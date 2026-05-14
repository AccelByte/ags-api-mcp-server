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
