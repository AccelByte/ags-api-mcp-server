// Copyright (c) 2025 AccelByte Inc.
// SPDX-License-Identifier: Apache-2.0

import type { ChartConfiguration, ChartDataset } from "chart.js";
import type { z } from "zod/v3";

import { AreaChartOutputSchema } from "../../../shared/render-schemas.js";
import {
  chartTokens,
  colorWithAlpha,
  commonChartOptions,
  createChartMount,
  instantiateChart,
  seriesPalette,
  validateColumns,
  xScaleType,
} from "../base.js";
import type { Row } from "../types.js";

type AreaOptions = z.infer<typeof AreaChartOutputSchema>["options"];

type XValue = string | number | Date;

function toXValue(value: unknown): XValue {
  if (value instanceof Date) return value;
  if (typeof value === "number") return value;
  return String(value ?? "");
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

interface AreaPoint {
  x: XValue;
  y: number;
}

interface AreaDataset {
  label: string;
  data: AreaPoint[];
}

function pivotByColor(
  rows: Row[],
  xKey: string,
  yKey: string,
  colorKey: string | undefined,
): AreaDataset[] {
  if (!colorKey) {
    const data: AreaPoint[] = [];
    for (const row of rows) {
      const y = asNumber(row[yKey]);
      if (y === undefined) continue;
      data.push({ x: toXValue(row[xKey]), y });
    }
    return [{ label: yKey, data }];
  }
  const groups = new Map<string, AreaPoint[]>();
  for (const row of rows) {
    const y = asNumber(row[yKey]);
    if (y === undefined) continue;
    const label = String(row[colorKey] ?? "");
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label)!.push({ x: toXValue(row[xKey]), y });
  }
  return Array.from(groups, ([label, data]) => ({ label, data }));
}

export function renderArea(rows: Row[], options: AreaOptions): HTMLElement {
  validateColumns(rows, options.x, options.y, options.color);

  const { wrapper, canvas } = createChartMount();
  const tokens = chartTokens();
  const palette = seriesPalette();
  const datasets = pivotByColor(rows, options.x, options.y, options.color);

  const stepped = options.curve === "step";
  const tension = options.curve === "smooth" ? 0.4 : 0;
  const stacked = options.stack_mode === "stacked" || options.stack_mode === "normalized";
  const normalized = options.stack_mode === "normalized";
  const fillAlpha = options.stack_mode === "overlap" ? 0.34 : options.color ? 0.46 : 0.6;

  const styled = datasets.map((ds, i) => {
    const color = options.color ? palette[i % palette.length] : tokens.accent;
    return {
      ...ds,
      borderColor: options.color ? color : tokens.info,
      backgroundColor: colorWithAlpha(color, fillAlpha),
      pointRadius: 0,
      fill: true,
      tension,
      stepped,
    };
  });

  const base = commonChartOptions();
  const xType = xScaleType(rows, options.x);
  // Chart.js' typings require `Point.x: number`, but the runtime accepts strings/Dates
  // when paired with a category/time scale. Narrow the cast to just the datasets.
  const config: ChartConfiguration<"line"> = {
    type: "line",
    data: { datasets: styled as unknown as ChartDataset<"line">[] },
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
          type: xType,
          stacked,
          title: {
            display: true,
            text: options.x_label ?? options.x,
            color: tokens.textPrimary,
          },
        },
        y: {
          ...(base.scales.y as Record<string, unknown>),
          stacked,
          beginAtZero: true,
          ...(normalized ? { max: 1 } : {}),
          title: {
            display: true,
            text: options.y_label ?? options.y,
            color: tokens.textPrimary,
          },
        },
      },
    },
  };

  instantiateChart(canvas, config as ChartConfiguration);
  return wrapper;
}
