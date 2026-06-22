import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";

import "../jsdom.js";
import {
  CHART_TYPE_TO_RENDER_TOOL,
  clearDashboardMode,
  maybeAddPinAffordance,
  renderDashboard,
  type DashboardHostBridge,
} from "../../../../src/v2/renderer/views/dashboard.js";
import {
  DashboardOutputSchema,
  PIN_RENDER_TOOLS,
  type DashboardData,
  type DashboardOutput,
} from "../../../../src/v2/shared/render-schemas.js";

function root(): HTMLElement {
  const el = document.getElementById("app");
  assert.ok(el, "expected #app root");
  el.replaceChildren();
  return el;
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function metaPayload(): DashboardOutput {
  return DashboardOutputSchema.parse({
    chart_type: "dashboard",
    namespace: "studioalpha",
    usage: {
      monthly: { used_usd: 1.5, limit_usd: 10, period: "2026-06" },
      lifetime: { used_usd: 3, limit_usd: null },
    },
    pins: [
      {
        pin_id: "p1",
        title: "Headline metric",
        render_tool: "render_metric",
        render_options: { value: "v" },
      },
      {
        pin_id: "p2",
        title: "Stale pin",
        render_tool: "render_table",
        render_options: {},
      },
    ],
  });
}

/** A bridge whose load_dashboard returns `loadResult` (or throws when null). */
function makeBridge(
  loadResult: DashboardData | null,
  calls: Array<{ name: string; args?: Record<string, unknown> }> = [],
): DashboardHostBridge {
  return {
    getHostContext: () => ({
      displayMode: "fullscreen",
      availableDisplayModes: ["inline", "fullscreen"],
      containerDimensions: { height: 600, width: 800 },
    }),
    getHostCapabilities: () => ({ serverTools: {} }),
    async callServerTool({ name, arguments: args }) {
      calls.push({ name, args });
      if (name === "load_dashboard") {
        if (!loadResult) {
          throw new Error("server unreachable");
        }
        return { structuredContent: loadResult };
      }
      return { structuredContent: { namespace: "studioalpha", pins: [] } };
    },
    async requestDisplayMode({ mode }) {
      return { mode };
    },
    async updateModelContext() {
      return {};
    },
  };
}

afterEach(() => {
  clearDashboardMode();
});

describe("dashboard view", () => {
  test("paints the usage header and self-loads card bodies via load_dashboard", async () => {
    const el = root();
    const calls: Array<{ name: string; args?: Record<string, unknown> }> = [];
    const loaded: DashboardData = {
      namespace: "studioalpha",
      usage: { monthly: { used_usd: 1.5, limit_usd: 10, period: "2026-06" } },
      pins: [
        {
          pin_id: "p1",
          title: "Headline metric",
          render_tool: "render_metric",
          render_options: { value: "v" },
          render_output: {
            chart_type: "metric",
            data: { columns: [{ name: "v", type: "bigint" }], rows: [["42"]] },
            options: { value: "v" },
          },
        },
        {
          pin_id: "p2",
          title: "Stale pin",
          render_tool: "render_table",
          render_options: {},
          stale: true,
        },
      ],
    };

    renderDashboard(el, metaPayload(), makeBridge(loaded, calls), "fullscreen");
    await flush();

    // Self-load happened (§8A.1).
    assert.ok(
      calls.some((c) => c.name === "load_dashboard"),
      "expected a load_dashboard self-call",
    );
    // Usage header rendered.
    assert.match(el.textContent ?? "", /Monthly/);
    // Two cards rendered.
    assert.equal(el.querySelectorAll(".renderer-dashboard-card").length, 2);
    // Metric card resolved to its value.
    assert.match(el.textContent ?? "", /42/);
    // Stale card shows a Refresh prompt, not an error.
    const staleStatus = el.querySelector(
      '.renderer-dashboard-card[data-pin-id="p2"] .renderer-dashboard-card-status',
    );
    assert.equal(staleStatus?.getAttribute("data-state"), "stale");
    assert.match(staleStatus?.textContent ?? "", /Refresh/i);
  });

  test("isolates a poison-pill render_output to its own card (§8A.9)", async () => {
    const el = root();
    const loaded: DashboardData = {
      namespace: "studioalpha",
      pins: [
        {
          pin_id: "p1",
          title: "Good metric",
          render_tool: "render_metric",
          render_options: { value: "v" },
          render_output: {
            chart_type: "metric",
            data: { columns: [{ name: "v", type: "bigint" }], rows: [["7"]] },
            options: { value: "v" },
          },
        },
        {
          pin_id: "p2",
          title: "Hostile pin",
          render_tool: "render_bar_chart",
          render_options: {},
          // Invalid: a bar payload with no data/options fails RenderOutputSchema.
          render_output: { chart_type: "bar" },
        },
      ],
    };

    renderDashboard(el, metaPayload(), makeBridge(loaded), "fullscreen");
    await flush();

    // The good card still rendered — the grid is not blanked.
    assert.match(el.textContent ?? "", /7/);
    // The hostile card shows an inline error, and nothing executed.
    const badStatus = el.querySelector(
      '.renderer-dashboard-card[data-pin-id="p2"] .renderer-dashboard-card-status',
    );
    assert.equal(badStatus?.getAttribute("data-state"), "error");
    assert.equal(el.querySelectorAll(".renderer-dashboard-card").length, 2);
  });

  test("offline-tolerant: keeps the metadata paint and shows a reconnect hint when load fails", async () => {
    const el = root();
    renderDashboard(el, metaPayload(), makeBridge(null), "fullscreen");
    await flush();

    // Cards still present from the metadata paint (no blank wall).
    assert.equal(el.querySelectorAll(".renderer-dashboard-card").length, 2);
    assert.ok(
      el.querySelector(".renderer-dashboard-hint"),
      "expected a reconnect hint",
    );
  });

  test("renders an empty state when there are no pins", async () => {
    const el = root();
    const empty = DashboardOutputSchema.parse({
      chart_type: "dashboard",
      namespace: "studioalpha",
      pins: [],
    });
    renderDashboard(
      el,
      empty,
      makeBridge({ namespace: "studioalpha", pins: [] }),
      "fullscreen",
    );
    await flush();
    assert.ok(el.querySelector(".renderer-dashboard-empty"));
  });

  test("maybeAddPinAffordance adds a Pin button that calls pin_query with the result spec", async () => {
    const el = root();
    // A rendered single result with a header-actions slot + SQL provenance.
    el.innerHTML =
      '<section class="renderer-shell"><div class="renderer-header">' +
      '<div class="renderer-header-actions"></div></div></section>';
    const calls: Array<{ name: string; args?: Record<string, unknown> }> = [];
    const bridge = makeBridge({ namespace: "studioalpha", pins: [] }, calls);

    maybeAddPinAffordance(
      el,
      {
        chart_type: "bar",
        data_source: "facade",
        sql: "SELECT day, rev FROM t",
        title: "Daily revenue",
        options: { x: "day", y: "rev" },
      },
      bridge,
    );

    const button = el.querySelector<HTMLButtonElement>(".renderer-pin-btn");
    assert.ok(button, "expected a Pin button");
    button.click();
    await flush();

    const pinCall = calls.find((c) => c.name === "pin_query");
    assert.ok(pinCall, "expected pin_query to be called");
    assert.equal(pinCall.args?.render_tool, "render_bar_chart");
    assert.equal(pinCall.args?.sql, "SELECT day, rev FROM t");
    assert.deepEqual(pinCall.args?.render_options, { x: "day", y: "rev" });
  });

  test("maybeAddPinAffordance is a no-op without SQL or a server-tool bridge", () => {
    const el = root();
    el.innerHTML =
      '<section class="renderer-shell"><div class="renderer-header">' +
      '<div class="renderer-header-actions"></div></div></section>';
    // No SQL → no button.
    maybeAddPinAffordance(
      el,
      { chart_type: "bar", data_source: "facade", title: "x", options: {} },
      makeBridge({ namespace: "n", pins: [] }),
    );
    assert.equal(el.querySelector(".renderer-pin-btn"), null);
    // No callServerTool → no button.
    maybeAddPinAffordance(
      el,
      { chart_type: "bar", data_source: "facade", sql: "SELECT 1", options: {} },
      {},
    );
    assert.equal(el.querySelector(".renderer-pin-btn"), null);
  });

  test("maybeAddPinAffordance is a no-op for a non-facade result even with SQL", () => {
    const el = root();
    el.innerHTML =
      '<section class="renderer-shell"><div class="renderer-header">' +
      '<div class="renderer-header-actions"></div></div></section>';
    // SQL present but the rows came from a non-facade provider — pinning persists
    // to the Athena facade, so it must not offer to pin a non-facade result.
    maybeAddPinAffordance(
      el,
      {
        chart_type: "bar",
        data_source: "direct",
        sql: "SELECT 1",
        title: "x",
        options: {},
      },
      makeBridge({ namespace: "n", pins: [] }),
    );
    assert.equal(el.querySelector(".renderer-pin-btn"), null);
  });

  test("clearDashboardMode strips the body layout class", async () => {
    const el = root();
    renderDashboard(
      el,
      metaPayload(),
      makeBridge({ namespace: "studioalpha", pins: [] }),
      "fullscreen",
    );
    assert.ok(document.body.classList.contains("renderer-dashboard-mode"));
    clearDashboardMode();
    assert.equal(
      document.body.classList.contains("renderer-dashboard-mode"),
      false,
    );
  });

  test("static pins show a Snapshot badge + an active Refresh that re-renders inline (no server call)", async () => {
    const el = root();
    const calls: Array<{ name: string; args?: Record<string, unknown> }> = [];
    const cols = [
      { name: "sku", type: "string" },
      { name: "revenue", type: "number" },
    ];
    const rows = [
      ["A", "120"],
      ["B", "90"],
    ];
    const staticMeta = DashboardOutputSchema.parse({
      chart_type: "dashboard",
      namespace: "studioalpha",
      pins: [
        {
          pin_id: "s1",
          title: "Revenue by SKU",
          render_tool: "render_table",
          render_options: {},
          data_columns: cols,
          data_rows: rows,
          span: 8,
        },
      ],
    });
    const loaded: DashboardData = {
      namespace: "studioalpha",
      pins: [
        {
          pin_id: "s1",
          title: "Revenue by SKU",
          render_tool: "render_table",
          render_options: {},
          data_columns: cols,
          data_rows: rows,
          span: 8,
          render_output: {
            chart_type: "table",
            data: { columns: cols, rows },
            options: {},
            data_source: "direct",
          },
        },
      ],
    };

    renderDashboard(el, staticMeta, makeBridge(loaded, calls), "fullscreen");
    await flush();

    const card = el.querySelector('.renderer-dashboard-card[data-pin-id="s1"]');
    assert.ok(card, "expected the static card");
    assert.ok(
      card!.querySelector(".renderer-dashboard-card-snapshot"),
      "expected a Snapshot badge",
    );
    // Refresh is present and active (icon button) — even on a snapshot.
    const refresh = card!.querySelector<HTMLButtonElement>(
      ".renderer-dashboard-card-refresh",
    );
    assert.ok(refresh, "expected an active Refresh button on the snapshot");
    // Remove lives behind the kebab menu (present in the DOM, hidden until opened).
    assert.ok(
      card!.querySelector(".renderer-dashboard-card-menu-btn"),
      "expected a kebab menu button",
    );
    assert.ok(
      card!.querySelector(".renderer-dashboard-card-remove"),
      "Remove lives in the kebab menu",
    );
    // The inline rows rendered into the table body.
    assert.match(card!.textContent ?? "", /120/);

    // Clicking Refresh on a snapshot re-renders inline — it must NOT hit the server.
    const before = calls.length;
    refresh!.click();
    await flush();
    assert.equal(
      calls.slice(before).some((c) => c.name === "refresh_pinned_query"),
      false,
      "a snapshot refresh must not call refresh_pinned_query",
    );
    assert.match(card!.textContent ?? "", /120/);
  });

  test("the kebab menu opens to reveal Remove and removes the pin", async () => {
    const el = root();
    const calls: Array<{ name: string; args?: Record<string, unknown> }> = [];
    const cols = [{ name: "sku", type: "string" }];
    const rows = [["A"]];
    const staticMeta = DashboardOutputSchema.parse({
      chart_type: "dashboard",
      namespace: "studioalpha",
      pins: [
        {
          pin_id: "s1",
          title: "Snapshot pin",
          render_tool: "render_table",
          render_options: {},
          data_columns: cols,
          data_rows: rows,
        },
      ],
    });
    const loaded: DashboardData = {
      namespace: "studioalpha",
      pins: [
        {
          pin_id: "s1",
          title: "Snapshot pin",
          render_tool: "render_table",
          render_options: {},
          data_columns: cols,
          data_rows: rows,
          render_output: {
            chart_type: "table",
            data: { columns: cols, rows },
            options: {},
            data_source: "direct",
          },
        },
      ],
    };

    renderDashboard(el, staticMeta, makeBridge(loaded, calls), "fullscreen");
    await flush();

    const menu = el.querySelector<HTMLElement>(".renderer-dashboard-card-menu");
    assert.ok(menu, "expected a kebab menu container");
    assert.equal(menu!.classList.contains("open"), false);
    // Open the menu.
    menu!
      .querySelector<HTMLButtonElement>(".renderer-dashboard-card-menu-btn")!
      .click();
    assert.equal(menu!.classList.contains("open"), true, "menu should open");
    // Remove from inside the menu drops the pin (model-held → local drop).
    menu!
      .querySelector<HTMLButtonElement>(".renderer-dashboard-card-remove")!
      .click();
    await flush();
    assert.equal(
      el.querySelector('.renderer-dashboard-card[data-pin-id="s1"]'),
      null,
      "the pin should be removed",
    );
  });

  test("a focus-triggered reload preserves static pins (inline-data round-trip)", async () => {
    const el = root();
    const calls: Array<{ name: string; args?: Record<string, unknown> }> = [];
    const cols = [{ name: "sku", type: "string" }];
    const rows = [["A"]];
    const staticMeta = DashboardOutputSchema.parse({
      chart_type: "dashboard",
      namespace: "studioalpha",
      pins: [
        {
          pin_id: "s1",
          title: "Snapshot pin",
          render_tool: "render_table",
          render_options: {},
          data_columns: cols,
          data_rows: rows,
        },
      ],
    });
    const loaded: DashboardData = {
      namespace: "studioalpha",
      pins: [
        {
          pin_id: "s1",
          title: "Snapshot pin",
          render_tool: "render_table",
          render_options: {},
          data_columns: cols,
          data_rows: rows,
          render_output: {
            chart_type: "table",
            data: { columns: cols, rows },
            options: {},
            data_source: "direct",
          },
        },
      ],
    };

    renderDashboard(el, staticMeta, makeBridge(loaded, calls), "fullscreen");
    await flush();

    // Simulate returning to the view — the widget self-reloads on focus.
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
    document.dispatchEvent(new window.Event("visibilitychange"));
    await flush();

    // The second self-load carried the inline rows back (cardToMeta → pinsToInput).
    const loads = calls.filter((c) => c.name === "load_dashboard");
    assert.ok(loads.length >= 2, "expected a second load on focus");
    const lastPins = (loads[loads.length - 1].args?.pins ?? []) as Array<
      Record<string, unknown>
    >;
    assert.deepEqual(lastPins[0]?.data_rows, rows);
    // Still rendered as a static snapshot — not dropped to a stale card.
    const card = el.querySelector('.renderer-dashboard-card[data-pin-id="s1"]');
    assert.ok(card!.querySelector(".renderer-dashboard-card-snapshot"));
    assert.equal(
      card!.querySelector(".renderer-dashboard-card-status"),
      null,
      "static pin should keep its rendered body, not fall back to a stale status",
    );
  });

  test("fullscreen card gets a grid-column span; compact card does not", async () => {
    const meta = DashboardOutputSchema.parse({
      chart_type: "dashboard",
      namespace: "studioalpha",
      pins: [
        {
          pin_id: "p1",
          title: "Wide",
          render_tool: "render_table",
          render_options: {},
          span: 8,
        },
      ],
    });
    // load_dashboard resolves the pin (here: a stale card) — it stays on the
    // board so the span assertion exercises a loaded card, not just the skeleton.
    const loaded: DashboardData = {
      namespace: "studioalpha",
      pins: [
        {
          pin_id: "p1",
          title: "Wide",
          render_tool: "render_table",
          render_options: {},
          span: 8,
          stale: true,
        },
      ],
    };

    // Fullscreen → span applied as an inline grid-column.
    const elFull = root();
    renderDashboard(elFull, meta, makeBridge(loaded), "fullscreen");
    await flush();
    const wide = elFull.querySelector<HTMLElement>(
      '.renderer-dashboard-card[data-pin-id="p1"]',
    );
    assert.equal(wide?.style.gridColumn, "span 8");

    // Compact → no inline span (single-column layout owns width).
    clearDashboardMode();
    const elCompact = root();
    renderDashboard(elCompact, meta, makeBridge(loaded), "inline");
    await flush();
    const compact = elCompact.querySelector<HTMLElement>(
      '.renderer-dashboard-card[data-pin-id="p1"]',
    );
    assert.equal(compact?.style.gridColumn, "");
  });
});

describe("refresh-all (container chrome)", () => {
  const originalConfirm = globalThis.window?.confirm;
  afterEach(() => {
    if (globalThis.window) {
      globalThis.window.confirm = originalConfirm as typeof window.confirm;
    }
  });

  function renderFullscreen(
    calls: Array<{ name: string; args?: Record<string, unknown> }>,
    displayMode: "inline" | "fullscreen" = "fullscreen",
  ): HTMLElement {
    const el = root();
    // load_dashboard must return the same pins as the metadata, or applyLoadedData
    // replaces session.pins (with []) and the header repaints without refresh-all.
    const loaded: DashboardData = {
      namespace: "studioalpha",
      pins: [
        {
          pin_id: "p1",
          title: "Headline metric",
          render_tool: "render_metric",
          render_options: { value: "v" },
          render_output: {
            chart_type: "metric",
            data: { columns: [{ name: "v", type: "bigint" }], rows: [["42"]] },
            options: { value: "v" },
          },
        },
        {
          pin_id: "p2",
          title: "Stale pin",
          render_tool: "render_table",
          render_options: {},
          stale: true,
        },
      ],
    };
    renderDashboard(el, metaPayload(), makeBridge(loaded, calls), displayMode);
    return el;
  }

  test("button shows in fullscreen with pins; confirm → calls refresh_all_pinned", async () => {
    const calls: Array<{ name: string; args?: Record<string, unknown> }> = [];
    const el = renderFullscreen(calls);
    await flush();

    const button = el.querySelector<HTMLButtonElement>(
      ".renderer-dashboard-refresh-all",
    );
    assert.ok(button, "expected a Refresh all button in fullscreen with pins");

    window.confirm = () => true;
    const before = calls.length;
    button.click();
    await flush();
    assert.ok(
      calls.slice(before).some((c) => c.name === "refresh_all_pinned"),
      "confirming should call refresh_all_pinned",
    );
  });

  test("declining the cost confirm does not call refresh_all_pinned", async () => {
    const calls: Array<{ name: string; args?: Record<string, unknown> }> = [];
    const el = renderFullscreen(calls);
    await flush();

    window.confirm = () => false;
    const before = calls.length;
    el.querySelector<HTMLButtonElement>(".renderer-dashboard-refresh-all")?.click();
    await flush();
    assert.equal(
      calls.slice(before).some((c) => c.name === "refresh_all_pinned"),
      false,
      "declining must not call refresh_all_pinned",
    );
  });

  test("button is absent in inline (non-interactive) display", async () => {
    const calls: Array<{ name: string; args?: Record<string, unknown> }> = [];
    const el = renderFullscreen(calls, "inline");
    await flush();
    assert.equal(el.querySelector(".renderer-dashboard-refresh-all"), null);
  });
});

describe("sync chrome (reload on refocus)", () => {
  test("a visibilitychange→visible reloads the board via load_dashboard", async () => {
    const el = root();
    const calls: Array<{ name: string; args?: Record<string, unknown> }> = [];
    const loaded: DashboardData = { namespace: "studioalpha", pins: [] };
    renderDashboard(el, metaPayload(), makeBridge(loaded, calls), "fullscreen");
    await flush();

    // The behavior-only sync marker is mounted in the dashboard header.
    assert.ok(
      el.querySelector(".renderer-dashboard-sync"),
      "expected the sync marker in the dashboard header",
    );

    const before = calls.filter((c) => c.name === "load_dashboard").length;
    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      configurable: true,
    });
    document.dispatchEvent(new CustomEvent("visibilitychange"));
    await flush();

    const after = calls.filter((c) => c.name === "load_dashboard").length;
    assert.ok(after > before, "becoming visible should re-run load_dashboard");
  });

  test("re-rendering a dashboard disposes the prior focus listener (no scope leak)", async () => {
    const el = root();
    const calls: Array<{ name: string; args?: Record<string, unknown> }> = [];
    const loaded: DashboardData = { namespace: "studioalpha", pins: [] };
    let liveVis = 0;
    const realAdd = document.addEventListener.bind(document);
    const realRemove = document.removeEventListener.bind(document);
    const countingAdd: typeof document.addEventListener = (
      type,
      listener,
      options,
    ) => {
      if (type === "visibilitychange") liveVis += 1;
      realAdd(type, listener, options);
    };
    const countingRemove: typeof document.removeEventListener = (
      type,
      listener,
      options,
    ) => {
      if (type === "visibilitychange") liveVis -= 1;
      realRemove(type, listener, options);
    };
    document.addEventListener = countingAdd;
    document.removeEventListener = countingRemove;
    try {
      renderDashboard(
        el,
        metaPayload(),
        makeBridge(loaded, calls),
        "fullscreen",
      );
      await flush();
      // Dashboard→dashboard re-render (the path that bypasses clearDashboardMode
      // in app-shell): the prior scope must be disposed, not orphaned.
      renderDashboard(
        el,
        metaPayload(),
        makeBridge(loaded, calls),
        "fullscreen",
      );
      await flush();
      // Exactly one focus listener is live — the first render's was removed, not
      // stacked. Before the fix this was 2 (a leak that re-fired loadData).
      assert.equal(liveVis, 1);
    } finally {
      document.addEventListener = realAdd;
      document.removeEventListener = realRemove;
    }
  });
});

describe("card remove (kebab / overflow chrome)", () => {
  const liveLoaded: DashboardData = {
    namespace: "studioalpha",
    pins: [
      {
        pin_id: "p1",
        title: "Headline metric",
        render_tool: "render_metric",
        render_options: { value: "v" },
        render_output: {
          chart_type: "metric",
          data: { columns: [{ name: "v", type: "bigint" }], rows: [["42"]] },
          options: { value: "v" },
        },
      },
    ],
  };

  test("clicking Remove calls unpin_query for the pin", async () => {
    const el = root();
    const calls: Array<{ name: string; args?: Record<string, unknown> }> = [];
    renderDashboard(el, metaPayload(), makeBridge(liveLoaded, calls), "fullscreen");
    await flush();

    const removeBtn = el.querySelector<HTMLButtonElement>(
      ".renderer-dashboard-card-remove",
    );
    assert.ok(removeBtn, "expected a Remove item in the kebab (fullscreen)");
    const before = calls.length;
    removeBtn.click();
    await flush();

    const unpin = calls.slice(before).find((c) => c.name === "unpin_query");
    assert.ok(unpin, "Remove should call unpin_query");
    assert.equal(unpin.args?.pin_id, "p1");
  });

  test("a non-NOT_FOUND store error keeps the card (no phantom delete)", async () => {
    const el = root();
    const calls: Array<{ name: string; args?: Record<string, unknown> }> = [];
    const bridge: DashboardHostBridge = {
      getHostContext: () => ({
        displayMode: "fullscreen",
        availableDisplayModes: ["inline", "fullscreen"],
        containerDimensions: { height: 600, width: 800 },
      }),
      getHostCapabilities: () => ({ serverTools: {} }),
      async callServerTool({ name, arguments: args }) {
        calls.push({ name, args });
        if (name === "load_dashboard") {
          return { structuredContent: liveLoaded };
        }
        if (name === "unpin_query") {
          return {
            isError: true,
            _meta: { code: "PINNED_QUERIES_UNAVAILABLE" },
            content: [{ type: "text", text: "pins not enabled" }],
          };
        }
        return { structuredContent: { namespace: "studioalpha", pins: [] } };
      },
      async requestDisplayMode({ mode }) {
        return { mode };
      },
      async updateModelContext() {
        return {};
      },
    };
    renderDashboard(el, metaPayload(), bridge, "fullscreen");
    await flush();

    const removeBtn = el.querySelector<HTMLButtonElement>(
      ".renderer-dashboard-card-remove",
    );
    assert.ok(removeBtn, "expected a Remove item");
    removeBtn.click();
    await flush();

    // A store error other than NOT_FOUND means the unpin did NOT happen — the
    // card must stay; dropping it would be a phantom delete that reappears on
    // the next store-backed reload.
    assert.ok(
      el.querySelector('.renderer-dashboard-card[data-pin-id="p1"]'),
      "the card must remain after a failed (non-NOT_FOUND) remove",
    );
  });

  test("Remove item is absent in inline (non-interactive) display", async () => {
    const el = root();
    renderDashboard(el, metaPayload(), makeBridge(liveLoaded), "inline");
    await flush();
    assert.equal(el.querySelector(".renderer-dashboard-card-remove"), null);
  });
});

describe("static pin card chrome (regression)", () => {
  test("a static (snapshot) pin shows no 'source: inline' in its card tools", async () => {
    // Regression: a static pin sets the card context's provider to `direct`, which
    // makes the footer `source-note` eligible. The card tools must mount only the
    // header regions — footer notes belong to the card BODY, not the tool row.
    const el = root();
    const calls: Array<{ name: string; args?: Record<string, unknown> }> = [];
    const staticPin = {
      pin_id: "s1",
      title: "Snapshot",
      render_tool: "render_table" as const,
      render_options: {},
      data_columns: [{ name: "a", type: "varchar" }],
      data_rows: [["x"]],
    };
    const payload = DashboardOutputSchema.parse({
      chart_type: "dashboard",
      namespace: "studioalpha",
      pins: [staticPin],
    });
    const loaded: DashboardData = { namespace: "studioalpha", pins: [staticPin] };
    renderDashboard(el, payload, makeBridge(loaded, calls), "fullscreen");
    await flush();

    const tools = el.querySelector(".renderer-dashboard-card-tools");
    assert.ok(tools, "expected card tools in fullscreen");
    assert.equal(
      tools.querySelector(".renderer-footer-source"),
      null,
      "'source: inline' must not leak into the card tools (top-right)",
    );
  });
});

describe("CHART_TYPE_TO_RENDER_TOOL", () => {
  test("every pinnable render tool has a chart_type → render_tool reverse mapping", () => {
    // The Pin affordance maps a rendered chart_type back to its render tool. A
    // new pinnable chart missing from this map would silently lose its Pin
    // button, so assert the map covers the whole pinnable set.
    const mapped = new Set(Object.values(CHART_TYPE_TO_RENDER_TOOL));
    for (const tool of PIN_RENDER_TOOLS) {
      assert.ok(mapped.has(tool), `no chart_type maps to ${tool}`);
    }
  });
});
