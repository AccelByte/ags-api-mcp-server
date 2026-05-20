import assert from "node:assert/strict";
import { describe, test } from "node:test";

import "../jsdom.js";
import {
  FOLDOUT_TABLE_MAX_ROWS,
  mountShell,
} from "../../../../src/v2/renderer/views/base.js";
import { toRows } from "../../../../src/v2/renderer/views/coerce.js";
import type { Row } from "../../../../src/v2/renderer/views/types.js";

function freshRoot(): HTMLElement {
  const root = document.createElement("main");
  document.body.appendChild(root);
  return root;
}

function sampleRows(count: number): Row[] {
  return toRows(
    [
      { name: "id", type: "bigint" },
      { name: "name", type: "varchar" },
    ],
    Array.from({ length: count }, (_, i) => [String(i + 1), `row-${i + 1}`]),
  );
}

describe("foldouts", () => {
  test("SQL foldout is present when sql is provided", () => {
    const root = freshRoot();
    mountShell(root, { title: "T", sql: "SELECT 1" });

    const foldouts = root.querySelectorAll(".renderer-foldout");
    assert.equal(foldouts.length, 1);
    const label = foldouts[0]?.querySelector(".renderer-foldout-label");
    assert.equal(label?.textContent, "SQL");
  });

  test("foldouts are absent when no sql and no tableData", () => {
    const root = freshRoot();
    mountShell(root, { title: "T" });

    assert.equal(root.querySelector(".renderer-foldouts"), null);
    assert.equal(root.querySelector(".renderer-foldout"), null);
  });

  test("table foldout is present only when tableData is supplied", () => {
    const rootChart = freshRoot();
    const rows = sampleRows(3);
    mountShell(rootChart, {
      title: "T",
      tableData: { columnNames: ["id", "name"], rows },
    });

    const labels = Array.from(
      rootChart.querySelectorAll(".renderer-foldout-label"),
    ).map((el) => el.textContent);
    assert.deepEqual(labels, ["Table"]);

    const rootMetric = freshRoot();
    mountShell(rootMetric, { title: "T", sql: "SELECT 1" });
    const metricLabels = Array.from(
      rootMetric.querySelectorAll(".renderer-foldout-label"),
    ).map((el) => el.textContent);
    assert.deepEqual(metricLabels, ["SQL"]);
  });

  test("both foldouts default collapsed (open === false)", () => {
    const root = freshRoot();
    mountShell(root, {
      title: "T",
      sql: "SELECT 1",
      tableData: { columnNames: ["id", "name"], rows: sampleRows(2) },
    });

    const details = root.querySelectorAll<HTMLDetailsElement>(
      ".renderer-foldout",
    );
    assert.equal(details.length, 2);
    for (const el of details) {
      assert.equal(el.open, false);
    }
  });

  test("lazy mount: content empty until toggled open, then persisted across toggles", () => {
    const root = freshRoot();
    mountShell(root, {
      title: "T",
      sql: "SELECT col FROM t",
    });

    const details = root.querySelector<HTMLDetailsElement>(".renderer-foldout");
    assert.ok(details);

    assert.equal(details.querySelector(".renderer-foldout-sql"), null);

    details.open = true;
    details.dispatchEvent(new window.Event("toggle"));
    const built = details.querySelector(".renderer-foldout-sql");
    assert.ok(built, "expected sql content after first toggle");
    assert.equal(built.querySelector("code")?.textContent, "SELECT col FROM t");

    details.open = false;
    details.dispatchEvent(new window.Event("toggle"));
    details.open = true;
    details.dispatchEvent(new window.Event("toggle"));

    const sqlBlocks = details.querySelectorAll(".renderer-foldout-sql");
    assert.equal(sqlBlocks.length, 1);
    assert.equal(sqlBlocks[0], built);
  });

  test("table foldout truncates to FOLDOUT_TABLE_MAX_ROWS and renders truncation note", () => {
    const root = freshRoot();
    const total = FOLDOUT_TABLE_MAX_ROWS + 25;
    mountShell(root, {
      title: "T",
      tableData: { columnNames: ["id", "name"], rows: sampleRows(total) },
    });

    const details = root.querySelector<HTMLDetailsElement>(".renderer-foldout");
    assert.ok(details);

    details.open = true;
    details.dispatchEvent(new window.Event("toggle"));

    const note = details.querySelector(".renderer-foldout-truncation");
    assert.ok(note);
    assert.match(
      note.textContent ?? "",
      new RegExp(`Showing first ${FOLDOUT_TABLE_MAX_ROWS} of ${total} rows`),
    );

    const bodyRows = details.querySelectorAll(
      ".renderer-foldout-table-wrap tbody tr",
    );
    assert.equal(bodyRows.length, FOLDOUT_TABLE_MAX_ROWS);
  });

  test("table foldout below cap renders all rows and no truncation note", () => {
    const root = freshRoot();
    mountShell(root, {
      title: "T",
      tableData: { columnNames: ["id", "name"], rows: sampleRows(3) },
    });

    const details = root.querySelector<HTMLDetailsElement>(".renderer-foldout");
    assert.ok(details);

    details.open = true;
    details.dispatchEvent(new window.Event("toggle"));

    assert.equal(details.querySelector(".renderer-foldout-truncation"), null);
    const bodyRows = details.querySelectorAll(
      ".renderer-foldout-table-wrap tbody tr",
    );
    assert.equal(bodyRows.length, 3);
  });

  test("foldouts are inserted between body and footer", () => {
    const root = freshRoot();
    mountShell(root, { title: "T", sql: "SELECT 1" });

    const shell = root.querySelector(".renderer-shell");
    assert.ok(shell);
    const children = Array.from(shell.children).map((el) => el.className);
    const bodyIdx = children.indexOf("renderer-chart-body");
    const foldoutsIdx = children.indexOf("renderer-foldouts");
    const footerIdx = children.indexOf("renderer-footer");
    assert.ok(bodyIdx < foldoutsIdx);
    assert.ok(foldoutsIdx < footerIdx);
  });
});
