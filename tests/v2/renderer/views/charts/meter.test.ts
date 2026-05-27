import assert from "node:assert/strict";
import { describe, test } from "node:test";

import "../../jsdom.js";
import { renderMeter } from "../../../../../src/v2/renderer/views/charts/meter.js";
import { toRows } from "../../../../../src/v2/renderer/views/coerce.js";

describe("renderMeter", () => {
  test("renders one bar per row with raw + percent value text and a per-meter unit", () => {
    const rows = toRows(
      [
        { name: "label", type: "varchar" },
        { name: "used", type: "bigint" },
        { name: "quota", type: "bigint" },
        { name: "unit", type: "varchar" },
      ],
      [
        ["API calls", "750", "1000", "calls"],
        ["Storage", "3.2", "5.0", "GB"],
      ],
    );

    const list = renderMeter(rows, {
      value: "used",
      max: "quota",
      label: "label",
      unit: "unit",
    });

    assert.ok(list instanceof HTMLElement);
    const fills = list.querySelectorAll(".meter-fill");
    assert.equal(fills.length, 2);
    assert.equal((fills[0] as HTMLElement).style.width, "75%");
    // Unit comes from the per-meter column, shown once after max.
    assert.match(list.textContent ?? "", /750 \/ 1,000 calls · 75%/);
    assert.match(list.textContent ?? "", /3\.2 \/ 5 GB · 64%/);
    assert.match(list.textContent ?? "", /API calls/);
  });

  test("applies the compact number format to displayed values", () => {
    const rows = toRows(
      [
        { name: "used", type: "bigint" },
        { name: "quota", type: "bigint" },
      ],
      [["1482300", "2000000"]],
    );

    const list = renderMeter(rows, {
      value: "used",
      max: "quota",
      format: "compact",
    });

    assert.match(list.textContent ?? "", /1\.48M \/ 2M · 74%/);
  });

  test("treats value as a 0–100 percentage when no max column is given", () => {
    const rows = toRows([{ name: "pct", type: "double" }], [["42"]]);

    const list = renderMeter(rows, { value: "pct" });

    const fill = list.querySelector(".meter-fill") as HTMLElement;
    assert.equal(fill.style.width, "42%");
    assert.match(list.textContent ?? "", /42%/);
    // Percentage mode shows no "x / y" raw text.
    assert.doesNotMatch(list.textContent ?? "", /\//);
  });

  test("clamps an over-limit bar to 100% and recolors it to the danger token", () => {
    const rows = toRows(
      [
        { name: "used", type: "bigint" },
        { name: "quota", type: "bigint" },
      ],
      [["1100", "1000"]],
    );

    const list = renderMeter(rows, { value: "used", max: "quota" });

    const fill = list.querySelector(".meter-fill") as HTMLElement;
    assert.equal(fill.style.width, "100%");
    assert.equal(fill.style.background, "var(--color-danger)");
    assert.match(list.textContent ?? "", /110%/);
  });

  test("uses a per-meter color override when the color column is present", () => {
    const rows = toRows(
      [
        { name: "used", type: "bigint" },
        { name: "quota", type: "bigint" },
        { name: "tint", type: "varchar" },
      ],
      [["1100", "1000", "var(--series-2)"]],
    );

    const list = renderMeter(rows, {
      value: "used",
      max: "quota",
      color: "tint",
    });

    const fill = list.querySelector(".meter-fill") as HTMLElement;
    // Override wins even though the meter is over its limit.
    assert.equal(fill.style.background, "var(--series-2)");
  });

  test("falls back to a series palette color when no override is given", () => {
    const rows = toRows(
      [
        { name: "used", type: "bigint" },
        { name: "quota", type: "bigint" },
      ],
      [["250", "1000"]],
    );

    const list = renderMeter(rows, { value: "used", max: "quota" });

    const fill = list.querySelector(".meter-fill") as HTMLElement;
    assert.equal(fill.style.background, "var(--series-1)");
  });

  test("throws when the max column is present but resolves to zero", () => {
    const rows = toRows(
      [
        { name: "used", type: "bigint" },
        { name: "quota", type: "bigint" },
      ],
      [["50", "0"]],
    );

    assert.throws(
      () => renderMeter(rows, { value: "used", max: "quota" }),
      /max column "quota" resolved to 0/,
    );
  });

  test("throws when the max column is present but non-numeric", () => {
    const rows = toRows(
      [
        { name: "used", type: "bigint" },
        { name: "quota", type: "varchar" },
      ],
      [["50", "unlimited"]],
    );

    assert.throws(
      () => renderMeter(rows, { value: "used", max: "quota" }),
      /max column "quota" resolved to unlimited/,
    );
  });

  test("renders an empty-state element when rows is empty", () => {
    const el = renderMeter([], { value: "used" });
    assert.ok(el instanceof HTMLElement);
    assert.match(el.textContent ?? "", /no data/i);
    assert.equal(el.querySelectorAll(".meter-fill").length, 0);
  });

  test("throws when value is negative and max is provided", () => {
    const rows = toRows(
      [
        { name: "used", type: "bigint" },
        { name: "quota", type: "bigint" },
      ],
      [["-50", "1000"]],
    );

    assert.throws(
      () => renderMeter(rows, { value: "used", max: "quota" }),
      /value column "used" resolved to -50/,
    );
  });

  test("sets ARIA progressbar attributes on the meter track", () => {
    const rows = toRows(
      [
        { name: "used", type: "bigint" },
        { name: "quota", type: "bigint" },
      ],
      [["1100", "1000"]],
    );

    const list = renderMeter(rows, { value: "used", max: "quota", label: undefined });
    const track = list.querySelector(".meter-track") as HTMLElement;
    assert.equal(track.getAttribute("role"), "progressbar");
    // Over-limit fillWidth is clamped to 100, so aria-valuenow reflects 100.
    assert.equal(track.getAttribute("aria-valuenow"), "100");
    assert.equal(track.getAttribute("aria-valuemin"), "0");
    assert.equal(track.getAttribute("aria-valuemax"), "100");
    assert.equal(track.getAttribute("aria-label"), "Meter 1");
  });

  test("throws when the referenced value column is missing", () => {
    const rows = toRows([{ name: "used", type: "bigint" }], [["10"]]);

    assert.throws(() => {
      renderMeter(rows, { value: "missing" });
    }, /Unknown column/);
  });
});
