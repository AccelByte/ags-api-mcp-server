// Copyright (c) 2025 AccelByte Inc. All Rights Reserved.
// This is licensed software from AccelByte Inc, for limitations
// and restrictions contact your company contract manager.

import * as Plot from "@observablehq/plot";
import type { z } from "zod/v3";

import { AreaChartOutputSchema } from "../../../shared/render-schemas.js";
import {
  facetConfig,
  plotDefaults,
  seriesRange,
  tooltipChannels,
  validateColumns,
} from "../base.js";
import type { Row } from "../types.js";

type AreaOptions = z.infer<typeof AreaChartOutputSchema>["options"];

const ACCENT = "var(--color-accent)";
const INFO = "var(--color-text-info)";
const CURVE_MAP = {
  linear: "linear",
  smooth: "catmull-rom",
  step: "step",
} as const;

export function renderArea(rows: Row[], options: AreaOptions): SVGElement | HTMLElement {
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
  const defaults = plotDefaults();
  const curve = CURVE_MAP[options.curve];

  const area = Plot.areaY(rows, {
    x: options.x,
    y: options.y,
    fill: options.color ?? ACCENT,
    z: options.color,
    stroke: options.color ?? INFO,
    fillOpacity:
      options.stack_mode === "overlap"
        ? 0.34
        : options.color
          ? 0.46
          : 0.6,
    strokeOpacity: 0.92,
    curve,
    offset: options.stack_mode === "normalized" ? "normalize" : undefined,
    ...markFacets,
    ...tooltipChannels(options.tooltip),
  });

  return Plot.plot({
    ...defaults,
    x: { ...defaults.x, label: options.x_label ?? options.x },
    y: { ...defaults.y, label: options.y_label ?? options.y },
    color: options.color
      ? { range: seriesRange(), legend: true }
      : defaults.color,
    marks: [area, Plot.ruleY([0])],
  });
}
