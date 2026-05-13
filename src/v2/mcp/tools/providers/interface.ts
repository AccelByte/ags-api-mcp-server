// Copyright (c) 2025 AccelByte Inc. All Rights Reserved.
// This is licensed software from AccelByte Inc, for limitations
// and restrictions contact your company contract manager.

import type { ZodTypeAny } from "zod/v3";

/** A single column descriptor returned by a provider. */
export type ProviderColumn = { name: string; type: string };

/** Resolved tabular data — the unit every render tool consumes. */
export type ProviderData = {
  columns: ProviderColumn[];
  rows: string[][];
};

/**
 * Every render tool's data source. The interface is complete: every method
 * a render tool needs is declared here. Capability differences (facade vs.
 * direct) are expressed via the behavior of resolve(), not via interface shape.
 *
 * Same-name `schemaFields` across providers MUST declare schema-compatible
 * Zod types — the registry merges with last-write-wins.
 */
export interface Provider {
  /** Discriminator value used in the render tool's `provider` input field. */
  readonly name: string;

  /** Provider-specific input fields merged into every render tool's schema. */
  readonly schemaFields?: Readonly<Record<string, ZodTypeAny>>;

  /** Resolve the data referenced by `input`, using `token` for upstream auth. */
  resolve(input: Record<string, unknown>, token: string): Promise<ProviderData>;
}
