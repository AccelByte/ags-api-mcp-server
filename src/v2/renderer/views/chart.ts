// Copyright (c) 2025 AccelByte Inc. All Rights Reserved.
// This is licensed software from AccelByte Inc, for limitations
// and restrictions contact your company contract manager.

import type { RenderOutput } from "../../shared/render-schemas.js";

type ChartPayload = Exclude<
  RenderOutput,
  { chart_type: "table" } | { chart_type: "metric" }
>;

function appendHeader(
  container: HTMLElement,
  title?: string,
  description?: string,
): void {
  const header = document.createElement("section");
  header.className = "renderer-shell";

  const titleElement = document.createElement("div");
  titleElement.className = "renderer-header";

  const heading = document.createElement("h1");
  heading.className = "renderer-title";
  heading.textContent = title ?? "Analytics visualization";
  titleElement.appendChild(heading);

  if (description) {
    const body = document.createElement("p");
    body.className = "renderer-description";
    body.textContent = description;
    titleElement.appendChild(body);
  }

  header.appendChild(titleElement);
  container.appendChild(header);
}

export function renderChart(root: HTMLElement, payload: ChartPayload): void {
  root.replaceChildren();
  appendHeader(root, payload.title, payload.description);

  const shell = root.querySelector(".renderer-shell");
  if (!(shell instanceof HTMLElement)) {
    throw new Error("Renderer shell did not mount.");
  }

  const summary = document.createElement("p");
  summary.className = "renderer-summary";
  summary.textContent = `${payload.data.columns.length} columns, ${payload.data.rows.length} rows available for ${payload.chart_type.replaceAll("_", " ")} rendering.`;
  shell.appendChild(summary);

  const placeholder = document.createElement("section");
  placeholder.className = "renderer-placeholder";

  const badge = document.createElement("div");
  badge.className = "renderer-badge";
  badge.textContent = "Phase 7 shell";
  placeholder.appendChild(badge);

  const body = document.createElement("p");
  body.textContent =
    "Interactive chart rendering will land in Phases 8 through 10. This placeholder keeps the renderer shell, host-theme wiring, and bundle pipeline compiling.";
  placeholder.appendChild(body);

  shell.appendChild(placeholder);
}
