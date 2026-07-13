// Copyright (c) 2025 AccelByte Inc.
// SPDX-License-Identifier: Apache-2.0

import type { z } from "zod/v3";
import {
  ProviderColumnSchema,
  type RenderColumnHint,
} from "../../shared/render-schemas.js";
import {
  attachRowSetMeta,
  type ColumnType,
  type Primitive,
  type Row,
  type RowSet,
} from "./types.js";

type ProviderColumn = z.infer<typeof ProviderColumnSchema>;

const NUMERIC_TYPES = new Set([
  "bigint",
  "decimal",
  "double",
  "float",
  "integer",
  "int",
  "number",
  "numeric",
  "real",
  "smallint",
  "tinyint",
]);

const TEMPORAL_TYPES = new Set([
  "date",
  "datetime",
  "time",
  "timestamp",
  "timestamp with time zone",
  "timestamp without time zone",
]);

const BOOLEAN_TYPES = new Set(["bool", "boolean"]);

function normalizeTypeName(type: string): string {
  return type.trim().toLowerCase();
}

function isNullLike(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === "" || normalized === "null";
}

function resolveColumnType(
  column: ProviderColumn,
  hint?: RenderColumnHint,
): ColumnType {
  if (hint?.type) {
    return hint.type;
  }

  const typeName = normalizeTypeName(column.type);
  if (NUMERIC_TYPES.has(typeName)) {
    return "quantitative";
  }
  if (TEMPORAL_TYPES.has(typeName)) {
    return "temporal";
  }
  if (BOOLEAN_TYPES.has(typeName)) {
    return "boolean";
  }

  return "nominal";
}

function coerceBoolean(value: string): Primitive {
  const normalized = value.trim().toLowerCase();
  if (normalized === "true") {
    return true;
  }
  if (normalized === "false") {
    return false;
  }

  return value;
}

function coerceTemporal(value: string, hint?: RenderColumnHint): Primitive {
  if (hint?.format) {
    return value;
  }

  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    return value;
  }

  return date;
}

function coerceQuantitative(value: string): Primitive {
  const number = Number(value);
  if (Number.isFinite(number)) {
    return number;
  }

  return value;
}

function coerceValue(
  value: string | undefined,
  type: ColumnType,
  hint?: RenderColumnHint,
): Primitive {
  if (value === undefined || isNullLike(value)) {
    return null;
  }

  switch (type) {
    case "quantitative":
      return coerceQuantitative(value);
    case "temporal":
      return coerceTemporal(value, hint);
    case "boolean":
      return coerceBoolean(value);
    default:
      return value;
  }
}

export function toRows(
  columns: ProviderColumn[],
  rawRows: string[][],
  columnHints: Record<string, RenderColumnHint> = {},
): RowSet {
  const columnTypes = Object.fromEntries(
    columns.map((column) => [
      column.name,
      resolveColumnType(column, columnHints[column.name]),
    ]),
  ) as Record<string, ColumnType>;

  const rows = rawRows.map((rawRow) => {
    const row: Row = {};
    for (const [index, column] of columns.entries()) {
      row[column.name] = coerceValue(
        rawRow[index],
        columnTypes[column.name],
        columnHints[column.name],
      );
    }
    return row;
  });

  return attachRowSetMeta(rows, {
    columnOrder: columns.map((column) => column.name),
    columnTypes,
    columnHints,
  });
}
