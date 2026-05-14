// Copyright (c) 2025 AccelByte Inc. All Rights Reserved.
// This is licensed software from AccelByte Inc, for limitations
// and restrictions contact your company contract manager.

import * as Plot from "@observablehq/plot";
import type { z } from "zod/v3";

import { HistogramChartOutputSchema } from "../../../shared/render-schemas.js";
import { facetConfig, validateColumns } from "../base.js";
import type { Row } from "../types.js";

type HistogramOptions = z.infer<typeof HistogramChartOutputSchema>["options"];

const ACCENT = "var(--color-accent)";
const INFO = "var(--color-text-info)";
const SERIES_RANGE = [
  ACCENT,
  INFO,
  "color-mix(in srgb, var(--color-accent) 72%, var(--color-panel) 28%)",
  "color-mix(in srgb, var(--color-text-info) 64%, var(--color-panel) 36%)",
];

export function renderHistogram(
  rows: Row[],
  options: HistogramOptions,
): SVGElement | HTMLElement {
  validateColumns(
    rows,
    options.column,
    options.color,
    options.facet_col,
    options.facet_row,
  );

  const marks = [
    Plot.rectY(
      rows,
      {
        ...Plot.binX(
          { y: options.normalize ? "proportion" : "count" },
          {
            x: options.column,
            thresholds: options.bin_count,
          },
        ),
        fill: options.color ?? ACCENT,
        ...facetConfig({
          facet_col: options.facet_col,
          facet_row: options.facet_row,
        }),
      },
    ),
    Plot.ruleY([0]),
  ];

  return Plot.plot({
    x: { label: options.x_label ?? options.column },
    y: {
      label: options.y_label ?? (options.normalize ? "Proportion" : "Count"),
      grid: true,
    },
    color: options.color ? { range: SERIES_RANGE, legend: true } : undefined,
    marks,
  });
}
