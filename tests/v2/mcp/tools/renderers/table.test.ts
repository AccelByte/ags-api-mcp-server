import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type {
  RegisteredTool,
  ToolCallback,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { ZodError, z } from "zod/v3";

import { TableOutputSchema } from "../../../../../src/v2/shared/render-schemas.js";
import { createDirectProvider } from "../../../../../src/v2/mcp/tools/providers/direct.js";
import { createProviderRegistry } from "../../../../../src/v2/mcp/tools/providers/registry.js";
import type {
  Provider,
  ProviderData,
} from "../../../../../src/v2/mcp/tools/providers/interface.js";
import { setupRenderTable } from "../../../../../src/v2/mcp/tools/renderers/table.js";

interface CapturedTableTool {
  name: string;
  config: Record<string, unknown>;
  callback: ToolCallback<Record<string, z.ZodTypeAny>>;
}

function createCapturingServer(captured: CapturedTableTool) {
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

describe("setupRenderTable", () => {
  test("registers render_table and projects table options into structured content", async () => {
    const captured = {} as CapturedTableTool;
    const registry = createProviderRegistry([createDirectProvider()]);

    setupRenderTable(createCapturingServer(captured) as never, registry);

    assert.equal(captured.name, "render_table");

    const inputSchema = captured.config.inputSchema as Record<
      string,
      z.ZodTypeAny
    >;
    for (const key of ["columns_order", "page_size"]) {
      assert.ok(inputSchema[key], `expected render_table field ${key}`);
    }

    const columns = [
      { name: "player_id", type: "varchar" },
      { name: "score", type: "bigint" },
      { name: "rank", type: "integer" },
    ];
    const rows = [
      ["player-1", "400", "1"],
      ["player-2", "350", "2"],
    ];

    const result = await captured.callback(
      {
        provider: "direct",
        data_columns: columns,
        data_rows: rows,
        title: "Leaderboard",
        description: "Current standings",
        columns_order: ["rank", "player_id", "score"],
        page_size: 25,
      },
      { authInfo: { token: "token-123" } },
    );

    const parsed = TableOutputSchema.parse(result.structuredContent);

    assert.equal(parsed.chart_type, "table");
    assert.deepEqual(parsed.data, { columns, rows });
    assert.deepEqual(parsed.options, {
      columns_order: ["rank", "player_id", "score"],
      page_size: 25,
    });

    assert.throws(
      () =>
        TableOutputSchema.parse({
          ...parsed,
          chart_type: "metric",
        }),
      ZodError,
    );

    assert.throws(
      () => {
        const { options: _options, ...withoutOptions } = parsed;
        TableOutputSchema.parse(withoutOptions);
      },
      ZodError,
    );

    assert.throws(
      () =>
        TableOutputSchema.parse({
          ...parsed,
          unexpected: true,
        }),
      ZodError,
    );
  });

  test("surfaces sql from resolveData onto structuredContent", async () => {
    const captured = {} as CapturedTableTool;
    const sqlProvider: Provider = {
      name: "sql-stub",
      resolve: async (): Promise<ProviderData> => ({
        columns: [{ name: "v", type: "bigint" }],
        rows: [["1"]],
        sql: "SELECT v FROM t",
      }),
    };
    const registry = createProviderRegistry([sqlProvider]);

    setupRenderTable(createCapturingServer(captured) as never, registry);

    const result = await captured.callback(
      { provider: "sql-stub" },
      { authInfo: { token: "token-123" } },
    );

    const parsed = TableOutputSchema.parse(result.structuredContent);
    assert.equal(parsed.sql, "SELECT v FROM t");
  });
});
