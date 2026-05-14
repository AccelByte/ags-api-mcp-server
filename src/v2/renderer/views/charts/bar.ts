// Copyright (c) 2025 AccelByte Inc. All Rights Reserved.
// This is licensed software from AccelByte Inc, for limitations
// and restrictions contact your company contract manager.

import * as Plot from "@observablehq/plot";
import type { z } from "zod/v3";

import { BarChartOutputSchema } from "../../../shared/render-schemas.js";
import {
  facetConfig,
  tooltipChannels,
  validateColumns,
} from "../base.js";
import type { Row } from "../types.js";

type BarOptions = z.infer<typeof BarChartOutputSchema>["options"];

const ACCENT = "var(--color-accent)";
const INFO = "var(--color-text-info)";
const TEXT_ON_ACCENT = "var(--color-text-on-accent)";
const SERIES_RANGE = [
  ACCENT,
  INFO,
  "color-mix(in srgb, var(--color-accent) 72%, var(--color-panel) 28%)",
  "color-mix(in srgb, var(--color-text-info) 64%, var(--color-panel) 36%)",
  "color-mix(in srgb, var(--color-accent) 48%, var(--color-text-info) 52%)",
];

export function renderBar(rows: Row[], options: BarOptions): SVGElement | HTMLElement {
  validateColumns(
    rows,
    options.x,
    options.y,
    options.color,
    options.label,
    options.facet_col,
    options.facet_row,
  );

  const grouped = options.bar_mode === "grouped";
  const normalized = options.bar_mode === "normalized";
  const horizontal = options.orientation === "horizontal";
  const tooltip = tooltipChannels(options.tooltip);
  const markFacets = facetConfig({
    facet_col: options.facet_col,
    facet_row: options.facet_row,
  });

  if (horizontal) {
    const mark =
      grouped && options.color
        ? Plot.barX(rows, {
            x: options.y,
            y: options.color,
            fy: options.x,
            fill: options.color,
            ...markFacets,
            ...tooltip,
          })
        : Plot.barX(
            rows,
            options.color
              ? Plot.stackX(
                  normalized ? { offset: "normalize" } : {},
                  {
                    x: options.y,
                    y: options.x,
                    fill: options.color,
                    ...markFacets,
                    ...tooltip,
                  },
                )
              : {
                  x: options.y,
                  y: options.x,
                  fill: ACCENT,
                  ...markFacets,
                  ...tooltip,
                },
          );

    const marks = [mark, Plot.ruleX([0])];
    if (options.label) {
      marks.push(
        Plot.text(rows, {
          x: options.y,
          y: grouped && options.color ? options.color : options.x,
          fy: grouped && options.color ? options.x : undefined,
          text: options.label,
          dx: 6,
          fill: options.color ? INFO : TEXT_ON_ACCENT,
          ...markFacets,
        }),
      );
    }

    return Plot.plot({
      marginLeft: 112,
      x: { label: options.y_label ?? options.y, grid: true },
      y: { label: options.x_label ?? options.x },
      color: options.color ? { range: SERIES_RANGE, legend: true } : undefined,
      marks,
    });
  }

  const mark =
    grouped && options.color
      ? Plot.barY(rows, {
          x: options.color,
          y: options.y,
          fx: options.x,
          fill: options.color,
          ...markFacets,
          ...tooltip,
        })
      : Plot.barY(
          rows,
          options.color
            ? Plot.stackY(
                normalized ? { offset: "normalize" } : {},
                {
                  x: options.x,
                  y: options.y,
                  fill: options.color,
                  ...markFacets,
                  ...tooltip,
                },
              )
            : {
                x: options.x,
                y: options.y,
                fill: ACCENT,
                ...markFacets,
                ...tooltip,
              },
        );

  const marks = [mark, Plot.ruleY([0])];
  if (options.label) {
    marks.push(
      Plot.text(rows, {
        x: grouped && options.color ? options.color : options.x,
        y: options.y,
        fx: grouped && options.color ? options.x : undefined,
        text: options.label,
        dy: -6,
        fill: options.color ? INFO : TEXT_ON_ACCENT,
        ...markFacets,
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
