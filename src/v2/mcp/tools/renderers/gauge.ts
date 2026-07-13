// Copyright (c) 2025 AccelByte Inc.
// SPDX-License-Identifier: Apache-2.0

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v3";

import {
  GaugeChartOutputSchema,
  strictObject,
} from "../../../shared/render-schemas.js";
import type { ProviderRegistry } from "../providers/registry.js";
import { defineRenderTool } from "./define.js";

export function setupRenderGaugeChart(
  server: McpServer,
  registry: ProviderRegistry,
): void {
  defineRenderTool({
    server,
    registry,
    name: "render_gauge_chart",
    title: "Render Gauge Chart",
    description:
      "Render a query result as a gauge chart. value names the numeric measure and max defines the upper bound. " +
      'Use provider="facade" to render server-side results by reference (fidelity-preserving). ' +
      'Use provider="direct" only for small inline datasets.',
    chartType: "gauge",
    outputSchema: GaugeChartOutputSchema,
    optionFields: {
      value: z.string().describe("Column name for the numeric gauge value."),
      min: z.number().default(0),
      max: z.number().describe("Upper bound of the gauge scale."),
      thresholds: z
        .array(
          strictObject({
            value: z.number(),
            color: z.string(),
          }),
        )
        .optional()
        .describe(
          "Optional threshold markers ordered by value, each with a display color.",
        ),
      unit: z.string().optional(),
    },
    mapInputToOptions: (input) => ({
      value: input.value,
      min: input.min,
      max: input.max,
      thresholds: input.thresholds,
      unit: input.unit,
    }),
  });
}

export default setupRenderGaugeChart;
