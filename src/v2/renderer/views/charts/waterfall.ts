// Copyright (c) 2025 AccelByte Inc. All Rights Reserved.
// This is licensed software from AccelByte Inc, for limitations
// and restrictions contact your company contract manager.

import type { ChartConfiguration } from "chart.js";
import type { z } from "zod/v3";

import { WaterfallChartOutputSchema } from "../../../shared/render-schemas.js";
import {
  chartTokens,
  commonChartOptions,
  createChartMount,
  instantiateChart,
  validateColumns,
} from "../base.js";
import type { Primitive, Row } from "../types.js";

type WaterfallOptions = z.infer<typeof WaterfallChartOutputSchema>["options"];

interface WaterfallStep {
  category: string;
  lower: number;
  upper: number;
  tone: "positive" | "negative" | "total";
  title: string;
}

function asNumber(value: Primitive): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function asCategory(value: Primitive): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function asBoolean(value: Primitive): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    return ["1", "true", "yes", "total"].includes(value.trim().toLowerCase());
  }
  if (typeof value === "number") return value !== 0;
  return false;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 2,
    signDisplay: "exceptZero",
  }).format(value);
}

function buildSteps(rows: Row[], options: WaterfallOptions): WaterfallStep[] {
  let cumulative = 0;
  const steps: WaterfallStep[] = [];

  for (const row of rows) {
    const category = asCategory(row[options.category]);
    const value = asNumber(row[options.value]);
    if (!category || value === undefined) continue;

    const totalBar = options.is_total ? asBoolean(row[options.is_total]) : false;
    const lower = totalBar ? 0 : cumulative;
    const upper = totalBar ? value : cumulative + value;
    cumulative = upper;

    steps.push({
      category,
      lower: Math.min(lower, upper),
      upper: Math.max(lower, upper),
      tone: totalBar ? "total" : value >= 0 ? "positive" : "negative",
      title: totalBar
        ? `${category}: total ${formatNumber(value)}`
        : `${category}: ${formatNumber(value)} (running total ${formatNumber(upper)})`,
    });
  }

  return steps;
}

export function renderWaterfall(
  rows: Row[],
  options: WaterfallOptions,
): HTMLElement {
  validateColumns(rows, options.category, options.value, options.is_total);

  const steps = buildSteps(rows, options);
  if (steps.length === 0) {
    throw new Error("Waterfall chart requires at least one numeric step.");
  }

  const { wrapper, canvas } = createChartMount();
  const tokens = chartTokens();
  const toneColor = {
    positive: tokens.success,
    negative: tokens.danger,
    total: tokens.accent,
  } as const;

  const data = steps.map((s) => [s.lower, s.upper] as [number, number]);
  const colors = steps.map((s) => toneColor[s.tone]);
  const titles = steps.map((s) => s.title);

  const base = commonChartOptions();
  // Synthetic zero-data datasets render legend swatches for the three tones without
  // adding visible bars to the chart.
  const legendDatasets = [
    { label: "Positive", data: [], backgroundColor: tokens.success, borderColor: tokens.success },
    { label: "Negative", data: [], backgroundColor: tokens.danger, borderColor: tokens.danger },
    { label: "Total", data: [], backgroundColor: tokens.accent, borderColor: tokens.accent },
  ];

  const config: ChartConfiguration = {
    type: "bar",
    data: {
      labels: steps.map((s) => s.category),
      datasets: [
        {
          label: options.value,
          data: data as unknown as number[],
          backgroundColor: colors,
          borderColor: colors,
          minBarLength: 3,
        },
        ...legendDatasets,
      ],
    },
    options: {
      ...base,
      plugins: {
        ...base.plugins,
        legend: {
          display: true,
          labels: {
            color: tokens.textPrimary,
            // Hide the main dataset entry; only show the three tone swatches.
            filter: (item: { datasetIndex?: number }) => (item.datasetIndex ?? 0) > 0,
          },
        },
        tooltip: {
          ...(base.plugins.tooltip as Record<string, unknown>),
          callbacks: {
            label: (ctx: { dataIndex: number }) => titles[ctx.dataIndex],
          },
        },
      },
      scales: {
        x: {
          ...(base.scales.x as Record<string, unknown>),
          title: {
            display: true,
            text: options.x_label ?? options.category,
            color: tokens.textPrimary,
          },
        },
        y: {
          ...(base.scales.y as Record<string, unknown>),
          title: {
            display: true,
            text: options.y_label ?? options.value,
            color: tokens.textPrimary,
          },
        },
      },
    },
  };

  instantiateChart(canvas, config);
  return wrapper;
}
