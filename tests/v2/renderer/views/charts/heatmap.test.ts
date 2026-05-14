import assert from "node:assert/strict";
import { describe, test } from "node:test";

import "../../jsdom.js";
import { renderHeatmap } from "../../../../../src/v2/renderer/views/charts/heatmap.js";
import { toRows } from "../../../../../src/v2/renderer/views/coerce.js";

describe("renderHeatmap", () => {
  test("returns a chart element for valid categorical and numeric data", () => {
    const rows = toRows(
      [
        { name: "hour", type: "varchar" },
        { name: "region", type: "varchar" },
        { name: "concurrency", type: "double" },
      ],
      [
        ["00:00", "ap-south", "14.5"],
        ["01:00", "ap-south", "16.25"],
        ["00:00", "eu-west", "9.5"],
      ],
    );

    const chart = renderHeatmap(rows, {
      x: "hour",
      y: "region",
      value: "concurrency",
      color_scheme: "sequential",
      show_values: true,
    });

    assert.ok(
      chart instanceof SVGElement || chart instanceof HTMLElement,
      "expected an SVGElement or HTMLElement",
    );
  });

  test("throws when required columns are missing", () => {
    const rows = toRows(
      [
        { name: "hour", type: "varchar" },
        { name: "value", type: "double" },
      ],
      [["00:00", "7"]],
    );

    assert.throws(() => {
      renderHeatmap(rows, {
        x: "hour",
        y: "missing",
        value: "value",
        color_scheme: "sequential",
        show_values: false,
      });
    }, /Unknown column/);
  });
});
