import assert from "node:assert/strict";
import { describe, test } from "node:test";

import "../jsdom.js";
import {
  REGION_ORDER,
  defineChrome,
  type AnyChrome,
  type Region,
} from "../../../../src/v2/renderer/chrome/types.js";
import {
  resolve,
  activeCount,
  type Resolved,
} from "../../../../src/v2/renderer/chrome/resolve.js";
import { buildChromeContext } from "../../../../src/v2/renderer/chrome/context.js";
import {
  FOOTER_NOTE_CHROMES,
  sourceNoteChrome,
  statsNoteChrome,
} from "../../../../src/v2/renderer/chrome/chromes/footer-notes.js";
import { mountResolved, createFrame } from "../../../../src/v2/renderer/chrome/frame.js";
import type { ChromeContext } from "../../../../src/v2/shared/chrome-context.js";

const STANDALONE_FACADE: ChromeContext = {
  core: { container: "standalone", renderType: "bar", permissions: {} },
  provider: { kind: "facade", canRefresh: true },
  render: { options: {} },
  surface: {},
};

/** Active chrome ids, flattened in the frame's canonical region order. */
function activeIds(resolved: Resolved): string[] {
  return REGION_ORDER.flatMap((region) =>
    resolved[region].map((entry) => entry.chrome.id),
  );
}

/** A presentational stub chrome with controllable eligibility. */
function stubChrome(
  id: string,
  region: Region,
  priority: number,
  eligible: boolean,
): AnyChrome {
  return defineChrome<true>({
    id,
    scope: "item",
    region,
    priority,
    select: () => (eligible ? true : null),
    render: () => {
      const el = document.createElement("span");
      el.dataset.id = id;
      return el;
    },
  });
}

describe("resolve — mechanics", () => {
  test("drops chromes whose select returns null", () => {
    const resolved = resolve(
      [
        stubChrome("yes", "footer-start", 10, true),
        stubChrome("no", "footer-start", 20, false),
      ],
      STANDALONE_FACADE,
    );
    assert.deepEqual(activeIds(resolved), ["yes"]);
    assert.equal(activeCount(resolved), 1);
  });

  test("groups by region", () => {
    const resolved = resolve(
      [
        stubChrome("h", "header-end", 10, true),
        stubChrome("f", "footer-end", 10, true),
      ],
      STANDALONE_FACADE,
    );
    assert.deepEqual(
      resolved["header-end"].map((e) => e.chrome.id),
      ["h"],
    );
    assert.deepEqual(
      resolved["footer-end"].map((e) => e.chrome.id),
      ["f"],
    );
  });

  test("orders within a region by priority (ascending)", () => {
    const resolved = resolve(
      [
        stubChrome("late", "footer-start", 30, true),
        stubChrome("early", "footer-start", 10, true),
        stubChrome("mid", "footer-start", 20, true),
      ],
      STANDALONE_FACADE,
    );
    assert.deepEqual(
      resolved["footer-start"].map((e) => e.chrome.id),
      ["early", "mid", "late"],
    );
  });

  test("prefs.hidden removes a chrome (future hide, no-op today)", () => {
    const all = [
      stubChrome("a", "footer-start", 10, true),
      stubChrome("b", "footer-start", 20, true),
    ];
    const resolved = resolve(all, STANDALONE_FACADE, {
      hidden: new Set(["a"]),
    });
    assert.deepEqual(activeIds(resolved), ["b"]);
  });

  test("prefs.order overrides declared priority", () => {
    const all = [
      stubChrome("a", "footer-start", 10, true),
      stubChrome("b", "footer-start", 20, true),
    ];
    const resolved = resolve(all, STANDALONE_FACADE, { order: ["b", "a"] });
    assert.deepEqual(
      resolved["footer-start"].map((e) => e.chrome.id),
      ["b", "a"],
    );
  });

  test("pairs each chrome with the exact slice its select returned", () => {
    const chrome = defineChrome<{ n: number }>({
      id: "slice",
      scope: "item",
      region: "footer-start",
      priority: 10,
      select: () => ({ n: 42 }),
      render: () => document.createElement("span"),
    });
    const resolved = resolve([chrome], STANDALONE_FACADE);
    assert.deepEqual(resolved["footer-start"][0]?.slice, { n: 42 });
  });
});

describe("resolve — footer-note eligibility truth table", () => {
  function ids(input: Parameters<typeof buildChromeContext>[0]): string[] {
    return activeIds(resolve(FOOTER_NOTE_CHROMES, buildChromeContext(input)));
  }

  test("direct provider ⇒ source-note only", () => {
    assert.deepEqual(ids({ dataSource: "direct" }), ["source-note"]);
  });

  test("direct provider ignores any stats (snapshots have none)", () => {
    assert.deepEqual(
      ids({
        dataSource: "direct",
        stats: { data_scanned_bytes: 100, engine_execution_time_ms: 5 },
      }),
      ["source-note"],
    );
  });

  test("facade with full stats ⇒ stats-note only", () => {
    assert.deepEqual(
      ids({
        dataSource: "facade",
        stats: { data_scanned_bytes: 100, engine_execution_time_ms: 5 },
      }),
      ["stats-note"],
    );
  });

  test("absent data_source is treated as facade", () => {
    assert.deepEqual(ids({ stats: { data_scanned_bytes: 100 } }), [
      "stats-note",
    ]);
  });

  test("facade without stats ⇒ nothing", () => {
    assert.deepEqual(ids({ dataSource: "facade" }), []);
  });

  test("facade with an empty stats object ⇒ nothing (no displayable parts)", () => {
    assert.deepEqual(ids({ dataSource: "facade", stats: {} }), []);
  });

  test("facade with only scanned bytes ⇒ stats-note", () => {
    assert.deepEqual(
      ids({ dataSource: "facade", stats: { data_scanned_bytes: 100 } }),
      ["stats-note"],
    );
  });

  test("facade with only execution time ⇒ stats-note", () => {
    assert.deepEqual(
      ids({ dataSource: "facade", stats: { engine_execution_time_ms: 5 } }),
      ["stats-note"],
    );
  });

  test("source-note and stats-note are mutually exclusive by construction", () => {
    // A result is either inline (direct) or facade-resolved — never both — so the
    // two footer notes can never appear together. This preserves legacy behavior:
    // direct provider data never carried execution stats.
    const directIds = ids({ dataSource: "direct" });
    const facadeIds = ids({
      dataSource: "facade",
      stats: { data_scanned_bytes: 1 },
    });
    assert.equal(directIds.includes("stats-note"), false);
    assert.equal(facadeIds.includes("source-note"), false);
  });
});

describe("footer-note chromes — render output (pixel-identity)", () => {
  test("source-note renders the legacy inline label", () => {
    const slice = sourceNoteChrome.select(
      buildChromeContext({ dataSource: "direct" }),
    );
    assert.notEqual(slice, null);
    const el = sourceNoteChrome.render(slice as never);
    assert.equal(el.className, "renderer-footer-source");
    assert.equal(el.textContent, "source: inline");
  });

  test("stats-note renders scanned + duration joined by ' · '", () => {
    const slice = statsNoteChrome.select(
      buildChromeContext({
        dataSource: "facade",
        stats: { data_scanned_bytes: 12 * 1024 * 1024, engine_execution_time_ms: 840 },
      }),
    );
    assert.notEqual(slice, null);
    const el = statsNoteChrome.render(slice as never);
    assert.equal(el.className, "renderer-footer-stats");
    // 12 MB is ≥10, so the ported formatter keeps one decimal ("12.0 MB").
    assert.equal(el.textContent, "scanned 12.0 MB · 840 ms");
  });

  test("mountResolved appends footer notes as direct children of .renderer-footer", () => {
    const root = document.createElement("div");
    const frame = createFrame(root, { title: "t", chartType: "bar" });
    mountResolved(
      frame,
      resolve(
        FOOTER_NOTE_CHROMES,
        buildChromeContext({
          dataSource: "facade",
          stats: { data_scanned_bytes: 100 },
        }),
      ),
    );
    const statsNote = frame.footer.querySelector(".renderer-footer-stats");
    assert.ok(statsNote, "stats note should be a direct child of the footer");
    assert.equal(statsNote?.parentElement, frame.footer);
  });
});
