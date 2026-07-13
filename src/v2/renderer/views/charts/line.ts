// Copyright (c) 2025 AccelByte Inc.
// SPDX-License-Identifier: Apache-2.0

import type { ChartConfiguration, ChartDataset } from "chart.js";
import type { z } from "zod/v3";

import { LineChartOutputSchema } from "../../../shared/render-schemas.js";
import {
  chartTokens,
  commonChartOptions,
  createChartMount,
  instantiateChart,
  seriesPalette,
  validateColumns,
  xScaleType,
} from "../base.js";
import type { Row } from "../types.js";

type LineOptions = z.infer<typeof LineChartOutputSchema>["options"];

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

interface LinePoint {
  x: XValue;
  y: number;
}

interface LineDataset {
  label: string;
  data: LinePoint[];
}

function pivotByColor(
  rows: Row[],
  xKey: string,
  yKey: string,
  colorKey: string | undefined,
): LineDataset[] {
  if (!colorKey) {
    const data: LinePoint[] = [];
    for (const row of rows) {
      const y = asNumber(row[yKey]);
      if (y === undefined) continue;
      data.push({ x: toXValue(row[xKey]), y });
    }
    return [{ label: yKey, data }];
  }

  const groups = new Map<string, LinePoint[]>();
  for (const row of rows) {
    const y = asNumber(row[yKey]);
    if (y === undefined) continue;
    const label = String(row[colorKey] ?? "");
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label)!.push({ x: toXValue(row[xKey]), y });
  }
  return Array.from(groups, ([label, data]) => ({ label, data }));
}

export function renderLine(rows: Row[], options: LineOptions): HTMLElement {
  validateColumns(rows, options.x, options.y, options.color);

  const { wrapper, canvas } = createChartMount();
  const tokens = chartTokens();
  const palette = seriesPalette();
  const datasets = pivotByColor(rows, options.x, options.y, options.color);

  const stepped = options.curve === "step";
  const tension = options.curve === "smooth" ? 0.4 : 0;

  const styled = datasets.map((ds, i) => {
    const color = options.color ? palette[i % palette.length] : tokens.accent;
    return {
      ...ds,
      borderColor: color,
      backgroundColor: color,
      pointRadius: options.show_points ? 3.5 : 0,
      pointBackgroundColor: color,
      pointBorderColor: options.color ? color : tokens.info,
      fill: false,
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

  instantiateChart(canvas, config as ChartConfiguration);
  return wrapper;
}
