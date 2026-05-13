import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type {
  RegisteredTool,
  ToolCallback,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { ZodError, z } from "zod/v3";

import { StateTimelineChartOutputSchema } from "../../../../../src/v2/shared/render-schemas.js";
import { createDirectProvider } from "../../../../../src/v2/mcp/tools/providers/direct.js";
import { createProviderRegistry } from "../../../../../src/v2/mcp/tools/providers/registry.js";
import { setupRenderStateTimelineChart } from "../../../../../src/v2/mcp/tools/renderers/state-timeline.js";

interface CapturedStateTimelineTool {
  name: string;
  config: Record<string, unknown>;
  callback: ToolCallback<Record<string, z.ZodTypeAny>>;
}

function createCapturingServer(captured: CapturedStateTimelineTool) {
  return {
    registerTool(
      name: string,
      config: Record<string, unknown>,
      callback: ToolCallback<Record<string, z.ZodTypeAny>>,
    ): RegisteredTool {
      captured.name = name;
      captured.config = config;
      captured.callback = callback;
      return {} as RegisteredTool;
    },
  };
}

describe("setupRenderStateTimelineChart", () => {
  test("registers render_state_timeline_chart and projects specialized options into structured content", async () => {
    const captured = {} as CapturedStateTimelineTool;
    const registry = createProviderRegistry([createDirectProvider()]);

    setupRenderStateTimelineChart(
      createCapturingServer(captured) as never,
      registry,
    );

    assert.equal(captured.name, "render_state_timeline_chart");

    const inputSchema = captured.config.inputSchema as Record<
      string,
      z.ZodTypeAny
    >;
    for (const key of ["entity", "start", "end", "state"]) {
      assert.ok(
        inputSchema[key],
        `expected render_state_timeline_chart field ${key}`,
      );
    }

    const columns = [
      { name: "server", type: "varchar" },
      { name: "started_at", type: "timestamp" },
      { name: "ended_at", type: "timestamp" },
      { name: "status", type: "varchar" },
    ];
    const rows = [
      ["srv-a", "2026-05-13T10:00:00Z", "2026-05-13T10:30:00Z", "online"],
      ["srv-a", "2026-05-13T10:30:00Z", "2026-05-13T10:45:00Z", "degraded"],
    ];

    const result = await captured.callback(
      {
        provider: "direct",
        data_columns: columns,
        data_rows: rows,
        title: "Server State",
        description: "Status by interval",
        entity: "server",
        start: "started_at",
        end: "ended_at",
        state: "status",
      },
      { authInfo: { token: "token-123" } },
    );

    const parsed = StateTimelineChartOutputSchema.parse(
      result.structuredContent,
    );

    assert.equal(parsed.chart_type, "state_timeline");
    assert.deepEqual(parsed.data, { columns, rows });
    assert.deepEqual(parsed.options, {
      entity: "server",
      start: "started_at",
      end: "ended_at",
      state: "status",
    });

    assert.throws(
      () =>
        StateTimelineChartOutputSchema.parse({
          ...parsed,
          chart_type: "bar",
        }),
      ZodError,
    );

    assert.throws(
      () => {
        const { options: _options, ...withoutOptions } = parsed;
        StateTimelineChartOutputSchema.parse(withoutOptions);
      },
      ZodError,
    );

    assert.throws(
      () =>
        StateTimelineChartOutputSchema.parse({
          ...parsed,
          unexpected: true,
        }),
      ZodError,
    );
  });
});
