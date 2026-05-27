import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type {
  RegisteredTool,
  ToolCallback,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { ZodError, z } from "zod/v3";

import { MeterOutputSchema } from "../../../../../src/v2/shared/render-schemas.js";
import { createDirectProvider } from "../../../../../src/v2/mcp/tools/providers/direct.js";
import { createProviderRegistry } from "../../../../../src/v2/mcp/tools/providers/registry.js";
import { setupRenderMeter } from "../../../../../src/v2/mcp/tools/renderers/meter.js";

interface CapturedMeterTool {
  name: string;
  config: Record<string, unknown>;
  callback: ToolCallback<Record<string, z.ZodTypeAny>>;
}

function createCapturingServer(captured: CapturedMeterTool) {
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

describe("setupRenderMeter", () => {
  test("registers render_meter and projects specialized options into structured content", async () => {
    const captured = {} as CapturedMeterTool;
    const registry = createProviderRegistry([createDirectProvider()]);

    setupRenderMeter(createCapturingServer(captured) as never, registry);

    assert.equal(captured.name, "render_meter");

    const inputSchema = captured.config.inputSchema as Record<
      string,
      z.ZodTypeAny
    >;
    for (const key of ["value", "max", "label", "color", "unit", "format"]) {
      assert.ok(inputSchema[key], `expected render_meter field ${key}`);
    }

    const columns = [
      { name: "feature", type: "varchar" },
      { name: "used", type: "bigint" },
      { name: "quota", type: "bigint" },
      { name: "unit", type: "varchar" },
    ];
    const rows = [
      ["API calls", "750", "1000", "calls"],
      ["Storage", "200", "500", "GB"],
    ];

    const result = await captured.callback(
      {
        provider: "direct",
        data_columns: columns,
        data_rows: rows,
        title: "Usage limits",
        description: "Current plan usage",
        value: "used",
        max: "quota",
        label: "feature",
        unit: "unit",
        format: "compact",
      },
      { authInfo: { token: "token-123" } },
    );

    const parsed = MeterOutputSchema.parse(result.structuredContent);

    assert.equal(parsed.chart_type, "meter");
    assert.deepEqual(parsed.data, { columns, rows });
    assert.deepEqual(parsed.options, {
      value: "used",
      max: "quota",
      label: "feature",
      color: undefined,
      unit: "unit",
      format: "compact",
    });

    assert.throws(
      () =>
        MeterOutputSchema.parse({
          ...parsed,
          chart_type: "line",
        }),
      ZodError,
    );

    assert.throws(() => {
      const { options: _options, ...withoutOptions } = parsed;
      MeterOutputSchema.parse(withoutOptions);
    }, ZodError);

    assert.throws(
      () =>
        MeterOutputSchema.parse({
          ...parsed,
          unexpected: true,
        }),
      ZodError,
    );
  });
});
