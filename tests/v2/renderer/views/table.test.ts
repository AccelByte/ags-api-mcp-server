import assert from "node:assert/strict";
import { describe, test } from "node:test";

import "../jsdom.js";
import { renderTable } from "../../../../src/v2/renderer/views/table.js";

function resetRoot(): HTMLElement {
  const root = document.getElementById("app");
  assert.ok(root);
  root.replaceChildren();
  return root;
}

function samplePayload() {
  return {
    chart_type: "table" as const,
    title: "Active players",
    data: {
      columns: [
        { name: "region", type: "varchar" },
        { name: "active", type: "bigint" },
      ],
      rows: [
        ["us-east", "1200"],
        ["us-west", "950"],
        ["eu-central", "780"],
      ],
    },
    options: { page_size: 50 },
  };
}

describe("renderTable chrome", () => {
  test("wraps search and pager inside .renderer-table-toolbar", () => {
    const root = resetRoot();
    renderTable(root, samplePayload());

    const toolbar = root.querySelector(".renderer-table-toolbar");
    assert.ok(toolbar, "expected .renderer-table-toolbar wrapper");

    const searchInput = toolbar?.querySelector("input[type='search']");
    assert.ok(searchInput, "search input lives inside the toolbar");

    const pager = toolbar?.querySelector(".renderer-pager");
    assert.ok(pager, "pager group lives inside the toolbar");
    assert.equal(pager?.querySelectorAll("button").length, 2);
    assert.ok(pager?.querySelector(".renderer-pager-indicator"));
  });

  test("applies .is-numeric only to quantitative columns", () => {
    const root = resetRoot();
    renderTable(root, samplePayload());

    const renderedTable = root.querySelector("table.renderer-table");
    assert.ok(renderedTable, "expected the rendered <table> to carry .renderer-table");

    const headers = Array.from(renderedTable.querySelectorAll("thead th"));
    assert.ok(headers.length >= 2);
    // Column 0 (region) is categorical → no .is-numeric
    assert.equal(headers[0].classList.contains("is-numeric"), false);
    // Column 1 (active) is quantitative → .is-numeric
    assert.equal(headers[1].classList.contains("is-numeric"), true);

    const firstDataRowCells = Array.from(
      renderedTable.querySelectorAll("tbody tr"),
    )[0]?.querySelectorAll("td");
    assert.ok(firstDataRowCells && firstDataRowCells.length >= 2);
    assert.equal(firstDataRowCells[0].classList.contains("is-numeric"), false);
    assert.equal(firstDataRowCells[1].classList.contains("is-numeric"), true);
  });

  test("rendered table exposes zebra-stripe + sticky-header hooks", () => {
    const root = resetRoot();
    renderTable(root, samplePayload());

    const renderedTable = root.querySelector("table.renderer-table");
    assert.ok(renderedTable);

    // Sticky-header hook: <thead> with <th> exists for the position:sticky rule.
    const thead = renderedTable.querySelector("thead");
    assert.ok(thead, "thead present for sticky-header rule");
    assert.ok(thead.querySelector("th"), "thead has at least one th");

    // Zebra-stripe hook: multiple <tr> children in <tbody> so nth-child(even) applies.
    const bodyRows = renderedTable.querySelectorAll("tbody tr");
    assert.ok(bodyRows.length >= 2, "tbody has multiple rows for zebra striping");
  });

});
