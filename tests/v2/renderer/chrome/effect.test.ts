import assert from "node:assert/strict";
import { describe, test } from "node:test";

import "../jsdom.js";
import {
  createFrame,
  createMountScope,
  mountResolved,
} from "../../../../src/v2/renderer/chrome/frame.js";
import { resolve } from "../../../../src/v2/renderer/chrome/resolve.js";
import { buildChromeContext } from "../../../../src/v2/renderer/chrome/context.js";
import {
  defineChrome,
  type EffectHost,
} from "../../../../src/v2/renderer/chrome/types.js";

describe("chrome effects (action hooks)", () => {
  test("effect runs on mount; dispatch→bind; update swaps in place; dispose cleans up", async () => {
    const events: string[] = [];
    const calls: Array<{ type: string; payload?: Record<string, unknown> }> = [];
    let host: EffectHost | undefined;

    const chrome = defineChrome<{ label: string }>({
      id: "fx",
      scope: "item",
      region: "footer-end",
      priority: 10,
      select: () => ({ label: "v0" }),
      render: (slice) => {
        const el = document.createElement("span");
        el.className = "fx";
        el.textContent = slice.label;
        return el;
      },
      effect: (slice, h) => {
        host = h;
        events.push(`mount:${slice.label}`);
        return () => events.push("cleanup");
      },
    });

    const root = document.createElement("div");
    const frame = createFrame(root);
    const bind = async (
      type: string,
      payload?: Record<string, unknown>,
    ) => {
      calls.push({ type, payload });
      return { isError: false, structuredContent: { ok: 1 } };
    };

    mountResolved(frame, resolve([chrome], buildChromeContext({})), bind);

    // effect ran once on mount, and the element is in the footer
    assert.deepEqual(events, ["mount:v0"]);
    assert.equal(frame.footer.querySelector(".fx")?.textContent, "v0");
    assert.ok(host, "effect should receive a host");

    // dispatch routes through bind and returns its result
    const result = await host.dispatch({ type: "do", payload: { a: 1 } });
    assert.deepEqual(calls, [{ type: "do", payload: { a: 1 } }]);
    assert.deepEqual(result, { isError: false, structuredContent: { ok: 1 } });

    // update re-renders in place (replaces, does not append)
    host.update({ label: "v1" });
    assert.equal(frame.footer.querySelector(".fx")?.textContent, "v1");
    assert.equal(frame.footer.querySelectorAll(".fx").length, 1);

    // dispose runs the cleanup once
    assert.equal(frame.isDisposed(), false);
    frame.dispose();
    assert.equal(frame.isDisposed(), true);
    assert.deepEqual(events, ["mount:v0", "cleanup"]);

    // update is a no-op after dispose (no detached re-render)
    host.update({ label: "v2" });
    assert.equal(frame.footer.querySelector(".fx")?.textContent, "v1");
  });

  test("dispatch rejects when no binder is wired", async () => {
    let host: EffectHost | undefined;
    const chrome = defineChrome<true>({
      id: "fx2",
      scope: "item",
      region: "footer-end",
      priority: 10,
      select: () => true,
      render: () => document.createElement("span"),
      effect: (_slice, h) => {
        host = h;
      },
    });
    const frame = createFrame(document.createElement("div"));
    mountResolved(frame, resolve([chrome], buildChromeContext({}))); // no bind
    assert.ok(host);
    await assert.rejects(host.dispatch({ type: "x" }), /No binder/);
  });

  test("dispose is idempotent; addDispose after dispose runs immediately", () => {
    const frame = createFrame(document.createElement("div"));
    let count = 0;
    frame.addDispose(() => {
      count += 1;
    });
    frame.dispose();
    frame.dispose(); // idempotent — cleanup not run twice
    assert.equal(count, 1);
    frame.addDispose(() => {
      count += 1;
    }); // late registration runs immediately
    assert.equal(count, 2);
  });

  test("a chrome without an effect mounts and disposes cleanly", () => {
    const chrome = defineChrome<true>({
      id: "plain",
      scope: "item",
      region: "footer-start",
      priority: 10,
      select: () => true,
      render: () => {
        const el = document.createElement("span");
        el.className = "plain";
        return el;
      },
    });
    const frame = createFrame(document.createElement("div"));
    mountResolved(frame, resolve([chrome], buildChromeContext({})));
    assert.ok(frame.footer.querySelector(".plain"));
    frame.dispose(); // no throw, nothing to clean
    assert.equal(frame.isDisposed(), true);
  });

  test("MountScope.dispose runs every disposer even if one throws (reverse order)", () => {
    const order: string[] = [];
    const scope = createMountScope();
    scope.addDispose(() => order.push("a"));
    scope.addDispose(() => {
      order.push("b-throws");
      throw new Error("boom");
    });
    scope.addDispose(() => order.push("c"));
    scope.dispose();
    // Disposers run in reverse registration order, and one throwing does not
    // block the rest.
    assert.deepEqual(order, ["c", "b-throws", "a"]);
    assert.equal(scope.isDisposed(), true);
  });
});
