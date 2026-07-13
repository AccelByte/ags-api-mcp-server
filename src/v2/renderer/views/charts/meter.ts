// Copyright (c) 2025 AccelByte Inc.
// SPDX-License-Identifier: Apache-2.0

import type { z } from "zod/v3";

import { MeterOutputSchema } from "../../../shared/render-schemas.js";
import { asNumber, clamp, seriesRange, validateColumns } from "../base.js";
import type { Primitive, Row } from "../types.js";

type MeterOptions = z.infer<typeof MeterOutputSchema>["options"];

const DANGER = "var(--color-danger)";

function formatValue(value: number, format: MeterOptions["format"]): string {
  switch (format) {
    case "compact":
      return new Intl.NumberFormat(undefined, {
        maximumFractionDigits: 2,
        notation: "compact",
      }).format(value);
    case "integer":
      return new Intl.NumberFormat(undefined, {
        maximumFractionDigits: 0,
      }).format(value);
    case "number":
    default:
      return new Intl.NumberFormat(undefined, {
        maximumFractionDigits: 2,
      }).format(value);
  }
}

function asText(value: Primitive | undefined): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  const text = String(value).trim();
  return text === "" ? undefined : text;
}

export function renderMeter(rows: Row[], options: MeterOptions): HTMLElement {
  if (rows.length === 0) {
    const empty = document.createElement("div");
    empty.className = "renderer-empty";
    empty.textContent = "No data";
    return empty;
  }

  validateColumns(
    rows,
    options.value,
    options.max,
    options.label,
    options.color,
    options.unit,
  );

  // Match donut.ts / pie.ts / state-timeline.ts: compute the series palette per-call.
  const series = seriesRange();

  const list = document.createElement("div");
  list.className = "meter-list";

  rows.forEach((row, index) => {
    const current = asNumber(row[options.value]);
    if (current === undefined) {
      throw new Error(
        `Meter requires a numeric value in column "${options.value}".`,
      );
    }

    const maxRaw = options.max ? row[options.max] : undefined;
    const max = options.max ? asNumber(maxRaw) : undefined;
    if (options.max && (max === undefined || max <= 0)) {
      throw new Error(
        `Meter row ${index}: max column "${options.max}" resolved to ${String(maxRaw)}; must be a number > 0.`,
      );
    }
    if (max !== undefined && current < 0) {
      throw new Error(
        `Meter row ${index}: value column "${options.value}" resolved to ${current}; must be >= 0 when max is provided.`,
      );
    }
    const unit = options.unit ? asText(row[options.unit]) : undefined;
    const unitSuffix = unit ? ` ${unit}` : "";

    let pct: number;
    let valueText: string;
    // Math.round is used for the % label regardless of `format`; the format enum only
    // affects the raw current/max value display (e.g. 1,482,300 → 1.48M for "compact").
    if (max !== undefined) {
      pct = (current / max) * 100;
      valueText = `${formatValue(current, options.format)} / ${formatValue(max, options.format)}${unitSuffix} · ${Math.round(pct)}%`;
    } else {
      // Percentage mode: value is already a 0–100 percentage.
      pct = current;
      valueText = `${Math.round(pct)}%`;
    }

    const overLimit = pct > 100;
    const fillWidth = clamp(pct, 0, 100);

    const override = options.color ? asText(row[options.color]) : undefined;
    const color = override ?? (overLimit ? DANGER : series[index % series.length]);

    const meter = document.createElement("div");
    meter.className = "meter-row";
    if (overLimit) {
      meter.dataset.overLimit = "true";
    }

    const labelRow = document.createElement("div");
    labelRow.className = "meter-label-row";

    const label = document.createElement("span");
    label.className = "meter-label";
    label.textContent =
      (options.label ? asText(row[options.label]) : undefined) ??
      `Meter ${index + 1}`;

    const value = document.createElement("span");
    value.className = "meter-value";
    value.textContent = valueText;

    labelRow.append(label, value);

    const track = document.createElement("div");
    track.className = "meter-track";
    track.setAttribute("role", "progressbar");
    track.setAttribute("aria-valuenow", String(Math.round(fillWidth)));
    track.setAttribute("aria-valuemin", "0");
    track.setAttribute("aria-valuemax", "100");
    track.setAttribute("aria-label", label.textContent ?? `Meter ${index + 1}`);

    const fill = document.createElement("div");
    fill.className = "meter-fill";
    fill.style.width = `${fillWidth}%`;
    fill.style.background = color;

    track.appendChild(fill);
    meter.append(labelRow, track);
    list.appendChild(meter);
  });

  return list;
}
