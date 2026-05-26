// Copyright (c) 2025 AccelByte Inc. All Rights Reserved.
// This is licensed software from AccelByte Inc, for limitations
// and restrictions contact your company contract manager.

import type { ChartConfiguration } from "chart.js";
import type { z } from "zod/v3";

import { HistogramChartOutputSchema } from "../../../shared/render-schemas.js";
import {
  chartTokens,
  commonChartOptions,
  createChartMount,
  instantiateChart,
  seriesPalette,
  validateColumns,
} from "../base.js";
import type { Row } from "../types.js";

type HistogramOptions = z.infer<typeof HistogramChartOutputSchema>["options"];

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

interface Bin {
  start: number;
  end: number;
  count: number;
}

// Sturges' rule when no explicit bin count is provided.
function defaultBinCount(n: number): number {
  if (n < 2) return 1;
  return Math.max(1, Math.ceil(Math.log2(n) + 1));
}

function binValues(values: number[], requested?: number): Bin[] {
  if (values.length === 0) return [];
  // Manual min/max — `Math.min(...values)` throws RangeError above ~65K args in V8.
  let min = values[0]!;
  let max = values[0]!;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const count = requested ?? defaultBinCount(values.length);
  if (min === max) {
    return [{ start: min, end: max, count: values.length }];
  }
  const width = (max - min) / count;
  const bins: Bin[] = Array.from({ length: count }, (_, i) => ({
    start: min + i * width,
    end: min + (i + 1) * width,
    count: 0,
  }));
  for (const v of values) {
    let idx = Math.floor((v - min) / width);
    if (idx >= count) idx = count - 1;
    if (idx < 0) idx = 0;
    bins[idx].count += 1;
  }
  return bins;
}

function formatBinLabel(bin: Bin): string {
  const fmt = (n: number) =>
    new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(n);
  return `${fmt(bin.start)}–${fmt(bin.end)}`;
}

export function renderHistogram(
  rows: Row[],
  options: HistogramOptions,
): HTMLElement {
  validateColumns(rows, options.column, options.color);

  const { wrapper, canvas } = createChartMount();
  const tokens = chartTokens();
  const palette = seriesPalette();

  const groups = new Map<string, number[]>();
  for (const row of rows) {
    const v = asNumber(row[options.column]);
    if (v === undefined) continue;
    const key = options.color ? String(row[options.color] ?? "") : "__all__";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(v);
  }

  // Use the same bin edges for every group so bars align.
  const allValues: number[] = [];
  for (const arr of groups.values()) allValues.push(...arr);
  const baseBins = binValues(allValues, options.bin_count);
  const labels = baseBins.map(formatBinLabel);

  const datasets = Array.from(groups, ([groupLabel, values], idx) => {
    const bins = baseBins.map((b) => ({ ...b, count: 0 }));
    for (const v of values) {
      let bi = bins.findIndex((b) => v >= b.start && v < b.end);
      if (bi === -1) bi = bins.length - 1;
      bins[bi].count += 1;
    }
    const counts = bins.map((b) => b.count);
    const denom = options.normalize ? values.length || 1 : 1;
    const data = counts.map((c) => (options.normalize ? c / denom : c));
    const color = options.color ? palette[idx % palette.length] : tokens.accent;
    return {
      label: options.color ? groupLabel : options.column,
      data,
      backgroundColor: color,
      borderColor: color,
    };
  });

  const base = commonChartOptions();
  const config: ChartConfiguration = {
    type: "bar",
    data: { labels, datasets },
    options: {
      ...base,
      plugins: {
        ...base.plugins,
        legend: {
          display: Boolean(options.color),
          labels: { color: tokens.textPrimary },
        },
      },
      scales: {
        x: {
          ...(base.scales.x as Record<string, unknown>),
          title: {
            display: true,
            text: options.x_label ?? options.column,
            color: tokens.textPrimary,
          },
        },
        y: {
          ...(base.scales.y as Record<string, unknown>),
          beginAtZero: true,
          title: {
            display: true,
            text: options.y_label ?? (options.normalize ? "Proportion" : "Count"),
            color: tokens.textPrimary,
          },
        },
      },
    },
  };

  instantiateChart(canvas, config);
  return wrapper;
}
