import assert from "node:assert/strict";
import { describe, test } from "node:test";

import "../jsdom.js";
import { syncChrome } from "../../../../src/v2/renderer/chrome/chromes/sync.js";
import { buildChromeContext } from "../../../../src/v2/renderer/chrome/context.js";
import { createFrame, attachEffect } from "../../../../src/v2/renderer/chrome/frame.js";

function setVisibility(state: "visible" | "hidden"): void {
  Object.defineProperty(document, "visibilityState", {
    value: state,
    configurable: true,
  });
}

describe("sync chrome — eligibility + render", () => {
  test("eligible only in the dashboard container", () => {
    assert.equal(
      syncChrome.select(buildChromeContext({ container: "dashboard" })),
      true,
    );
    assert.equal(
      syncChrome.select(buildChromeContext({ container: "standalone" })),
      null,
    );
    assert.equal(
      syncChrome.select(buildChromeContext({ container: "dashboard-card" })),
      null,
    );
  });

  test("renders a hidden marker (behavior-only chrome)", () => {
    const el = syncChrome.render(true);
    assert.equal(el.className, "renderer-dashboard-sync");
    assert.equal(el.hidden, true);
  });
});

describe("sync chrome — effect (visibilitychange → reload)", () => {
  test("dispatches 'reload' when the tab becomes visible, and cleans up on dispose", () => {
    const calls: string[] = [];
    const frame = createFrame(document.createElement("div"));
    const marker = syncChrome.render(true);
    frame.body.append(marker);
    const bind = async (type: string) => {
      calls.push(type);
      return {};
    };
    attachEffect(syncChrome, true, marker, frame, bind);

    setVisibility("visible");
    document.dispatchEvent(new CustomEvent("visibilitychange"));
    assert.deepEqual(calls, ["reload"]);

    // After dispose the listener is gone — no further dispatches.
    frame.dispose();
    document.dispatchEvent(new CustomEvent("visibilitychange"));
    assert.deepEqual(calls, ["reload"]);
  });

  test("does not dispatch while hidden", () => {
    const calls: string[] = [];
    const frame = createFrame(document.createElement("div"));
    const bind = async (type: string) => {
      calls.push(type);
      return {};
    };
    attachEffect(syncChrome, true, syncChrome.render(true), frame, bind);

    setVisibility("hidden");
    document.dispatchEvent(new CustomEvent("visibilitychange"));
    assert.deepEqual(calls, []);
    frame.dispose();
  });
});
