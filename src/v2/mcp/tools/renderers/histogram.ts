// Copyright (c) 2025 AccelByte Inc. All Rights Reserved.
// This is licensed software from AccelByte Inc, for limitations
// and restrictions contact your company contract manager.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v3";

import { HistogramChartOutputSchema } from "../../../shared/render-schemas.js";
import type { ProviderRegistry } from "../providers/registry.js";
import { defineRenderTool } from "./define.js";

export function setupRenderHistogramChart(
  server: McpServer,
  registry: ProviderRegistry,
): void {
  defineRenderTool({
    server,
    registry,
    name: "render_histogram_chart",
    title: "Render Histogram Chart",
    description:
      "Render a query result as a histogram. column is the numeric field being bucketed into bins. " +
      'Use provider="facade" with query_id+namespace for Athena Facade results (fidelity-preserving). ' +
      'Use provider="direct" only for small inline datasets.',
    chartType: "histogram",
    outputSchema: HistogramChartOutputSchema,
    optionFields: {
      column: z
        .string()
        .describe("Numeric column to bucket into histogram bins."),
      bin_count: z.number().int().min(1).max(200).optional(),
      normalize: z.boolean().default(false),
      color: z
        .string()
        .optional()
        .describe("Optional column that splits the histogram into groups."),
      x_label: z.string().optional(),
      y_label: z.string().optional(),
    },
    mapInputToOptions: (input) => ({
      column: input.column,
      bin_count: input.bin_count,
      normalize: input.normalize,
      color: input.color,
      x_label: input.x_label,
      y_label: input.y_label,
    }),
  });
}

export default setupRenderHistogramChart;
