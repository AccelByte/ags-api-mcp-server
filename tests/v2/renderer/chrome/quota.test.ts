import assert from "node:assert/strict";
import { describe, test } from "node:test";

import "../jsdom.js";
import {
  quotaChrome,
  type QuotaSlice,
} from "../../../../src/v2/renderer/chrome/chromes/quota.js";
import { buildChromeContext } from "../../../../src/v2/renderer/chrome/context.js";
import { createFrame, attachEffect } from "../../../../src/v2/renderer/chrome/frame.js";

const USAGE = {
  monthly: { used_usd: 1.5, limit_usd: 10, period: "2026-06" },
  lifetime: { used_usd: 3, limit_usd: null },
};

describe("quota chrome — eligibility + render", () => {
  test("eligible in the dashboard; carries usage + namespace", () => {
    const slice = quotaChrome.select(
      buildChromeContext({
        container: "dashboard",
        usage: USAGE,
        namespace: "studioalpha",
      }),
    );
    assert.deepEqual(slice, { usage: USAGE, namespace: "studioalpha" });
  });

  test("not shown outside the dashboard", () => {
    assert.equal(
      quotaChrome.select(buildChromeContext({ container: "standalone" })),
      null,
    );
    assert.equal(
      quotaChrome.select(buildChromeContext({ container: "dashboard-card" })),
      null,
    );
  });

  test("renders the usage meter when usage is present", () => {
    const bar = quotaChrome.render({ usage: USAGE });
    assert.equal(bar.className, "renderer-usage-bar");
    assert.match(bar.textContent ?? "", /Monthly/);
    assert.match(bar.textContent ?? "", /\$1\.50 \/ \$10\.00/);
  });

  test("renders 'Usage unavailable' when usage is missing", () => {
    const bar = quotaChrome.render({ usage: undefined });
    assert.match(bar.textContent ?? "", /Usage unavailable/);
  });

  test("the effect host re-renders the bar in place (drives session.quotaUpdate)", () => {
    // Mirrors the dashboard wiring: mount the bar, capture its host, then push a
    // new usage snapshot through host.update — the bar swaps in place.
    const root = document.createElement("div");
    const frame = createFrame(root);
    const slice: QuotaSlice = { usage: undefined, namespace: "n" };
    const bar = quotaChrome.render(slice);
    frame.body.append(bar);
    const host = attachEffect(quotaChrome, slice, bar, frame);

    assert.match(frame.body.querySelector(".renderer-usage-bar")?.textContent ?? "", /unavailable/);
    host.update({ ...slice, usage: USAGE });
    assert.match(frame.body.querySelector(".renderer-usage-bar")?.textContent ?? "", /Monthly/);
    assert.equal(frame.body.querySelectorAll(".renderer-usage-bar").length, 1);

    // After dispose, updates no-op.
    frame.dispose();
    host.update({ ...slice, usage: undefined });
    assert.match(frame.body.querySelector(".renderer-usage-bar")?.textContent ?? "", /Monthly/);
  });
});
