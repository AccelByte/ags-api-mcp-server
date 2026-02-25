// Copyright (c) 2025 AccelByte Inc. All Rights Reserved.
// This is licensed software from AccelByte Inc, for limitations
// and restrictions contact your company contract manager.

import type { Express, Request, Response, NextFunction } from "express";

import { OAuthProtectedResourceMetadata } from "@modelcontextprotocol/sdk/shared/auth.js";

import log from "../logger.js";
import { assertNotPrivateUrl } from "../ssrf-guard.js";
import { deriveBaseUrl } from "../utils.js";

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
 * - `proxyRegister`: Like `proxy`, but also proxies the registration endpoint
 *
 * TEMPORARY WORKAROUND: All modes except `none` exist because VS Code and some
 * MCP clients cannot discover the auth server when it's on a different host.
 * TODO: Remove once MCP clients properly support cross-origin OAuth discovery.
 */
enum AuthorizationServerDiscoveryMode {
  None = "none",
  Redirect = "redirect",
  Proxy = "proxy",
  ProxyRegister = "proxyRegister",
}

interface RegisterOAuthRoutesOptions {
  /**
   * Workaround for MCP clients that cannot discover the actual authorization
   * server using the standard discovery rules. When set to `redirect`, `proxy`,
   * or `proxyRegister`, this MCP server advertises itself as the authorization
   * server so that clients talk to it, and it can then redirect or proxy them
   * to the actual authorization server.
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
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    hostedMode = false,
    mcpPath = "/mcp",
  } = options;

  const isDiscoveryWorkaroundEnabled =
    authorizationServerDiscoveryMode !== AuthorizationServerDiscoveryMode.None;

  app.get(
    "/.well-known/oauth-protected-resource",
    (req: Request, res: Response) => {
      const effectiveAuthServer = deriveBaseUrl(req, authorizationServerUrl);
      const protectedResourceUrl = `${deriveBaseUrl(req, resourceServerUrl)}${mcpPath}`;

      const metadata: OAuthProtectedResourceMetadata = {
        resource: protectedResourceUrl,
        authorization_servers: [effectiveAuthServer],
        bearer_methods_supported: ["header"],
      };
      res.status(200).json(metadata);
    },
  );

  // Namespace-aware protected resource metadata endpoint.
  // When a namespace is present, authorization_servers includes the namespace
  // as a path component so that MCP clients discover the namespace-specific
  // authorization server. This is a custom convention (not defined by RFC 9728)
  // to support multi-tenant namespace routing.
  app.get(
    "/.well-known/oauth-protected-resource/:namespace",
    (req: Request, res: Response) => {
      const { namespace } = req.params;

      // Validate namespace to prevent path traversal / URL injection
      if (!namespace || !/^[a-zA-Z0-9_-]+$/.test(namespace)) {
        res.status(400).json({
          error: "Bad Request",
          message: "Invalid namespace",
        });
        return;
      }

      const effectiveAuthServer = deriveBaseUrl(req, authorizationServerUrl);
      const protectedResourceUrl = `${deriveBaseUrl(req, resourceServerUrl)}${mcpPath}/${namespace}`;

      const metadata: OAuthProtectedResourceMetadata = {
        resource: protectedResourceUrl,
        authorization_servers: [`${effectiveAuthServer}/${namespace}`],
        bearer_methods_supported: ["header"],
      };
      res.status(200).json(metadata);
    },
  );

  if (isDiscoveryWorkaroundEnabled) {
    const oauthAuthServerHandler = async (
      req: Request,
      res: Response,
      next: NextFunction,
    ) => {
      try {
        const { namespace } = req.params;

        // Validate namespace if present to prevent path traversal / URL injection
        if (namespace && !/^[a-zA-Z0-9_-]+$/.test(namespace)) {
          res.status(400).json({
            error: "Bad Request",
            message: "Invalid namespace",
          });
          return;
        }

        const baseUrl = authorizationServerUrl.replace(/\/+$/, "");
        const metadataUrl = namespace
          ? `${baseUrl}/.well-known/oauth-authorization-server/${namespace}`
          : `${baseUrl}/.well-known/oauth-authorization-server`;

        if (
          authorizationServerDiscoveryMode ===
          AuthorizationServerDiscoveryMode.Redirect
        ) {
          // Use 307 (Temporary Redirect) to preserve HTTP method
          // This is appropriate for OAuth discovery redirects
          res.redirect(307, metadataUrl);
        } else if (
          authorizationServerDiscoveryMode ===
            AuthorizationServerDiscoveryMode.Proxy ||
          authorizationServerDiscoveryMode ===
            AuthorizationServerDiscoveryMode.ProxyRegister
        ) {
          // Check cache first
          const cached = metadataCache.get(metadataUrl);
          if (cached && cached.expiresAt > Date.now()) {
            log.debug({ metadataUrl }, "Returning cached metadata");
            res.status(200).json(cached.metadata);
            return;
          }

          // SSRF guard: prevent proxy fetches to private/internal addresses
          await assertNotPrivateUrl(new URL(metadataUrl));

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

            // For ProxyRegister mode, rewrite registration_endpoint to go through this server
            if (
              authorizationServerDiscoveryMode ===
              AuthorizationServerDiscoveryMode.ProxyRegister
            ) {
              const registrationPath = namespace
                ? `/oauth/namespaces/${namespace}/register`
                : `/oauth/register`;
              res.status(200).json({
                ...metadata,
                registration_endpoint: `${resourceServerUrl}${registrationPath}`,
              });
            } else {
              res.status(200).json(metadata);
            }
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
    };

    app.get("/.well-known/oauth-authorization-server", oauthAuthServerHandler);

    app.get(
      "/.well-known/oauth-authorization-server/:namespace",
      oauthAuthServerHandler,
    );

    // TEMPORARY WORKAROUND: Proxy registration endpoint for ProxyRegister mode.
    // Proxies OAuth dynamic client registration to the actual auth server.
    // TODO: Remove once MCP clients properly support cross-origin OAuth discovery.
    if (
      authorizationServerDiscoveryMode ===
      AuthorizationServerDiscoveryMode.ProxyRegister
    ) {
      const baseUrl = authorizationServerUrl.replace(/\/+$/, "");

      const oauthRegisterHandler = async (
        req: Request,
        res: Response,
        next: NextFunction,
      ) => {
        try {
          const { namespace } = req.params;

          // Validate namespace if present to prevent path traversal / URL injection
          if (namespace && !/^[a-zA-Z0-9_-]+$/.test(namespace)) {
            res.status(400).json({
              error: "Bad Request",
              message: "Invalid namespace",
            });
            return;
          }

          log.debug(
            {
              namespace,
              headers: {
                "content-type": req.get("Content-Type"),
                "user-agent": req.get("User-Agent"),
              },
            },
            "Incoming OAuth registration request (proxied)",
          );

          // Resolve actual registration endpoint from metadata
          const metadataUrl = namespace
            ? `${baseUrl}/.well-known/oauth-authorization-server/${namespace}`
            : `${baseUrl}/.well-known/oauth-authorization-server`;
          let registrationEndpoint = namespace
            ? `${baseUrl}/iam/v3/namespace/${namespace}/oauth/register`
            : `${baseUrl}/iam/v3/oauth/register`; // fallback

          // SSRF guard: prevent registration proxy fetches to private/internal addresses
          await assertNotPrivateUrl(new URL(metadataUrl));

          try {
            const metadataResponse = await fetch(metadataUrl);
            if (metadataResponse.ok) {
              const metadata = await metadataResponse.json();
              if (metadata.registration_endpoint) {
                registrationEndpoint = metadata.registration_endpoint;
              }
            }
          } catch (metadataError) {
            log.warn(
              { error: metadataError },
              "Failed to fetch metadata for registration endpoint, using default",
            );
          }

          // SSRF guard: validate the registration endpoint (may come from upstream metadata)
          await assertNotPrivateUrl(new URL(registrationEndpoint));

          log.debug(
            { registrationEndpoint, namespace },
            "Forwarding registration request to auth server",
          );

          const regController = new AbortController();
          const regTimeoutId = setTimeout(
            () => regController.abort(),
            METADATA_FETCH_TIMEOUT_MS,
          );

          let response: globalThis.Response;
          try {
            response = await fetch(registrationEndpoint, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(req.body),
              signal: regController.signal,
            });
          } catch (fetchErr) {
            clearTimeout(regTimeoutId);
            if (fetchErr instanceof Error && fetchErr.name === "AbortError") {
              log.error(
                { registrationEndpoint },
                "Registration proxy fetch timed out",
              );
              res.status(504).json({
                error: "Gateway Timeout",
                message: "Authorization server did not respond in time",
              });
              return;
            }
            throw fetchErr;
          }
          clearTimeout(regTimeoutId);

          const data = await response.json();

          log.debug(
            {
              status: response.status,
              hasClientId: !!data.client_id,
            },
            "OAuth registration response received",
          );

          res.status(response.status).json(data);
        } catch (error) {
          log.error({ error }, "OAuth registration proxy error");
          next(error);
        }
      };

      app.post("/oauth/register", oauthRegisterHandler);
      app.post("/oauth/namespaces/:namespace/register", oauthRegisterHandler);
    }
  }
}

export { AuthorizationServerDiscoveryMode, type RegisterOAuthRoutesOptions };
export default registerOAuthRoutes;
