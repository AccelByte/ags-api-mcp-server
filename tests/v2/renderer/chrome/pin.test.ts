import assert from "node:assert/strict";
import { describe, test } from "node:test";

import "../jsdom.js";
import { pinChrome, type PinSlice } from "../../../../src/v2/renderer/chrome/chromes/pin.js";
import { buildChromeContext } from "../../../../src/v2/renderer/chrome/context.js";
import { resolve } from "../../../../src/v2/renderer/chrome/resolve.js";

/** A fully-eligible pin context: standalone, facade-backed, has SQL + tool + permission. */
function eligibleInput(): Parameters<typeof buildChromeContext>[0] {
  return {
    container: "standalone",
    renderType: "bar",
    dataSource: "facade",
    sql: "SELECT 1",
    title: "Daily revenue",
    options: { x: "day", y: "rev" },
    renderTool: "render_bar_chart",
    permissions: { canManagePins: true },
  };
}

function selectPin(
  overrides: Partial<Parameters<typeof buildChromeContext>[0]>,
): PinSlice | null {
  return pinChrome.select(
    buildChromeContext({ ...eligibleInput(), ...overrides }),
  );
}

describe("pin chrome — eligibility truth table", () => {
  test("eligible: standalone + facade + sql + tool + permission ⇒ slice", () => {
    assert.deepEqual(selectPin({}), {
      title: "Daily revenue",
      sql: "SELECT 1",
      renderTool: "render_bar_chart",
      options: { x: "day", y: "rev" },
    });
  });

  test("title defaults to 'Pinned query' when absent", () => {
    assert.equal(selectPin({ title: undefined })?.title, "Pinned query");
  });

  test("not shown in a dashboard card (item lives standalone only)", () => {
    assert.equal(selectPin({ container: "dashboard-card" }), null);
    assert.equal(selectPin({ container: "dashboard" }), null);
  });

  test("not shown for a direct (snapshot) result, even with SQL", () => {
    assert.equal(selectPin({ dataSource: "direct" }), null);
  });

  test("not shown when the facade result carries no SQL", () => {
    assert.equal(selectPin({ sql: undefined }), null);
  });

  test("not shown when the host cannot manage pins (no callServerTool)", () => {
    assert.equal(selectPin({ permissions: { canManagePins: false } }), null);
  });

  test("not shown when the chart type isn't pinnable (no render tool)", () => {
    assert.equal(selectPin({ renderTool: undefined }), null);
  });
});

describe("pin chrome — presentation + intent", () => {
  test("renders the legacy .renderer-pin-btn", () => {
    const slice = selectPin({});
    assert.notEqual(slice, null);
    const button = pinChrome.render(slice as PinSlice);
    assert.equal(button.className, "renderer-pin-btn");
    assert.equal(button.textContent, "Pin");
    assert.equal(button.getAttribute("title"), "Keep this chart on the dashboard");
  });

  test("intent forwards exactly {title, sql, render_tool, render_options}", () => {
    const slice = selectPin({}) as PinSlice;
    assert.deepEqual(pinChrome.intent?.(slice), {
      type: "pin",
      payload: {
        title: "Daily revenue",
        sql: "SELECT 1",
        render_tool: "render_bar_chart",
        render_options: { x: "day", y: "rev" },
      },
    });
  });

  test("resolve places the pin in the header-end region", () => {
    const resolved = resolve([pinChrome], buildChromeContext(eligibleInput()));
    assert.equal(resolved["header-end"].length, 1);
    assert.equal(resolved["header-end"][0]?.chrome.id, "pin");
  });
});
