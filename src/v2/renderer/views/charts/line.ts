// Copyright (c) 2025 AccelByte Inc. All Rights Reserved.
// This is licensed software from AccelByte Inc, for limitations
// and restrictions contact your company contract manager.

import * as Plot from "@observablehq/plot";
import type { z } from "zod/v3";

import { LineChartOutputSchema } from "../../../shared/render-schemas.js";
import {
  facetConfig,
  tooltipChannels,
  validateColumns,
} from "../base.js";
import type { Row } from "../types.js";

type LineOptions = z.infer<typeof LineChartOutputSchema>["options"];

const ACCENT = "var(--color-accent)";
const INFO = "var(--color-text-info)";
const SERIES_RANGE = [
  ACCENT,
  INFO,
  "color-mix(in srgb, var(--color-accent) 72%, var(--color-panel) 28%)",
  "color-mix(in srgb, var(--color-text-info) 64%, var(--color-panel) 36%)",
];
const CURVE_MAP = {
  linear: "linear",
  smooth: "catmull-rom",
  step: "step",
} as const;

export function renderLine(rows: Row[], options: LineOptions): SVGElement | HTMLElement {
  validateColumns(
    rows,
    options.x,
    options.y,
    options.color,
    options.facet_col,
    options.facet_row,
  );

  const markFacets = facetConfig({
    facet_col: options.facet_col,
    facet_row: options.facet_row,
  });

  const marks = [
    Plot.lineY(rows, {
      x: options.x,
      y: options.y,
      stroke: options.color ?? ACCENT,
      z: options.color,
      curve: CURVE_MAP[options.curve],
      ...markFacets,
      ...tooltipChannels(options.tooltip),
    }),
    Plot.ruleY([0]),
  ];

  if (options.show_points) {
    marks.push(
      Plot.dot(rows, {
        x: options.x,
        y: options.y,
        fill: options.color ?? ACCENT,
        stroke: options.color ? undefined : INFO,
        r: 3.5,
        ...markFacets,
        ...tooltipChannels(options.tooltip),
      }),
    );
  }

  return Plot.plot({
    x: { label: options.x_label ?? options.x },
    y: { label: options.y_label ?? options.y, grid: true },
    color: options.color ? { range: SERIES_RANGE, legend: true } : undefined,
    marks,
  });
}
