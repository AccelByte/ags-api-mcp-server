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

startExpress(app, config.mcp.port);
