// Copyright (c) 2025 AccelByte Inc. All Rights Reserved.
// This is licensed software from AccelByte Inc, for limitations
// and restrictions contact your company contract manager.

import type { ChartConfiguration } from "chart.js";
import type { z } from "zod/v3";

import { BoxChartOutputSchema } from "../../../shared/render-schemas.js";
import {
  chartTokens,
  colorWithAlpha,
  commonChartOptions,
  createChartMount,
  instantiateChart,
  seriesPalette,
  validateColumns,
} from "../base.js";
import type { Row } from "../types.js";

type BoxOptions = z.infer<typeof BoxChartOutputSchema>["options"];

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function asLabel(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return String(value ?? "");
}

function groupValues(
  rows: Row[],
  xKey: string,
  yKey: string,
): { labels: string[]; data: number[][] } {
  const groups = new Map<string, number[]>();
  for (const row of rows) {
    const y = asNumber(row[yKey]);
    if (y === undefined) continue;
    const x = asLabel(row[xKey]);
    if (!groups.has(x)) groups.set(x, []);
    groups.get(x)!.push(y);
  }
  const labels = Array.from(groups.keys());
  const data = labels.map((label) => groups.get(label)!);
  return { labels, data };
}

function groupValuesByColor(
  rows: Row[],
  xKey: string,
  yKey: string,
  colorKey: string,
): { labels: string[]; series: Array<{ label: string; data: number[][] }> } {
  const xLabels: string[] = [];
  const xIdx = new Map<string, number>();
  const series = new Map<string, number[][]>();

  const ensureX = (label: string): number => {
    let idx = xIdx.get(label);
    if (idx === undefined) {
      idx = xLabels.length;
      xIdx.set(label, idx);
      xLabels.push(label);
    }
    return idx;
  };

  for (const row of rows) {
    const y = asNumber(row[yKey]);
    if (y === undefined) continue;
    const x = asLabel(row[xKey]);
    const c = asLabel(row[colorKey]);
    const i = ensureX(x);
    if (!series.has(c)) series.set(c, []);
    const seriesData = series.get(c)!;
    if (!seriesData[i]) seriesData[i] = [];
    seriesData[i].push(y);
  }

  // Pad missing slots with empty arrays so dataset length matches xLabels.
  for (const data of series.values()) {
    for (let i = 0; i < xLabels.length; i++) {
      if (!data[i]) data[i] = [];
    }
  }

  return {
    labels: xLabels,
    series: Array.from(series, ([label, data]) => ({ label, data })),
  };
}

export function renderBox(rows: Row[], options: BoxOptions): HTMLElement {
  validateColumns(rows, options.x, options.y, options.color);

  const { wrapper, canvas } = createChartMount();
  const tokens = chartTokens();
  const palette = seriesPalette();

  let labels: string[];
  let datasets: Array<{
    label: string;
    data: number[][];
    backgroundColor: string;
    borderColor: string;
  }>;

  if (options.color) {
    const grouped = groupValuesByColor(rows, options.x, options.y, options.color);
    labels = grouped.labels;
    datasets = grouped.series.map((s, i) => ({
      label: s.label,
      data: s.data,
      backgroundColor: colorWithAlpha(palette[i % palette.length], 0.42),
      borderColor: palette[i % palette.length],
    }));
  } else {
    const grouped = groupValues(rows, options.x, options.y);
    labels = grouped.labels;
    datasets = [
      {
        label: options.y,
        data: grouped.data,
        backgroundColor: colorWithAlpha(tokens.accent, 0.42),
        borderColor: tokens.info,
      },
    ];
  }

  const base = commonChartOptions();
  const config: ChartConfiguration = {
    type: "boxplot" as ChartConfiguration["type"],
    data: { labels, datasets } as unknown as ChartConfiguration["data"],
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
            text: options.x_label ?? options.x,
            color: tokens.textPrimary,
          },
        },
        y: {
          ...(base.scales.y as Record<string, unknown>),
          title: {
            display: true,
            text: options.y_label ?? options.y,
            color: tokens.textPrimary,
          },
        },
      },
    },
  };

  instantiateChart(canvas, config);
  return wrapper;
}
