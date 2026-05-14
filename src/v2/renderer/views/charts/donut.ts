// Copyright (c) 2025 AccelByte Inc. All Rights Reserved.
// This is licensed software from AccelByte Inc, for limitations
// and restrictions contact your company contract manager.

import type { z } from "zod/v3";

import { DonutChartOutputSchema } from "../../../shared/render-schemas.js";
import { validateColumns } from "../base.js";
import type { Primitive, Row } from "../types.js";

type DonutOptions = z.infer<typeof DonutChartOutputSchema>["options"];

const SVG_NS = "http://www.w3.org/2000/svg";
const ACCENT = "var(--color-accent)";
const INFO = "var(--color-text-info)";
const PANEL = "var(--color-panel)";
const TEXT_PRIMARY = "var(--color-text-primary)";
const TEXT_SECONDARY = "var(--color-text-secondary)";
const TEXT_ON_ACCENT = "var(--color-text-on-accent)";
const SERIES_RANGE = [
  ACCENT,
  INFO,
  "color-mix(in srgb, var(--color-accent) 72%, var(--color-panel) 28%)",
  "color-mix(in srgb, var(--color-text-info) 64%, var(--color-panel) 36%)",
  "color-mix(in srgb, var(--color-accent) 48%, var(--color-text-info) 52%)",
  "color-mix(in srgb, var(--color-text-info) 44%, var(--color-accent) 56%)",
] as const;

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

function labelPosition(
  startAngle: number,
  endAngle: number,
  innerRadius: number,
  outerRadius: number,
): { x: number; y: number } {
  return polar((innerRadius + outerRadius) / 2, (startAngle + endAngle) / 2);
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
    fill: SERIES_RANGE[index % SERIES_RANGE.length],
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
  const outerRadius = 104;
  const innerRadius = outerRadius * options.hole;

  const wrapper = document.createElement("div");
  wrapper.style.display = "grid";
  wrapper.style.gridTemplateColumns = "minmax(0, 300px) minmax(0, 1fr)";
  wrapper.style.alignItems = "center";
  wrapper.style.gap = "1rem";

  const svg = svgElement("svg");
  svg.setAttribute("viewBox", "0 0 260 260");
  svg.setAttribute("width", "100%");
  svg.setAttribute("height", "260");

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

    const title = svgElement("title");
    title.textContent =
      `${slice.category}: ${formatNumber(slice.value)} (${Math.round(slice.share * 100)}%)`;
    path.appendChild(title);
    svg.appendChild(path);

    if (options.show_labels && slice.share >= 0.06 && endAngle - startAngle >= 24) {
      const { x, y } = labelPosition(
        startAngle,
        endAngle,
        innerRadius,
        outerRadius,
      );
      const label = svgElement("text");
      label.setAttribute("x", x.toFixed(2));
      label.setAttribute("y", y.toFixed(2));
      label.setAttribute("text-anchor", "middle");
      label.setAttribute("dominant-baseline", "central");
      label.setAttribute("fill", TEXT_ON_ACCENT);
      label.setAttribute("font-size", "11");
      label.setAttribute("font-weight", "700");
      label.textContent = slice.category;
      svg.appendChild(label);
    }

    startAngle = endAngle;
  }

  const centerValue = svgElement("text");
  centerValue.setAttribute("x", "130");
  centerValue.setAttribute("y", "126");
  centerValue.setAttribute("text-anchor", "middle");
  centerValue.setAttribute("fill", TEXT_PRIMARY);
  centerValue.setAttribute("font-size", "24");
  centerValue.setAttribute("font-weight", "800");
  centerValue.textContent = formatNumber(total);
  svg.appendChild(centerValue);

  const centerLabel = svgElement("text");
  centerLabel.setAttribute("x", "130");
  centerLabel.setAttribute("y", "148");
  centerLabel.setAttribute("text-anchor", "middle");
  centerLabel.setAttribute("fill", TEXT_SECONDARY);
  centerLabel.setAttribute("font-size", "12");
  centerLabel.textContent = options.center_label ?? "Total";
  svg.appendChild(centerLabel);

  wrapper.append(svg, buildLegend(slices));
  return wrapper;
}
