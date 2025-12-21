// Copyright (c) 2025 AccelByte Inc. All Rights Reserved.
// This is licensed software from AccelByte Inc, for limitations
// and restrictions contact your company contract manager.

import { Express } from "express";
import { create as createExpress, start as startExpress } from "./express.js";

import config from "./config.js";
import registerMcpRoutes, { McpServerFactory } from "./mcp/routes.js";
import registerOAuthRoutes from "./auth/routes.js";
import createServer from "./mcp/server.js";

const app: Express = createExpress();

const mcpServerFactory: McpServerFactory = async () =>
  createServer("test", "1.0.0", config);

if (config.mcp.enableAuth) {
  registerOAuthRoutes(app, config.mcp.serverUrl, config.openapi.serverUrl);
}

registerMcpRoutes(app, mcpServerFactory, {
  path: config.mcp.path,
  enableAuth: config.mcp.enableAuth,
});

// Root informational endpoint
app.get("/", (_, res) => {
  res.json({
    name: "ags-api-mcp-server",
    version: "2025.9.0",
    description: "AccelByte Gaming Services API MCP Server",
    endpoints: {
      mcp: `${config.mcp.serverUrl}${config.mcp.path}`,
      health: `${config.mcp.serverUrl}/health`,
      protectedResourceMetadata: `${config.mcp.serverUrl}/.well-known/oauth-protected-resource`,
    },
    authentication: {
      enabled: config.mcp.enableAuth,
      type: "Bearer Token (JWT)",
      authorizationServer: config.openapi.serverUrl,
    },
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
