import assert from "node:assert/strict";
import { describe, test } from "node:test";

import "../../jsdom.js";
import { renderPie } from "../../../../../src/v2/renderer/views/charts/pie.js";
import { toRows } from "../../../../../src/v2/renderer/views/coerce.js";

function makeRows(): ReturnType<typeof toRows> {
  return toRows(
    [
      { name: "segment", type: "varchar" },
      { name: "value", type: "bigint" },
    ],
    [
      ["alpha", "30"],
      ["beta", "50"],
      ["gamma", "20"],
    ],
  );
}

describe("renderPie", () => {
  test("uses class names instead of inline element.style on wrapper/legend/items", () => {
    const chart = renderPie(makeRows(), {
      category: "segment",
      value: "value",
      show_labels: false,
    }) as HTMLElement;

    assert.equal(chart.className, "pie-wrap");
    assert.equal(chart.getAttribute("style"), null);

    const legend = chart.querySelector(".pie-legend") as HTMLElement;
    assert.ok(legend, "expected .pie-legend element");
    assert.equal(legend.getAttribute("style"), null);

    const items = legend.querySelectorAll(".pie-legend-item");
    assert.ok(items.length >= 1);
    for (const item of items) {
      assert.equal(
        (item as HTMLElement).getAttribute("style"),
        null,
        "legend item should not have inline styles",
      );
    }

    const swatches = legend.querySelectorAll(".series-swatch");
    assert.equal(swatches.length, items.length);
    for (const swatch of swatches) {
      const style = (swatch as HTMLElement).style;
      // Only `color` is allowed (used by .series-swatch's currentColor background).
      for (let i = 0; i < style.length; i++) {
        const prop = style.item(i);
        assert.equal(
          prop,
          "color",
          `swatch should only set color, found ${prop}`,
        );
      }
    }
  });

  test("svg uses .pie-svg class with no fixed height attribute", () => {
    const chart = renderPie(makeRows(), {
      category: "segment",
      value: "value",
      show_labels: false,
    }) as HTMLElement;

    const svg = chart.querySelector("svg") as SVGElement;
    assert.ok(svg, "expected an svg element");
    assert.equal(svg.getAttribute("class"), "pie-svg");
    assert.equal(svg.getAttribute("height"), null);
  });
});
