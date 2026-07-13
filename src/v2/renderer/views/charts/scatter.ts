// Copyright (c) 2025 AccelByte Inc.
// SPDX-License-Identifier: Apache-2.0

import type { ChartConfiguration } from "chart.js";
import type { z } from "zod/v3";

import { ScatterChartOutputSchema } from "../../../shared/render-schemas.js";
import {
  chartTokens,
  commonChartOptions,
  createChartMount,
  instantiateChart,
  seriesPalette,
  validateColumns,
} from "../base.js";
import type { Row } from "../types.js";

type ScatterOptions = z.infer<typeof ScatterChartOutputSchema>["options"];

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

interface ScatterPoint {
  x: number;
  y: number;
  r?: number;
}

interface ScatterDataset {
  label: string;
  data: ScatterPoint[];
}

function pivotByColor(
  rows: Row[],
  xKey: string,
  yKey: string,
  colorKey: string | undefined,
  sizeKey: string | undefined,
): ScatterDataset[] {
  const makePoint = (row: Row): ScatterPoint | undefined => {
    const x = asNumber(row[xKey]);
    const y = asNumber(row[yKey]);
    if (x === undefined || y === undefined) return undefined;
    const r = sizeKey ? asNumber(row[sizeKey]) : undefined;
    return r !== undefined ? { x, y, r } : { x, y };
  };

  if (!colorKey) {
    const data: ScatterPoint[] = [];
    for (const row of rows) {
      const p = makePoint(row);
      if (p) data.push(p);
    }
    return [{ label: yKey, data }];
  }

  const groups = new Map<string, ScatterPoint[]>();
  for (const row of rows) {
    const p = makePoint(row);
    if (!p) continue;
    const label = String(row[colorKey] ?? "");
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label)!.push(p);
  }
  return Array.from(groups, ([label, data]) => ({ label, data }));
}

export function renderScatter(rows: Row[], options: ScatterOptions): HTMLElement {
  validateColumns(rows, options.x, options.y, options.color, options.size);

  const { wrapper, canvas } = createChartMount();
  const tokens = chartTokens();
  const palette = seriesPalette();
  const datasets = pivotByColor(rows, options.x, options.y, options.color, options.size);

  const styled = datasets.map((ds, i) => {
    const color = options.color ? palette[i % palette.length] : tokens.accent;
    return {
      ...ds,
      backgroundColor: color,
      borderColor: options.color ? color : tokens.info,
      pointRadius: options.size ? undefined : 4.5,
      pointHoverRadius: 6,
      ...(options.trend_line === "linear"
        ? {
            trendlineLinear: {
              colorMin: tokens.info,
              colorMax: tokens.info,
              lineStyle: "solid",
              width: 2,
            },
          }
        : {}),
    };
  });

  const base = commonChartOptions();
  const config: ChartConfiguration = {
    type: "scatter",
    data: { datasets: styled },
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
          type: "linear",
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
