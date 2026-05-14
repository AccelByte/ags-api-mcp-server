import assert from "node:assert/strict";
import { describe, test } from "node:test";

import "../../jsdom.js";
import { renderGauge } from "../../../../../src/v2/renderer/views/charts/gauge.js";
import { toRows } from "../../../../../src/v2/renderer/views/coerce.js";

describe("renderGauge", () => {
  test("returns a chart element for a valid gauge payload", () => {
    const rows = toRows(
      [{ name: "success_rate", type: "double" }],
      [["87.4"]],
    );

    const chart = renderGauge(rows, {
      value: "success_rate",
      min: 0,
      max: 100,
      thresholds: [
        { value: 50, color: "var(--color-text-info)" },
        { value: 80, color: "var(--color-accent)" },
      ],
      unit: "%",
    });

    assert.ok(
      chart instanceof SVGElement || chart instanceof HTMLElement,
      "expected an SVGElement or HTMLElement",
    );
  });

  test("throws when the referenced value column is missing", () => {
    const rows = toRows(
      [{ name: "score", type: "double" }],
      [["42"]],
    );

    assert.throws(() => {
      renderGauge(rows, {
        value: "missing",
        min: 0,
        max: 100,
      });
    }, /Unknown column/);
  });
});
