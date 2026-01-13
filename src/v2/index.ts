// Copyright (c) 2025 AccelByte Inc. All Rights Reserved.
// This is licensed software from AccelByte Inc, for limitations
// and restrictions contact your company contract manager.

import { Express } from "express";
import { create as createExpress, start as startExpress } from "./express.js";

import config from "./config.js";
import registerMcpRoutes, { McpServerFactory } from "./mcp/routes.js";
import registerOAuthRoutes from "./auth/routes.js";
import { resolveAgsHost } from "./auth/host-resolver.js";
import createServer from "./mcp/server.js";

const app: Express = createExpress();

if (config.hosted.enabled) {
  app.use(resolveAgsHost(config.hosted));
}

const mcpServerFactory: McpServerFactory = async (context) =>
  createServer("ags-api-mcp-server", "2025.9.0", config, context);

if (config.mcp.enableAuth) {
  registerOAuthRoutes(app, config.mcp.serverUrl, config.openapi.serverUrl, {
    hostedMode: config.hosted.enabled,
  });
}

registerMcpRoutes(app, mcpServerFactory, {
  path: config.mcp.path,
  enableAuth: config.mcp.enableAuth,
  defaultAgsBaseUrl: config.openapi.serverUrl,
});

// Root informational endpoint
app.get("/", (req, res) => {
  const openapiServerUrl = req.ags?.baseUrl || config.openapi.serverUrl;

  res.json({
    name: "ags-api-mcp-server",
    version: "2026.1.0",
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

startExpress(app, config.mcp.port);
