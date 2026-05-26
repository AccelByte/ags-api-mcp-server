// Copyright (c) 2025 AccelByte Inc. All Rights Reserved.
// This is licensed software from AccelByte Inc, for limitations
// and restrictions contact your company contract manager.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v3";

import { LineChartOutputSchema } from "../../../shared/render-schemas.js";
import type { ProviderRegistry } from "../providers/registry.js";
import { defineRenderTool } from "./define.js";

export function setupRenderLineChart(
  server: McpServer,
  registry: ProviderRegistry,
): void {
  defineRenderTool({
    server,
    registry,
    name: "render_line_chart",
    title: "Render Line Chart",
    description:
      "Render a query result as a line chart. x is the horizontal axis, y is the numeric measure, color is an optional series split. " +
      'Use provider="facade" with query_id+namespace for Athena Facade results (fidelity-preserving). ' +
      'Use provider="direct" only for small inline datasets.',
    chartType: "line",
    outputSchema: LineChartOutputSchema,
    optionFields: {
      x: z.string().describe("Column name for the horizontal axis."),
      y: z.string().describe("Numeric column for the vertical axis."),
      color: z
        .string()
        .optional()
        .describe("Column that splits the data into colored series."),
      show_points: z.boolean().default(false),
      curve: z.enum(["linear", "smooth", "step"]).default("linear"),
      x_label: z.string().optional(),
      y_label: z.string().optional(),
      tooltip: z.array(z.string()).optional(),
    },
    mapInputToOptions: (input) => ({
      x: input.x,
      y: input.y,
      color: input.color,
      show_points: input.show_points,
      curve: input.curve,
      x_label: input.x_label,
      y_label: input.y_label,
      tooltip: input.tooltip,
    }),
  });
}

export default setupRenderLineChart;
