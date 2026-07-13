// Copyright (c) 2025 AccelByte Inc.
// SPDX-License-Identifier: Apache-2.0

import type {
  Filter,
  RenderColumnHint,
} from "../../shared/render-schemas.js";

export type Primitive = string | number | boolean | Date | null;
export type Row = Record<string, Primitive>;
export type ColumnType =
  | "quantitative"
  | "nominal"
  | "ordinal"
  | "temporal"
  | "boolean";

export type RowSetMeta = {
  columnOrder: string[];
  columnTypes: Record<string, ColumnType>;
  columnHints: Record<string, RenderColumnHint>;
};

export const ROW_SET_META = Symbol("renderer.row-set-meta");

export type RowSet = Row[] & {
  [ROW_SET_META]?: RowSetMeta;
};

export function attachRowSetMeta(rows: Row[], meta: RowSetMeta): RowSet {
  Object.defineProperty(rows, ROW_SET_META, {
    configurable: true,
    enumerable: false,
    value: meta,
    writable: false,
  });

  return rows as RowSet;
}

export function getRowSetMeta(rows: Row[] | RowSet): RowSetMeta | undefined {
  return (rows as RowSet)[ROW_SET_META];
}

export type { Filter, RenderColumnHint };
