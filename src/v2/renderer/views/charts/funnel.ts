// Copyright (c) 2025 AccelByte Inc. All Rights Reserved.
// This is licensed software from AccelByte Inc, for limitations
// and restrictions contact your company contract manager.

import type { z } from "zod/v3";

import { FunnelChartOutputSchema } from "../../../shared/render-schemas.js";
import { validateColumns } from "../base.js";
import type { Primitive, Row } from "../types.js";

type FunnelOptions = z.infer<typeof FunnelChartOutputSchema>["options"];

const PANEL_MUTED = "var(--color-panel-muted)";
const BORDER = "var(--color-border)";
const ACCENT = "var(--color-accent)";
const INFO = "var(--color-text-info)";
const TEXT_PRIMARY = "var(--color-text-primary)";
const TEXT_SECONDARY = "var(--color-text-secondary)";
const TEXT_ON_ACCENT = "var(--color-text-on-accent)";

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

function formatConversion(current: number, previous: number): string {
  if (previous <= 0) {
    return "n/a";
  }
  return new Intl.NumberFormat(undefined, {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(current / previous);
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
  wrapper.style.display = "grid";
  wrapper.style.gap = "0.85rem";

  stages.forEach((stage, index) => {
    const item = document.createElement("section");
    item.style.display = "grid";
    item.style.gap = "0.35rem";

    if (options.orientation === "horizontal") {
      item.style.gridTemplateColumns = "minmax(120px, 180px) minmax(0, 1fr)";
      item.style.alignItems = "center";

      const label = document.createElement("div");
      label.style.display = "grid";
      label.style.gap = "0.2rem";

      const title = document.createElement("strong");
      title.style.color = TEXT_PRIMARY;
      title.textContent = stage.stage;

      const meta = document.createElement("span");
      meta.style.color = TEXT_SECONDARY;
      meta.textContent = formatNumber(stage.value);
      if (options.show_conversion && index > 0) {
        meta.textContent += ` · ${formatConversion(stage.value, stages[index - 1].value)}`;
      }

      label.append(title, meta);

      const barWrap = document.createElement("div");
      barWrap.style.height = "2.1rem";
      barWrap.style.borderRadius = "999px";
      barWrap.style.background = PANEL_MUTED;
      barWrap.style.border = `1px solid ${BORDER}`;
      barWrap.style.padding = "0.2rem";

      const bar = document.createElement("div");
      bar.style.width = `${Math.max(16, (stage.value / maxValue) * 100)}%`;
      bar.style.height = "100%";
      bar.style.borderRadius = "999px";
      bar.style.display = "flex";
      bar.style.alignItems = "center";
      bar.style.justifyContent = "flex-end";
      bar.style.padding = "0 0.75rem";
      bar.style.background =
        "linear-gradient(90deg, var(--color-accent), var(--color-text-info))";
      bar.style.color = TEXT_ON_ACCENT;
      bar.style.fontWeight = "700";
      bar.textContent = formatNumber(stage.value);

      barWrap.appendChild(bar);
      item.append(label, barWrap);
      wrapper.appendChild(item);
      return;
    }

    const label = document.createElement("div");
    label.style.display = "flex";
    label.style.justifyContent = "space-between";
    label.style.gap = "0.75rem";
    label.style.color = TEXT_PRIMARY;

    const title = document.createElement("strong");
    title.textContent = stage.stage;
    label.appendChild(title);

    const meta = document.createElement("span");
    meta.style.color = TEXT_SECONDARY;
    meta.textContent = formatNumber(stage.value);
    if (options.show_conversion && index > 0) {
      meta.textContent += ` · ${formatConversion(stage.value, stages[index - 1].value)}`;
    }
    label.appendChild(meta);
    item.appendChild(label);

    const bar = document.createElement("div");
    const width = 26 + (stage.value / maxValue) * 74;
    bar.style.width = `${width}%`;
    bar.style.height = "2.5rem";
    bar.style.margin = "0 auto";
    bar.style.borderRadius = "16px";
    bar.style.display = "flex";
    bar.style.alignItems = "center";
    bar.style.justifyContent = "center";
    bar.style.background = index % 2 === 0 ? ACCENT : INFO;
    bar.style.color = TEXT_ON_ACCENT;
    bar.style.fontWeight = "700";
    bar.style.boxShadow = "inset 0 0 0 1px rgba(255,255,255,0.1)";
    bar.textContent = formatNumber(stage.value);
    item.appendChild(bar);

    wrapper.appendChild(item);
  });

  return wrapper;
}
