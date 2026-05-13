import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type {
  RegisteredTool,
  ToolCallback,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { ZodError, z } from "zod/v3";

import { PieChartOutputSchema } from "../../../../../src/v2/shared/render-schemas.js";
import { createDirectProvider } from "../../../../../src/v2/mcp/tools/providers/direct.js";
import { createProviderRegistry } from "../../../../../src/v2/mcp/tools/providers/registry.js";
import { setupRenderPieChart } from "../../../../../src/v2/mcp/tools/renderers/pie.js";

interface CapturedPieTool {
  name: string;
  config: Record<string, unknown>;
  callback: ToolCallback<Record<string, z.ZodTypeAny>>;
}

function createCapturingServer(captured: CapturedPieTool) {
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

describe("setupRenderPieChart", () => {
  test("registers render_pie_chart and projects specialized options into structured content", async () => {
    const captured = {} as CapturedPieTool;
    const registry = createProviderRegistry([createDirectProvider()]);

    setupRenderPieChart(createCapturingServer(captured) as never, registry);

    assert.equal(captured.name, "render_pie_chart");

    const inputSchema = captured.config.inputSchema as Record<
      string,
      z.ZodTypeAny
    >;
    for (const key of ["category", "value", "show_labels", "other_threshold"]) {
      assert.ok(inputSchema[key], `expected render_pie_chart field ${key}`);
    }

    const columns = [
      { name: "segment", type: "varchar" },
      { name: "users", type: "bigint" },
    ];
    const rows = [
      ["new", "120"],
      ["returning", "80"],
    ];

    const result = await captured.callback(
      {
        provider: "direct",
        data_columns: columns,
        data_rows: rows,
        title: "Player Segments",
        description: "User distribution",
        category: "segment",
        value: "users",
        show_labels: false,
        other_threshold: 0.1,
      },
      { authInfo: { token: "token-123" } },
    );

    const parsed = PieChartOutputSchema.parse(result.structuredContent);

    assert.equal(parsed.chart_type, "pie");
    assert.deepEqual(parsed.data, { columns, rows });
    assert.deepEqual(parsed.options, {
      category: "segment",
      value: "users",
      show_labels: false,
      other_threshold: 0.1,
    });

    assert.throws(
      () =>
        PieChartOutputSchema.parse({
          ...parsed,
          chart_type: "heatmap",
        }),
      ZodError,
    );

    assert.throws(
      () =>
        PieChartOutputSchema.parse({
          ...parsed,
          unexpected: true,
        }),
      ZodError,
    );
  });
});
