// Copyright (c) 2025 AccelByte Inc. All Rights Reserved.
// This is licensed software from AccelByte Inc, for limitations
// and restrictions contact your company contract manager.

import * as Plot from "@observablehq/plot";
import type { z } from "zod/v3";

import { WaterfallChartOutputSchema } from "../../../shared/render-schemas.js";
import { plotDefaults, validateColumns } from "../base.js";
import type { Primitive, Row } from "../types.js";

type WaterfallOptions = z.infer<typeof WaterfallChartOutputSchema>["options"];

const POSITIVE = "var(--color-success)";
const NEGATIVE = "var(--color-danger)";
const TOTAL = "var(--color-accent)";

type WaterfallDatum = {
  category: string;
  lower: number;
  upper: number;
  tone: "positive" | "negative" | "total";
  title: string;
};

function asNumber(value: Primitive): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function asCategory(value: Primitive): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return String(value);
}

function asBoolean(value: Primitive): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return ["1", "true", "yes", "total"].includes(normalized);
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  return false;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 2,
    signDisplay: "exceptZero",
  }).format(value);
}

export function renderWaterfall(
  rows: Row[],
  options: WaterfallOptions,
): SVGElement | HTMLElement {
  validateColumns(rows, options.category, options.value, options.is_total);

  let cumulative = 0;
  const steps: WaterfallDatum[] = [];

  for (const row of rows) {
    const category = asCategory(row[options.category]);
    const value = asNumber(row[options.value]);
    if (!category || value === undefined) {
      continue;
    }

    const totalBar = options.is_total
      ? asBoolean(row[options.is_total])
      : false;
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

  if (steps.length === 0) {
    throw new Error("Waterfall chart requires at least one numeric step.");
  }

  const defaults = plotDefaults();

  return Plot.plot({
    ...defaults,
    marginLeft: 88,
    x: { ...defaults.x, label: options.x_label ?? options.category },
    y: {
      ...defaults.y,
      label: options.y_label ?? options.value,
      tickFormat: "~s",
    },
    color: {
      type: "categorical",
      domain: ["positive", "negative", "total"],
      range: [POSITIVE, NEGATIVE, TOTAL],
      legend: true,
    },
    marks: [
      Plot.ruleY([0]),
      Plot.rectY(steps, {
        x: "category",
        y1: "lower",
        y2: "upper",
        fill: "tone",
        inset: 0.12,
        title: "title",
      }),
    ],
  });
}
