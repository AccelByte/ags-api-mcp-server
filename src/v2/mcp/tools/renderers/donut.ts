// Copyright (c) 2025 AccelByte Inc. All Rights Reserved.
// This is licensed software from AccelByte Inc, for limitations
// and restrictions contact your company contract manager.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v3";

import { DonutChartOutputSchema } from "../../../shared/render-schemas.js";
import type { ProviderRegistry } from "../providers/registry.js";
import { defineRenderTool } from "./define.js";

export function setupRenderDonutChart(
  server: McpServer,
  registry: ProviderRegistry,
): void {
  defineRenderTool({
    server,
    registry,
    name: "render_donut_chart",
    title: "Render Donut Chart",
    description:
      "Render a query result as a donut chart. category names the slices and value sets the slice size. " +
      'Use provider="facade" to render server-side results by reference (fidelity-preserving). ' +
      'Use provider="direct" only for small inline datasets.',
    chartType: "donut",
    outputSchema: DonutChartOutputSchema,
    optionFields: {
      category: z.string().describe("Column name for donut slice categories."),
      value: z.string().describe("Numeric column used for slice size."),
      show_labels: z.boolean().default(true),
      other_threshold: z.number().min(0).max(1).optional(),
      center_label: z.string().optional(),
      hole: z.number().min(0.3).max(0.7).default(0.5),
    },
    mapInputToOptions: (input) => ({
      category: input.category,
      value: input.value,
      show_labels: input.show_labels,
      other_threshold: input.other_threshold,
      center_label: input.center_label,
      hole: input.hole,
    }),
  });
}

export default setupRenderDonutChart;
