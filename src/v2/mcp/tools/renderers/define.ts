// Copyright (c) 2025 AccelByte Inc. All Rights Reserved.
// This is licensed software from AccelByte Inc, for limitations
// and restrictions contact your company contract manager.

import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import type { AnyZodObject, ZodTypeAny } from "zod/v3";

import { RENDERER_RESOURCE_URI } from "../../renderer-resource.js";
import { FacadeError } from "../providers/facade.js";
import type { ProviderRegistry } from "../providers/registry.js";
import { resolveData, sharedRenderFields } from "./shared-input.js";

type ToolInput = { provider: string } & Record<string, unknown>;

interface DefineRenderToolOptions<TSchema extends AnyZodObject> {
  server: McpServer;
  registry: ProviderRegistry;
  name: string;
  title: string;
  description: string;
  chartType: string;
  optionFields: Record<string, ZodTypeAny>;
  outputSchema: TSchema;
  mapInputToOptions(input: ToolInput): Record<string, unknown>;
}

/**
 * A render tool's payload-building parts, keyed by tool name. Populated as each
 * `setupRender*` runs `defineRenderTool`, so the dashboard can rebuild any
 * pinned chart from its stored `render_tool` + `render_options` (on open and on
 * refresh) without bespoke per-chart code.
 */
export interface RenderToolEntry {
  chartType: string;
  outputSchema: AnyZodObject;
}

const renderToolRegistry = new Map<string, RenderToolEntry>();

/** All registered render tool names (for tests / coverage assertions). */
export function listRenderToolNames(): string[] {
  return Array.from(renderToolRegistry.keys());
}

/** Row data + execution metadata used to rebuild a render payload. */
export interface RenderPayloadData {
  columns: { name: string; type: string }[];
  rows: string[][];
  stats?: { data_scanned_bytes?: number; engine_execution_time_ms?: number };
  sql?: string;
}

/**
 * Rebuild a validated RenderOutput for a pinned query from its stored
 * `render_tool` + opaque `render_options` and freshly-resolved rows. Reuses the
 * tool's own `outputSchema.parse(...)`, so a hostile/invalid `render_options`
 * throws here (caught per-card by the caller) rather than rendering.
 */
export function buildPinRenderOutput(
  renderTool: string,
  renderOptions: Record<string, unknown>,
  data: RenderPayloadData,
  extras: { title?: string; dataSource?: string } = {},
): Record<string, unknown> {
  const entry = renderToolRegistry.get(renderTool);
  if (!entry) {
    throw new Error(`Unknown render tool: "${renderTool}".`);
  }
  return entry.outputSchema.parse({
    chart_type: entry.chartType,
    title: extras.title,
    data: { columns: data.columns, rows: data.rows },
    // Live (facade) pins resolve rows by query_id; static pins carry them inline
    // and render as "direct" (symmetric with the `direct` render provider).
    data_source: extras.dataSource ?? "facade",
    stats: data.stats,
    sql: data.sql,
    options: renderOptions,
  }) as Record<string, unknown>;
}

export function defineRenderTool<TSchema extends AnyZodObject>({
  server,
  registry,
  name,
  title,
  description,
  chartType,
  optionFields,
  outputSchema,
  mapInputToOptions,
}: DefineRenderToolOptions<TSchema>): void {
  // Record the build parts so the dashboard can rebuild this chart from a
  // stored pin (open + refresh) via the same outputSchema.parse path.
  renderToolRegistry.set(name, { chartType, outputSchema });

  registerAppTool(
    server,
    name,
    {
      title,
      description,
      inputSchema: { ...sharedRenderFields(registry), ...optionFields },
      outputSchema: outputSchema.shape,
      _meta: { ui: { resourceUri: RENDERER_RESOURCE_URI } },
    },
    async (
      input: Record<string, unknown>,
      extra: {
        authInfo?: { token?: string };
      },
    ) => {
      const toolInput = input as ToolInput;
      const token = extra.authInfo?.token ?? "";

      try {
        const { columns, rows, stats, sql } = await resolveData(
          registry,
          toolInput,
          token,
        );
        const view = outputSchema.parse({
          chart_type: chartType,
          title: toolInput.title,
          description: toolInput.description,
          column_hints: toolInput.column_hints,
          filters: toolInput.filters,
          data: { columns, rows },
          data_source: toolInput.provider,
          stats,
          sql,
          options: mapInputToOptions(toolInput),
        });

        return {
          content: [
            {
              type: "text" as const,
              text: `Rendering ${chartType} with ${rows.length} rows.`,
            },
          ],
          structuredContent: view,
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error ?? "");

        if (error instanceof FacadeError) {
          return {
            content: [{ type: "text" as const, text: message }],
            isError: true,
            _meta: { code: error.code },
          };
        }

        throw new McpError(ErrorCode.InvalidParams, message);
      }
    },
  );
}

export default defineRenderTool;
