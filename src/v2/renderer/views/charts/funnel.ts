// Copyright (c) 2025 AccelByte Inc. All Rights Reserved.
// This is licensed software from AccelByte Inc, for limitations
// and restrictions contact your company contract manager.

import type { z } from "zod/v3";

import { FunnelChartOutputSchema } from "../../../shared/render-schemas.js";
import { validateColumns } from "../base.js";
import type { Primitive, Row } from "../types.js";

type FunnelOptions = z.infer<typeof FunnelChartOutputSchema>["options"];

type FunnelStage = {
  stage: string;
  value: number;
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

function asLabel(value: Primitive): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return String(value);
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 2,
  }).format(value);
}

function conversionRatio(current: number, previous: number): number | undefined {
  if (previous <= 0) {
    return undefined;
  }
  return current / previous;
}

function formatPercent(ratio: number): string {
  return new Intl.NumberFormat(undefined, {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(ratio);
}

function buildConversionPill(
  current: number,
  previous: number,
): HTMLSpanElement | undefined {
  const ratio = conversionRatio(current, previous);
  if (ratio === undefined) {
    return undefined;
  }

  const pill = document.createElement("span");
  pill.className = "delta-indicator delta-indicator--pill";
  pill.dataset.direction = ratio >= 1 ? "up" : "down";
  pill.textContent = formatPercent(ratio);
  return pill;
}

export function renderFunnel(
  rows: Row[],
  options: FunnelOptions,
): SVGElement | HTMLElement {
  validateColumns(rows, options.stage, options.value);

  const stages: FunnelStage[] = [];
  for (const row of rows) {
    const stage = asLabel(row[options.stage]);
    const value = asNumber(row[options.value]);
    if (!stage || value === undefined) {
      continue;
    }
    stages.push({ stage, value });
  }

  if (stages.length === 0) {
    throw new Error("Funnel chart requires at least one stage with a numeric value.");
  }

  const maxValue = Math.max(...stages.map((stage) => stage.value), 0);
  if (maxValue <= 0) {
    throw new Error("Funnel chart values must be greater than zero.");
  }

  const wrapper = document.createElement("div");
  wrapper.className = "funnel-wrap";

  const horizontal = options.orientation === "horizontal";

  stages.forEach((stage, index) => {
    const item = document.createElement("section");
    item.className = `funnel-stage ${horizontal ? "funnel-stage--horizontal" : "funnel-stage--vertical"}`;
    const share = stage.value / maxValue;
    item.style.setProperty("--share", share.toFixed(4));

    const label = document.createElement("div");
    label.className = "funnel-label";

    const title = document.createElement("strong");
    title.className = "funnel-label-title";
    title.textContent = stage.stage;
    label.appendChild(title);

    const meta = document.createElement("span");
    meta.className = "funnel-label-meta";
    const metaValue = document.createElement("span");
    metaValue.textContent = formatNumber(stage.value);
    meta.appendChild(metaValue);

    if (options.show_conversion && index > 0) {
      const pill = buildConversionPill(stage.value, stages[index - 1].value);
      if (pill) {
        meta.appendChild(pill);
      }
    }

    label.appendChild(meta);

    const barWrap = document.createElement("div");
    barWrap.className = "funnel-bar";

    const barFill = document.createElement("div");
    barFill.className = "funnel-bar-fill";
    barFill.textContent = formatNumber(stage.value);
    barWrap.appendChild(barFill);

    item.append(label, barWrap);
    wrapper.appendChild(item);
  });

  return wrapper;
}
