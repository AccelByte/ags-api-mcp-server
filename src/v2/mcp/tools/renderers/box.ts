// Copyright (c) 2025 AccelByte Inc. All Rights Reserved.
// This is licensed software from AccelByte Inc, for limitations
// and restrictions contact your company contract manager.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v3";

import { BoxChartOutputSchema } from "../../../shared/render-schemas.js";
import type { ProviderRegistry } from "../providers/registry.js";
import { defineRenderTool } from "./define.js";

export function setupRenderBoxChart(
  server: McpServer,
  registry: ProviderRegistry,
): void {
  defineRenderTool({
    server,
    registry,
    name: "render_box_chart",
    title: "Render Box Chart",
    description:
      "Render a query result as a box chart. x groups the distribution and y is the numeric measure summarized into quartiles. " +
      'Use provider="facade" to render server-side results by reference (fidelity-preserving). ' +
      'Use provider="direct" only for small inline datasets.',
    chartType: "box",
    outputSchema: BoxChartOutputSchema,
    optionFields: {
      x: z.string().describe("Column name for the grouping axis."),
      y: z
        .string()
        .describe("Numeric column whose distribution is summarized."),
      color: z
        .string()
        .optional()
        .describe("Optional column that splits the data into colored groups."),
      x_label: z.string().optional(),
      y_label: z.string().optional(),
    },
    mapInputToOptions: (input) => ({
      x: input.x,
      y: input.y,
      color: input.color,
      x_label: input.x_label,
      y_label: input.y_label,
    }),
  });
}

export default setupRenderBoxChart;
