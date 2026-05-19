// Copyright (c) 2025 AccelByte Inc. All Rights Reserved.
// This is licensed software from AccelByte Inc, for limitations
// and restrictions contact your company contract manager.

import * as Plot from "@observablehq/plot";
import type { z } from "zod/v3";

import { BoxChartOutputSchema } from "../../../shared/render-schemas.js";
import {
  facetConfig,
  plotDefaults,
  seriesRange,
  tooltipChannels,
  validateColumns,
} from "../base.js";
import type { Row } from "../types.js";

type BoxOptions = z.infer<typeof BoxChartOutputSchema>["options"];

const ACCENT = "var(--color-accent)";
const INFO = "var(--color-text-info)";

export function renderBox(rows: Row[], options: BoxOptions): SVGElement | HTMLElement {
  validateColumns(
    rows,
    options.x,
    options.y,
    options.color,
    options.facet_col,
    options.facet_row,
  );

  const defaults = plotDefaults();

  return Plot.plot({
    ...defaults,
    x: { ...defaults.x, label: options.x_label ?? options.x },
    y: { ...defaults.y, label: options.y_label ?? options.y },
    color: options.color
      ? { range: seriesRange(), legend: true }
      : defaults.color,
    marks: [
      Plot.boxY(rows, {
        x: options.x,
        y: options.y,
        fill: options.color ?? ACCENT,
        stroke: options.color ?? INFO,
        fillOpacity: 0.42,
        ...facetConfig({
          facet_col: options.facet_col,
          facet_row: options.facet_row,
        }),
        ...tooltipChannels(
          [options.x, options.y, options.color].filter(
            (value): value is string => Boolean(value),
          ),
        ),
      }),
    ],
  });
}
