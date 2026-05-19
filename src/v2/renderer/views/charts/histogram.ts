// Copyright (c) 2025 AccelByte Inc. All Rights Reserved.
// This is licensed software from AccelByte Inc, for limitations
// and restrictions contact your company contract manager.

import * as Plot from "@observablehq/plot";
import type { z } from "zod/v3";

import { HistogramChartOutputSchema } from "../../../shared/render-schemas.js";
import {
  facetConfig,
  plotDefaults,
  seriesRange,
  validateColumns,
} from "../base.js";
import type { Row } from "../types.js";

type HistogramOptions = z.infer<typeof HistogramChartOutputSchema>["options"];

const ACCENT = "var(--color-accent)";

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

  const defaults = plotDefaults();

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
    ...defaults,
    x: { ...defaults.x, label: options.x_label ?? options.column },
    y: {
      ...defaults.y,
      label: options.y_label ?? (options.normalize ? "Proportion" : "Count"),
    },
    color: options.color
      ? { range: seriesRange(), legend: true }
      : defaults.color,
    marks,
  });
}
