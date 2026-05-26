import assert from "node:assert/strict";
import { describe, test } from "node:test";

import "../../jsdom.js";
import { renderBar } from "../../../../../src/v2/renderer/views/charts/bar.js";
import { getChartConfig } from "../../../../../src/v2/renderer/views/base.js";
import { toRows } from "../../../../../src/v2/renderer/views/coerce.js";

function configFor(view: HTMLElement) {
  const canvas = view.querySelector("canvas");
  assert.ok(canvas, "expected a <canvas> in the chart wrapper");
  const config = getChartConfig(canvas as HTMLCanvasElement);
  assert.ok(config, "expected a Chart.js config stashed on the canvas");
  return config!;
}

describe("renderBar", () => {
  test("returns a sized wrapper containing a canvas with a bar chart config", () => {
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

    const view = renderBar(rows, {
      x: "team",
      y: "score",
      bar_mode: "grouped",
      orientation: "vertical",
    });

    assert.ok(view instanceof HTMLElement);
    const config = configFor(view);
    assert.equal(config.type, "bar");
    assert.deepEqual(config.data.labels, ["blue", "red"]);
    assert.equal(config.data.datasets.length, 1);
    assert.deepEqual(config.data.datasets[0]!.data, [10, 12]);
  });

  test("uses resolved CSS variable for the accent fill when no color split is provided", () => {
    const rows = toRows(
      [
        { name: "team", type: "varchar" },
        { name: "score", type: "bigint" },
      ],
      [["blue", "10"]],
    );

    const view = renderBar(rows, {
      x: "team",
      y: "score",
      bar_mode: "grouped",
      orientation: "vertical",
    });

    const config = configFor(view);
    // In JSDOM the var() expression cannot resolve, so it survives as-is on the dataset.
    // In a real browser the same call returns the actual color hex.
    assert.equal(config.data.datasets[0]!.backgroundColor, "var(--color-accent)");
  });

  test("uses per-series palette colors when a color split column is provided", () => {
    const rows = toRows(
      [
        { name: "team", type: "varchar" },
        { name: "score", type: "bigint" },
        { name: "region", type: "varchar" },
      ],
      [
        ["blue", "10", "apac"],
        ["red", "12", "emea"],
      ],
    );

    const view = renderBar(rows, {
      x: "team",
      y: "score",
      color: "region",
      bar_mode: "grouped",
      orientation: "vertical",
    });

    const config = configFor(view);
    assert.equal(config.data.datasets.length, 2);
    for (const ds of config.data.datasets) {
      assert.match(
        String(ds.backgroundColor),
        /^var\(--series-\d+\)$/,
      );
    }
  });

  test("horizontal orientation flips the index axis", () => {
    const rows = toRows(
      [
        { name: "team", type: "varchar" },
        { name: "score", type: "bigint" },
      ],
      [["blue", "10"]],
    );

    const view = renderBar(rows, {
      x: "team",
      y: "score",
      bar_mode: "grouped",
      orientation: "horizontal",
    });

    const config = configFor(view);
    assert.equal(
      (config.options as { indexAxis?: string }).indexAxis,
      "y",
    );
  });

  test("stacked bar_mode propagates to the scales", () => {
    const rows = toRows(
      [
        { name: "team", type: "varchar" },
        { name: "score", type: "bigint" },
      ],
      [["blue", "10"]],
    );

    const view = renderBar(rows, {
      x: "team",
      y: "score",
      bar_mode: "stacked",
      orientation: "vertical",
    });

    const config = configFor(view);
    const scales = config.options!.scales as Record<string, { stacked?: boolean }>;
    assert.equal(scales.x.stacked, true);
    assert.equal(scales.y.stacked, true);
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
