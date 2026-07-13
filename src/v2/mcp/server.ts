// Copyright (c) 2025 AccelByte Inc.
// SPDX-License-Identifier: Apache-2.0

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { Config } from "../config.js";
import { registerRendererResource } from "./renderer-resource.js";
import { McpRequestContext } from "./routes.js";
import setupApiTools from "./tools/api.js";
import { getOrCreateOpenApiTools } from "./tools/openapi-tools-factory.js";
import setupAuthTools from "./tools/auth.js";
import setupWorkflows from "./prompts/workflows.js";
import setupPlaybooks from "./prompts/playbooks.js";
import setupRenderTools from "./tools/renderers/index.js";

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

  const openApiTools = await getOrCreateOpenApiTools(effectiveConfig);

  // Pass namespace from requestContext to setupApiTools for default path param
  await setupApiTools(
    server,
    effectiveConfig,
    openApiTools,
    requestContext?.namespace,
  );
  setupAuthTools(server);
  await setupWorkflows(server);
  await setupPlaybooks(server);

  if (effectiveConfig.mcp.enableRenderTools) {
    setupRenderTools(
      server,
      openApiTools,
      requestContext?.namespace,
      effectiveConfig.mcp.allowDirectPins,
    );
    await registerRendererResource(server);
  }

  return server;
}

export default createServer;
