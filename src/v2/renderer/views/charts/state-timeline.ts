// Copyright (c) 2025 AccelByte Inc. All Rights Reserved.
// This is licensed software from AccelByte Inc, for limitations
// and restrictions contact your company contract manager.

import type { z } from "zod/v3";

import { StateTimelineChartOutputSchema } from "../../../shared/render-schemas.js";
import { seriesRange, validateColumns } from "../base.js";
import type { Primitive, Row } from "../types.js";

type StateTimelineOptions = z.infer<typeof StateTimelineChartOutputSchema>["options"];

const BORDER = "var(--color-border)";
const PANEL_MUTED = "var(--color-panel-muted)";
const TEXT_PRIMARY = "var(--color-text-primary)";
const TEXT_SECONDARY = "var(--color-text-secondary)";
const TEXT_ON_ACCENT = "var(--color-text-on-accent)";

type TimelineSegment = {
  entity: string;
  state: string;
  startMs: number;
  endMs: number;
};

function asText(value: Primitive): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return String(value);
}

function asTimestamp(value: Primitive): number | undefined {
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isNaN(time) ? undefined : time;
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? undefined : parsed;
  }
  return undefined;
}

function formatDate(value: number): string {
  return new Date(value).toISOString();
}

function formatCompactDate(value: number): string {
  const iso = new Date(value).toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

export function renderStateTimeline(
  rows: Row[],
  options: StateTimelineOptions,
): SVGElement | HTMLElement {
  validateColumns(rows, options.entity, options.start, options.end, options.state);

  const segments: TimelineSegment[] = [];
  const entityOrder: string[] = [];
  const stateOrder: string[] = [];

  for (const row of rows) {
    const entity = asText(row[options.entity]);
    const state = asText(row[options.state]);
    const startMs = asTimestamp(row[options.start]);
    const endMs = asTimestamp(row[options.end]);
    if (!entity || !state || startMs === undefined || endMs === undefined) {
      continue;
    }

    const normalizedStart = Math.min(startMs, endMs);
    const normalizedEnd = Math.max(startMs, endMs);
    segments.push({
      entity,
      state,
      startMs: normalizedStart,
      endMs: normalizedEnd,
    });

    if (!entityOrder.includes(entity)) {
      entityOrder.push(entity);
    }
    if (!stateOrder.includes(state)) {
      stateOrder.push(state);
    }
  }

  if (segments.length === 0) {
    throw new Error("State timeline requires at least one row with valid entity, state, and time interval values.");
  }

  const minStart = Math.min(...segments.map((segment) => segment.startMs));
  const maxEnd = Math.max(...segments.map((segment) => segment.endMs));
  const span = Math.max(1, maxEnd - minStart);
  const palette = seriesRange();
  const colorByState = new Map(
    stateOrder.map((state, index) => [
      state,
      palette[index % palette.length],
    ]),
  );

  const wrapper = document.createElement("div");
  wrapper.style.display = "grid";
  wrapper.style.gap = "0.85rem";

  const axis = document.createElement("div");
  axis.style.display = "flex";
  axis.style.justifyContent = "space-between";
  axis.style.gap = "1rem";
  axis.style.fontSize = "0.85rem";
  axis.style.color = TEXT_SECONDARY;
  axis.textContent = "";

  const axisStart = document.createElement("span");
  axisStart.style.whiteSpace = "nowrap";
  axisStart.textContent = `${options.start}: ${formatCompactDate(minStart)}`;
  const axisEnd = document.createElement("span");
  axisEnd.style.whiteSpace = "nowrap";
  axisEnd.style.textAlign = "right";
  axisEnd.textContent = `${options.end}: ${formatCompactDate(maxEnd)}`;
  axis.append(axisStart, axisEnd);
  wrapper.appendChild(axis);

  for (const entity of entityOrder) {
    const row = document.createElement("section");
    row.style.display = "grid";
    row.style.gridTemplateColumns = "minmax(110px, 160px) minmax(0, 1fr)";
    row.style.alignItems = "center";
    row.style.gap = "0.75rem";

    const label = document.createElement("strong");
    label.style.color = TEXT_PRIMARY;
    label.textContent = entity;
    row.appendChild(label);

    const track = document.createElement("div");
    track.style.position = "relative";
    track.style.height = "2.4rem";
    track.style.borderRadius = "999px";
    track.style.background = PANEL_MUTED;
    track.style.border = `1px solid ${BORDER}`;
    track.style.overflow = "hidden";

    const RAIL_INSET = 1.2;
    const railSpan = 100 - 2 * RAIL_INSET;

    const entitySegments = segments
      .filter((segment) => segment.entity === entity)
      .sort((left, right) => left.startMs - right.startMs);

    for (const segment of entitySegments) {
      const block = document.createElement("div");
      const left = RAIL_INSET + ((segment.startMs - minStart) / span) * railSpan;
      const width = Math.max(
        1.2,
        ((segment.endMs - segment.startMs) / span) * railSpan,
      );

      block.style.position = "absolute";
      block.style.left = `${left}%`;
      block.style.top = "50%";
      block.style.transform = "translateY(-50%)";
      block.style.height = "1.9rem";
      block.style.width = `${width}%`;
      block.style.borderRadius = "999px";
      block.style.display = "flex";
      block.style.alignItems = "center";
      block.style.justifyContent = "center";
      block.style.padding = "0 0.5rem";
      block.style.background = colorByState.get(segment.state) ?? palette[0];
      block.style.color = TEXT_ON_ACCENT;
      block.style.fontSize = "0.75rem";
      block.style.fontWeight = "700";
      block.style.whiteSpace = "nowrap";
      block.style.overflow = "hidden";
      block.style.textOverflow = "ellipsis";
      block.title =
        `${segment.state}: ${formatDate(segment.startMs)} -> ${formatDate(segment.endMs)}`;
      block.textContent = segment.state;

      track.appendChild(block);
    }

    row.appendChild(track);
    wrapper.appendChild(row);
  }

  const legend = document.createElement("div");
  legend.style.display = "flex";
  legend.style.flexWrap = "wrap";
  legend.style.gap = "0.75rem";

  for (const state of stateOrder) {
    const item = document.createElement("span");
    item.style.display = "inline-flex";
    item.style.alignItems = "center";
    item.style.gap = "0.45rem";
    item.style.color = TEXT_SECONDARY;

    const swatch = document.createElement("span");
    swatch.style.display = "inline-block";
    swatch.style.width = "0.8rem";
    swatch.style.height = "0.8rem";
    swatch.style.borderRadius = "999px";
    swatch.style.background = colorByState.get(state) ?? palette[0];

    const text = document.createElement("span");
    text.textContent = state;
    item.append(swatch, text);
    legend.appendChild(item);
  }

  wrapper.appendChild(legend);
  return wrapper;
}
