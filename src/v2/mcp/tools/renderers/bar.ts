// Copyright (c) 2025 AccelByte Inc.
// SPDX-License-Identifier: Apache-2.0

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v3";

import { BarChartOutputSchema } from "../../../shared/render-schemas.js";
import type { ProviderRegistry } from "../providers/registry.js";
import { defineRenderTool } from "./define.js";

export function setupRenderBarChart(
  server: McpServer,
  registry: ProviderRegistry,
): void {
  defineRenderTool({
    server,
    registry,
    name: "render_bar_chart",
    title: "Render Bar Chart",
    description:
      "Render a query result as a bar chart. x is the category axis, y is the numeric value, color is an optional column that splits into colored series. " +
      'Use provider="facade" to render server-side results by reference (fidelity-preserving). ' +
      'Use provider="direct" only for small inline datasets.',
    chartType: "bar",
    outputSchema: BarChartOutputSchema,
    optionFields: {
      x: z.string().describe("Column name for the category axis."),
      y: z.string().describe("Numeric column for bar height."),
      color: z
        .string()
        .optional()
        .describe("Column that splits into colored series."),
      bar_mode: z.enum(["grouped", "stacked", "normalized"]).default("grouped"),
      orientation: z.enum(["vertical", "horizontal"]).default("vertical"),
      label: z
        .string()
        .optional()
        .describe("Column rendered as text label on each bar."),
      x_label: z.string().optional(),
      y_label: z.string().optional(),
      tooltip: z.array(z.string()).optional(),
    },
    mapInputToOptions: (input) => ({
      x: input.x,
      y: input.y,
      color: input.color,
      bar_mode: input.bar_mode,
      orientation: input.orientation,
      label: input.label,
      x_label: input.x_label,
      y_label: input.y_label,
      tooltip: input.tooltip,
    }),
  });
}

export default setupRenderBarChart;
