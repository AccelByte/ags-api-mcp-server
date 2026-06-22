import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { buildChromeContext } from "../../../../src/v2/renderer/chrome/context.js";

describe("buildChromeContext", () => {
  test("fills core defaults and a facade fragment for empty input", () => {
    const ctx = buildChromeContext({});
    assert.equal(ctx.core.container, "standalone");
    assert.equal(ctx.core.renderType, "");
    assert.deepEqual(ctx.core.permissions, {});
    assert.equal(ctx.core.pin, undefined);
    assert.equal(ctx.provider.kind, "facade"); // absent dataSource ⇒ facade
    assert.deepEqual(ctx.render.options, {});
    assert.deepEqual(ctx.surface, {});
  });

  test("dataSource 'direct' yields a non-refreshable snapshot fragment", () => {
    const ctx = buildChromeContext({ dataSource: "direct" });
    assert.equal(ctx.provider.kind, "direct");
    assert.equal(ctx.provider.canRefresh, false);
  });

  test("a facade fragment carries sql + stats when provided", () => {
    const ctx = buildChromeContext({
      sql: "SELECT 1",
      stats: { data_scanned_bytes: 5 },
    });
    assert.equal(ctx.provider.kind, "facade");
    if (ctx.provider.kind === "facade") {
      assert.equal(ctx.provider.canRefresh, true);
      assert.equal(ctx.provider.sql, "SELECT 1");
      assert.deepEqual(ctx.provider.stats, { data_scanned_bytes: 5 });
    }
  });

  test("passes core / render / surface fields through", () => {
    const ctx = buildChromeContext({
      container: "dashboard-card",
      renderType: "bar",
      permissions: { canManagePins: true },
      pin: { pinId: "p1" },
      title: "T",
      renderTool: "render_bar_chart",
      options: { x: "a" },
      interactive: true,
      pinCount: 2,
      namespace: "ns",
    });
    assert.equal(ctx.core.container, "dashboard-card");
    assert.equal(ctx.core.renderType, "bar");
    assert.deepEqual(ctx.core.permissions, { canManagePins: true });
    assert.deepEqual(ctx.core.pin, { pinId: "p1" });
    assert.equal(ctx.render.title, "T");
    assert.equal(ctx.render.renderTool, "render_bar_chart");
    assert.deepEqual(ctx.render.options, { x: "a" });
    assert.equal(ctx.surface.interactive, true);
    assert.equal(ctx.surface.pinCount, 2);
    assert.equal(ctx.surface.namespace, "ns");
  });
});
