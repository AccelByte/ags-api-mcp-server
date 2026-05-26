import assert from "node:assert/strict";
import { describe, test } from "node:test";

import "../jsdom.js";
import {
  commonChartOptions,
  createChartMount,
  mountShell,
  pickAxes,
  pickCategoryKey,
  pickColorKey,
  pickNumericKey,
  resolveCssVar,
  seriesPalette,
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

describe("mountShell", () => {
  function freshRoot(): HTMLElement {
    const root = document.createElement("main");
    document.body.appendChild(root);
    return root;
  }

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

describe("chart helpers", () => {
  test("seriesRange returns six --series-N CSS variable references for SVG charts", () => {
    const range = seriesRange();
    assert.equal(range.length, 6);
    for (let index = 0; index < range.length; index++) {
      assert.match(range[index], /^var\(--series-\d+\)$/);
    }
  });

  test("seriesPalette returns six resolved (or fallback) colors for canvas charts", () => {
    const palette = seriesPalette();
    assert.equal(palette.length, 6);
    for (const color of palette) {
      assert.equal(typeof color, "string");
      assert.notEqual(color, "");
    }
  });

  test("resolveCssVar falls back to the original expression when the var is unresolvable in JSDOM", () => {
    // JSDOM does not honor :root CSS variables defined in global.css, so resolveCssVar
    // falls back to the var(...) expression. Concrete colors pass through unchanged.
    assert.equal(resolveCssVar("var(--color-accent)"), "var(--color-accent)");
    assert.equal(resolveCssVar("#0f766e"), "#0f766e");
    assert.equal(resolveCssVar(undefined), "#000000");
  });

  test("createChartMount produces a sized wrapper containing a canvas", () => {
    const { wrapper, canvas } = createChartMount(420);
    assert.equal(wrapper.tagName, "DIV");
    assert.equal(wrapper.style.height, "420px");
    assert.equal(wrapper.style.position, "relative");
    assert.equal(canvas.tagName, "CANVAS");
    assert.equal(wrapper.firstChild, canvas);
  });

  test("commonChartOptions includes responsive sizing and tooltip configuration", () => {
    const opts = commonChartOptions();
    assert.equal(opts.responsive, true);
    assert.equal(opts.maintainAspectRatio, false);
    assert.ok(opts.plugins.legend);
    assert.ok(opts.plugins.tooltip);
    assert.ok(opts.scales.x);
    assert.ok(opts.scales.y);
  });
});
