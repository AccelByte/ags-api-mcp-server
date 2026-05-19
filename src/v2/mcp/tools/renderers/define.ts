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
        const { columns, rows, stats } = await resolveData(
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
