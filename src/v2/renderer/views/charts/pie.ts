// Copyright (c) 2025 AccelByte Inc.
// SPDX-License-Identifier: Apache-2.0

import type { z } from "zod/v3";

import { PieChartOutputSchema } from "../../../shared/render-schemas.js";
import { seriesRange, validateColumns } from "../base.js";
import type { Primitive, Row } from "../types.js";

type PieOptions = z.infer<typeof PieChartOutputSchema>["options"];

const SVG_NS = "http://www.w3.org/2000/svg";
const PANEL = "var(--color-panel)";
// Series palette colors are fixed darkish saturated tones (not theme-aware), so
// white text + a subtle dark outline reads on every slice in both light and dark modes.
const SLICE_LABEL_FILL = "rgba(255, 255, 255, 0.95)";
const SLICE_LABEL_STROKE = "rgba(0, 0, 0, 0.4)";
const SLICE_LABEL_MAX_CHARS = 16;

type SliceDatum = {
  category: string;
  value: number;
  share: number;
  fill: string;
};

function svgElement<K extends keyof SVGElementTagNameMap>(
  name: K,
): SVGElementTagNameMap[K] {
  return document.createElementNS(SVG_NS, name);
}

function polar(radius: number, angleDegrees: number): { x: number; y: number } {
  const radians = ((angleDegrees - 90) * Math.PI) / 180;
  return {
    x: 130 + radius * Math.cos(radians),
    y: 130 + radius * Math.sin(radians),
  };
}

function describeSlice(
  startAngle: number,
  endAngle: number,
  radius: number,
): string {
  const start = polar(radius, startAngle);
  const end = polar(radius, endAngle);
  const largeArcFlag = endAngle - startAngle > 180 ? "1" : "0";
  return `M 130 130 L ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArcFlag} 1 ${end.x} ${end.y} Z`;
}

function labelPosition(
  startAngle: number,
  endAngle: number,
  radius: number,
): { x: number; y: number } {
  return polar(radius, (startAngle + endAngle) / 2);
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

function asCategory(value: Primitive): string | undefined {
  if (typeof value === "string" || typeof value === "boolean") {
    return String(value);
  }
  return undefined;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 2,
  }).format(value);
}

function collectSlices(
  rows: Row[],
  categoryKey: string,
  valueKey: string,
  otherThreshold?: number,
): SliceDatum[] {
  const order: string[] = [];
  const totals = new Map<string, number>();
  const palette = seriesRange();

  for (const row of rows) {
    const category = asCategory(row[categoryKey]);
    const value = asNumber(row[valueKey]);
    if (!category || value === undefined) {
      continue;
    }

    if (!totals.has(category)) {
      order.push(category);
    }
    totals.set(category, (totals.get(category) ?? 0) + value);
  }

  const rawSlices = order.map((category) => ({
    category,
    value: totals.get(category) ?? 0,
  }));
  const total = rawSlices.reduce((sum, slice) => sum + slice.value, 0);
  if (total <= 0) {
    throw new Error("Pie chart requires positive numeric values.");
  }

  const threshold = otherThreshold ?? 0;
  const largeSlices = rawSlices.filter((slice) => slice.value / total >= threshold);
  const otherValue = rawSlices
    .filter((slice) => slice.value / total < threshold)
    .reduce((sum, slice) => sum + slice.value, 0);

  const normalized = otherValue > 0
    ? [...largeSlices, { category: "Other", value: otherValue }]
    : largeSlices;

  return normalized.map((slice, index) => ({
    ...slice,
    share: slice.value / total,
    fill: palette[index % palette.length],
  }));
}

function buildLegend(slices: SliceDatum[]): HTMLOListElement {
  const legend = document.createElement("ol");
  legend.className = "pie-legend";

  for (const slice of slices) {
    const item = document.createElement("li");
    item.className = "pie-legend-item";

    const swatch = document.createElement("span");
    swatch.className = "series-swatch";
    swatch.style.color = slice.fill;

    const label = document.createElement("span");
    label.className = "pie-legend-label";
    label.textContent = `${slice.category} (${Math.round(slice.share * 100)}%)`;

    const value = document.createElement("span");
    value.className = "pie-legend-value";
    value.textContent = formatNumber(slice.value);

    item.append(swatch, label, value);
    legend.appendChild(item);
  }

  return legend;
}

export function renderPie(rows: Row[], options: PieOptions): SVGElement | HTMLElement {
  validateColumns(rows, options.category, options.value);

  const slices = collectSlices(
    rows,
    options.category,
    options.value,
    options.other_threshold,
  );
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  const radius = 104;

  const wrapper = document.createElement("div");
  wrapper.className = "pie-wrap";

  const svg = svgElement("svg");
  svg.setAttribute("class", "pie-svg");
  svg.setAttribute("viewBox", "0 0 260 260");

  let startAngle = 0;
  for (const slice of slices) {
    const endAngle = startAngle + (slice.value / total) * 360;

    const path = svgElement("path");
    path.setAttribute("d", describeSlice(startAngle, endAngle, radius));
    path.setAttribute("fill", slice.fill);
    path.setAttribute("stroke", PANEL);
    path.setAttribute("stroke-width", "2");

    const title = svgElement("title");
    title.textContent =
      `${slice.category}: ${formatNumber(slice.value)} (${Math.round(slice.share * 100)}%)`;
    path.appendChild(title);
    svg.appendChild(path);

    if (options.show_labels && slice.share >= 0.05 && endAngle - startAngle >= 22) {
      const { x, y } = labelPosition(startAngle, endAngle, radius * 0.68);
      const label = svgElement("text");
      label.setAttribute("x", x.toFixed(2));
      label.setAttribute("y", y.toFixed(2));
      label.setAttribute("text-anchor", "middle");
      label.setAttribute("dominant-baseline", "central");
      label.setAttribute("fill", SLICE_LABEL_FILL);
      label.setAttribute("stroke", SLICE_LABEL_STROKE);
      label.setAttribute("stroke-width", "0.6");
      label.setAttribute("paint-order", "stroke");
      label.setAttribute("font-size", "11");
      label.setAttribute("font-weight", "700");
      label.textContent =
        slice.category.length > SLICE_LABEL_MAX_CHARS
          ? `${slice.category.slice(0, SLICE_LABEL_MAX_CHARS - 1).trimEnd()}…`
          : slice.category;
      svg.appendChild(label);
    }

    startAngle = endAngle;
  }

  wrapper.append(svg, buildLegend(slices));
  return wrapper;
}
