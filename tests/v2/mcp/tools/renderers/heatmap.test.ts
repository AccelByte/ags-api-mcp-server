import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type {
  RegisteredTool,
  ToolCallback,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { ZodError, z } from "zod/v3";

import { HeatmapChartOutputSchema } from "../../../../../src/v2/shared/render-schemas.js";
import { createDirectProvider } from "../../../../../src/v2/mcp/tools/providers/direct.js";
import { createProviderRegistry } from "../../../../../src/v2/mcp/tools/providers/registry.js";
import { setupRenderHeatmapChart } from "../../../../../src/v2/mcp/tools/renderers/heatmap.js";

interface CapturedHeatmapTool {
  name: string;
  config: Record<string, unknown>;
  callback: ToolCallback<Record<string, z.ZodTypeAny>>;
}

function createCapturingServer(captured: CapturedHeatmapTool) {
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

describe("setupRenderHeatmapChart", () => {
  test("registers render_heatmap_chart and projects specialized options into structured content", async () => {
    const captured = {} as CapturedHeatmapTool;
    const registry = createProviderRegistry([createDirectProvider()]);

    setupRenderHeatmapChart(createCapturingServer(captured) as never, registry);

    assert.equal(captured.name, "render_heatmap_chart");

    const inputSchema = captured.config.inputSchema as Record<
      string,
      z.ZodTypeAny
    >;
    for (const key of ["x", "y", "value", "color_scheme", "show_values"]) {
      assert.ok(inputSchema[key], `expected render_heatmap_chart field ${key}`);
    }

    const columns = [
      { name: "weekday", type: "varchar" },
      { name: "hour", type: "integer" },
      { name: "count", type: "bigint" },
    ];
    const rows = [
      ["Mon", "9", "14"],
      ["Tue", "10", "18"],
    ];

    const result = await captured.callback(
      {
        provider: "direct",
        data_columns: columns,
        data_rows: rows,
        title: "Traffic Density",
        description: "Event count by hour",
        x: "weekday",
        y: "hour",
        value: "count",
        color_scheme: "diverging",
        show_values: true,
        x_label: "Weekday",
        y_label: "Hour",
      },
      { authInfo: { token: "token-123" } },
    );

    const parsed = HeatmapChartOutputSchema.parse(result.structuredContent);

    assert.equal(parsed.chart_type, "heatmap");
    assert.deepEqual(parsed.data, { columns, rows });
    assert.deepEqual(parsed.options, {
      x: "weekday",
      y: "hour",
      value: "count",
      color_scheme: "diverging",
      show_values: true,
      x_label: "Weekday",
      y_label: "Hour",
    });

    assert.throws(
      () =>
        HeatmapChartOutputSchema.parse({
          ...parsed,
          chart_type: "pie",
        }),
      ZodError,
    );

    assert.throws(
      () =>
        HeatmapChartOutputSchema.parse({
          ...parsed,
          unexpected: true,
        }),
      ZodError,
    );
  });
});
