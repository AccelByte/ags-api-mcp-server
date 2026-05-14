// Copyright (c) 2025 AccelByte Inc. All Rights Reserved.
// This is licensed software from AccelByte Inc, for limitations
// and restrictions contact your company contract manager.

import type { z } from "zod/v3";

import { GaugeChartOutputSchema } from "../../../shared/render-schemas.js";
import { validateColumns } from "../base.js";
import type { Primitive, Row } from "../types.js";

type GaugeOptions = z.infer<typeof GaugeChartOutputSchema>["options"];

const SVG_NS = "http://www.w3.org/2000/svg";
const PANEL_MUTED = "var(--color-panel-muted)";
const BORDER = "var(--color-border)";
const ACCENT = "var(--color-accent)";
const TEXT_PRIMARY = "var(--color-text-primary)";
const TEXT_SECONDARY = "var(--color-text-secondary)";

function svgElement<K extends keyof SVGElementTagNameMap>(
  name: K,
): SVGElementTagNameMap[K] {
  return document.createElementNS(SVG_NS, name);
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function polar(radius: number, angleDegrees: number): { x: number; y: number } {
  const radians = ((angleDegrees - 90) * Math.PI) / 180;
  return {
    x: 110 + radius * Math.cos(radians),
    y: 110 + radius * Math.sin(radians),
  };
}

function describeArc(
  radius: number,
  startAngle: number,
  endAngle: number,
): string {
  const start = polar(radius, endAngle);
  const end = polar(radius, startAngle);
  const largeArcFlag = Math.abs(endAngle - startAngle) > 180 ? "1" : "0";
  return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArcFlag} 0 ${end.x} ${end.y}`;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 2,
  }).format(value);
}

function valueColor(
  value: number,
  thresholds: GaugeOptions["thresholds"],
): string {
  let color = ACCENT;
  for (const threshold of thresholds ?? []) {
    if (value >= threshold.value) {
      color = threshold.color;
    }
  }
  return color;
}

export function renderGauge(
  rows: Row[],
  options: GaugeOptions,
): SVGElement | HTMLElement {
  validateColumns(rows, options.value);

  const currentValue = asNumber(rows[0]?.[options.value]);
  if (currentValue === undefined) {
    throw new Error("Gauge chart requires a numeric value in the first row.");
  }
  if (options.max <= options.min) {
    throw new Error("Gauge chart requires max to be greater than min.");
  }

  const boundedValue = clamp(currentValue, options.min, options.max);
  const ratio = (boundedValue - options.min) / (options.max - options.min);
  const endAngle = 180 - ratio * 180;

  const wrapper = document.createElement("div");
  wrapper.style.display = "grid";
  wrapper.style.gap = "0.75rem";
  wrapper.style.justifyItems = "center";
  wrapper.style.padding = "0.5rem 0";

  const svg = svgElement("svg");
  svg.setAttribute("viewBox", "0 0 220 150");
  svg.setAttribute("width", "100%");
  svg.setAttribute("height", "150");

  const track = svgElement("path");
  track.setAttribute("d", describeArc(72, 180, 0));
  track.setAttribute("fill", "none");
  track.setAttribute("stroke", PANEL_MUTED);
  track.setAttribute("stroke-width", "18");
  track.setAttribute("stroke-linecap", "round");
  svg.appendChild(track);

  if (ratio > 0) {
    const valueArc = svgElement("path");
    valueArc.setAttribute("d", describeArc(72, 180, endAngle));
    valueArc.setAttribute("fill", "none");
    valueArc.setAttribute("stroke", valueColor(boundedValue, options.thresholds));
    valueArc.setAttribute("stroke-width", "18");
    valueArc.setAttribute("stroke-linecap", "round");
    svg.appendChild(valueArc);
  }

  for (const threshold of options.thresholds ?? []) {
    if (threshold.value < options.min || threshold.value > options.max) {
      continue;
    }

    const thresholdRatio =
      (threshold.value - options.min) / (options.max - options.min);
    const angle = 180 - thresholdRatio * 180;
    const start = polar(82, angle);
    const end = polar(92, angle);

    const tick = svgElement("line");
    tick.setAttribute("x1", start.x.toFixed(2));
    tick.setAttribute("y1", start.y.toFixed(2));
    tick.setAttribute("x2", end.x.toFixed(2));
    tick.setAttribute("y2", end.y.toFixed(2));
    tick.setAttribute("stroke", threshold.color);
    tick.setAttribute("stroke-width", "4");
    tick.setAttribute("stroke-linecap", "round");
    svg.appendChild(tick);
  }

  const valueText = svgElement("text");
  valueText.setAttribute("x", "110");
  valueText.setAttribute("y", "102");
  valueText.setAttribute("text-anchor", "middle");
  valueText.setAttribute("fill", TEXT_PRIMARY);
  valueText.setAttribute("font-size", "28");
  valueText.setAttribute("font-weight", "800");
  valueText.textContent = formatNumber(currentValue);
  svg.appendChild(valueText);

  if (options.unit) {
    const unitText = svgElement("text");
    unitText.setAttribute("x", "110");
    unitText.setAttribute("y", "122");
    unitText.setAttribute("text-anchor", "middle");
    unitText.setAttribute("fill", TEXT_SECONDARY);
    unitText.setAttribute("font-size", "12");
    unitText.textContent = options.unit;
    svg.appendChild(unitText);
  }

  const minLabel = svgElement("text");
  minLabel.setAttribute("x", "24");
  minLabel.setAttribute("y", "136");
  minLabel.setAttribute("text-anchor", "middle");
  minLabel.setAttribute("fill", TEXT_SECONDARY);
  minLabel.setAttribute("font-size", "11");
  minLabel.textContent = formatNumber(options.min);
  svg.appendChild(minLabel);

  const maxLabel = svgElement("text");
  maxLabel.setAttribute("x", "196");
  maxLabel.setAttribute("y", "136");
  maxLabel.setAttribute("text-anchor", "middle");
  maxLabel.setAttribute("fill", TEXT_SECONDARY);
  maxLabel.setAttribute("font-size", "11");
  maxLabel.textContent = formatNumber(options.max);
  svg.appendChild(maxLabel);

  wrapper.appendChild(svg);

  const summary = document.createElement("div");
  summary.style.display = "flex";
  summary.style.flexWrap = "wrap";
  summary.style.justifyContent = "center";
  summary.style.gap = "0.75rem";
  summary.style.color = TEXT_SECONDARY;
  summary.style.fontSize = "0.9rem";

  const actualValue = document.createElement("span");
  actualValue.textContent = `Actual: ${formatNumber(currentValue)}`;
  summary.appendChild(actualValue);

  const range = document.createElement("span");
  range.textContent = `Range: ${formatNumber(options.min)} to ${formatNumber(options.max)}`;
  summary.appendChild(range);

  wrapper.appendChild(summary);
  return wrapper;
}
