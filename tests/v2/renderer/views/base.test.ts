import assert from "node:assert/strict";
import { describe, test } from "node:test";

import "../jsdom.js";
import {
  mountChart,
  mountShell,
  pickAxes,
  pickCategoryKey,
  pickColorKey,
  pickNumericKey,
  plotDefaults,
  seriesRange,
  validateColumns,
} from "../../../../src/v2/renderer/views/base.js";
import { toRows } from "../../../../src/v2/renderer/views/coerce.js";

describe("renderer view helpers", () => {
  test("pickAxes prefers category x and numeric y", () => {
    const rows = toRows(
      [
        { name: "team", type: "varchar" },
        { name: "score", type: "bigint" },
      ],
      [["alpha", "10"]],
    );

    assert.deepEqual(pickAxes(rows), { x: "team", y: "score" });
  });

  test("pickColorKey rejects categories above cardinality threshold", () => {
    const rows = toRows(
      [
        { name: "segment", type: "varchar" },
        { name: "value", type: "bigint" },
      ],
      Array.from({ length: 21 }, (_, index) => [`segment-${index}`, String(index)]),
    );

    assert.equal(pickColorKey(rows, "segment"), undefined);
  });

  test("pickNumericKey and pickCategoryKey follow inferred types", () => {
    const rows = toRows(
      [
        { name: "bucket", type: "varchar" },
        { name: "revenue", type: "double" },
        { name: "active", type: "boolean" },
      ],
      [["north", "12.5", "true"]],
    );

    assert.equal(pickNumericKey(rows), "revenue");
    assert.equal(pickCategoryKey(rows), "bucket");
  });

  test("validateColumns throws on unknown keys", () => {
    const rows = toRows(
      [{ name: "value", type: "bigint" }],
      [["7"]],
    );

    assert.doesNotThrow(() => {
      validateColumns(rows, "value");
    });

    assert.throws(() => {
      validateColumns(rows, "missing");
    }, /Unknown column/);
  });
});

describe("mountChart / mountShell", () => {
  function freshRoot(): HTMLElement {
    const root = document.createElement("main");
    document.body.appendChild(root);
    return root;
  }

  test("mountChart returns an HTMLDivElement for legacy callers", () => {
    const root = freshRoot();
    const body = mountChart(root, "Title", "Description");

    assert.ok(body instanceof HTMLElement);
    assert.equal(body.tagName, "DIV");
    const child = document.createElement("span");
    assert.doesNotThrow(() => body.appendChild(child));
    assert.equal(body.firstChild, child);
  });

  test("mountShell returns { body, footer } as attachable elements", () => {
    const root = freshRoot();
    const { body, footer } = mountShell(root, { title: "T" });

    assert.ok(body instanceof HTMLElement);
    assert.equal(body.tagName, "DIV");
    assert.ok(footer instanceof HTMLElement);
    assert.equal(footer.tagName, "DIV");
    assert.equal(footer.className, "renderer-footer");

    const probe = document.createElement("span");
    body.appendChild(probe);
    assert.equal(body.firstChild, probe);

    const footerProbe = document.createElement("span");
    footer.appendChild(footerProbe);
    assert.equal(footer.firstChild, footerProbe);
  });

  test("mountShell renders eyebrow when chartType is provided", () => {
    const root = freshRoot();
    mountShell(root, { title: "T", chartType: "bar" });

    const eyebrow = root.querySelector(".renderer-eyebrow");
    assert.ok(eyebrow, "expected eyebrow element");
    assert.equal(eyebrow?.textContent, "bar");
  });

  test("mountShell omits eyebrow when chartType is absent", () => {
    const root = freshRoot();
    mountShell(root, { title: "T" });

    assert.equal(root.querySelector(".renderer-eyebrow"), null);
  });
});

describe("seriesRange / plotDefaults", () => {
  test("seriesRange returns six --series-N CSS variable references", () => {
    const range = seriesRange();
    assert.equal(range.length, 6);
    for (let index = 0; index < range.length; index++) {
      assert.match(range[index], /^var\(--series-\d+\)$/);
    }
  });

  test("plotDefaults returns expected margins, style, and color range", () => {
    const defaults = plotDefaults();
    assert.equal(defaults.marginLeft, 72);
    assert.equal(defaults.marginRight, 24);
    assert.equal(defaults.marginTop, 28);
    assert.equal(defaults.marginBottom, 72);
    assert.deepEqual(defaults.style, {
      fontFamily: "var(--font-sans)",
      fontSize: "12px",
      color: "var(--color-text-primary)",
    });
    assert.equal(defaults.x.tickPadding, 8);
    assert.equal(defaults.x.labelAnchor, "center");
    assert.equal(defaults.x.labelArrow, "none");
    assert.equal(defaults.x.labelOffset, 56);
    assert.equal(defaults.y.tickPadding, 8);
    assert.equal(defaults.y.grid, true);
    assert.equal(defaults.y.gridOpacity, 0.35);
    assert.equal(defaults.y.labelAnchor, "center");
    assert.equal(defaults.y.labelArrow, "none");
    assert.equal(defaults.y.labelOffset, 56);
    assert.equal(defaults.fx.label, null);
    assert.equal(defaults.fy.label, null);
    assert.deepEqual(defaults.color.range, seriesRange());
  });
});
