// Copyright (c) 2025 AccelByte Inc.
// SPDX-License-Identifier: Apache-2.0

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v3";

import { TableOutputSchema } from "../../../shared/render-schemas.js";
import type { ProviderRegistry } from "../providers/registry.js";
import { defineRenderTool } from "./define.js";

export function setupRenderTable(
  server: McpServer,
  registry: ProviderRegistry,
): void {
  defineRenderTool({
    server,
    registry,
    name: "render_table",
    title: "Render Table",
    description:
      'Render a query result as a paginated table. Use provider="facade" to render server-side results by reference (fidelity-preserving). ' +
      'Use provider="direct" only for small inline datasets.',
    chartType: "table",
    outputSchema: TableOutputSchema,
    optionFields: {
      columns_order: z
        .array(z.string())
        .optional()
        .describe("Optional explicit display order for table columns."),
      page_size: z.number().int().min(1).max(500).default(50),
    },
    mapInputToOptions: (input) => ({
      columns_order: input.columns_order,
      page_size: input.page_size,
    }),
  });
}

export default setupRenderTable;
