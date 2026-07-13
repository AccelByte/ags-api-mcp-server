// Copyright (c) 2025 AccelByte Inc.
// SPDX-License-Identifier: Apache-2.0

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v3";

import { WaterfallChartOutputSchema } from "../../../shared/render-schemas.js";
import type { ProviderRegistry } from "../providers/registry.js";
import { defineRenderTool } from "./define.js";

export function setupRenderWaterfallChart(
  server: McpServer,
  registry: ProviderRegistry,
): void {
  defineRenderTool({
    server,
    registry,
    name: "render_waterfall_chart",
    title: "Render Waterfall Chart",
    description:
      "Render a query result as a waterfall chart. category defines each step and value provides the delta amount. " +
      'Use provider="facade" to render server-side results by reference (fidelity-preserving). ' +
      'Use provider="direct" only for small inline datasets.',
    chartType: "waterfall",
    outputSchema: WaterfallChartOutputSchema,
    optionFields: {
      category: z.string().describe("Column name for waterfall steps."),
      value: z.string().describe("Numeric column used for step deltas."),
      is_total: z
        .string()
        .optional()
        .describe("Optional boolean-like column indicating total bars."),
      x_label: z.string().optional(),
      y_label: z.string().optional(),
    },
    mapInputToOptions: (input) => ({
      category: input.category,
      value: input.value,
      is_total: input.is_total,
      x_label: input.x_label,
      y_label: input.y_label,
    }),
  });
}

export default setupRenderWaterfallChart;
