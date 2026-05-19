import assert from "node:assert/strict";
import { describe, test } from "node:test";

import "../jsdom.js";
import { renderMetric } from "../../../../src/v2/renderer/views/metric.js";

function resetRoot(): HTMLElement {
  const root = document.getElementById("app");
  assert.ok(root);
  root.replaceChildren();
  return root;
}

describe("renderMetric", () => {
  test("renders formatted currency values and compare text", () => {
    const root = resetRoot();

    renderMetric(root, {
      chart_type: "metric",
      title: "Revenue",
      data: {
        columns: [
          { name: "revenue", type: "double" },
          { name: "delta", type: "double" },
        ],
        rows: [["12345.67", "0.08"]],
      },
      options: {
        value: "revenue",
        compare: "delta",
        format: "currency",
        label: "Gross revenue",
        unit: "USD",
      },
    });

    assert.match(root.textContent ?? "", /Gross revenue/);
    assert.match(root.textContent ?? "", /\$/);
    assert.match(root.textContent ?? "", /0\.08/);
  });

  test("shows a placeholder when the value column is missing", () => {
    const root = resetRoot();

    renderMetric(root, {
      chart_type: "metric",
      data: {
        columns: [{ name: "count", type: "bigint" }],
        rows: [["7"]],
      },
      options: {
        value: "missing",
      },
    });

    assert.match(root.textContent ?? "", /—/);
  });

  test("renders an up delta with success direction for positive change", () => {
    const root = resetRoot();

    renderMetric(root, {
      chart_type: "metric",
      data: {
        columns: [
          { name: "value", type: "double" },
          { name: "prev", type: "double" },
        ],
        rows: [["120", "100"]],
      },
      options: { value: "value", compare: "prev" },
    });

    const delta = root.querySelector(".delta-indicator--inline");
    assert.ok(delta, "expected delta indicator element");
    assert.equal(
      (delta as HTMLElement).dataset.direction,
      "up",
      "positive change should be up",
    );
    assert.match(delta?.textContent ?? "", /▲/);
    assert.match(delta?.textContent ?? "", /\+20\.0/);
  });

  test("renders a down delta with danger direction for negative change", () => {
    const root = resetRoot();

    renderMetric(root, {
      chart_type: "metric",
      data: {
        columns: [
          { name: "value", type: "double" },
          { name: "prev", type: "double" },
        ],
        rows: [["98", "100"]],
      },
      options: { value: "value", compare: "prev" },
    });

    const delta = root.querySelector(".delta-indicator--inline");
    assert.ok(delta, "expected delta indicator element");
    assert.equal((delta as HTMLElement).dataset.direction, "down");
    assert.match(delta?.textContent ?? "", /▼/);
    assert.match(delta?.textContent ?? "", /-2\.0/);
  });

  test("falls back to raw compare text when values are non-numeric", () => {
    const root = resetRoot();

    renderMetric(root, {
      chart_type: "metric",
      data: {
        columns: [
          { name: "segment", type: "varchar" },
          { name: "previous_segment", type: "varchar" },
        ],
        rows: [["alpha", "beta"]],
      },
      options: { value: "segment", compare: "previous_segment" },
    });

    assert.equal(root.querySelector(".delta-indicator--inline"), null);
    const compare = root.querySelector(".metric-compare");
    assert.ok(compare, "expected fallback compare element");
    assert.equal(compare?.textContent, "beta");
  });

  test("omits the compare row entirely when compare option is missing", () => {
    const root = resetRoot();

    renderMetric(root, {
      chart_type: "metric",
      data: {
        columns: [{ name: "value", type: "double" }],
        rows: [["42"]],
      },
      options: { value: "value" },
    });

    assert.equal(root.querySelector(".metric-compare"), null);
    assert.equal(root.querySelector(".delta-indicator"), null);
  });

  test("renders a secondary chip only when a third numeric column is present", () => {
    const rootWithoutSecondary = resetRoot();
    renderMetric(rootWithoutSecondary, {
      chart_type: "metric",
      data: {
        columns: [
          { name: "value", type: "double" },
          { name: "prev", type: "double" },
        ],
        rows: [["10", "8"]],
      },
      options: { value: "value", compare: "prev" },
    });
    assert.equal(
      rootWithoutSecondary.querySelector(".metric-secondary"),
      null,
      "no third numeric column → no secondary chip",
    );

    const rootWithSecondary = resetRoot();
    renderMetric(rootWithSecondary, {
      chart_type: "metric",
      data: {
        columns: [
          { name: "value", type: "double" },
          { name: "prev", type: "double" },
          { name: "users", type: "bigint" },
        ],
        rows: [["10", "8", "1234"]],
      },
      options: { value: "value", compare: "prev" },
    });
    const chip = rootWithSecondary.querySelector(".metric-secondary");
    assert.ok(chip, "third numeric column → secondary chip rendered");
    assert.match(chip?.textContent ?? "", /users/);
    assert.match(chip?.textContent ?? "", /1,?234/);
  });

  test("applies filters before selecting the first metric row", () => {
    const root = resetRoot();

    renderMetric(root, {
      chart_type: "metric",
      data: {
        columns: [
          { name: "segment", type: "varchar" },
          { name: "value", type: "bigint" },
        ],
        rows: [
          ["control", "5"],
          ["target", "12"],
        ],
      },
      filters: [{ column: "segment", op: "eq", value: "target" }],
      options: {
        value: "value",
        format: "integer",
      },
    });

    assert.match(root.textContent ?? "", /12/);
  });
});
