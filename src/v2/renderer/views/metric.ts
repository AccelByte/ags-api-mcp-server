// Copyright (c) 2025 AccelByte Inc. All Rights Reserved.
// This is licensed software from AccelByte Inc, for limitations
// and restrictions contact your company contract manager.

import type { z } from "zod/v3";
import { MetricOutputSchema } from "../../shared/render-schemas.js";
import { toRows } from "./coerce.js";
import { filterRows } from "./filter.js";
import type { Primitive, Row } from "./types.js";

type MetricPayload = z.infer<typeof MetricOutputSchema>;

function firstRowValue(rows: Row[], columnName: string): Primitive | undefined {
  return rows[0]?.[columnName];
}

function formatAutoNumber(value: number): string {
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 2,
  }).format(value);
}

function formatMetricValue(
  value: Primitive | undefined,
  format?: string,
  unit?: string,
): string {
  if (value === undefined || value === null) {
    return "—";
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "boolean") {
    return value ? "True" : "False";
  }

  if (typeof value === "string") {
    return value;
  }

  switch (format) {
    case "compact":
      return new Intl.NumberFormat(undefined, {
        maximumFractionDigits: 2,
        notation: "compact",
      }).format(value);
    case "currency":
      if (unit && /^[A-Z]{3}$/.test(unit)) {
        try {
          return new Intl.NumberFormat(undefined, {
            style: "currency",
            currency: unit,
            maximumFractionDigits: 2,
          }).format(value);
        } catch {
          return `${formatAutoNumber(value)} ${unit}`;
        }
      }
      return formatAutoNumber(value);
    case "integer":
      return new Intl.NumberFormat(undefined, {
        maximumFractionDigits: 0,
      }).format(value);
    case "number":
      return formatAutoNumber(value);
    case "percent":
      return new Intl.NumberFormat(undefined, {
        style: "percent",
        maximumFractionDigits: 2,
      }).format(value);
    default:
      return formatAutoNumber(value);
  }
}

function formatCompareValue(value: Primitive | undefined): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value === "number") {
    return formatAutoNumber(value);
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "boolean") {
    return value ? "True" : "False";
  }

  return value;
}

export function renderMetric(root: HTMLElement, payload: MetricPayload): void {
  root.replaceChildren();
  const rows = filterRows(
    toRows(payload.data.columns, payload.data.rows, payload.column_hints ?? {}),
    payload.filters ?? [],
  );
  const metricValue = firstRowValue(rows, payload.options.value);
  const compareValue = payload.options.compare
    ? formatCompareValue(firstRowValue(rows, payload.options.compare))
    : undefined;

  const card = document.createElement("section");
  card.className = "metric-card";

  const label = document.createElement("h1");
  label.className = "metric-label";
  label.textContent = payload.options.label ?? payload.title ?? payload.options.value;
  card.appendChild(label);

  if (payload.description) {
    const description = document.createElement("p");
    description.className = "renderer-description";
    description.textContent = payload.description;
    card.appendChild(description);
  }

  const value = document.createElement("p");
  value.className = "metric-value";
  value.textContent = formatMetricValue(
    metricValue,
    payload.options.format,
    payload.options.unit,
  );

  if (payload.options.unit && payload.options.format !== "currency") {
    const unit = document.createElement("span");
    unit.className = "metric-unit";
    unit.textContent = payload.options.unit;
    value.appendChild(unit);
  }

  card.appendChild(value);

  const compareColumn = payload.options.compare;
  if (compareColumn && compareValue) {
    const compare = document.createElement("p");
    compare.className = "metric-compare";
    compare.textContent = compareValue;
    card.appendChild(compare);
  }

  root.appendChild(card);
}
