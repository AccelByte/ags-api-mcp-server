// Copyright (c) 2025 AccelByte Inc. All Rights Reserved.
// This is licensed software from AccelByte Inc, for limitations
// and restrictions contact your company contract manager.

import type { z } from "zod/v3";

import { GaugeChartOutputSchema } from "../../../shared/render-schemas.js";
import { asNumber, clamp, validateColumns } from "../base.js";
import type { Row } from "../types.js";

type GaugeOptions = z.infer<typeof GaugeChartOutputSchema>["options"];

const SVG_NS = "http://www.w3.org/2000/svg";
const PANEL_MUTED = "var(--color-panel-muted)";
const ACCENT = "var(--color-accent)";
const TEXT_PRIMARY = "var(--color-text-primary)";
const TEXT_SECONDARY = "var(--color-text-secondary)";

// Standard ⌒ gauge: half-circle opening downward.
// Min at 9 o'clock (angle -90), max at 3 o'clock (angle +90), sweeping clockwise through 12 o'clock.
const CENTER_X = 110;
const CENTER_Y = 110;
const RADIUS = 72;
const START_ANGLE = -90;
const END_ANGLE = 90;
const STROKE_WIDTH = 18;
const TICK_INNER = RADIUS + 10;
const TICK_OUTER = RADIUS + 20;

function svgElement<K extends keyof SVGElementTagNameMap>(
  name: K,
): SVGElementTagNameMap[K] {
  return document.createElementNS(SVG_NS, name);
}

function polar(radius: number, angleDegrees: number): { x: number; y: number } {
  // angle 0 → 12 o'clock, increasing clockwise (visually).
  const radians = ((angleDegrees - 90) * Math.PI) / 180;
  return {
    x: CENTER_X + radius * Math.cos(radians),
    y: CENTER_Y + radius * Math.sin(radians),
  };
}

function arcPath(
  radius: number,
  fromAngle: number,
  toAngle: number,
): string {
  const start = polar(radius, fromAngle);
  const end = polar(radius, toAngle);
  const largeArcFlag = Math.abs(toAngle - fromAngle) > 180 ? "1" : "0";
  // sweep=1 → clockwise visually (matches angle increase from START to END through 12 o'clock).
  return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArcFlag} 1 ${end.x} ${end.y}`;
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
  const valueAngle = START_ANGLE + ratio * (END_ANGLE - START_ANGLE);

  const wrapper = document.createElement("div");
  wrapper.style.display = "grid";
  wrapper.style.gap = "0.75rem";
  wrapper.style.justifyItems = "center";
  wrapper.style.padding = "0.5rem 0";

  const svg = svgElement("svg");
  svg.setAttribute("viewBox", "0 0 220 150");
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  svg.style.width = "100%";
  svg.style.maxWidth = "520px";
  svg.style.height = "auto";
  svg.style.aspectRatio = "220 / 150";

  const track = svgElement("path");
  track.setAttribute("d", arcPath(RADIUS, START_ANGLE, END_ANGLE));
  track.setAttribute("fill", "none");
  track.setAttribute("stroke", PANEL_MUTED);
  track.setAttribute("stroke-width", String(STROKE_WIDTH));
  track.setAttribute("stroke-linecap", "round");
  svg.appendChild(track);

  if (ratio > 0) {
    const valueArc = svgElement("path");
    valueArc.setAttribute("d", arcPath(RADIUS, START_ANGLE, valueAngle));
    valueArc.setAttribute("fill", "none");
    valueArc.setAttribute("stroke", valueColor(boundedValue, options.thresholds));
    valueArc.setAttribute("stroke-width", String(STROKE_WIDTH));
    valueArc.setAttribute("stroke-linecap", "round");
    svg.appendChild(valueArc);
  }

  for (const threshold of options.thresholds ?? []) {
    if (threshold.value < options.min || threshold.value > options.max) {
      continue;
    }

    const thresholdRatio =
      (threshold.value - options.min) / (options.max - options.min);
    const angle = START_ANGLE + thresholdRatio * (END_ANGLE - START_ANGLE);
    const start = polar(TICK_INNER, angle);
    const end = polar(TICK_OUTER, angle);

    const tick = svgElement("line");
    tick.setAttribute("x1", start.x.toFixed(2));
    tick.setAttribute("y1", start.y.toFixed(2));
    tick.setAttribute("x2", end.x.toFixed(2));
    tick.setAttribute("y2", end.y.toFixed(2));
    tick.setAttribute("stroke", threshold.color);
    tick.setAttribute("stroke-width", "3");
    tick.setAttribute("stroke-linecap", "round");
    svg.appendChild(tick);
  }

  const valueText = svgElement("text");
  valueText.setAttribute("x", String(CENTER_X));
  valueText.setAttribute("y", String(CENTER_Y - 6));
  valueText.setAttribute("text-anchor", "middle");
  valueText.setAttribute("fill", TEXT_PRIMARY);
  valueText.setAttribute("font-size", "28");
  valueText.setAttribute("font-weight", "800");
  valueText.textContent = formatNumber(currentValue);
  svg.appendChild(valueText);

  if (options.unit) {
    const unitText = svgElement("text");
    unitText.setAttribute("x", String(CENTER_X));
    unitText.setAttribute("y", String(CENTER_Y + 14));
    unitText.setAttribute("text-anchor", "middle");
    unitText.setAttribute("fill", TEXT_SECONDARY);
    unitText.setAttribute("font-size", "12");
    unitText.textContent = options.unit;
    svg.appendChild(unitText);
  }

  const leftEnd = polar(RADIUS, START_ANGLE);
  const rightEnd = polar(RADIUS, END_ANGLE);

  const minLabel = svgElement("text");
  minLabel.setAttribute("x", leftEnd.x.toFixed(2));
  minLabel.setAttribute("y", (leftEnd.y + 18).toFixed(2));
  minLabel.setAttribute("text-anchor", "middle");
  minLabel.setAttribute("fill", TEXT_SECONDARY);
  minLabel.setAttribute("font-size", "11");
  minLabel.textContent = formatNumber(options.min);
  svg.appendChild(minLabel);

  const maxLabel = svgElement("text");
  maxLabel.setAttribute("x", rightEnd.x.toFixed(2));
  maxLabel.setAttribute("y", (rightEnd.y + 18).toFixed(2));
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
