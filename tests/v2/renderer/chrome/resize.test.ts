import assert from "node:assert/strict";
import { describe, test } from "node:test";

import "../jsdom.js";
import { buildChromeContext } from "../../../../src/v2/renderer/chrome/context.js";
import {
  growChrome,
  shrinkChrome,
  type ResizeSlice,
} from "../../../../src/v2/renderer/chrome/chromes/resize.js";
import { resolve } from "../../../../src/v2/renderer/chrome/resolve.js";

type Input = Parameters<typeof buildChromeContext>[0];

// A live (facade) pin: no dataSource ⇒ facade fragment ⇒ canRefresh true.
function eligible(span = 6): Input {
  return {
    container: "dashboard-card",
    interactive: true,
    pin: { pinId: "p1", span },
  };
}

function selectGrow(overrides: Partial<Input>): ResizeSlice | null {
  return growChrome.select(buildChromeContext({ ...eligible(), ...overrides }));
}

describe("resize chromes — eligibility truth table", () => {
  test("eligible: dashboard-card + interactive + live pin ⇒ slice with clamped span", () => {
    assert.deepEqual(selectGrow({}), { pinId: "p1", span: 6 });
  });

  test("not shown outside a dashboard card", () => {
    assert.equal(selectGrow({ container: "standalone" }), null);
    assert.equal(selectGrow({ container: "dashboard" }), null);
  });

  test("not shown when not interactive (inline display)", () => {
    assert.equal(selectGrow({ interactive: false }), null);
  });

  test("not shown without a pin identity", () => {
    assert.equal(selectGrow({ pin: undefined }), null);
  });

  test("not shown for a static/snapshot pin (dataSource=direct ⇒ canRefresh false)", () => {
    // Static pins have no durable row to PATCH — they get no resize control.
    assert.equal(selectGrow({ dataSource: "direct" }), null);
  });

  test("absent span clamps to the default (4)", () => {
    assert.deepEqual(
      growChrome.select(
        buildChromeContext({
          container: "dashboard-card",
          interactive: true,
          pin: { pinId: "p1" },
        }),
      ),
      { pinId: "p1", span: 4 },
    );
  });
});

describe("resize chromes — presentation + bounds", () => {
  test("grow renders an enabled 'Wider' menu item mid-range", () => {
    const button = growChrome.render({ pinId: "p1", span: 6 });
    assert.equal(
      button.className,
      "renderer-dashboard-card-menu-item renderer-dashboard-card-grow",
    );
    assert.equal(button.getAttribute("role"), "menuitem");
    assert.ok(button.querySelector("svg"), "expected the plus icon");
    assert.equal(button.querySelector("span")?.textContent, "Wider");
    assert.equal((button as HTMLButtonElement).disabled, false);
  });

  test("grow is disabled at the 12-col max", () => {
    const button = growChrome.render({ pinId: "p1", span: 12 });
    assert.equal((button as HTMLButtonElement).disabled, true);
    assert.equal(button.getAttribute("aria-disabled"), "true");
  });

  test("shrink renders 'Narrower' and is disabled at the 1-col min", () => {
    const mid = shrinkChrome.render({ pinId: "p1", span: 6 });
    assert.equal(mid.querySelector("span")?.textContent, "Narrower");
    assert.equal((mid as HTMLButtonElement).disabled, false);
    const min = shrinkChrome.render({ pinId: "p1", span: 1 });
    assert.equal((min as HTMLButtonElement).disabled, true);
  });

  test("intents step the span by ±1, clamped at the bounds", () => {
    assert.deepEqual(growChrome.intent?.({ pinId: "p1", span: 6 }), {
      type: "update",
      payload: { pin_id: "p1", span: 7 },
    });
    assert.deepEqual(shrinkChrome.intent?.({ pinId: "p1", span: 6 }), {
      type: "update",
      payload: { pin_id: "p1", span: 5 },
    });
    assert.deepEqual(growChrome.intent?.({ pinId: "p1", span: 12 })?.payload, {
      pin_id: "p1",
      span: 12,
    });
    assert.deepEqual(shrinkChrome.intent?.({ pinId: "p1", span: 1 })?.payload, {
      pin_id: "p1",
      span: 1,
    });
  });

  test("both resolve into the overflow region (the kebab)", () => {
    const resolved = resolve(
      [growChrome, shrinkChrome],
      buildChromeContext(eligible()),
    );
    assert.equal(resolved.overflow.length, 2);
    assert.deepEqual(
      resolved.overflow.map((e) => e.chrome.id).sort(),
      ["grow", "shrink"],
    );
  });
});
