// Copyright (c) 2025 AccelByte Inc. All Rights Reserved.
// This is licensed software from AccelByte Inc, for limitations
// and restrictions contact your company contract manager.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v3";

import { MetricOutputSchema } from "../../../shared/render-schemas.js";
import type { ProviderRegistry } from "../providers/registry.js";
import { defineRenderTool } from "./define.js";

export function setupRenderMetric(
  server: McpServer,
  registry: ProviderRegistry,
): void {
  defineRenderTool({
    server,
    registry,
    name: "render_metric",
    title: "Render Metric",
    description:
      "Render a query result as a single metric value. value names the primary numeric or textual column to display. " +
      'Use provider="facade" with query_id+namespace for Athena Facade results (fidelity-preserving). ' +
      'Use provider="direct" only for small inline datasets.',
    chartType: "metric",
    outputSchema: MetricOutputSchema,
    optionFields: {
      value: z.string().describe("Column name for the primary metric value."),
      compare: z
        .string()
        .optional()
        .describe("Optional comparison or delta column."),
      label: z.string().optional().describe("Optional label override."),
      unit: z.string().optional().describe("Optional unit suffix."),
      format: z
        .string()
        .optional()
        .describe("Optional display format hint for the metric value."),
    },
    mapInputToOptions: (input) => ({
      value: input.value,
      compare: input.compare,
      label: input.label,
      unit: input.unit,
      format: input.format,
    }),
  });
}

export default setupRenderMetric;
