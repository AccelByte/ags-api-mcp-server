// Copyright (c) 2025 AccelByte Inc. All Rights Reserved.
// This is licensed software from AccelByte Inc, for limitations
// and restrictions contact your company contract manager.

import * as Plot from "@observablehq/plot";
import type { z } from "zod/v3";

import { ScatterChartOutputSchema } from "../../../shared/render-schemas.js";
import {
  facetConfig,
  tooltipChannels,
  validateColumns,
} from "../base.js";
import type { Row } from "../types.js";

type ScatterOptions = z.infer<typeof ScatterChartOutputSchema>["options"];

const ACCENT = "var(--color-accent)";
const INFO = "var(--color-text-info)";
const SERIES_RANGE = [
  ACCENT,
  INFO,
  "color-mix(in srgb, var(--color-accent) 72%, var(--color-panel) 28%)",
  "color-mix(in srgb, var(--color-text-info) 64%, var(--color-panel) 36%)",
];

export function renderScatter(
  rows: Row[],
  options: ScatterOptions,
): SVGElement | HTMLElement {
  validateColumns(
    rows,
    options.x,
    options.y,
    options.color,
    options.size,
    options.label,
    options.facet_col,
    options.facet_row,
  );

  const markFacets = facetConfig({
    facet_col: options.facet_col,
    facet_row: options.facet_row,
  });

  const marks = [
    Plot.dot(rows, {
      x: options.x,
      y: options.y,
      r: options.size ?? 4.5,
      fill: options.color ?? ACCENT,
      stroke: options.color ? undefined : INFO,
      fillOpacity: 0.74,
      ...markFacets,
      ...tooltipChannels(options.tooltip),
    }),
  ];

  if (options.label) {
    marks.push(
      Plot.text(rows, {
        x: options.x,
        y: options.y,
        text: options.label,
        dy: -10,
        fill: INFO,
        ...markFacets,
      }),
    );
  }

  if (options.trend_line === "linear") {
    marks.push(
      Plot.linearRegressionY(rows, {
        x: options.x,
        y: options.y,
        stroke: INFO,
        strokeWidth: 2,
        ...markFacets,
      }),
    );
  }

  return Plot.plot({
    x: { label: options.x_label ?? options.x, grid: true },
    y: { label: options.y_label ?? options.y, grid: true },
    color: options.color ? { range: SERIES_RANGE, legend: true } : undefined,
    marks,
  });
}
