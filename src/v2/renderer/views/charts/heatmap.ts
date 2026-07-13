// Copyright (c) 2025 AccelByte Inc.
// SPDX-License-Identifier: Apache-2.0

import type { z } from "zod/v3";

import { HeatmapChartOutputSchema } from "../../../shared/render-schemas.js";
import { validateColumns } from "../base.js";
import type { Primitive, Row } from "../types.js";

type HeatmapOptions = z.infer<typeof HeatmapChartOutputSchema>["options"];

const PANEL = "var(--color-panel)";
const PANEL_MUTED = "var(--color-panel-muted)";
const BORDER = "var(--color-border)";
const ACCENT = "var(--color-accent)";
const INFO = "var(--color-text-info)";
const TEXT_PRIMARY = "var(--color-text-primary)";
const TEXT_SECONDARY = "var(--color-text-secondary)";
const TEXT_ON_ACCENT = "var(--color-text-on-accent)";

type HeatmapCell = {
  x: string;
  y: string;
  value: number;
};

function pushUnique(values: string[], next: string): void {
  if (!values.includes(next)) {
    values.push(next);
  }
}

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

function heatColor(
  value: number,
  min: number,
  max: number,
  scheme: HeatmapOptions["color_scheme"],
): string {
  if (min === max) {
    return ACCENT;
  }

  const ratio = (value - min) / (max - min);
  if (scheme === "diverging") {
    const distance = Math.abs(ratio - 0.5) * 2;
    const emphasis = Math.round(30 + distance * 60);
    if (ratio >= 0.5) {
      return `color-mix(in srgb, ${ACCENT} ${emphasis}%, ${PANEL} ${100 - emphasis}%)`;
    }
    return `color-mix(in srgb, ${INFO} ${emphasis}%, ${PANEL} ${100 - emphasis}%)`;
  }

  const emphasis = Math.round(16 + ratio * 72);
  return `color-mix(in srgb, ${ACCENT} ${emphasis}%, ${PANEL} ${100 - emphasis}%)`;
}

function textColor(value: number, min: number, max: number): string {
  if (min === max) {
    return TEXT_ON_ACCENT;
  }

  const ratio = (value - min) / (max - min);
  return ratio >= 0.58 ? TEXT_ON_ACCENT : TEXT_PRIMARY;
}

function numberLabel(value: number): string {
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 2,
  }).format(value);
}

export function renderHeatmap(
  rows: Row[],
  options: HeatmapOptions,
): SVGElement | HTMLElement {
  validateColumns(rows, options.x, options.y, options.value);

  const xLabels: string[] = [];
  const yLabels: string[] = [];
  const cells: HeatmapCell[] = [];

  for (const row of rows) {
    const x = asLabel(row[options.x]);
    const y = asLabel(row[options.y]);
    const value = asNumber(row[options.value]);
    if (!x || !y || value === undefined) {
      continue;
    }

    pushUnique(xLabels, x);
    pushUnique(yLabels, y);
    cells.push({ x, y, value });
  }

  if (cells.length === 0) {
    throw new Error("Heatmap requires at least one row with categorical x/y and numeric value data.");
  }

  const values = cells.map((cell) => cell.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const valueByKey = new Map(
    cells.map((cell) => [`${cell.y}\u0000${cell.x}`, cell.value]),
  );

  const figure = document.createElement("div");
  figure.style.display = "grid";
  figure.style.gap = "0.75rem";

  if (options.x_label || options.y_label) {
    const labels = document.createElement("div");
    labels.style.display = "flex";
    labels.style.flexWrap = "wrap";
    labels.style.gap = "0.75rem";
    labels.style.color = TEXT_SECONDARY;
    labels.style.fontSize = "0.9rem";

    if (options.x_label) {
      const xLabel = document.createElement("span");
      xLabel.textContent = `X: ${options.x_label}`;
      labels.appendChild(xLabel);
    }
    if (options.y_label) {
      const yLabel = document.createElement("span");
      yLabel.textContent = `Y: ${options.y_label}`;
      labels.appendChild(yLabel);
    }

    figure.appendChild(labels);
  }

  const grid = document.createElement("table");
  grid.style.borderCollapse = "separate";
  grid.style.borderSpacing = "0.35rem";
  grid.style.width = "100%";
  grid.style.tableLayout = "fixed";

  // Reserve a fixed-width column for row labels so long values (e.g. URL paths) wrap
  // *within* the label column instead of bleeding into the first data cell.
  const colgroup = document.createElement("colgroup");
  const labelCol = document.createElement("col");
  labelCol.style.width = "14rem";
  colgroup.appendChild(labelCol);
  for (let i = 0; i < xLabels.length; i += 1) {
    colgroup.appendChild(document.createElement("col"));
  }
  grid.appendChild(colgroup);

  const headerRow = document.createElement("tr");
  const corner = document.createElement("th");
  corner.textContent = options.y_label ?? options.y;
  corner.style.padding = "0.5rem 0.75rem 0.5rem 0";
  corner.style.textAlign = "left";
  corner.style.color = TEXT_SECONDARY;
  headerRow.appendChild(corner);

  for (const xLabel of xLabels) {
    const heading = document.createElement("th");
    heading.textContent = xLabel;
    heading.style.padding = "0.5rem 0.35rem";
    heading.style.fontWeight = "600";
    heading.style.fontSize = "0.85rem";
    heading.style.color = TEXT_PRIMARY;
    headerRow.appendChild(heading);
  }
  grid.appendChild(headerRow);

  for (const yLabel of yLabels) {
    const row = document.createElement("tr");
    const label = document.createElement("th");
    label.textContent = yLabel;
    label.style.padding = "0.35rem 0.9rem 0.35rem 0";
    label.style.textAlign = "left";
    label.style.fontWeight = "600";
    label.style.fontSize = "0.85rem";
    label.style.color = TEXT_PRIMARY;
    label.style.overflowWrap = "anywhere";
    label.style.wordBreak = "break-word";
    label.style.verticalAlign = "middle";
    row.appendChild(label);

    for (const xLabel of xLabels) {
      const value = valueByKey.get(`${yLabel}\u0000${xLabel}`);
      const cell = document.createElement("td");
      cell.style.height = "3.25rem";
      cell.style.minWidth = "3.25rem";
      cell.style.border = `1px solid ${BORDER}`;
      cell.style.borderRadius = "12px";
      cell.style.background = value === undefined
        ? PANEL_MUTED
        : heatColor(value, min, max, options.color_scheme);
      cell.style.color = value === undefined
        ? TEXT_SECONDARY
        : textColor(value, min, max);
      cell.style.textAlign = "center";
      cell.style.verticalAlign = "middle";
      cell.style.fontWeight = "700";
      cell.style.fontVariantNumeric = "tabular-nums";
      cell.title = `${yLabel} / ${xLabel}: ${value === undefined ? "No data" : numberLabel(value)}`;
      cell.textContent = options.show_values && value !== undefined
        ? numberLabel(value)
        : value === undefined
          ? "—"
          : "";
      row.appendChild(cell);
    }

    grid.appendChild(row);
  }

  figure.appendChild(grid);
  return figure;
}
