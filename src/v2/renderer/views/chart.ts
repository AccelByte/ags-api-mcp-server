// Copyright (c) 2025 AccelByte Inc. All Rights Reserved.
// This is licensed software from AccelByte Inc, for limitations
// and restrictions contact your company contract manager.

import { toRows } from "./coerce.js";
import { filterRows } from "./filter.js";
import { mountChart } from "./base.js";
import type { RenderOutput } from "../../shared/render-schemas.js";
import { renderArea } from "./charts/area.js";
import { renderBar } from "./charts/bar.js";
import { renderBox } from "./charts/box.js";
import { renderHistogram } from "./charts/histogram.js";
import { renderLine } from "./charts/line.js";
import { renderScatter } from "./charts/scatter.js";

type ChartPayload = Exclude<
  RenderOutput,
  { chart_type: "table" } | { chart_type: "metric" }
>;

function renderPlaceholder(
  container: HTMLDivElement,
  chartType: ChartPayload["chart_type"],
  columnCount: number,
  rowCount: number,
): void {
  const summary = document.createElement("p");
  summary.className = "renderer-summary";
  summary.textContent = `${columnCount} columns, ${rowCount} rows available for ${chartType.replaceAll("_", " ")} rendering.`;
  container.appendChild(summary);

  const placeholder = document.createElement("section");
  placeholder.className = "renderer-placeholder";

  const badge = document.createElement("div");
  badge.className = "renderer-badge";
  badge.textContent = "Phase 9 partial";
  placeholder.appendChild(badge);

  const body = document.createElement("p");
  body.textContent =
    "This chart type is scheduled for the next renderer phase. The dataset has been parsed, filtered, and is ready for the specialized view.";
  placeholder.appendChild(body);

  container.appendChild(placeholder);
}

export function renderChart(root: HTMLElement, payload: ChartPayload): void {
  root.replaceChildren();

  const rows = filterRows(
    toRows(payload.data.columns, payload.data.rows, payload.column_hints ?? {}),
    payload.filters ?? [],
  );
  const container = mountChart(root, payload.title, payload.description);

  const view =
    payload.chart_type === "bar"
      ? renderBar(rows, payload.options)
      : payload.chart_type === "line"
        ? renderLine(rows, payload.options)
        : payload.chart_type === "area"
          ? renderArea(rows, payload.options)
          : payload.chart_type === "scatter"
            ? renderScatter(rows, payload.options)
            : payload.chart_type === "histogram"
              ? renderHistogram(rows, payload.options)
              : payload.chart_type === "box"
                ? renderBox(rows, payload.options)
                : undefined;

  if (view) {
    container.appendChild(view);
    return;
  }

  renderPlaceholder(
    container,
    payload.chart_type,
    payload.data.columns.length,
    rows.length,
  );
}
