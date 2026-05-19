import assert from "node:assert/strict";
import { describe, test } from "node:test";

import "../../jsdom.js";
import { renderFunnel } from "../../../../../src/v2/renderer/views/charts/funnel.js";
import { toRows } from "../../../../../src/v2/renderer/views/coerce.js";

function makeRows(): ReturnType<typeof toRows> {
  return toRows(
    [
      { name: "stage", type: "varchar" },
      { name: "value", type: "bigint" },
    ],
    [
      ["Visited", "1000"],
      ["Signed up", "450"],
      ["Activated", "200"],
    ],
  );
}

describe("renderFunnel", () => {
  test("stages carry --share as a unitless ratio between 0 and 1", () => {
    const chart = renderFunnel(makeRows(), {
      stage: "stage",
      value: "value",
      orientation: "vertical",
      show_conversion: false,
    }) as HTMLElement;

    const stages = chart.querySelectorAll(".funnel-stage");
    assert.ok(stages.length >= 1);

    for (const stage of stages) {
      const share = (stage as HTMLElement).style.getPropertyValue("--share");
      assert.ok(share, "expected --share custom property on stage");
      assert.match(share.trim(), /^(0\.\d+|1\.0+|1)$/);
    }
  });

  test("no inline element.style beyond the --share custom property", () => {
    const chart = renderFunnel(makeRows(), {
      stage: "stage",
      value: "value",
      orientation: "horizontal",
      show_conversion: false,
    }) as HTMLElement;

    assert.equal(chart.getAttribute("style"), null);

    const probe = chart.querySelectorAll(
      ".funnel-label, .funnel-label-title, .funnel-label-meta, .funnel-bar, .funnel-bar-fill",
    );
    for (const element of probe) {
      assert.equal(
        (element as HTMLElement).getAttribute("style"),
        null,
        `element ${element.className} should not have inline styles`,
      );
    }

    const stages = chart.querySelectorAll(".funnel-stage");
    for (const stage of stages) {
      const style = (stage as HTMLElement).style;
      for (let index = 0; index < style.length; index++) {
        const prop = style.item(index);
        assert.equal(
          prop,
          "--share",
          `stage should only set --share, found ${prop}`,
        );
      }
    }
  });

  test("renders .delta-indicator--pill when show_conversion is on", () => {
    const chart = renderFunnel(makeRows(), {
      stage: "stage",
      value: "value",
      orientation: "vertical",
      show_conversion: true,
    }) as HTMLElement;

    const pills = chart.querySelectorAll(".delta-indicator.delta-indicator--pill");
    // First stage has no previous; expect (stages - 1) pills.
    assert.equal(pills.length, 2);
    for (const pill of pills) {
      const direction = (pill as HTMLElement).dataset.direction;
      assert.ok(
        direction === "up" || direction === "down",
        "pill should have data-direction",
      );
    }
  });
});
