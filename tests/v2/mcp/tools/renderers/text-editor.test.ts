import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type {
  RegisteredTool,
  ToolCallback,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { ZodError, z } from "zod/v3";

import { TextEditorOutputSchema } from "../../../../../src/v2/shared/render-schemas.js";
import { setupRenderTextEditor } from "../../../../../src/v2/mcp/tools/renderers/text-editor.js";

interface CapturedTool {
  name: string;
  config: Record<string, unknown>;
  callback: ToolCallback<Record<string, z.ZodTypeAny>>;
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
      return {} as RegisteredTool;
    },
  };
}

describe("setupRenderTextEditor", () => {
  test("registers render_text_editor with the renderer UI resource and content/language/title inputs", () => {
    const captured = {} as CapturedTool;

    setupRenderTextEditor(createCapturingServer(captured) as never);

    assert.equal(captured.name, "render_text_editor");

    const inputSchema = captured.config.inputSchema as Record<
      string,
      z.ZodTypeAny
    >;
    for (const key of ["content", "language", "title"]) {
      assert.ok(inputSchema[key], `expected render_text_editor field ${key}`);
    }

    const meta = captured.config._meta as { ui?: { resourceUri?: string } };
    assert.equal(meta.ui?.resourceUri, "ui://renderer/index.html");
  });

  test("projects input into structured content and derives a filename + breadcrumb", async () => {
    const captured = {} as CapturedTool;
    setupRenderTextEditor(createCapturingServer(captured) as never);

    const result = await captured.callback(
      {
        content: '{\n  "namespace": "demo"\n}',
        language: "json",
        title: "Custom Context",
      },
      {} as never,
    );

    const parsed = TextEditorOutputSchema.parse(result.structuredContent);
    assert.equal(parsed.chart_type, "text_editor");
    assert.equal(parsed.content, '{\n  "namespace": "demo"\n}');
    assert.equal(parsed.language, "json");
    assert.equal(parsed.title, "Custom Context");
    assert.equal(parsed.filename, "custom-context.json");

    const breadcrumb = result.content?.[0];
    assert.equal(breadcrumb?.type, "text");
    assert.match(String(breadcrumb?.text), /custom-context\.json/);
  });

  test("defaults to markdown and a context filename when language/title are omitted", async () => {
    const captured = {} as CapturedTool;
    setupRenderTextEditor(createCapturingServer(captured) as never);

    const result = await captured.callback(
      { content: "# Notes" },
      {} as never,
    );

    const parsed = TextEditorOutputSchema.parse(result.structuredContent);
    assert.equal(parsed.language, "markdown");
    assert.equal(parsed.filename, "context.md");
  });

  test("output schema is strict and discriminated on chart_type", async () => {
    const captured = {} as CapturedTool;
    setupRenderTextEditor(createCapturingServer(captured) as never);

    const result = await captured.callback(
      { content: "hello", language: "text" },
      {} as never,
    );
    const parsed = TextEditorOutputSchema.parse(result.structuredContent);

    assert.throws(
      () => TextEditorOutputSchema.parse({ ...parsed, chart_type: "metric" }),
      ZodError,
    );
    assert.throws(
      () => TextEditorOutputSchema.parse({ ...parsed, unexpected: true }),
      ZodError,
    );
  });
});
