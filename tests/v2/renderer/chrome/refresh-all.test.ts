import assert from "node:assert/strict";
import { describe, test } from "node:test";

import "../jsdom.js";
import { refreshAllChrome } from "../../../../src/v2/renderer/chrome/chromes/refresh-all.js";
import { buildChromeContext } from "../../../../src/v2/renderer/chrome/context.js";
import {
  withCostConfirm,
  isCancelled,
  type ToolResult,
} from "../../../../src/v2/renderer/chrome/binder.js";

type Input = Parameters<typeof buildChromeContext>[0];

function eligible(): Input {
  return { container: "dashboard", interactive: true, pinCount: 2 };
}

function selectRefreshAll(overrides: Partial<Input>): true | null {
  return refreshAllChrome.select(buildChromeContext({ ...eligible(), ...overrides }));
}

describe("refresh-all chrome — eligibility truth table", () => {
  test("eligible: dashboard + interactive + has pins", () => {
    assert.equal(selectRefreshAll({}), true);
  });

  test("not shown when not interactive (inline display)", () => {
    assert.equal(selectRefreshAll({ interactive: false }), null);
  });

  test("not shown when there are no pins", () => {
    assert.equal(selectRefreshAll({ pinCount: 0 }), null);
  });

  test("not shown outside the dashboard container", () => {
    assert.equal(selectRefreshAll({ container: "standalone" }), null);
    assert.equal(selectRefreshAll({ container: "dashboard-card" }), null);
  });
});

describe("refresh-all chrome — presentation + intent", () => {
  test("renders the legacy refresh-all icon button", () => {
    const button = refreshAllChrome.render(true);
    assert.equal(
      button.className,
      "renderer-dashboard-iconbtn renderer-dashboard-refresh-all",
    );
    assert.equal(button.getAttribute("title"), "Refresh all");
    assert.equal(button.getAttribute("aria-label"), "Refresh all");
    assert.ok(button.querySelector("svg"), "expected an icon");
  });

  test("intent is a plain refresh-all (no payload)", () => {
    assert.deepEqual(refreshAllChrome.intent?.(true), { type: "refresh-all" });
  });
});

describe("withCostConfirm middleware", () => {
  const ok: ToolResult = { isError: false, structuredContent: { ran: true } };

  test("runs the action only when confirmed", async () => {
    let ran = false;
    const run = withCostConfirm(
      () => true,
      async () => {
        ran = true;
        return ok;
      },
    );
    const result = await run({ a: 1 });
    assert.equal(ran, true);
    assert.equal(isCancelled(result), false);
    assert.deepEqual(result, ok);
  });

  test("short-circuits to Cancelled when declined (action never runs)", async () => {
    let ran = false;
    const run = withCostConfirm(
      () => false,
      async () => {
        ran = true;
        return ok;
      },
    );
    const result = await run({ a: 1 });
    assert.equal(ran, false);
    assert.equal(isCancelled(result), true);
  });
});
