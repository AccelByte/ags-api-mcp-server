import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { RegisteredTool, ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v3";

import { BarChartOutputSchema } from "../../../../../src/v2/shared/render-schemas.js";
import { createProviderRegistry } from "../../../../../src/v2/mcp/tools/providers/registry.js";
import { createDirectProvider } from "../../../../../src/v2/mcp/tools/providers/direct.js";
import { setupRenderBarChart } from "../../../../../src/v2/mcp/tools/renderers/bar.js";

interface CapturedBarTool {
  name: string;
  config: Record<string, unknown>;
  callback: ToolCallback<Record<string, z.ZodTypeAny>>;
}

function createCapturingServer(captured: CapturedBarTool) {
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

describe("setupRenderBarChart", () => {
  test("registers render_bar_chart and projects bar options into structured content", async () => {
    const captured = {} as CapturedBarTool;
    const registry = createProviderRegistry([createDirectProvider()]);

    setupRenderBarChart(createCapturingServer(captured) as never, registry);

    assert.equal(captured.name, "render_bar_chart");

    const inputSchema = captured.config.inputSchema as Record<
      string,
      z.ZodTypeAny
    >;
    for (const key of ["x", "y", "color", "bar_mode", "orientation"]) {
      assert.ok(inputSchema[key], `expected render_bar_chart field ${key}`);
    }

    const columns = [
      { name: "team", type: "varchar" },
      { name: "score", type: "bigint" },
      { name: "region", type: "varchar" },
      { name: "label", type: "varchar" },
    ];
    const rows = [
      ["blue", "10", "apac", "Blue 10"],
      ["red", "12", "emea", "Red 12"],
    ];

    const result = await captured.callback(
      {
        provider: "direct",
        data_columns: columns,
        data_rows: rows,
        title: "Scores",
        description: "Demo dataset",
        x: "team",
        y: "score",
        color: "region",
        bar_mode: "stacked",
        orientation: "horizontal",
        label: "label",
        x_label: "Teams",
        y_label: "Scores",
        tooltip: ["team", "score", "region"],
      },
      { authInfo: { token: "token-123" } },
    );

    const parsed = BarChartOutputSchema.parse(result.structuredContent);

    assert.equal(parsed.chart_type, "bar");
    assert.deepEqual(parsed.data, { columns, rows });
    assert.deepEqual(parsed.options, {
      x: "team",
      y: "score",
      color: "region",
      bar_mode: "stacked",
      orientation: "horizontal",
      label: "label",
      x_label: "Teams",
      y_label: "Scores",
      tooltip: ["team", "score", "region"],
    });
  });
});
