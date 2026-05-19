// Copyright (c) 2025 AccelByte Inc. All Rights Reserved.
// This is licensed software from AccelByte Inc, for limitations
// and restrictions contact your company contract manager.

import { toRows } from "./coerce.js";
import { filterRows } from "./filter.js";
import { mountShell } from "./base.js";
import type { RenderOutput } from "../../shared/render-schemas.js";
import { renderArea } from "./charts/area.js";
import { renderBar } from "./charts/bar.js";
import { renderBox } from "./charts/box.js";
import { renderDonut } from "./charts/donut.js";
import { renderFunnel } from "./charts/funnel.js";
import { renderGauge } from "./charts/gauge.js";
import { renderHeatmap } from "./charts/heatmap.js";
import { renderHistogram } from "./charts/histogram.js";
import { renderLine } from "./charts/line.js";
import { renderPie } from "./charts/pie.js";
import { renderScatter } from "./charts/scatter.js";
import { renderStateTimeline } from "./charts/state-timeline.js";
import { renderWaterfall } from "./charts/waterfall.js";

type ChartPayload = Exclude<
  RenderOutput,
  { chart_type: "table" } | { chart_type: "metric" }
>;

function assertNever(value: never): never {
  throw new Error(`Unsupported chart type: ${String(value)}`);
}

export function renderChart(root: HTMLElement, payload: ChartPayload): void {
  root.replaceChildren();

  const rows = filterRows(
    toRows(payload.data.columns, payload.data.rows, payload.column_hints ?? {}),
    payload.filters ?? [],
  );
  const { body: container } = mountShell(root, {
    title: payload.title,
    description: payload.description,
    chartType: payload.chart_type,
    dataSource: payload.data_source,
    stats: payload.stats,
  });
  let view: SVGElement | HTMLElement;

  switch (payload.chart_type) {
    case "bar":
      view = renderBar(rows, payload.options);
      break;
    case "line":
      view = renderLine(rows, payload.options);
      break;
    case "area":
      view = renderArea(rows, payload.options);
      break;
    case "scatter":
      view = renderScatter(rows, payload.options);
      break;
    case "histogram":
      view = renderHistogram(rows, payload.options);
      break;
    case "box":
      view = renderBox(rows, payload.options);
      break;
    case "heatmap":
      view = renderHeatmap(rows, payload.options);
      break;
    case "pie":
      view = renderPie(rows, payload.options);
      break;
    case "donut":
      view = renderDonut(rows, payload.options);
      break;
    case "waterfall":
      view = renderWaterfall(rows, payload.options);
      break;
    case "funnel":
      view = renderFunnel(rows, payload.options);
      break;
    case "gauge":
      view = renderGauge(rows, payload.options);
      break;
    case "state_timeline":
      view = renderStateTimeline(rows, payload.options);
      break;
    default:
      return assertNever(payload);
  }

  container.appendChild(view);
}
