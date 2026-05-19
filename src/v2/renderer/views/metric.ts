// Copyright (c) 2025 AccelByte Inc. All Rights Reserved.
// This is licensed software from AccelByte Inc, for limitations
// and restrictions contact your company contract manager.

import type { z } from "zod/v3";
import { MetricOutputSchema } from "../../shared/render-schemas.js";
import { mountShell } from "./base.js";
import { toRows } from "./coerce.js";
import { filterRows } from "./filter.js";
import { getRowSetMeta, type Primitive, type Row } from "./types.js";

type MetricPayload = z.infer<typeof MetricOutputSchema>;

function firstRowValue(rows: Row[], columnName: string): Primitive | undefined {
  return rows[0]?.[columnName];
}

function formatAutoNumber(value: number): string {
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 2,
  }).format(value);
}

function formatPercentChange(percent: number): string {
  const sign = percent >= 0 ? "+" : "";
  return `${sign}${new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 1,
    minimumFractionDigits: 1,
  }).format(percent)} %`;
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

function findSecondaryColumn(
  rows: Row[],
  declaredColumns: string[],
  exclude: ReadonlySet<string>,
): string | undefined {
  const meta = getRowSetMeta(rows);
  for (const column of declaredColumns) {
    if (exclude.has(column)) {
      continue;
    }
    if (meta?.columnTypes[column] === "quantitative") {
      return column;
    }
    if (typeof rows[0]?.[column] === "number") {
      return column;
    }
  }
  return undefined;
}

export function renderMetric(root: HTMLElement, payload: MetricPayload): void {
  root.replaceChildren();
  const rows = filterRows(
    toRows(payload.data.columns, payload.data.rows, payload.column_hints ?? {}),
    payload.filters ?? [],
  );
  const metricValue = firstRowValue(rows, payload.options.value);
  const compareColumn = payload.options.compare;
  const compareRaw = compareColumn ? firstRowValue(rows, compareColumn) : undefined;

  const { body: card } = mountShell(root, {
    title: payload.options.label ?? payload.title ?? payload.options.value,
    description: payload.description,
    chartType: "metric",
    dataSource: payload.data_source,
    stats: payload.stats,
  });

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

  if (compareColumn && compareRaw !== undefined && compareRaw !== null) {
    const valueIsNumeric = typeof metricValue === "number";
    const compareIsNumeric = typeof compareRaw === "number";

    if (valueIsNumeric && compareIsNumeric && compareRaw !== 0) {
      const percentChange = ((metricValue - compareRaw) / compareRaw) * 100;
      const direction = percentChange >= 0 ? "up" : "down";
      const arrow = direction === "up" ? "▲" : "▼";

      const compare = document.createElement("p");
      compare.className = "metric-compare";

      const delta = document.createElement("span");
      delta.className = "delta-indicator delta-indicator--inline";
      delta.dataset.direction = direction;
      delta.textContent = `${arrow} ${formatPercentChange(percentChange)}`;
      compare.appendChild(delta);

      const comparable = document.createElement("span");
      comparable.className = "metric-compare-value";
      comparable.textContent = ` vs ${formatAutoNumber(compareRaw)}`;
      compare.appendChild(comparable);

      card.appendChild(compare);
    } else {
      const compareValue = formatCompareValue(compareRaw);
      if (compareValue) {
        const compare = document.createElement("p");
        compare.className = "metric-compare";
        compare.textContent = compareValue;
        card.appendChild(compare);
      }
    }
  }

  const declaredColumns = payload.data.columns.map((column) => column.name);
  const exclude = new Set<string>([payload.options.value]);
  if (compareColumn) {
    exclude.add(compareColumn);
  }
  const secondaryColumn = findSecondaryColumn(rows, declaredColumns, exclude);
  if (secondaryColumn) {
    const secondaryRaw = firstRowValue(rows, secondaryColumn);
    if (typeof secondaryRaw === "number") {
      const chip = document.createElement("span");
      chip.className = "metric-secondary";
      const chipLabel = document.createElement("span");
      chipLabel.className = "metric-secondary-label";
      chipLabel.textContent =
        payload.column_hints?.[secondaryColumn]?.label ?? secondaryColumn;
      const chipValue = document.createElement("span");
      chipValue.className = "metric-secondary-value";
      chipValue.textContent = formatAutoNumber(secondaryRaw);
      chip.append(chipLabel, chipValue);
      card.appendChild(chip);
    }
  }
}
