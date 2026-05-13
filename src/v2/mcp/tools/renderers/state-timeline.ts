// Copyright (c) 2025 AccelByte Inc. All Rights Reserved.
// This is licensed software from AccelByte Inc, for limitations
// and restrictions contact your company contract manager.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v3";

import { StateTimelineChartOutputSchema } from "../../../shared/render-schemas.js";
import type { ProviderRegistry } from "../providers/registry.js";
import { defineRenderTool } from "./define.js";

export function setupRenderStateTimelineChart(
  server: McpServer,
  registry: ProviderRegistry,
): void {
  defineRenderTool({
    server,
    registry,
    name: "render_state_timeline_chart",
    title: "Render State Timeline Chart",
    description:
      "Render a query result as a state timeline. entity identifies the subject, start and end define the interval, and state names the categorical state. " +
      'Use provider="facade" with query_id+namespace for Athena Facade results (fidelity-preserving). ' +
      'Use provider="direct" only for small inline datasets.',
    chartType: "state_timeline",
    outputSchema: StateTimelineChartOutputSchema,
    optionFields: {
      entity: z
        .string()
        .describe("Column name identifying the timeline entity or subject."),
      start: z
        .string()
        .describe("Column name for the interval start timestamp."),
      end: z.string().describe("Column name for the interval end timestamp."),
      state: z
        .string()
        .describe("Column name for the categorical state label."),
    },
    mapInputToOptions: (input) => ({
      entity: input.entity,
      start: input.start,
      end: input.end,
      state: input.state,
    }),
  });
}

export default setupRenderStateTimelineChart;
