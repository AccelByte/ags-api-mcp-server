// Copyright (c) 2025 AccelByte Inc.
// SPDX-License-Identifier: Apache-2.0

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v3";

import { HeatmapChartOutputSchema } from "../../../shared/render-schemas.js";
import type { ProviderRegistry } from "../providers/registry.js";
import { defineRenderTool } from "./define.js";

export function setupRenderHeatmapChart(
  server: McpServer,
  registry: ProviderRegistry,
): void {
  defineRenderTool({
    server,
    registry,
    name: "render_heatmap_chart",
    title: "Render Heatmap Chart",
    description:
      "Render a query result as a heatmap. x and y define the grid axes, and value controls cell intensity. " +
      'Use provider="facade" to render server-side results by reference (fidelity-preserving). ' +
      'Use provider="direct" only for small inline datasets.',
    chartType: "heatmap",
    outputSchema: HeatmapChartOutputSchema,
    optionFields: {
      x: z.string().describe("Column name for the horizontal grid axis."),
      y: z.string().describe("Column name for the vertical grid axis."),
      value: z.string().describe("Numeric column mapped to cell intensity."),
      color_scheme: z.enum(["sequential", "diverging"]).default("sequential"),
      show_values: z.boolean().default(false),
      x_label: z.string().optional(),
      y_label: z.string().optional(),
    },
    mapInputToOptions: (input) => ({
      x: input.x,
      y: input.y,
      value: input.value,
      color_scheme: input.color_scheme,
      show_values: input.show_values,
      x_label: input.x_label,
      y_label: input.y_label,
    }),
  });
}

export default setupRenderHeatmapChart;
