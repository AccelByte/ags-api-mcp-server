// Copyright (c) 2025 AccelByte Inc. All Rights Reserved.
// This is licensed software from AccelByte Inc, for limitations
// and restrictions contact your company contract manager.

import type { Express, Request, Response, NextFunction } from "express";

import { OAuthProtectedResourceMetadata } from "@modelcontextprotocol/sdk/shared/auth.js";

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
  } = options;

  const isDiscoveryWorkaroundEnabled =
    authorizationServerDiscoveryMode !== AuthorizationServerDiscoveryMode.None;

  app.get(
    "/.well-known/oauth-protected-resource",
    (req: Request, res: Response) => {
      const effectiveBaseUrl =
        hostedMode && req.ags?.baseUrl
          ? req.ags.baseUrl
          : authorizationServerUrl;
      const effectiveAuthServer =
        hostedMode && req.ags?.baseUrl
          ? req.ags.baseUrl
          : authorizationServerUrl;

      const metadata: OAuthProtectedResourceMetadata = {
        resource: effectiveBaseUrl,
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
            const response = await fetch(metadataUrl);
            if (!response.ok) {
              throw new Error(
                `Failed to fetch authorization server metadata: ${response.status} ${response.statusText}`,
              );
            }
            const metadata = await response.json();
            res.status(200).json(metadata);
          }
        } catch (error) {
          next(error);
        }
      },
    );
  }
}

export { AuthorizationServerDiscoveryMode, type RegisterOAuthRoutesOptions };
export default registerOAuthRoutes;
