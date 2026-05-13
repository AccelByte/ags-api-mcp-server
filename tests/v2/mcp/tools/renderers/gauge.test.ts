import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type {
  RegisteredTool,
  ToolCallback,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { ZodError, z } from "zod/v3";

import { GaugeChartOutputSchema } from "../../../../../src/v2/shared/render-schemas.js";
import { createDirectProvider } from "../../../../../src/v2/mcp/tools/providers/direct.js";
import { createProviderRegistry } from "../../../../../src/v2/mcp/tools/providers/registry.js";
import { setupRenderGaugeChart } from "../../../../../src/v2/mcp/tools/renderers/gauge.js";

interface CapturedGaugeTool {
  name: string;
  config: Record<string, unknown>;
  callback: ToolCallback<Record<string, z.ZodTypeAny>>;
}

function createCapturingServer(captured: CapturedGaugeTool) {
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

describe("setupRenderGaugeChart", () => {
  test("registers render_gauge_chart and projects specialized options into structured content", async () => {
    const captured = {} as CapturedGaugeTool;
    const registry = createProviderRegistry([createDirectProvider()]);

    setupRenderGaugeChart(createCapturingServer(captured) as never, registry);

    assert.equal(captured.name, "render_gauge_chart");

    const inputSchema = captured.config.inputSchema as Record<
      string,
      z.ZodTypeAny
    >;
    for (const key of ["value", "min", "max", "thresholds", "unit"]) {
      assert.ok(inputSchema[key], `expected render_gauge_chart field ${key}`);
    }

    const columns = [
      { name: "completion", type: "double" },
      { name: "label", type: "varchar" },
    ];
    const rows = [["0.76", "76%"]];

    const result = await captured.callback(
      {
        provider: "direct",
        data_columns: columns,
        data_rows: rows,
        title: "Completion",
        description: "Daily completion rate",
        value: "completion",
        min: 0,
        max: 1,
        thresholds: [
          { value: 0.5, color: "#f59e0b" },
          { value: 0.8, color: "#10b981" },
        ],
        unit: "%",
      },
      { authInfo: { token: "token-123" } },
    );

    const parsed = GaugeChartOutputSchema.parse(result.structuredContent);

    assert.equal(parsed.chart_type, "gauge");
    assert.deepEqual(parsed.data, { columns, rows });
    assert.deepEqual(parsed.options, {
      value: "completion",
      min: 0,
      max: 1,
      thresholds: [
        { value: 0.5, color: "#f59e0b" },
        { value: 0.8, color: "#10b981" },
      ],
      unit: "%",
    });

    assert.throws(
      () =>
        GaugeChartOutputSchema.parse({
          ...parsed,
          chart_type: "line",
        }),
      ZodError,
    );

    assert.throws(
      () => {
        const { options: _options, ...withoutOptions } = parsed;
        GaugeChartOutputSchema.parse(withoutOptions);
      },
      ZodError,
    );

    assert.throws(
      () =>
        GaugeChartOutputSchema.parse({
          ...parsed,
          unexpected: true,
        }),
      ZodError,
    );
  });
});
