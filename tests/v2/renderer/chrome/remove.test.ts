import assert from "node:assert/strict";
import { describe, test } from "node:test";

import "../jsdom.js";
import {
  removeChrome,
  type RemoveSlice,
} from "../../../../src/v2/renderer/chrome/chromes/remove.js";
import { buildChromeContext } from "../../../../src/v2/renderer/chrome/context.js";
import { resolve } from "../../../../src/v2/renderer/chrome/resolve.js";

type Input = Parameters<typeof buildChromeContext>[0];

function eligible(): Input {
  return {
    container: "dashboard-card",
    interactive: true,
    pin: { pinId: "p1" },
  };
}

function selectRemove(overrides: Partial<Input>): RemoveSlice | null {
  return removeChrome.select(buildChromeContext({ ...eligible(), ...overrides }));
}

describe("remove chrome — eligibility truth table", () => {
  test("eligible: dashboard-card + interactive + pin ⇒ slice", () => {
    assert.deepEqual(selectRemove({}), { pinId: "p1" });
  });

  test("not shown outside a dashboard card", () => {
    assert.equal(selectRemove({ container: "standalone" }), null);
    assert.equal(selectRemove({ container: "dashboard" }), null);
  });

  test("not shown when not interactive (inline display)", () => {
    assert.equal(selectRemove({ interactive: false }), null);
  });

  test("not shown without a pin identity", () => {
    assert.equal(selectRemove({ pin: undefined }), null);
  });
});

describe("remove chrome — presentation + intent", () => {
  test("renders the legacy Remove menu item", () => {
    const button = removeChrome.render({ pinId: "p1" });
    assert.equal(
      button.className,
      "renderer-dashboard-card-menu-item renderer-dashboard-card-remove",
    );
    assert.equal(button.getAttribute("role"), "menuitem");
    assert.ok(button.querySelector("svg"), "expected the trash icon");
    assert.equal(button.querySelector("span")?.textContent, "Remove");
  });

  test("intent forwards the pin id", () => {
    assert.deepEqual(removeChrome.intent?.({ pinId: "p1" }), {
      type: "remove",
      payload: { pin_id: "p1" },
    });
  });

  test("resolves into the overflow region (the kebab)", () => {
    const resolved = resolve([removeChrome], buildChromeContext(eligible()));
    assert.equal(resolved.overflow.length, 1);
    assert.equal(resolved.overflow[0]?.chrome.id, "remove");
  });
});
