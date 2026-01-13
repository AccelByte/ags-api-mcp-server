// Copyright (c) 2025 AccelByte Inc. All Rights Reserved.
// This is licensed software from AccelByte Inc, for limitations
// and restrictions contact your company contract manager.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { Config } from "../config.js";
import { McpRequestContext } from "./routes.js";
import setupApiTools from "./tools/api.js";
import setupAuthTools from "./tools/auth.js";
import setupWorkflows from "./prompts/workflows.js";

/**
 * Creates a new MCP server instance with tools and prompts registered.
 *
 * @param name - Server name
 * @param version - Server version
 * @param config - Application configuration
 * @param requestContext - Per-request context (optional, used in hosted mode)
 */
async function createServer(
  name: string,
  version: string,
  config: Config,
  requestContext?: McpRequestContext,
): Promise<McpServer> {
  const server = new McpServer({ name, version });

  // Determine the effective AGS base URL:
  // 1. From request context (hosted mode)
  // 2. From static config (non-hosted mode)
  const effectiveAgsBaseUrl =
    requestContext?.agsBaseUrl || config.openapi.serverUrl;

  // Create a merged config with the effective AGS base URL
  const effectiveConfig: Config = {
    ...config,
    openapi: {
      ...config.openapi,
      serverUrl: effectiveAgsBaseUrl,
    },
  };

  await setupApiTools(server, effectiveConfig);
  setupAuthTools(server);
  await setupWorkflows(server);

  return server;
}

export default createServer;
