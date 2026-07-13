// Copyright (c) 2025 AccelByte Inc.
// SPDX-License-Identifier: Apache-2.0

import type { z } from "zod/v3";
import { TableOutputSchema } from "../../shared/render-schemas.js";
import { mountShell, renderHtmlTable } from "./base.js";
import { toRows } from "./coerce.js";
import { filterRows } from "./filter.js";
import {
  getRowSetMeta,
  type Primitive,
  type RenderColumnHint,
  type Row,
} from "./types.js";

type TablePayload = z.infer<typeof TableOutputSchema>;

function orderedColumns(payload: TablePayload): string[] {
  const knownColumns = payload.data.columns.map((column) => column.name);
  const requested = payload.options.columns_order ?? [];
  const ordered: string[] = [];
  const seen = new Set<string>();

  for (const column of requested) {
    if (knownColumns.includes(column) && !seen.has(column)) {
      ordered.push(column);
      seen.add(column);
    }
  }

  for (const column of knownColumns) {
    if (!seen.has(column)) {
      ordered.push(column);
      seen.add(column);
    }
  }

  return ordered;
}

function formatValue(value: Primitive): string | number | boolean | Date {
  if (value === null) {
    return "—";
  }

  return value;
}

function formatHeader(column: string, hint?: RenderColumnHint): string {
  return hint?.label ?? column;
}

function toDisplayRows(rows: Row[], columns: string[]): Array<Record<string, unknown>> {
  return rows.map((row) =>
    Object.fromEntries(
      columns.map((column) => [column, formatValue(row[column])]),
    ),
  );
}

function buildSummary(
  filteredCount: number,
  totalCount: number,
  pageStart: number,
  pageEnd: number,
): string {
  if (filteredCount === 0) {
    return totalCount === 0
      ? "No rows available."
      : "No rows match the current filters.";
  }

  const pageText = `Showing ${pageStart}-${pageEnd} of ${filteredCount} rows`;
  if (filteredCount === totalCount) {
    return `${pageText}.`;
  }

  return `${pageText} after filtering ${totalCount} source rows.`;
}

function matchesQuery(
  row: Record<string, unknown>,
  columns: string[],
  needle: string,
): boolean {
  if (needle === "") return true;
  for (const column of columns) {
    const value = row[column];
    const text =
      value === null || value === undefined
        ? ""
        : value instanceof Date
          ? value.toISOString()
          : String(value);
    if (text.toLowerCase().includes(needle)) return true;
  }
  return false;
}

export function renderTable(root: HTMLElement, payload: TablePayload): void {
  root.replaceChildren();

  const rows = filterRows(
    toRows(payload.data.columns, payload.data.rows, payload.column_hints ?? {}),
    payload.filters ?? [],
  );
  const columns = orderedColumns(payload);
  const meta = getRowSetMeta(rows);
  const numericColumns = new Set<string>(
    columns.filter(
      (column) =>
        meta?.columnTypes[column] === "quantitative" &&
        rows.some((row) => typeof row[column] === "number"),
    ),
  );
  const headers = Object.fromEntries(
    columns.map((column) => [
      column,
      formatHeader(column, payload.column_hints?.[column]),
    ]),
  );
  const displayRows = toDisplayRows(rows, columns);
  const pageSize = payload.options.page_size;

  const { body: shell } = mountShell(root, {
    title: payload.title ?? "Query result table",
    description: payload.description,
    chartType: "table",
    dataSource: payload.data_source,
    stats: payload.stats,
    sql: payload.sql,
  });

  const summary = document.createElement("p");
  summary.className = "renderer-summary";
  shell.appendChild(summary);

  const toolbar = document.createElement("div");
  toolbar.className = "renderer-table-toolbar";

  const searchInput = document.createElement("input");
  searchInput.type = "search";
  searchInput.placeholder = "Search rows";
  searchInput.className = "renderer-search";

  const pager = document.createElement("div");
  pager.className = "renderer-pager";
  const previousButton = document.createElement("button");
  previousButton.type = "button";
  previousButton.textContent = "Previous";
  const nextButton = document.createElement("button");
  nextButton.type = "button";
  nextButton.textContent = "Next";
  const pageIndicator = document.createElement("span");
  pageIndicator.className = "renderer-pager-indicator";
  pager.append(previousButton, pageIndicator, nextButton);
  toolbar.append(searchInput, pager);
  shell.appendChild(toolbar);

  const tableWrap = document.createElement("div");
  tableWrap.className = "renderer-table-wrap";
  shell.appendChild(tableWrap);

  let currentPage = 0;

  const renderPage = (): void => {
    const needle = searchInput.value.trim().toLowerCase();
    const matchingRows = needle
      ? displayRows.filter((row) => matchesQuery(row, columns, needle))
      : displayRows;
    const totalPages =
      matchingRows.length === 0 ? 1 : Math.ceil(matchingRows.length / pageSize);
    currentPage = Math.min(currentPage, totalPages - 1);

    const startIndex = currentPage * pageSize;
    const pageRows = matchingRows.slice(startIndex, startIndex + pageSize);
    const pageStart = matchingRows.length === 0 ? 0 : startIndex + 1;
    const pageEnd = startIndex + pageRows.length;

    summary.textContent = buildSummary(
      matchingRows.length,
      displayRows.length,
      pageStart,
      pageEnd,
    );
    pageIndicator.textContent = `Page ${currentPage + 1} of ${totalPages}`;
    previousButton.disabled = currentPage === 0;
    nextButton.disabled = currentPage >= totalPages - 1;

    tableWrap.replaceChildren(
      renderHtmlTable(pageRows, columns, headers, numericColumns),
    );
  };

  previousButton.addEventListener("click", () => {
    if (currentPage > 0) {
      currentPage -= 1;
      renderPage();
    }
  });

  nextButton.addEventListener("click", () => {
    currentPage += 1;
    renderPage();
  });

  searchInput.addEventListener("input", () => {
    currentPage = 0;
    renderPage();
  });

  renderPage();
}
