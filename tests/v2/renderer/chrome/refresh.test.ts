import assert from "node:assert/strict";
import { describe, test } from "node:test";

import "../jsdom.js";
import {
  refreshChrome,
  type RefreshSlice,
} from "../../../../src/v2/renderer/chrome/chromes/refresh.js";
import { buildChromeContext } from "../../../../src/v2/renderer/chrome/context.js";

type Input = Parameters<typeof buildChromeContext>[0];

function selectRefresh(overrides: Partial<Input>): RefreshSlice | null {
  return refreshChrome.select(
    buildChromeContext({
      container: "dashboard-card",
      interactive: true,
      dataSource: "facade",
      ...overrides,
    }),
  );
}

describe("refresh chrome — eligibility truth table", () => {
  test("live (facade) card ⇒ shown, canRefresh true", () => {
    assert.deepEqual(selectRefresh({}), { canRefresh: true });
  });

  test("static (direct) card ⇒ shown, canRefresh false (re-renders locally)", () => {
    assert.deepEqual(selectRefresh({ dataSource: "direct" }), {
      canRefresh: false,
    });
  });

  test("not shown outside a dashboard card", () => {
    assert.equal(selectRefresh({ container: "standalone" }), null);
    assert.equal(selectRefresh({ container: "dashboard" }), null);
  });

  test("not shown when not interactive (inline display)", () => {
    assert.equal(selectRefresh({ interactive: false }), null);
  });
});

describe("refresh chrome — presentation", () => {
  test("renders the legacy refresh icon button", () => {
    const button = refreshChrome.render({ canRefresh: true });
    assert.equal(
      button.className,
      "renderer-dashboard-iconbtn renderer-dashboard-card-refresh",
    );
    assert.equal(button.getAttribute("title"), "Refresh");
    assert.equal(button.getAttribute("aria-label"), "Refresh");
    assert.ok(button.querySelector("svg"), "expected the refresh icon");
  });

  test("has no single intent — dual-mode is wired by the card", () => {
    assert.equal(refreshChrome.intent, undefined);
  });
});
