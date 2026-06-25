import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { RegisteredTool, ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod/v3";

import { RENDERER_RESOURCE_URI } from "../../../../../src/v2/mcp/renderer-resource.js";
import { strictObject } from "../../../../../src/v2/shared/render-schemas.js";
import { FacadeError } from "../../../../../src/v2/mcp/tools/providers/facade.js";
import { createProviderRegistry } from "../../../../../src/v2/mcp/tools/providers/registry.js";
import type {
  Provider,
  ProviderData,
} from "../../../../../src/v2/mcp/tools/providers/interface.js";
import { defineRenderTool } from "../../../../../src/v2/mcp/tools/renderers/define.js";

interface CapturedTool {
  name: string;
  config: Record<string, unknown>;
  callback: ToolCallback<Record<string, z.ZodTypeAny>>;
  registered?: RegisteredTool;
}

function createCapturingServer(captured: CapturedTool) {
  return {
    registerTool(
      name: string,
      config: Record<string, unknown>,
      callback: ToolCallback<Record<string, z.ZodTypeAny>>,
    ): RegisteredTool {
      captured.name = name;
      captured.config = config;
      captured.callback = callback;
      captured.registered = {} as RegisteredTool;
      return captured.registered;
    },
  };
}

function createProvider(
  resolve: (input: Record<string, unknown>, token: string) => Promise<ProviderData>,
): Provider {
  return {
    name: "direct",
    schemaFields: {
      data_columns: z
        .array(
          strictObject({
            name: z.string(),
            type: z.string(),
          }),
        )
        .optional(),
      data_rows: z.array(z.array(z.string())).optional(),
    },
    resolve,
  };
}

const ExampleOutputSchema = strictObject({
  chart_type: z.literal("example"),
  title: z.string().optional(),
  description: z.string().optional(),
  column_hints: z.record(z.string(), z.unknown()).optional(),
  filters: z.array(z.unknown()).optional(),
  data: strictObject({
    columns: z.array(
      strictObject({
        name: z.string(),
        type: z.string(),
      }),
    ),
    rows: z.array(z.array(z.string())),
  }),
  data_source: z.string().optional(),
  stats: z
    .object({
      data_scanned_bytes: z.number().optional(),
      engine_execution_time_ms: z.number().optional(),
    })
    .optional(),
  sql: z.string().optional(),
  namespace: z.string().optional(),
  options: strictObject({
    x: z.string(),
  }),
});

describe("defineRenderTool", () => {
  test("registers the tool definition with UI metadata, shared fields, option fields, and output schema", () => {
    const captured = {} as CapturedTool;
    const registry = createProviderRegistry([
      createProvider(async (): Promise<ProviderData> => ({
        columns: [],
        rows: [],
      })),
    ]);

    defineRenderTool({
      server: createCapturingServer(captured) as never,
      registry,
      name: "render_example_chart",
      title: "Render Example Chart",
      description: "Render example data.",
      chartType: "example",
      optionFields: {
        x: z.string(),
      },
      outputSchema: ExampleOutputSchema,
      mapInputToOptions: (input) => ({
        x: input.x,
      }),
    });

    assert.equal(captured.name, "render_example_chart");
    assert.equal(captured.config.title, "Render Example Chart");
    assert.equal(captured.config.description, "Render example data.");
    assert.deepEqual(captured.config._meta, {
      ui: { resourceUri: RENDERER_RESOURCE_URI },
      "ui/resourceUri": RENDERER_RESOURCE_URI,
    });

    const inputSchema = captured.config.inputSchema as Record<
      string,
      z.ZodTypeAny
    >;
    for (const key of [
      "provider",
      "data_columns",
      "data_rows",
      "max_rows",
      "title",
      "description",
      "column_hints",
      "filters",
      "x",
    ]) {
      assert.ok(inputSchema[key], `expected input schema field ${key}`);
    }

    assert.equal(
      (captured.config.outputSchema as Record<string, z.ZodTypeAny>).chart_type,
      ExampleOutputSchema.shape.chart_type,
    );
    assert.equal(
      (captured.config.outputSchema as Record<string, z.ZodTypeAny>).options,
      ExampleOutputSchema.shape.options,
    );
  });

  test("returns structuredContent and content on success without result UI metadata", async () => {
    const captured = {} as CapturedTool;
    const columns = [{ name: "team", type: "varchar" }];
    const rows = [["blue"]];
    const registry = createProviderRegistry([
      createProvider(async (): Promise<ProviderData> => ({ columns, rows })),
    ]);

    defineRenderTool({
      server: createCapturingServer(captured) as never,
      registry,
      name: "render_example_chart",
      title: "Render Example Chart",
      description: "Render example data.",
      chartType: "example",
      optionFields: {
        x: z.string(),
      },
      outputSchema: ExampleOutputSchema,
      mapInputToOptions: (input) => ({
        x: input.x,
      }),
    });

    const result = await captured.callback(
      {
        provider: "direct",
        data_columns: columns,
        data_rows: rows,
        title: "Example",
        x: "team",
      },
      { authInfo: { token: "token-123" } },
    );

    assert.deepEqual(result.content, [
      { type: "text", text: "Rendering example with 1 rows." },
    ]);
    assert.equal("structuredContent" in result, true);
    ExampleOutputSchema.parse(result.structuredContent);
    assert.deepEqual(result.structuredContent, {
      chart_type: "example",
      title: "Example",
      description: undefined,
      column_hints: undefined,
      filters: undefined,
      data: { columns, rows },
      data_source: "direct",
      stats: undefined,
      sql: undefined,
      namespace: undefined,
      options: { x: "team" },
    });
    assert.equal("_meta" in result, false);
  });

  test("includes sql on structuredContent when provider returns it", async () => {
    const captured = {} as CapturedTool;
    const columns = [{ name: "team", type: "varchar" }];
    const rows = [["blue"]];
    const registry = createProviderRegistry([
      createProvider(
        async (): Promise<ProviderData> => ({
          columns,
          rows,
          sql: "SELECT team FROM games",
        }),
      ),
    ]);

    defineRenderTool({
      server: createCapturingServer(captured) as never,
      registry,
      name: "render_example_chart",
      title: "Render Example Chart",
      description: "Render example data.",
      chartType: "example",
      optionFields: { x: z.string() },
      outputSchema: ExampleOutputSchema,
      mapInputToOptions: (input) => ({ x: input.x }),
    });

    const result = await captured.callback(
      { provider: "direct", x: "team" },
      { authInfo: { token: "token-123" } },
    );

    const structured = result.structuredContent as Record<string, unknown>;
    assert.equal(structured.sql, "SELECT team FROM games");
  });

  test("omits sql on structuredContent when provider does not return it", async () => {
    const captured = {} as CapturedTool;
    const columns = [{ name: "team", type: "varchar" }];
    const rows = [["blue"]];
    const registry = createProviderRegistry([
      createProvider(async (): Promise<ProviderData> => ({ columns, rows })),
    ]);

    defineRenderTool({
      server: createCapturingServer(captured) as never,
      registry,
      name: "render_example_chart",
      title: "Render Example Chart",
      description: "Render example data.",
      chartType: "example",
      optionFields: { x: z.string() },
      outputSchema: ExampleOutputSchema,
      mapInputToOptions: (input) => ({ x: input.x }),
    });

    const result = await captured.callback(
      { provider: "direct", x: "team" },
      { authInfo: { token: "token-123" } },
    );

    const structured = result.structuredContent as Record<string, unknown>;
    assert.equal(structured.sql, undefined);
  });

  test("maps FacadeError into isError results with code metadata", async () => {
    const captured = {} as CapturedTool;
    const registry = createProviderRegistry([
      createProvider(async (): Promise<ProviderData> => {
        throw new FacadeError("NOT_READY", "query still running");
      }),
    ]);

    defineRenderTool({
      server: createCapturingServer(captured) as never,
      registry,
      name: "render_example_chart",
      title: "Render Example Chart",
      description: "Render example data.",
      chartType: "example",
      optionFields: {
        x: z.string(),
      },
      outputSchema: ExampleOutputSchema,
      mapInputToOptions: (input) => ({
        x: input.x,
      }),
    });

    const result = await captured.callback(
      {
        provider: "direct",
        x: "team",
      },
      { authInfo: { token: "token-123" } },
    );

    assert.deepEqual(result, {
      content: [{ type: "text", text: "query still running" }],
      isError: true,
      _meta: { code: "NOT_READY" },
    });
  });

  test("wraps non-provider errors in McpError InvalidParams", async () => {
    const captured = {} as CapturedTool;
    const registry = createProviderRegistry([
      createProvider(async (): Promise<ProviderData> => {
        throw new Error("bad render options");
      }),
    ]);

    defineRenderTool({
      server: createCapturingServer(captured) as never,
      registry,
      name: "render_example_chart",
      title: "Render Example Chart",
      description: "Render example data.",
      chartType: "example",
      optionFields: {
        x: z.string(),
      },
      outputSchema: ExampleOutputSchema,
      mapInputToOptions: (input) => ({
        x: input.x,
      }),
    });

    await assert.rejects(
      captured.callback(
        {
          provider: "direct",
          x: "team",
        },
        { authInfo: { token: "token-123" } },
      ),
      (error: unknown) =>
        error instanceof McpError &&
        error.code === ErrorCode.InvalidParams &&
        error.message === "MCP error -32602: bad render options",
    );
  });
});
