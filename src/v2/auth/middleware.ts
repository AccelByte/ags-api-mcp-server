// Copyright (c) 2025 AccelByte Inc. All Rights Reserved.
// This is licensed software from AccelByte Inc, for limitations
// and restrictions contact your company contract manager.

import type { Request, RequestHandler } from "express";
import jwt, { JwtHeader, JwtPayload, SigningKeyCallback } from "jsonwebtoken";
import jwksClient from "jwks-client";
import { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";

import log from "../logger.js";

interface TokenPayload extends JwtPayload {
  client_id?: string;
  exp?: number;
  scope?: string | string[];
}

/**
 * Cache for resolved JWKS URIs (keyed by authorization server base URL).
 * Avoids fetching /.well-known/oauth-authorization-server on every request.
 */
interface JwksUriCacheEntry {
  jwksUri: string;
  expiresAt: number;
}

const jwksUriCache = new Map<string, JwksUriCacheEntry>();
const JWKS_URI_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const DISCOVERY_FETCH_TIMEOUT_MS = 10_000; // 10 seconds

// Cache JWKS clients by URI to avoid creating new clients per request
const jwksClients = new Map<string, ReturnType<typeof jwksClient>>();

function getOrCreateJwksClient(
  jwksUri: string,
): ReturnType<typeof jwksClient> {
  let client = jwksClients.get(jwksUri);
  if (!client) {
    client = jwksClient({
      jwksUri,
      cache: true,
      cacheMaxAge: "10m",
      rateLimit: true,
      jwksRequestsPerMinute: 10,
    });
    jwksClients.set(jwksUri, client);
  }
  return client;
}

/**
 * Discovers the JWKS URI for a given AGS base URL by fetching the
 * OAuth authorization server metadata from
 * `{agsBaseUrl}/.well-known/oauth-authorization-server`.
 *
 * Results are cached to avoid repeated discovery fetches.
 */
async function discoverJwksUri(agsBaseUrl: string): Promise<string> {
  const cached = jwksUriCache.get(agsBaseUrl);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.jwksUri;
  }

  const metadataUrl = `${agsBaseUrl}/.well-known/oauth-authorization-server`;

  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    DISCOVERY_FETCH_TIMEOUT_MS,
  );

  try {
    const response = await fetch(metadataUrl, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(
        `Discovery endpoint returned HTTP ${response.status}`,
      );
    }

    const metadata = await response.json();

    if (typeof metadata.jwks_uri !== "string" || !metadata.jwks_uri) {
      throw new Error("Discovery metadata missing jwks_uri");
    }

    const jwksUri: string = metadata.jwks_uri;

    jwksUriCache.set(agsBaseUrl, {
      jwksUri,
      expiresAt: Date.now() + JWKS_URI_CACHE_TTL_MS,
    });

    log.debug({ agsBaseUrl, jwksUri }, "Discovered JWKS URI");
    return jwksUri;
  } catch (err) {
    clearTimeout(timeoutId);
    throw new Error(
      `Failed to discover JWKS URI from ${metadataUrl}: ${err instanceof Error ? err.message : err}`,
    );
  }
}

function verifyToken(
  token: string,
  jwksUri: string,
): Promise<TokenPayload> {
  const client = getOrCreateJwksClient(jwksUri);

  return new Promise((resolve, reject) => {
    jwt.verify(
      token,
      (header: JwtHeader, callback: SigningKeyCallback) => {
        if (!header.kid) {
          callback(new Error("Token header missing 'kid' claim"));
          return;
        }
        client.getSigningKey(header.kid, (err: Error | null, key: any) => {
          if (err) {
            callback(err);
            return;
          }
          const signingKey =
            key?.getPublicKey?.() || key?.publicKey || key?.rsaPublicKey;
          if (!signingKey) {
            callback(new Error("No signing key found for kid: " + header.kid));
            return;
          }
          callback(null, signingKey);
        });
      },
      { algorithms: ["RS256"] },
      (err, decoded) => {
        if (err) return reject(err);
        resolve(decoded as TokenPayload);
      },
    );
  });
}

interface SetAuthFromTokenOptions {
  /** Default AGS base URL used to discover JWKS URI in standalone mode */
  defaultAgsBaseUrl: string;
}

function setAuthFromToken(options: SetAuthFromTokenOptions): RequestHandler {
  return async (req, res, next) => {
    const authHeader = (req as Request).headers?.authorization;
    const [scheme, token] =
      typeof authHeader === "string" ? authHeader.split(" ") : [];

    // Only proceed if Authorization header is in the form "Bearer <JWT>"
    const isBearer =
      typeof scheme === "string" && scheme.toLowerCase() === "bearer";
    const looksLikeJwt =
      typeof token === "string" && token.split(".").length === 3;

    if (isBearer && looksLikeJwt) {
      const agsBaseUrl = req.ags?.baseUrl || options.defaultAgsBaseUrl;

      try {
        const jwksUri = await discoverJwksUri(agsBaseUrl);
        const decoded = await verifyToken(token, jwksUri);

        const clientId =
          typeof decoded.client_id === "string" ? decoded.client_id : "";

        const expiresAt =
          typeof decoded.exp === "number" ? decoded.exp : undefined;

        let scopes: string[] = [];
        if (Array.isArray(decoded.scope) && decoded.scope.length > 0) {
          scopes = decoded.scope;
        } else if (typeof decoded.scope === "string") {
          scopes = decoded.scope.split(" ");
        }

        (req as Request & { auth?: AuthInfo }).auth = {
          token,
          clientId,
          scopes,
          expiresAt,
        } satisfies AuthInfo;
      } catch (err) {
        log.warn(
          {
            error: err instanceof Error ? err.message : "Unknown error",
            agsBaseUrl,
          },
          "JWT signature verification failed",
        );
        res.status(401).json({
          error: "Unauthorized",
          message: "Invalid or expired token",
        });
        return;
      }
    }

    next();
  };
}

export default setAuthFromToken;
