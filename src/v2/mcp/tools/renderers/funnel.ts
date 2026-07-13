// Copyright (c) 2025 AccelByte Inc.
// SPDX-License-Identifier: Apache-2.0

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v3";

import { FunnelChartOutputSchema } from "../../../shared/render-schemas.js";
import type { ProviderRegistry } from "../providers/registry.js";
import { defineRenderTool } from "./define.js";

export function setupRenderFunnelChart(
  server: McpServer,
  registry: ProviderRegistry,
): void {
  defineRenderTool({
    server,
    registry,
    name: "render_funnel_chart",
    title: "Render Funnel Chart",
    description:
      "Render a query result as a funnel chart. stage labels each funnel step and value sets the step size. " +
      'Use provider="facade" to render server-side results by reference (fidelity-preserving). ' +
      'Use provider="direct" only for small inline datasets.',
    chartType: "funnel",
    outputSchema: FunnelChartOutputSchema,
    optionFields: {
      stage: z.string().describe("Column name for funnel stages."),
      value: z.string().describe("Numeric column used for stage size."),
      orientation: z.enum(["vertical", "horizontal"]).default("vertical"),
      show_conversion: z.boolean().default(true),
    },
    mapInputToOptions: (input) => ({
      stage: input.stage,
      value: input.value,
      orientation: input.orientation,
      show_conversion: input.show_conversion,
    }),
  });
}

export default setupRenderFunnelChart;
