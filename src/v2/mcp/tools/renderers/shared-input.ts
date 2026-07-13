// Copyright (c) 2025 AccelByte Inc.
// SPDX-License-Identifier: Apache-2.0

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
        'Data source discriminator. Built-ins: "facade" (re-fetch server-side results by reference) and "direct" (inline — pass data_columns+data_rows). Provider-specific parameters are documented on their own fields.',
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
