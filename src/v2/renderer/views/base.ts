// Copyright (c) 2025 AccelByte Inc. All Rights Reserved.
// This is licensed software from AccelByte Inc, for limitations
// and restrictions contact your company contract manager.

import { table } from "@observablehq/inputs";

import type { RenderColumnHint } from "../../shared/render-schemas.js";
import { getRowSetMeta, type Row } from "./types.js";

export const FOLDOUT_TABLE_MAX_ROWS = 50;

function availableColumns(rows: Row[]): string[] {
  const meta = getRowSetMeta(rows);
  if (meta) {
    return meta.columnOrder;
  }

  const firstRow = rows[0];
  return firstRow ? Object.keys(firstRow) : [];
}

function distinctCount(rows: Row[], key: string): number {
  const values = new Set<string>();
  for (const row of rows) {
    const value = row[key];
    if (value === null || value === undefined) {
      continue;
    }
    values.add(value instanceof Date ? value.toISOString() : String(value));
  }
  return values.size;
}

function isNumericColumn(rows: Row[], key: string): boolean {
  const metaType = getRowSetMeta(rows)?.columnTypes[key];
  if (metaType === "quantitative") {
    return true;
  }

  return rows.some((row) => typeof row[key] === "number");
}

function isCategoryColumn(rows: Row[], key: string): boolean {
  const metaType = getRowSetMeta(rows)?.columnTypes[key];
  if (metaType && metaType !== "quantitative" && metaType !== "temporal") {
    return true;
  }

  return rows.some((row) => {
    const value = row[key];
    return typeof value === "string" || typeof value === "boolean";
  });
}

export interface RenderStats {
  data_scanned_bytes?: number;
  engine_execution_time_ms?: number;
}

export interface FoldoutTableData {
  columnNames: string[];
  rows: Row[];
  column_hints?: Record<string, RenderColumnHint>;
}

export interface MountShellOptions {
  title?: string;
  description?: string;
  chartType?: string;
  dataSource?: string;
  stats?: RenderStats;
  sql?: string;
  tableData?: FoldoutTableData;
}

export interface ShellRefs {
  body: HTMLDivElement;
  footer: HTMLDivElement;
}

export function appendInlineSourceNote(footer: HTMLElement, dataSource?: string): void {
  if (dataSource !== "direct") {
    return;
  }
  const note = document.createElement("span");
  note.className = "renderer-footer-source";
  note.textContent = "source: inline";
  footer.appendChild(note);
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return `${bytes} B`;
  }
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const digits = unitIndex === 0 || value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(digits)} ${units[unitIndex]}`;
}

function formatDurationMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) {
    return `${ms} ms`;
  }
  if (ms < 1000) {
    return `${Math.round(ms)} ms`;
  }
  const seconds = ms / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(seconds >= 10 ? 1 : 2)} s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds - minutes * 60);
  return `${minutes}m ${remainder}s`;
}

export function appendStatsNote(footer: HTMLElement, stats?: RenderStats): void {
  if (!stats) {
    return;
  }
  const parts: string[] = [];
  if (typeof stats.data_scanned_bytes === "number") {
    parts.push(`scanned ${formatBytes(stats.data_scanned_bytes)}`);
  }
  if (typeof stats.engine_execution_time_ms === "number") {
    parts.push(formatDurationMs(stats.engine_execution_time_ms));
  }
  if (parts.length === 0) {
    return;
  }
  const note = document.createElement("span");
  note.className = "renderer-footer-stats";
  note.textContent = parts.join(" · ");
  footer.appendChild(note);
}

export function mountShell(
  root: HTMLElement,
  options: MountShellOptions = {},
): ShellRefs {
  const shell = document.createElement("section");
  shell.className = "renderer-shell";

  const header = document.createElement("div");
  header.className = "renderer-header";

  const headerText = document.createElement("div");
  headerText.className = "renderer-header-text";

  if (options.chartType) {
    const eyebrow = document.createElement("span");
    eyebrow.className = "renderer-eyebrow";
    eyebrow.textContent = options.chartType;
    headerText.appendChild(eyebrow);
  }

  const heading = document.createElement("h1");
  heading.className = "renderer-title";
  heading.textContent = options.title ?? "Analytics visualization";
  headerText.appendChild(heading);

  if (options.description) {
    const description = document.createElement("p");
    description.className = "renderer-description";
    description.textContent = options.description;
    headerText.appendChild(description);
  }

  const actions = document.createElement("div");
  actions.className = "renderer-header-actions";

  header.append(headerText, actions);

  const body = document.createElement("div");
  body.className = "renderer-chart-body";

  const footer = document.createElement("div");
  footer.className = "renderer-footer";

  shell.append(header, body, footer);
  root.appendChild(shell);

  mountFoldouts(shell, footer, options);
  appendInlineSourceNote(footer, options.dataSource);
  appendStatsNote(footer, options.stats);

  return { body, footer };
}

const SQL_KEYWORDS = new Set([
  "select",
  "from",
  "where",
  "and",
  "or",
  "not",
  "in",
  "is",
  "null",
  "as",
  "on",
  "join",
  "inner",
  "outer",
  "left",
  "right",
  "full",
  "cross",
  "using",
  "group",
  "by",
  "order",
  "having",
  "limit",
  "offset",
  "distinct",
  "union",
  "intersect",
  "except",
  "all",
  "with",
  "case",
  "when",
  "then",
  "else",
  "end",
  "between",
  "like",
  "ilike",
  "exists",
  "any",
  "some",
  "asc",
  "desc",
  "true",
  "false",
  "values",
  "into",
  "insert",
  "update",
  "delete",
  "set",
  "create",
  "table",
  "view",
  "index",
  "drop",
  "alter",
  "add",
  "column",
  "primary",
  "key",
  "foreign",
  "references",
  "constraint",
  "unique",
  "default",
  "cast",
  "over",
  "partition",
  "window",
  "rows",
  "range",
  "preceding",
  "following",
  "current",
  "row",
  "unbounded",
  "if",
  "ifnull",
  "coalesce",
  "interval",
]);

function highlightSql(sql: string, target: HTMLElement): void {
  const tokenRe =
    /(\/\*[\s\S]*?\*\/|--[^\n]*)|('(?:''|[^'])*')|("(?:""|[^"])*")|(`(?:[^`])*`)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_][A-Za-z0-9_]*)|(\s+)|([^\s])/g;

  let match: RegExpExecArray | null;
  while ((match = tokenRe.exec(sql)) !== null) {
    const [
      ,
      comment,
      string,
      doubleQuoted,
      backtickQuoted,
      number,
      word,
      whitespace,
      punct,
    ] = match;

    if (comment !== undefined) {
      appendSpan(target, comment, "sql-comment");
    } else if (string !== undefined) {
      appendSpan(target, string, "sql-string");
    } else if (doubleQuoted !== undefined || backtickQuoted !== undefined) {
      appendSpan(target, match[0], "sql-identifier");
    } else if (number !== undefined) {
      appendSpan(target, number, "sql-number");
    } else if (word !== undefined) {
      const cls = SQL_KEYWORDS.has(word.toLowerCase())
        ? "sql-keyword"
        : "sql-name";
      appendSpan(target, word, cls);
    } else if (whitespace !== undefined) {
      target.appendChild(document.createTextNode(whitespace));
    } else if (punct !== undefined) {
      appendSpan(target, punct, "sql-punct");
    }
  }
}

function appendSpan(target: HTMLElement, text: string, className: string): void {
  const span = document.createElement("span");
  span.className = className;
  span.textContent = text;
  target.appendChild(span);
}

function buildSqlFoldoutContent(sql: string): HTMLElement {
  const pre = document.createElement("pre");
  pre.className = "renderer-foldout-sql";
  const code = document.createElement("code");
  highlightSql(sql, code);
  pre.appendChild(code);
  return pre;
}

function buildTableFoldoutContent(data: FoldoutTableData): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "renderer-foldout-table-wrap";

  const totalRows = data.rows.length;
  const displayRows = data.rows.slice(0, FOLDOUT_TABLE_MAX_ROWS);

  if (totalRows > FOLDOUT_TABLE_MAX_ROWS) {
    const note = document.createElement("p");
    note.className = "renderer-foldout-truncation";
    note.textContent = `Showing first ${FOLDOUT_TABLE_MAX_ROWS} of ${totalRows} rows. Use render_table to see all.`;
    wrap.appendChild(note);
  }

  const headers = Object.fromEntries(
    data.columnNames.map((column) => [
      column,
      data.column_hints?.[column]?.label ?? column,
    ]),
  );

  const meta = getRowSetMeta(data.rows);
  const numericColumns = new Set<string>(
    data.columnNames.filter(
      (column) =>
        meta?.columnTypes[column] === "quantitative" &&
        data.rows.some((row) => typeof row[column] === "number"),
    ),
  );

  const renderedTable = table(displayRows, {
    columns: data.columnNames,
    header: headers,
    layout: data.columnNames.length >= 12 ? "auto" : "fixed",
    required: false,
    rows: Math.max(displayRows.length, 1),
    select: false,
    width: "100%",
  });

  wrap.appendChild(renderedTable);

  const tableEl = wrap.querySelector("table");
  if (tableEl) {
    tableEl.classList.add("renderer-table");
    if (numericColumns.size > 0) {
      data.columnNames.forEach((column, index) => {
        if (!numericColumns.has(column)) {
          return;
        }
        const cellIndex = index + 1;
        tableEl
          .querySelectorAll(
            `thead th:nth-child(${cellIndex}), tbody td:nth-child(${cellIndex})`,
          )
          .forEach((cell) => cell.classList.add("is-numeric"));
      });
    }
  }

  return wrap;
}

export function mountFoldouts(
  shell: HTMLElement,
  footer: HTMLElement,
  options: MountShellOptions,
): void {
  const hasSql = typeof options.sql === "string" && options.sql.length > 0;
  const hasTable = options.tableData !== undefined;

  if (!hasSql && !hasTable) {
    return;
  }

  const foldouts = document.createElement("div");
  foldouts.className = "renderer-foldouts";

  if (hasSql && options.sql !== undefined) {
    foldouts.appendChild(
      buildFoldout("SQL", () => buildSqlFoldoutContent(options.sql as string)),
    );
  }

  if (hasTable && options.tableData !== undefined) {
    const tableData = options.tableData;
    foldouts.appendChild(
      buildFoldout("Table", () => buildTableFoldoutContent(tableData)),
    );
  }

  shell.insertBefore(foldouts, footer);
}

function buildFoldout(label: string, build: () => HTMLElement): HTMLElement {
  const details = document.createElement("details");
  details.className = "renderer-foldout";

  const summary = document.createElement("summary");
  summary.className = "renderer-foldout-summary";

  const chevron = document.createElement("span");
  chevron.className = "renderer-foldout-chevron";
  chevron.setAttribute("aria-hidden", "true");

  const text = document.createElement("span");
  text.className = "renderer-foldout-label";
  text.textContent = label;

  summary.append(chevron, text);
  details.appendChild(summary);

  let mounted = false;
  details.addEventListener("toggle", () => {
    if (mounted || !details.open) {
      return;
    }
    mounted = true;
    details.appendChild(build());
  });

  return details;
}

export function mountChart(
  root: HTMLElement,
  title?: string,
  description?: string,
): HTMLDivElement {
  const { body } = mountShell(root, { title, description });
  return body;
}

export function pickNumericKey(
  rows: Row[],
  preferred?: string,
): string | undefined {
  const columns = availableColumns(rows);
  if (preferred && columns.includes(preferred) && isNumericColumn(rows, preferred)) {
    return preferred;
  }

  return columns.find((key) => isNumericColumn(rows, key));
}

export function pickCategoryKey(
  rows: Row[],
  preferred?: string,
): string | undefined {
  const columns = availableColumns(rows);
  if (
    preferred &&
    columns.includes(preferred) &&
    isCategoryColumn(rows, preferred)
  ) {
    return preferred;
  }

  return columns.find((key) => isCategoryColumn(rows, key));
}

export function pickAxes(
  rows: Row[],
  preferredX?: string,
  preferredY?: string,
): { x: string; y: string } {
  const x =
    pickCategoryKey(rows, preferredX) ??
    availableColumns(rows)[0];
  const y =
    pickNumericKey(rows, preferredY) ??
    availableColumns(rows).find((key) => key !== x);

  if (!x || !y) {
    throw new Error("Could not infer chart axes from the available columns.");
  }

  return { x, y };
}

export function pickColorKey(
  rows: Row[],
  preferred?: string,
  maxCardinality = 20,
): string | undefined {
  const columns = availableColumns(rows);
  if (
    preferred &&
    columns.includes(preferred) &&
    distinctCount(rows, preferred) <= maxCardinality
  ) {
    return preferred;
  }

  return columns.find(
    (key) =>
      isCategoryColumn(rows, key) && distinctCount(rows, key) <= maxCardinality,
  );
}

export function validateColumns(rows: Row[], ...keys: Array<string | undefined>): void {
  const columns = new Set(availableColumns(rows));
  const missing = keys.filter(
    (key): key is string => key !== undefined && key !== "" && !columns.has(key),
  );

  if (missing.length > 0) {
    throw new Error(`Unknown column(s): ${missing.join(", ")}`);
  }
}

export function facetConfig(options: {
  facet_col?: string;
  facet_row?: string;
}): { fx?: string; fy?: string } {
  // Only include keys when set; an explicit `undefined` would clobber facet
  // channels (fx/fy) that a mark sets for grouping (e.g. bar grouped+color).
  const config: { fx?: string; fy?: string } = {};
  if (options.facet_col) {
    config.fx = options.facet_col;
  }
  if (options.facet_row) {
    config.fy = options.facet_row;
  }
  return config;
}

export function tooltipChannels(
  columns?: string[],
): { title?: (row: Row) => string } {
  if (!columns || columns.length === 0) {
    return {};
  }

  return {
    title: (row) =>
      columns
        .map((column) => {
          const value = row[column];
          return `${column}: ${value instanceof Date ? value.toISOString() : String(value ?? "—")}`;
        })
        .join("\n"),
  };
}

export function ordinalColor(color?: string): { fill?: string; stroke?: string } {
  if (!color) {
    return {};
  }

  return {
    fill: color,
    stroke: color,
  };
}

export function seriesRange(): string[] {
  return [
    "var(--series-1)",
    "var(--series-2)",
    "var(--series-3)",
    "var(--series-4)",
    "var(--series-5)",
    "var(--series-6)",
  ];
}

export function plotDefaults() {
  return {
    style: {
      fontFamily: "var(--font-sans)",
      fontSize: "12px",
      color: "var(--color-text-primary)",
    },
    marginLeft: 72,
    marginRight: 24,
    marginTop: 28,
    // Leave room for the axis label below a possible two-level time-tick stack ("12" / "Apr").
    marginBottom: 72,
    x: {
      tickPadding: 8,
      labelAnchor: "center" as const,
      labelArrow: "none" as const,
      labelOffset: 56,
    },
    y: {
      tickPadding: 8,
      grid: true,
      gridOpacity: 0.35,
      labelAnchor: "center" as const,
      labelArrow: "none" as const,
      labelOffset: 56,
    },
    fx: { label: null, labelOffset: 0 },
    fy: { label: null, labelOffset: 0 },
    color: { range: seriesRange() },
  };
}

export function aggregateBy(
  rows: Row[],
  categoryKey: string,
  valueKey: string,
): Row[] {
  const totals = new Map<string, number>();

  for (const row of rows) {
    const category = row[categoryKey];
    const value = row[valueKey];
    if (
      (typeof category !== "string" && typeof category !== "boolean") ||
      typeof value !== "number"
    ) {
      continue;
    }

    const mapKey = String(category);
    totals.set(mapKey, (totals.get(mapKey) ?? 0) + value);
  }

  return Array.from(totals, ([category, value]) => ({
    [categoryKey]: category,
    [valueKey]: value,
  }));
}
