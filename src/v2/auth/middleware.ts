// Copyright (c) 2025 AccelByte Inc. All Rights Reserved.
// This is licensed software from AccelByte Inc, for limitations
// and restrictions contact your company contract manager.

import type { Request, RequestHandler } from "express";
import jwt, { JwtHeader, JwtPayload, SigningKeyCallback } from "jsonwebtoken";
import jwksClient from "jwks-client";
import { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";

import log from "../logger.js";
import securityLog from "../security-logger.js";
import { assertNotPrivateHostname } from "../ssrf-guard.js";
import { validateUrlMatchesIssuer } from "./host-resolver.js";

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

/** Parse an integer env var with range validation; falls back to default on invalid input. */
function parseEnvInt(
  key: string,
  defaultValue: number,
  min: number,
  max: number,
): number {
  const raw = process.env[key];
  if (!raw) return defaultValue;
  const parsed = parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed < min || parsed > max) {
    log.warn(
      { key, raw, defaultValue, min, max },
      "Invalid env var value, using default",
    );
    return defaultValue;
  }
  return parsed;
}

const jwksUriCache = new Map<string, JwksUriCacheEntry>();
const JWKS_URI_CACHE_TTL_MS = parseEnvInt(
  "JWKS_CACHE_TTL_MS",
  10 * 60 * 1000,
  60_000,
  3_600_000,
); // default 10 min, range 1 min – 1 hr
const DISCOVERY_FETCH_TIMEOUT_MS = parseEnvInt(
  "JWKS_DISCOVERY_TIMEOUT_MS",
  10_000,
  3_000,
  30_000,
); // default 10s, range 3s – 30s
const JWKS_CACHE_MAX_AGE = process.env.JWKS_CACHE_MAX_AGE || "10m";
const JWKS_REQUESTS_PER_MINUTE = parseEnvInt("JWKS_RATE_LIMIT", 10, 1, 100);

// Maximum number of distinct AGS base URLs / JWKS URIs to cache.
// Prevents unbounded memory growth if many different URLs are encountered.
const MAX_CACHE_ENTRIES = 50;

/**
 * Evict the least-recently-used entry when the map reaches the max size.
 *
 * Uses ES2015+ Map insertion-order guarantee: entries are iterated in
 * insertion order. Callers promote entries on access by deleting and
 * re-inserting, so the first key is always the LRU candidate.
 */
function evictLRU<K, V>(map: Map<K, V>, max: number): void {
  if (map.size >= max) {
    const lru = map.keys().next().value;
    if (lru !== undefined) map.delete(lru);
  }
}

/** Promote `key` to most-recently-used position in a Map. */
function touchMapEntry<K, V>(map: Map<K, V>, key: K): void {
  const value = map.get(key);
  if (value !== undefined) {
    map.delete(key);
    map.set(key, value);
  }
}

// Cache JWKS clients by URI to avoid creating new clients per request
const jwksClients = new Map<string, ReturnType<typeof jwksClient>>();

function getOrCreateJwksClient(jwksUri: string): ReturnType<typeof jwksClient> {
  const existing = jwksClients.get(jwksUri);
  if (existing) {
    touchMapEntry(jwksClients, jwksUri);
    return existing;
  }

  const client = jwksClient({
    jwksUri,
    cache: true,
    cacheMaxAge: JWKS_CACHE_MAX_AGE,
    rateLimit: true,
    jwksRequestsPerMinute: JWKS_REQUESTS_PER_MINUTE,
  });
  jwksClients.set(jwksUri, client);
  evictLRU(jwksClients, MAX_CACHE_ENTRIES);
  return client;
}

/**
 * Per-URL rate limiter for JWKS discovery requests.
 * Prevents abuse in multi-tenant environments where many distinct base URLs
 * could trigger excessive outbound discovery fetches.
 */
interface DiscoveryRateEntry {
  requests: number;
  windowStart: number;
}
const discoveryRateLimit = new Map<string, DiscoveryRateEntry>();
const DISCOVERY_RATE_WINDOW_MS = 60_000; // 1-minute sliding window
const DISCOVERY_MAX_REQUESTS_PER_WINDOW = 5;

function checkDiscoveryRateLimit(agsBaseUrl: string): void {
  const now = Date.now();

  // Sweep expired entries to prevent unbounded growth in multi-tenant environments
  [...discoveryRateLimit.entries()].forEach(([url, e]) => {
    if (now - e.windowStart >= DISCOVERY_RATE_WINDOW_MS * 2) {
      discoveryRateLimit.delete(url);
    }
  });

  const entry = discoveryRateLimit.get(agsBaseUrl);

  if (!entry || now - entry.windowStart >= DISCOVERY_RATE_WINDOW_MS) {
    // Window expired or first request — start fresh
    discoveryRateLimit.set(agsBaseUrl, { requests: 1, windowStart: now });
    evictLRU(discoveryRateLimit, MAX_CACHE_ENTRIES);
    return;
  }

  if (entry.requests >= DISCOVERY_MAX_REQUESTS_PER_WINDOW) {
    log.warn(
      { agsBaseUrl, requests: entry.requests },
      "JWKS discovery rate limit exceeded",
    );
    throw new Error(
      `JWKS discovery rate limit exceeded for ${agsBaseUrl} (max ${DISCOVERY_MAX_REQUESTS_PER_WINDOW} per minute)`,
    );
  }

  entry.requests += 1;
}

/**
 * Discovers the JWKS URI for a given AGS base URL by fetching the
 * OAuth authorization server metadata from
 * `{agsBaseUrl}/.well-known/oauth-authorization-server`.
 *
 * Results are cached to avoid repeated discovery fetches.
 * Discovery requests are rate-limited per base URL to prevent abuse.
 */
async function discoverJwksUri(agsBaseUrl: string): Promise<string> {
  const cached = jwksUriCache.get(agsBaseUrl);
  if (cached && cached.expiresAt > Date.now()) {
    touchMapEntry(jwksUriCache, agsBaseUrl);
    return cached.jwksUri;
  }

  checkDiscoveryRateLimit(agsBaseUrl);

  const metadataUrl = `${agsBaseUrl}/.well-known/oauth-authorization-server`;

  // SSRF guard: prevent discovery fetches to private/internal addresses.
  // In hosted mode agsBaseUrl is derived from the Host header, so an attacker
  // could attempt to reach internal services.
  assertNotPrivateHostname(new URL(metadataUrl));

  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    DISCOVERY_FETCH_TIMEOUT_MS,
  );

  try {
    const response = await fetch(metadataUrl, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Discovery endpoint returned HTTP ${response.status}`);
    }

    const metadata = await response.json();

    if (typeof metadata.jwks_uri !== "string" || !metadata.jwks_uri) {
      throw new Error("Discovery metadata missing jwks_uri");
    }

    const jwksUri: string = metadata.jwks_uri;

    // Validate the returned JWKS URI is well-formed and uses HTTPS
    let jwksUrl: URL;
    try {
      jwksUrl = new URL(jwksUri);
    } catch {
      throw new Error(`Discovery returned malformed jwks_uri: ${jwksUri}`);
    }
    if (jwksUrl.protocol !== "https:") {
      throw new Error(
        `JWKS URI must use HTTPS, got: ${jwksUrl.protocol} (${jwksUri})`,
      );
    }
    // Block if JWKS host differs from the authorization server (prevents
    // compromised discovery endpoints from redirecting to attacker JWKS).
    const agsHost = new URL(agsBaseUrl).hostname;
    if (jwksUrl.hostname !== agsHost) {
      if (process.env.ALLOW_CROSS_DOMAIN_JWKS === "true") {
        log.warn(
          {
            agsBaseUrl,
            jwksUri,
            expectedHost: agsHost,
            actualHost: jwksUrl.hostname,
          },
          "JWKS URI hostname differs from authorization server (cross-domain JWKS enabled)",
        );
      } else {
        throw new Error(
          `JWKS URI hostname '${jwksUrl.hostname}' does not match authorization server '${agsHost}'. ` +
            `Set ALLOW_CROSS_DOMAIN_JWKS=true if this is intentional.`,
        );
      }
    }

    jwksUriCache.set(agsBaseUrl, {
      jwksUri,
      expiresAt: Date.now() + JWKS_URI_CACHE_TTL_MS,
    });
    evictLRU(jwksUriCache, MAX_CACHE_ENTRIES);

    log.debug({ agsBaseUrl, jwksUri }, "Discovered JWKS URI");
    return jwksUri;
  } catch (err) {
    clearTimeout(timeoutId);
    throw new Error(
      `Failed to discover JWKS URI from ${metadataUrl}: ${err instanceof Error ? err.message : err}`,
    );
  }
}

interface VerifyTokenOptions {
  jwksUri: string;
  /** If set, the token `aud` claim must contain this value. */
  audience?: string;
}

function verifyToken(
  token: string,
  options: VerifyTokenOptions,
): Promise<TokenPayload> {
  const client = getOrCreateJwksClient(options.jwksUri);

  return new Promise((resolve, reject) => {
    jwt.verify(
      token,
      (header: JwtHeader, callback: SigningKeyCallback) => {
        if (!header.kid) {
          callback(new Error("Token header missing 'kid' claim"));
          return;
        }
        client.getSigningKey(header.kid, (err, key) => {
          if (err) {
            callback(err);
            return;
          }
          if (!key) {
            callback(
              new Error(`No signing key returned for kid: ${header.kid}`),
            );
            return;
          }
          const signingKey =
            key.getPublicKey?.() || key.publicKey || key.rsaPublicKey;
          if (!signingKey) {
            callback(new Error(`No signing key found for kid: ${header.kid}`));
            return;
          }
          callback(null, signingKey);
        });
      },
      {
        algorithms: ["RS256"],
        clockTolerance: 30, // 30 seconds tolerance for clock skew
        ignoreNotBefore: false, // explicitly enforce nbf claim validation
        ...(options.audience ? { audience: options.audience } : {}),
      },
      (err, decoded) => {
        if (err) {
          return reject(err);
        }
        return resolve(decoded as TokenPayload);
      },
    );
  });
}

interface SetAuthFromTokenOptions {
  /** Default AGS base URL used to discover JWKS URI in standalone mode */
  defaultAgsBaseUrl: string;
  /** Expected audience claim. If set, tokens without a matching `aud` are rejected. */
  audience?: string;
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
        const decoded = await verifyToken(token, {
          jwksUri,
          audience: options.audience,
        });

        // Validate issuer claim matches the expected AGS environment
        if (decoded.iss && !validateUrlMatchesIssuer(agsBaseUrl, decoded.iss)) {
          throw new Error(
            `Token issuer '${decoded.iss}' does not match expected AGS environment '${agsBaseUrl}'`,
          );
        }

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
        securityLog.authSuccess({
          ip: req.ip,
          clientId,
          scopeCount: scopes.length,
        });
      } catch (err) {
        securityLog.authFailure({
          ip: req.ip,
          reason: err instanceof Error ? err.message : "Unknown error",
          agsBaseUrl,
          path: req.path,
        });
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

/**
 * Pre-warms the JWKS discovery cache for the given AGS base URL.
 * Call at server startup to avoid cold-start latency on the first request.
 */
async function prewarmJwksCache(agsBaseUrl: string): Promise<void> {
  try {
    await discoverJwksUri(agsBaseUrl);
    log.info({ agsBaseUrl }, "JWKS cache pre-warmed");
  } catch (err) {
    const allowColdStart = process.env.ALLOW_JWKS_COLD_START === "true";
    if (allowColdStart) {
      log.warn(
        { agsBaseUrl, error: err instanceof Error ? err.message : err },
        "JWKS cache pre-warming failed (cold start enabled, will retry on first request)",
      );
    } else {
      log.error(
        { agsBaseUrl, error: err instanceof Error ? err.message : err },
        "JWKS cache pre-warming failed — server cannot authenticate requests. " +
          "Set ALLOW_JWKS_COLD_START=true to start anyway.",
      );
      process.exit(1);
    }
  }
}

export default setAuthFromToken;
export { prewarmJwksCache };
