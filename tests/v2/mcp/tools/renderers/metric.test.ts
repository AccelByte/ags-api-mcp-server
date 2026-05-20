import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type {
  RegisteredTool,
  ToolCallback,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { ZodError, z } from "zod/v3";

import { MetricOutputSchema } from "../../../../../src/v2/shared/render-schemas.js";
import { createDirectProvider } from "../../../../../src/v2/mcp/tools/providers/direct.js";
import { createProviderRegistry } from "../../../../../src/v2/mcp/tools/providers/registry.js";
import type {
  Provider,
  ProviderData,
} from "../../../../../src/v2/mcp/tools/providers/interface.js";
import { setupRenderMetric } from "../../../../../src/v2/mcp/tools/renderers/metric.js";

interface CapturedMetricTool {
  name: string;
  config: Record<string, unknown>;
  callback: ToolCallback<Record<string, z.ZodTypeAny>>;
}

function createCapturingServer(captured: CapturedMetricTool) {
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

describe("setupRenderMetric", () => {
  test("registers render_metric and projects metric options into structured content", async () => {
    const captured = {} as CapturedMetricTool;
    const registry = createProviderRegistry([createDirectProvider()]);

    setupRenderMetric(createCapturingServer(captured) as never, registry);

    assert.equal(captured.name, "render_metric");

    const inputSchema = captured.config.inputSchema as Record<
      string,
      z.ZodTypeAny
    >;
    for (const key of ["value", "compare", "label", "unit", "format"]) {
      assert.ok(inputSchema[key], `expected render_metric field ${key}`);
    }

    const columns = [
      { name: "revenue", type: "double" },
      { name: "delta_pct", type: "double" },
    ];
    const rows = [["12345.67", "0.08"]];

    const result = await captured.callback(
      {
        provider: "direct",
        data_columns: columns,
        data_rows: rows,
        title: "Revenue",
        description: "Daily gross revenue",
        value: "revenue",
        compare: "delta_pct",
        label: "Gross revenue",
        unit: "USD",
        format: "currency",
      },
      { authInfo: { token: "token-123" } },
    );

    const parsed = MetricOutputSchema.parse(result.structuredContent);

    assert.equal(parsed.chart_type, "metric");
    assert.deepEqual(parsed.data, { columns, rows });
    assert.deepEqual(parsed.options, {
      value: "revenue",
      compare: "delta_pct",
      label: "Gross revenue",
      unit: "USD",
      format: "currency",
    });

    assert.throws(
      () =>
        MetricOutputSchema.parse({
          ...parsed,
          chart_type: "table",
        }),
      ZodError,
    );

    assert.throws(
      () => {
        const { options: _options, ...withoutOptions } = parsed;
        MetricOutputSchema.parse(withoutOptions);
      },
      ZodError,
    );

    assert.throws(
      () =>
        MetricOutputSchema.parse({
          ...parsed,
          unexpected: true,
        }),
      ZodError,
    );
  });

  test("surfaces sql from resolveData onto structuredContent", async () => {
    const captured = {} as CapturedMetricTool;
    const sqlProvider: Provider = {
      name: "sql-stub",
      resolve: async (): Promise<ProviderData> => ({
        columns: [{ name: "v", type: "bigint" }],
        rows: [["1"]],
        sql: "SELECT v FROM t",
      }),
    };
    const registry = createProviderRegistry([sqlProvider]);

    setupRenderMetric(createCapturingServer(captured) as never, registry);

    const result = await captured.callback(
      { provider: "sql-stub", value: "v" },
      { authInfo: { token: "token-123" } },
    );

    const parsed = MetricOutputSchema.parse(result.structuredContent);
    assert.equal(parsed.sql, "SELECT v FROM t");
  });
});
