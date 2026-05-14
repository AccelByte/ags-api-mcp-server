// Copyright (c) 2025 AccelByte Inc. All Rights Reserved.
// This is licensed software from AccelByte Inc, for limitations
// and restrictions contact your company contract manager.

import {
  attachRowSetMeta,
  getRowSetMeta,
  type Filter,
  type Primitive,
  type Row,
  type RowSet,
} from "./types.js";

type Comparable = string | number | boolean | null;

function normalizeBoolean(value: string): boolean | undefined {
  const normalized = value.trim().toLowerCase();
  if (normalized === "true") {
    return true;
  }
  if (normalized === "false") {
    return false;
  }

  return undefined;
}

function toComparable(
  value: Primitive | string | number | boolean | null | undefined,
  rowValue?: Primitive,
): Comparable | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  if (value instanceof Date) {
    return value.valueOf();
  }

  if (rowValue instanceof Date && typeof value === "string") {
    const date = new Date(value);
    return Number.isNaN(date.valueOf()) ? undefined : date.valueOf();
  }

  if (typeof rowValue === "number" && typeof value === "string") {
    const number = Number(value);
    return Number.isFinite(number) ? number : undefined;
  }

  if (typeof rowValue === "boolean" && typeof value === "string") {
    return normalizeBoolean(value);
  }

  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  return undefined;
}

function equalsComparable(
  rowValue: Primitive | undefined,
  filterValue: string | number | boolean | null,
): boolean {
  const left = toComparable(rowValue, rowValue);
  const right = toComparable(filterValue, rowValue);
  return left !== undefined && right !== undefined && left === right;
}

function compareComparable(
  rowValue: Primitive | undefined,
  filterValue: string | number | boolean | null,
): number | undefined {
  const left = toComparable(rowValue, rowValue);
  const right = toComparable(filterValue, rowValue);

  if (left === undefined || right === undefined || left === null || right === null) {
    return undefined;
  }

  if (typeof left !== typeof right) {
    return undefined;
  }

  if (typeof left === "string" || typeof left === "number") {
    if (left === right) {
      return 0;
    }

    return left > right ? 1 : -1;
  }

  return undefined;
}

function matchesFilter(row: Row, filter: Filter): boolean {
  const candidate = row[filter.column];
  const values = Array.isArray(filter.value) ? filter.value : [filter.value];

  switch (filter.op) {
    case "eq":
      return values.some((value) => equalsComparable(candidate, value));
    case "neq":
      return values.every((value) => !equalsComparable(candidate, value));
    case "in":
      return values.some((value) => equalsComparable(candidate, value));
    case "not_in":
      return values.every((value) => !equalsComparable(candidate, value));
    case "gt": {
      const comparison = compareComparable(candidate, values[0]);
      return comparison !== undefined && comparison > 0;
    }
    case "gte": {
      const comparison = compareComparable(candidate, values[0]);
      return comparison !== undefined && comparison >= 0;
    }
    case "lt": {
      const comparison = compareComparable(candidate, values[0]);
      return comparison !== undefined && comparison < 0;
    }
    case "lte": {
      const comparison = compareComparable(candidate, values[0]);
      return comparison !== undefined && comparison <= 0;
    }
    default:
      return true;
  }
}

export function filterRows(rows: RowSet, filters: Filter[] = []): RowSet {
  if (filters.length === 0) {
    return rows;
  }

  const meta = getRowSetMeta(rows);
  const filtered = rows.filter((row) =>
    filters.every((filter) => matchesFilter(row, filter)),
  );

  return meta ? attachRowSetMeta(filtered, meta) : (filtered as RowSet);
}
