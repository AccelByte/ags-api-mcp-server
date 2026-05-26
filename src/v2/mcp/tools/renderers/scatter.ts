// Copyright (c) 2025 AccelByte Inc. All Rights Reserved.
// This is licensed software from AccelByte Inc, for limitations
// and restrictions contact your company contract manager.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v3";

import { ScatterChartOutputSchema } from "../../../shared/render-schemas.js";
import type { ProviderRegistry } from "../providers/registry.js";
import { defineRenderTool } from "./define.js";

export function setupRenderScatterChart(
  server: McpServer,
  registry: ProviderRegistry,
): void {
  defineRenderTool({
    server,
    registry,
    name: "render_scatter_chart",
    title: "Render Scatter Chart",
    description:
      "Render a query result as a scatter chart. x and y are numeric axes, color and size optionally encode additional dimensions. " +
      'Use provider="facade" with query_id+namespace for Athena Facade results (fidelity-preserving). ' +
      'Use provider="direct" only for small inline datasets.',
    chartType: "scatter",
    outputSchema: ScatterChartOutputSchema,
    optionFields: {
      x: z.string().describe("Column name for the horizontal axis."),
      y: z.string().describe("Column name for the vertical axis."),
      color: z
        .string()
        .optional()
        .describe("Column that splits the data into colored groups."),
      size: z
        .string()
        .optional()
        .describe("Numeric column that controls point size."),
      trend_line: z.enum(["none", "linear"]).default("none"),
      x_label: z.string().optional(),
      y_label: z.string().optional(),
      tooltip: z.array(z.string()).optional(),
    },
    mapInputToOptions: (input) => ({
      x: input.x,
      y: input.y,
      color: input.color,
      size: input.size,
      trend_line: input.trend_line,
      x_label: input.x_label,
      y_label: input.y_label,
      tooltip: input.tooltip,
    }),
  });
}

export default setupRenderScatterChart;
