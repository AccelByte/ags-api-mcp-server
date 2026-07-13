// Copyright (c) 2025 AccelByte Inc.
// SPDX-License-Identifier: Apache-2.0

import type { ChartConfiguration } from "chart.js";
import type { z } from "zod/v3";

import { BarChartOutputSchema } from "../../../shared/render-schemas.js";
import {
  chartTokens,
  commonChartOptions,
  createChartMount,
  instantiateChart,
  seriesPalette,
  validateColumns,
} from "../base.js";
import type { Row } from "../types.js";

type BarOptions = z.infer<typeof BarChartOutputSchema>["options"];

// Per-band thickness for horizontal bars (bar + gap). Overhead covers Chart.js' inline
// legend (~28px), x-axis ticks (~30px), and the scale title (~20px).
const PIXELS_PER_BAND = 32;
const HEIGHT_OVERHEAD = 80;
const HEIGHT_MIN = 280;
const HEIGHT_MAX = 640;

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function asString(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return String(value ?? "");
}

interface BarDataset {
  label: string;
  data: number[];
  labelTexts?: Array<string | null>;
}

function buildLabelsAndDatasets(
  rows: Row[],
  xKey: string,
  yKey: string,
  colorKey: string | undefined,
  labelKey: string | undefined,
): { labels: string[]; datasets: BarDataset[] } {
  const xValues: string[] = [];
  const xIndex = new Map<string, number>();
  const observe = (xVal: string): number => {
    let idx = xIndex.get(xVal);
    if (idx === undefined) {
      idx = xValues.length;
      xIndex.set(xVal, idx);
      xValues.push(xVal);
    }
    return idx;
  };

  if (!colorKey) {
    const data: number[] = [];
    const labelTexts: Array<string | null> = [];
    for (const row of rows) {
      const y = asNumber(row[yKey]);
      if (y === undefined) continue;
      const idx = observe(asString(row[xKey]));
      data[idx] = y;
      labelTexts[idx] = labelKey ? asString(row[labelKey]) : null;
    }
    return {
      labels: xValues,
      datasets: [{ label: yKey, data, labelTexts }],
    };
  }

  const seriesData = new Map<string, number[]>();
  const seriesLabels = new Map<string, Array<string | null>>();
  for (const row of rows) {
    const y = asNumber(row[yKey]);
    if (y === undefined) continue;
    const seriesKey = asString(row[colorKey]);
    const idx = observe(asString(row[xKey]));
    if (!seriesData.has(seriesKey)) {
      seriesData.set(seriesKey, []);
      seriesLabels.set(seriesKey, []);
    }
    seriesData.get(seriesKey)![idx] = y;
    seriesLabels.get(seriesKey)![idx] = labelKey ? asString(row[labelKey]) : null;
  }

  const datasets: BarDataset[] = Array.from(seriesData, ([label, data]) => ({
    label,
    data,
    labelTexts: seriesLabels.get(label),
  }));
  return { labels: xValues, datasets };
}

function bandedHeight(bandCount: number): number {
  return Math.min(
    HEIGHT_MAX,
    Math.max(HEIGHT_MIN, bandCount * PIXELS_PER_BAND + HEIGHT_OVERHEAD),
  );
}

function normalizeStack(datasets: BarDataset[], labelCount: number): void {
  for (let i = 0; i < labelCount; i++) {
    let total = 0;
    for (const ds of datasets) {
      total += ds.data[i] ?? 0;
    }
    if (total <= 0) continue;
    for (const ds of datasets) {
      ds.data[i] = (ds.data[i] ?? 0) / total;
    }
  }
}

export function renderBar(rows: Row[], options: BarOptions): HTMLElement {
  validateColumns(rows, options.x, options.y, options.color, options.label);

  const horizontal = options.orientation === "horizontal";
  const grouped = options.bar_mode === "grouped";
  const normalized = options.bar_mode === "normalized";
  const stacked = options.bar_mode === "stacked" || normalized;

  const { labels, datasets } = buildLabelsAndDatasets(
    rows,
    options.x,
    options.y,
    options.color,
    options.label,
  );

  if (normalized && datasets.length > 1) {
    normalizeStack(datasets, labels.length);
  }

  const tokens = chartTokens();
  const palette = seriesPalette();
  const styled = datasets.map((ds, i) => {
    const color = options.color ? palette[i % palette.length] : tokens.accent;
    return {
      label: ds.label,
      data: ds.data,
      backgroundColor: color,
      borderColor: color,
      datalabels: options.label
        ? {
            display: true,
            color: options.color ? "rgba(255, 255, 255, 0.95)" : tokens.textOnAccent,
            anchor: horizontal ? "end" : "center",
            align: horizontal ? "start" : "center",
            font: { weight: 600 },
            formatter: (_value: unknown, ctx: { dataIndex: number }) =>
              ds.labelTexts?.[ctx.dataIndex] ?? null,
          }
        : { display: false },
    };
  });

  const bands =
    grouped && options.color && horizontal
      ? labels.length * datasets.length
      : labels.length;
  const height = horizontal ? bandedHeight(bands) : 360;
  const { wrapper, canvas } = createChartMount(height);

  const base = commonChartOptions();
  const config: ChartConfiguration = {
    type: "bar",
    data: { labels, datasets: styled as BarDataset[] & object[] },
    options: {
      ...base,
      indexAxis: horizontal ? "y" : "x",
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
          stacked: horizontal ? stacked : undefined,
          beginAtZero: horizontal ? true : undefined,
          max: normalized && horizontal ? 1 : undefined,
          title: {
            display: true,
            text: horizontal
              ? options.y_label ?? options.y
              : options.x_label ?? options.x,
            color: tokens.textPrimary,
          },
        },
        y: {
          ...(base.scales.y as Record<string, unknown>),
          stacked,
          beginAtZero: !horizontal ? true : undefined,
          max: normalized && !horizontal ? 1 : undefined,
          title: {
            display: true,
            text: horizontal
              ? options.x_label ?? options.x
              : options.y_label ?? options.y,
            color: tokens.textPrimary,
          },
        },
      },
    },
  };

  instantiateChart(canvas, config);
  return wrapper;
}
