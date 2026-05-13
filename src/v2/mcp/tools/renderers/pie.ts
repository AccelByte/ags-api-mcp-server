// Copyright (c) 2025 AccelByte Inc. All Rights Reserved.
// This is licensed software from AccelByte Inc, for limitations
// and restrictions contact your company contract manager.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v3";

import { PieChartOutputSchema } from "../../../shared/render-schemas.js";
import type { ProviderRegistry } from "../providers/registry.js";
import { defineRenderTool } from "./define.js";

export function setupRenderPieChart(
  server: McpServer,
  registry: ProviderRegistry,
): void {
  defineRenderTool({
    server,
    registry,
    name: "render_pie_chart",
    title: "Render Pie Chart",
    description:
      "Render a query result as a pie chart. category names the slices and value sets the slice size. " +
      'Use provider="facade" with query_id+namespace for Athena Facade results (fidelity-preserving). ' +
      'Use provider="direct" only for small inline datasets.',
    chartType: "pie",
    outputSchema: PieChartOutputSchema,
    optionFields: {
      category: z.string().describe("Column name for pie slice categories."),
      value: z.string().describe("Numeric column used for slice size."),
      show_labels: z.boolean().default(true),
      other_threshold: z.number().min(0).max(1).optional(),
    },
    mapInputToOptions: (input) => ({
      category: input.category,
      value: input.value,
      show_labels: input.show_labels,
      other_threshold: input.other_threshold,
    }),
  });
}

export default setupRenderPieChart;
