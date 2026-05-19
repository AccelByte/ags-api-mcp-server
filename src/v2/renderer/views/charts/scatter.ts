// Copyright (c) 2025 AccelByte Inc. All Rights Reserved.
// This is licensed software from AccelByte Inc, for limitations
// and restrictions contact your company contract manager.

import * as Plot from "@observablehq/plot";
import type { z } from "zod/v3";

import { ScatterChartOutputSchema } from "../../../shared/render-schemas.js";
import {
  facetConfig,
  plotDefaults,
  seriesRange,
  tooltipChannels,
  validateColumns,
} from "../base.js";
import type { Row } from "../types.js";

type ScatterOptions = z.infer<typeof ScatterChartOutputSchema>["options"];

const ACCENT = "var(--color-accent)";
const INFO = "var(--color-text-info)";

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
    options.facet_col,
    options.facet_row,
  );

  const markFacets = facetConfig({
    facet_col: options.facet_col,
    facet_row: options.facet_row,
  });
  const defaults = plotDefaults();

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
    ...defaults,
    x: { ...defaults.x, label: options.x_label ?? options.x, grid: true },
    y: { ...defaults.y, label: options.y_label ?? options.y },
    color: options.color
      ? { range: seriesRange(), legend: true }
      : defaults.color,
    marks,
  });
}
