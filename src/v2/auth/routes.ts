// Copyright (c) 2025 AccelByte Inc. All Rights Reserved.
// This is licensed software from AccelByte Inc, for limitations
// and restrictions contact your company contract manager.

import type { Express, Request, Response, NextFunction } from "express";

import { OAuthProtectedResourceMetadata } from "@modelcontextprotocol/sdk/shared/auth.js";

import log from "../logger.js";

/**
 * Simple in-memory cache for authorization server metadata.
 * Caches metadata per URL with a configurable TTL to avoid fetching on every request.
 */
interface MetadataCacheEntry {
  metadata: unknown;
  expiresAt: number;
}

const metadataCache = new Map<string, MetadataCacheEntry>();
const METADATA_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const METADATA_FETCH_TIMEOUT_MS = 10_000; // 10 seconds

/**
 * Authorization server discovery mode for OAuth.
 * - `none`: Use standard discovery (no workaround)
 * - `redirect`: Advertise this server as the authorization server and redirect
 *   clients to the actual authorization server
 * - `proxy`: Advertise this server as the authorization server and proxy
 *   the discovery document from the actual authorization server
 */
enum AuthorizationServerDiscoveryMode {
  None = "none",
  Redirect = "redirect",
  Proxy = "proxy",
}

interface RegisterOAuthRoutesOptions {
  /**
   * Workaround for MCP clients that cannot discover the actual authorization
   * server using the standard discovery rules. When set to `redirect` or `proxy`,
   * this MCP server advertises itself as the authorization server so that clients
   * talk to it, and it can then redirect or proxy them to the actual authorization server.
   *
   * @default AuthorizationServerDiscoveryMode.None
   */
  authorizationServerDiscoveryMode?: AuthorizationServerDiscoveryMode;

  /**
   * Whether hosted mode is enabled.
   * When true, the authorization server URL is derived from req.ags.baseUrl.
   */
  hostedMode?: boolean;

  /**
   * MCP endpoint path (e.g., "/mcp").
   * Used to construct the protected resource URL.
   */
  mcpPath?: string;
}

function registerOAuthRoutes(
  app: Express,
  resourceServerUrl: string,
  authorizationServerUrl: string,
  options: RegisterOAuthRoutesOptions = {},
): void {
  const {
    authorizationServerDiscoveryMode = AuthorizationServerDiscoveryMode.None,
    hostedMode = false,
    mcpPath = "/mcp",
  } = options;

  const isDiscoveryWorkaroundEnabled =
    authorizationServerDiscoveryMode !== AuthorizationServerDiscoveryMode.None;

  app.get(
    "/.well-known/oauth-protected-resource",
    (req: Request, res: Response) => {
      // Check if we have request headers that indicate we're behind a reverse proxy
      // NOTE: In production, these headers should be validated/whitelisted to prevent
      // header injection attacks. Only trust headers from known reverse proxies.
      const forwardedHost = req.get("x-forwarded-host");
      const forwardedPort = req.get("x-forwarded-port");
      const host = req.get("host");
      const forwardedProto = req.get("x-forwarded-proto");

      // Determine base URL, authorization server URL, and protected resource URL
      let effectiveBaseUrl: string;
      let effectiveAuthServer: string;
      let protectedResourceUrl: string;

      if (forwardedHost || (host && forwardedPort)) {
        // Behind reverse proxy: construct from request headers
        const protocol = forwardedProto || req.protocol || "http";
        let requestHost = forwardedHost || host || "";

        // Ensure port is included
        if (requestHost && !requestHost.includes(":")) {
          if (
            forwardedPort &&
            forwardedPort !== "80" &&
            forwardedPort !== "443"
          ) {
            requestHost = `${requestHost}:${forwardedPort}`;
          }
        }

        if (requestHost) {
          const baseUrl = `${protocol}://${requestHost}`;
          effectiveBaseUrl = baseUrl;
          effectiveAuthServer = baseUrl;
          protectedResourceUrl = `${baseUrl}${mcpPath}`;
        } else {
          // Fallback to configured URLs
          effectiveBaseUrl = authorizationServerUrl;
          effectiveAuthServer = authorizationServerUrl;
          protectedResourceUrl = `${resourceServerUrl}${mcpPath}`;
        }
      } else if (hostedMode && req.ags?.baseUrl) {
        // Hosted mode with ags baseUrl: use that
        effectiveBaseUrl = req.ags.baseUrl;
        effectiveAuthServer = req.ags.baseUrl;
        protectedResourceUrl = `${req.ags.baseUrl}${mcpPath}`;
      } else {
        // Default: use configured URLs
        effectiveBaseUrl = authorizationServerUrl;
        effectiveAuthServer = authorizationServerUrl;
        protectedResourceUrl = `${resourceServerUrl}${mcpPath}`;
      }

      const metadata: OAuthProtectedResourceMetadata = {
        resource: protectedResourceUrl,
        authorization_servers: isDiscoveryWorkaroundEnabled
          ? [effectiveBaseUrl]
          : [effectiveAuthServer],
        bearer_methods_supported: ["header"],
      };
      res.status(200).json(metadata);
    },
  );

  if (isDiscoveryWorkaroundEnabled) {
    app.get(
      "/.well-known/oauth-authorization-server",
      async (_: Request, res: Response, next: NextFunction) => {
        try {
          const baseUrl = authorizationServerUrl.replace(/\/+$/, "");
          const metadataUrl = `${baseUrl}/.well-known/oauth-authorization-server`;

          if (
            authorizationServerDiscoveryMode ===
            AuthorizationServerDiscoveryMode.Redirect
          ) {
            // Use 307 (Temporary Redirect) to preserve HTTP method
            // This is appropriate for OAuth discovery redirects
            res.redirect(307, metadataUrl);
          } else if (
            authorizationServerDiscoveryMode ===
            AuthorizationServerDiscoveryMode.Proxy
          ) {
            // Check cache first
            const cached = metadataCache.get(metadataUrl);
            if (cached && cached.expiresAt > Date.now()) {
              log.debug({ metadataUrl }, "Returning cached metadata");
              res.status(200).json(cached.metadata);
              return;
            }

            // Fetch with timeout
            const controller = new AbortController();
            const timeoutId = setTimeout(
              () => controller.abort(),
              METADATA_FETCH_TIMEOUT_MS,
            );

            try {
              const response = await fetch(metadataUrl, {
                signal: controller.signal,
              });
              clearTimeout(timeoutId);

              if (!response.ok) {
                log.error(
                  { metadataUrl, status: response.status },
                  "Authorization server returned error",
                );
                res.status(502).json({
                  error: "Bad Gateway",
                  message: "Authorization server returned an error",
                });
                return;
              }

              // Validate content type
              const contentType = response.headers.get("content-type");
              if (!contentType?.includes("application/json")) {
                log.error(
                  { metadataUrl, contentType },
                  "Authorization server returned non-JSON response",
                );
                res.status(502).json({
                  error: "Bad Gateway",
                  message: "Authorization server returned invalid content type",
                });
                return;
              }

              const metadata = await response.json();

              // Cache the result
              metadataCache.set(metadataUrl, {
                metadata,
                expiresAt: Date.now() + METADATA_CACHE_TTL_MS,
              });

              log.debug({ metadataUrl }, "Fetched and cached metadata");
              res.status(200).json(metadata);
            } catch (fetchError) {
              clearTimeout(timeoutId);

              if (
                fetchError instanceof Error &&
                fetchError.name === "AbortError"
              ) {
                log.error({ metadataUrl }, "Metadata fetch timed out");
                res.status(504).json({
                  error: "Gateway Timeout",
                  message: "Authorization server did not respond in time",
                });
                return;
              }

              throw fetchError;
            }
          }
        } catch (error) {
          log.error(
            { error: error instanceof Error ? error.message : error },
            "Error in OAuth authorization server proxy",
          );
          next(error);
        }
      },
    );
  }
}

export { AuthorizationServerDiscoveryMode, type RegisterOAuthRoutesOptions };
export default registerOAuthRoutes;
