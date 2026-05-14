import assert from "node:assert/strict";
import { describe, test } from "node:test";

import "../../jsdom.js";
import { renderBar } from "../../../../../src/v2/renderer/views/charts/bar.js";
import { toRows } from "../../../../../src/v2/renderer/views/coerce.js";

describe("renderBar", () => {
  test("returns a chart element and uses CSS variable colors for default fills", () => {
    const rows = toRows(
      [
        { name: "team", type: "varchar" },
        { name: "score", type: "bigint" },
      ],
      [
        ["blue", "10"],
        ["red", "12"],
      ],
    );

    const chart = renderBar(rows, {
      x: "team",
      y: "score",
      bar_mode: "grouped",
      orientation: "vertical",
    });

    assert.ok(
      chart instanceof SVGElement || chart instanceof HTMLElement,
      "expected an SVGElement or HTMLElement",
    );
    assert.match(chart.outerHTML, /var\(--color-accent\)/);
    assert.doesNotMatch(chart.outerHTML, /steelblue/);
  });

  test("throws when required columns are missing", () => {
    const rows = toRows(
      [
        { name: "team", type: "varchar" },
        { name: "score", type: "bigint" },
      ],
      [["blue", "10"]],
    );

    assert.throws(() => {
      renderBar(rows, {
        x: "missing",
        y: "score",
        bar_mode: "grouped",
        orientation: "vertical",
      });
    }, /Unknown column/);
  });
});
