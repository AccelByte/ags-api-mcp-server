// Copyright (c) 2025 AccelByte Inc.
// SPDX-License-Identifier: Apache-2.0

import type { z } from "zod/v3";

import { DonutChartOutputSchema } from "../../../shared/render-schemas.js";
import { seriesRange, validateColumns } from "../base.js";
import type { Primitive, Row } from "../types.js";

type DonutOptions = z.infer<typeof DonutChartOutputSchema>["options"];

const SVG_NS = "http://www.w3.org/2000/svg";
const PANEL = "var(--color-panel)";
const TEXT_PRIMARY = "var(--color-text-primary)";
const TEXT_SECONDARY = "var(--color-text-secondary)";

const VIEWBOX_SIZE = 320;
const CENTER = VIEWBOX_SIZE / 2;
const OUTER_RADIUS = 104;
const LABEL_RADIUS = OUTER_RADIUS + 18;
// Horizontal padding reserved on each side of the SVG viewBox so on-chart slice
// labels (which extend outward past the donut) don't clip at the SVG edges.
const VIEWBOX_PAD_X = 36;
const MAX_SLICE_LABEL_CHARS = 11;

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
    x: CENTER + radius * Math.cos(radians),
    y: CENTER + radius * Math.sin(radians),
  };
}

function describeSlice(
  startAngle: number,
  endAngle: number,
  outerRadius: number,
  innerRadius: number,
): string {
  const outerStart = polar(outerRadius, startAngle);
  const outerEnd = polar(outerRadius, endAngle);
  const innerEnd = polar(innerRadius, endAngle);
  const innerStart = polar(innerRadius, startAngle);
  const largeArcFlag = endAngle - startAngle > 180 ? "1" : "0";

  return [
    `M ${outerStart.x} ${outerStart.y}`,
    `A ${outerRadius} ${outerRadius} 0 ${largeArcFlag} 1 ${outerEnd.x} ${outerEnd.y}`,
    `L ${innerEnd.x} ${innerEnd.y}`,
    `A ${innerRadius} ${innerRadius} 0 ${largeArcFlag} 0 ${innerStart.x} ${innerStart.y}`,
    "Z",
  ].join(" ");
}

function labelPlacement(
  startAngle: number,
  endAngle: number,
  radius: number,
): { x: number; y: number; anchor: "start" | "middle" | "end" } {
  const midAngle = (startAngle + endAngle) / 2;
  const point = polar(radius, midAngle);
  const radians = ((midAngle - 90) * Math.PI) / 180;
  const cos = Math.cos(radians);
  const anchor = cos > 0.15 ? "start" : cos < -0.15 ? "end" : "middle";
  return { x: point.x, y: point.y, anchor };
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
    throw new Error("Donut chart requires positive numeric values.");
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
  legend.style.listStyle = "none";
  legend.style.margin = "0";
  legend.style.padding = "0";
  legend.style.display = "grid";
  legend.style.gap = "0.5rem";

  for (const slice of slices) {
    const item = document.createElement("li");
    item.style.display = "flex";
    item.style.alignItems = "center";
    item.style.gap = "0.65rem";

    const swatch = document.createElement("span");
    swatch.style.display = "inline-block";
    swatch.style.width = "0.85rem";
    swatch.style.height = "0.85rem";
    swatch.style.borderRadius = "999px";
    swatch.style.background = slice.fill;

    const text = document.createElement("span");
    text.style.color = TEXT_PRIMARY;
    text.textContent =
      `${slice.category} (${Math.round(slice.share * 100)}%) - ${formatNumber(slice.value)}`;

    item.append(swatch, text);
    legend.appendChild(item);
  }

  return legend;
}

export function renderDonut(
  rows: Row[],
  options: DonutOptions,
): SVGElement | HTMLElement {
  validateColumns(rows, options.category, options.value);

  const slices = collectSlices(
    rows,
    options.category,
    options.value,
    options.other_threshold,
  );
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  const outerRadius = OUTER_RADIUS;
  const innerRadius = outerRadius * options.hole;

  const wrapper = document.createElement("div");
  wrapper.style.display = "grid";
  wrapper.style.gridTemplateColumns = "minmax(0, 340px) minmax(0, 1fr)";
  wrapper.style.alignItems = "center";
  wrapper.style.gap = "1rem";

  const svg = svgElement("svg");
  svg.setAttribute(
    "viewBox",
    `${-VIEWBOX_PAD_X} 0 ${VIEWBOX_SIZE + VIEWBOX_PAD_X * 2} ${VIEWBOX_SIZE}`,
  );
  svg.setAttribute("width", "100%");
  svg.setAttribute("height", String(VIEWBOX_SIZE));

  let startAngle = 0;
  for (const slice of slices) {
    const endAngle = startAngle + (slice.value / total) * 360;

    const path = svgElement("path");
    path.setAttribute(
      "d",
      describeSlice(startAngle, endAngle, outerRadius, innerRadius),
    );
    path.setAttribute("fill", slice.fill);
    path.setAttribute("stroke", PANEL);
    path.setAttribute("stroke-width", "2");
    svg.appendChild(path);

    if (options.show_labels && slice.share >= 0.04) {
      const { x, y, anchor } = labelPlacement(
        startAngle,
        endAngle,
        LABEL_RADIUS,
      );
      const truncated = slice.category.length > MAX_SLICE_LABEL_CHARS;
      const label = svgElement("text");
      label.setAttribute("x", x.toFixed(2));
      label.setAttribute("y", y.toFixed(2));
      label.setAttribute("text-anchor", anchor);
      label.setAttribute("dominant-baseline", "central");
      label.setAttribute("fill", TEXT_PRIMARY);
      label.setAttribute("font-size", "11");
      label.setAttribute("font-weight", "600");
      // Full category name remains visible in the legend; on-chart label is
      // truncated only to avoid clipping at the SVG edge.
      label.appendChild(
        document.createTextNode(
          truncated
            ? `${slice.category.slice(0, MAX_SLICE_LABEL_CHARS - 1)}…`
            : slice.category,
        ),
      );
      svg.appendChild(label);
    }

    startAngle = endAngle;
  }

  const centerValue = svgElement("text");
  centerValue.setAttribute("x", String(CENTER));
  centerValue.setAttribute("y", String(CENTER - 4));
  centerValue.setAttribute("text-anchor", "middle");
  centerValue.setAttribute("fill", TEXT_PRIMARY);
  centerValue.setAttribute("font-size", "24");
  centerValue.setAttribute("font-weight", "800");
  centerValue.textContent = formatNumber(total);
  svg.appendChild(centerValue);

  const centerLabel = svgElement("text");
  centerLabel.setAttribute("x", String(CENTER));
  centerLabel.setAttribute("y", String(CENTER + 18));
  centerLabel.setAttribute("text-anchor", "middle");
  centerLabel.setAttribute("fill", TEXT_SECONDARY);
  centerLabel.setAttribute("font-size", "12");
  centerLabel.textContent = options.center_label ?? "Total";
  svg.appendChild(centerLabel);

  wrapper.append(svg, buildLegend(slices));
  return wrapper;
}
