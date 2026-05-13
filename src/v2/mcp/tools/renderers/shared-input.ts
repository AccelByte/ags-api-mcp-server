// Copyright (c) 2025 AccelByte Inc. All Rights Reserved.
// This is licensed software from AccelByte Inc, for limitations
// and restrictions contact your company contract manager.

import { z, type ZodTypeAny } from "zod/v3";

import {
  FilterSchema,
  RenderColumnHintSchema,
} from "../../../shared/render-schemas.js";
import type { ProviderData } from "../providers/interface.js";
import type { ProviderRegistry } from "../providers/registry.js";

export const MAX_ROWS_DEFAULT = 10_000;
export const MAX_ROWS_CEILING = 100_000;

/**
 * Fields included on every render_* tool's INPUT schema. Built lazily from the
 * server-instance provider registry so hosted-mode config is preserved.
 */
export function sharedRenderFields(
  registry: ProviderRegistry,
): Record<string, ZodTypeAny> {
  return {
    provider: z
      .string()
      .describe(
        'Data source discriminator. Built-ins: "facade" (Athena Facade — pass query_id+namespace), "direct" (inline — pass data_columns+data_rows).',
      ),
    ...registry.mergedSchemaFields(),
    max_rows: z
      .number()
      .int()
      .min(1)
      .max(MAX_ROWS_CEILING)
      .default(MAX_ROWS_DEFAULT)
      .describe(
        `Maximum rows to fetch from the provider before rendering. Default ${MAX_ROWS_DEFAULT}; ceiling ${MAX_ROWS_CEILING}.`,
      ),
    title: z.string().optional(),
    description: z.string().optional(),
    column_hints: z
      .record(z.string(), RenderColumnHintSchema)
      .optional()
      .describe("Per-column rendering hints keyed by column name."),
    filters: z
      .array(FilterSchema)
      .optional()
      .describe(
        "Row-level filters applied client-side before rendering (ANDed).",
      ),
  };
}

export async function resolveData(
  registry: ProviderRegistry,
  input: { provider: string } & Record<string, unknown>,
  token: string,
): Promise<ProviderData> {
  const provider = registry.getProvider(input.provider);
  if (!provider) {
    throw new Error(
      `Unknown provider: "${input.provider}". Registered providers: ${registry.listProviderNames().join(", ") || "(none)"}`,
    );
  }

  return provider.resolve(input, token);
}
