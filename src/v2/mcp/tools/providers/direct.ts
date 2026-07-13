// Copyright (c) 2025 AccelByte Inc.
// SPDX-License-Identifier: Apache-2.0

import { z } from "zod/v3";

import { DIRECT_DATA_SOURCE } from "../../../shared/render-schemas.js";
import type { Provider, ProviderColumn, ProviderData } from "./interface.js";

const ProviderColumnSchema = z
  .object({
    name: z.string(),
    type: z.string(),
  })
  .strict();

function createDirectProvider(): Provider {
  return {
    name: DIRECT_DATA_SOURCE,
    schemaFields: {
      data_columns: z
        .array(ProviderColumnSchema)
        .optional()
        .describe(
          'Inline column descriptors (required when provider="direct"). Each {name,type}. Caller owns fidelity — prefer provider="facade" for large datasets.',
        ),
      data_rows: z
        .array(z.array(z.string()))
        .optional()
        .describe(
          'Inline rows as string matrix (required when provider="direct"). Numeric values passed as strings; renderer parses per column type.',
        ),
    },

    async resolve(input): Promise<ProviderData> {
      const { data_columns: dataColumns, data_rows: dataRows } = input as {
        data_columns?: ProviderColumn[];
        data_rows?: string[][];
      };

      if (!dataColumns || !dataRows) {
        throw new Error(
          'provider="direct" requires both data_columns and data_rows.',
        );
      }

      return { columns: dataColumns, rows: dataRows };
    },
  };
}

export { createDirectProvider };
export default createDirectProvider;
