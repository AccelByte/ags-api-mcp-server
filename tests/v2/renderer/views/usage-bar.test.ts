import assert from "node:assert/strict";
import { describe, test } from "node:test";

import "../jsdom.js";
import { buildUsageBar } from "../../../../src/v2/renderer/views/usage-bar.js";

describe("buildUsageBar", () => {
  test("marks the fill 'over' and clamps width when usage meets/exceeds the limit", () => {
    const bar = buildUsageBar({
      monthly: { used_usd: 12, limit_usd: 10, period: "2026-06" },
    });
    const fill = bar.querySelector<HTMLElement>(".renderer-usage-fill");
    assert.ok(fill, "expected a fill bar");
    assert.equal(fill.dataset.state, "over");
    assert.match(fill.style.width, /^100(\.0)?%$/); // clamped to 100% (jsdom drops the .0)
  });

  test("renders a Lifetime cell; a null limit shows used-only with no track", () => {
    const bar = buildUsageBar({ lifetime: { used_usd: 3, limit_usd: null } });
    assert.match(bar.textContent ?? "", /Lifetime/);
    assert.match(bar.textContent ?? "", /\$3\.00/);
    assert.equal(bar.querySelector(".renderer-usage-track"), null);
  });

  test("appends a projected run-rate suffix when present and positive", () => {
    const bar = buildUsageBar({
      monthly: {
        used_usd: 1.5,
        limit_usd: 10,
        period: "2026-06",
        projected_run_rate_usd: 8,
      },
    });
    assert.match(bar.textContent ?? "", /projected \$8\.00/);
  });

  test("round2 shows an em dash for a missing used value", () => {
    const bar = buildUsageBar({
      monthly: { used_usd: undefined, limit_usd: 10, period: "2026-06" },
    });
    assert.match(bar.textContent ?? "", /— \/ \$10\.00/);
  });

  test("renders 'Usage unavailable' for empty or absent usage", () => {
    assert.match(
      buildUsageBar(undefined).textContent ?? "",
      /Usage unavailable/,
    );
    assert.match(buildUsageBar({}).textContent ?? "", /Usage unavailable/);
  });
});
