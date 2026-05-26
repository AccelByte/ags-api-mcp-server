// Copyright (c) 2025 AccelByte Inc. All Rights Reserved.
// This is licensed software from AccelByte Inc, for limitations
// and restrictions contact your company contract manager.

import { Express } from "express";
import { create as createExpress, start as startExpress } from "./express.js";

import config from "./config.js";
import registerMcpRoutes, { McpServerFactory } from "./mcp/routes.js";
import registerOAuthRoutes, {
  AuthorizationServerDiscoveryMode,
} from "./auth/routes.js";
import { resolveAgsHost } from "./auth/host-resolver.js";
import { prewarmJwksCache } from "./auth/middleware.js";
import createServer from "./mcp/server.js";

const app: Express = createExpress();

if (config.hosted.enabled) {
  app.use(resolveAgsHost(config.hosted));
}

const mcpServerFactory: McpServerFactory = async (context) =>
  createServer("ags-api-mcp-server", "2026.3.1", config, context);

if (config.mcp.enableAuth) {
  registerOAuthRoutes(app, config.mcp.serverUrl, config.openapi.serverUrl, {
    authorizationServerDiscoveryMode: config.mcp
      .authServerDiscoveryMode as AuthorizationServerDiscoveryMode,
    hostedMode: config.hosted.enabled,
    mcpPath: config.mcp.path,
    // Same hosted-mode gate as below: the flag only takes effect in hosted
    // (multi-tenant) deployments where it was designed to live.
    allowParentDomainIssuer:
      config.hosted.enabled && config.hosted.allowParentDomainIssuer,
  });
}

registerMcpRoutes(app, mcpServerFactory, {
  path: config.mcp.path,
  enableAuth: config.mcp.enableAuth,
  defaultAgsBaseUrl: config.openapi.serverUrl,
  mcpServerUrl: config.mcp.serverUrl,
  hostedMode: config.hosted.enabled,
  // Gate the flag on hosted mode so an operator who flips MCP_HOSTED=false
  // (e.g. moving a deployment from multi-tenant to standalone) does not
  // silently keep a loosened issuer check that only made sense for the
  // shared-auth-server topology in the first place.
  allowParentDomainIssuer:
    config.hosted.enabled && config.hosted.allowParentDomainIssuer,
});

// Root informational endpoint
app.get("/", (req, res) => {
  const openapiServerUrl = req.ags?.baseUrl || config.openapi.serverUrl;

  res.json({
    name: "ags-api-mcp-server",
    version: "2026.3.0",
    description: "AccelByte Gaming Services API MCP Server",
    mode: config.hosted.enabled ? "hosted" : "standalone",
    endpoints: {
      mcp: `${config.mcp.serverUrl}${config.mcp.path}`,
      health: `${config.mcp.serverUrl}/health`,
      protectedResourceMetadata: `${config.mcp.serverUrl}/.well-known/oauth-protected-resource`,
    },
    authentication: {
      enabled: config.mcp.enableAuth,
      type: "Bearer Token (JWT)",
      authorizationServer: openapiServerUrl,
    },
    ...(config.hosted.enabled &&
      req.ags && {
        context: {
          agsBaseUrl: req.ags.baseUrl,
        },
      }),
    documentation: {
      mcp: "https://modelcontextprotocol.io/",
      accelbyte: "https://docs.accelbyte.io/",
    },
  });
});

// Health check endpoint
app.get("/health", (_, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Pre-warm JWKS discovery cache before accepting requests to avoid
// cold-start latency and duplicate concurrent fetches on early requests.
if (config.mcp.enableAuth) {
  await prewarmJwksCache(config.openapi.serverUrl);
}

startExpress(app, config.mcp.port);
