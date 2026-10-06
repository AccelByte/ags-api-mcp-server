// Copyright (c) 2025 AccelByte Inc.
// SPDX-License-Identifier: Apache-2.0

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  ListToolsRequestSchema,
  type ListToolsResult,
} from "@modelcontextprotocol/sdk/types.js";

import { Config } from "../config.js";
import { registerRendererResource } from "./renderer-resource.js";
import { McpRequestContext } from "./routes.js";
import setupApiTools from "./tools/api.js";
import { getOrCreateOpenApiTools } from "./tools/openapi-tools-factory.js";
import setupAuthTools from "./tools/auth.js";
import setupWorkflows from "./prompts/workflows.js";
import setupPlaybooks from "./prompts/playbooks.js";
import setupRenderTools from "./tools/renderers/index.js";

type ListToolsHandler = (
  ...args: unknown[]
) => ListToolsResult | Promise<ListToolsResult>;

/**
 * Drops the draft-07 `$schema` that zod-to-json-schema stamps on each
 * `outputSchema`; clients with a 2020-12-only validator reject it. The SDK has
 * no hook for this, so the `tools/list` handler is wrapped directly.
 */
function stripOutputSchemaDialect(server: McpServer): void {
  const method = ListToolsRequestSchema.shape.method.value;
  const handlers =
    // eslint-disable-next-line no-underscore-dangle
    (
      server.server as unknown as {
        _requestHandlers: Map<string, ListToolsHandler>;
      }
    )._requestHandlers;
  const listTools = handlers.get(method);
  if (!listTools) return;

  handlers.set(method, async (...args) => {
    const result = await listTools(...args);
    return {
      ...result,
      tools: result.tools.map((tool) => {
        if (!tool.outputSchema) return tool;
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { $schema, ...outputSchema } = tool.outputSchema;
        return { ...tool, outputSchema };
      }),
    };
  });
}

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

  stripOutputSchemaDialect(server);

  return server;
}

export default createServer;
