// Copyright (c) 2025 AccelByte Inc. All Rights Reserved.
// This is licensed software from AccelByte Inc, for limitations
// and restrictions contact your company contract manager.

import {
  Chart,
  registerables,
  type ChartConfiguration,
} from "chart.js";
import {
  BoxPlotController,
  BoxAndWiskers,
} from "@sgratzl/chartjs-chart-boxplot";
import datalabelsPlugin from "chartjs-plugin-datalabels";
import trendlinePlugin from "chartjs-plugin-trendline";
import "chartjs-adapter-date-fns";

import type {
  RenderColumnHint,
  RenderStats,
} from "../../shared/render-schemas.js";
import { getRowSetMeta, type Primitive, type Row } from "./types.js";

let chartJsRegistered = false;
function ensureChartJsRegistered(): void {
  if (chartJsRegistered) {
    return;
  }
  Chart.register(
    ...registerables,
    BoxPlotController,
    BoxAndWiskers,
    trendlinePlugin,
  );
  // Datalabels is opt-in per chart; register globally but default to display:false in commonChartOptions().
  Chart.register(datalabelsPlugin);
  chartJsRegistered = true;
}

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

function formatCellValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "—";
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

export function renderHtmlTable(
  rows: Array<Record<string, unknown>>,
  columns: string[],
  headers: Record<string, string>,
  numericColumns: Set<string> = new Set(),
): HTMLTableElement {
  const tableEl = document.createElement("table");
  tableEl.className = "renderer-table";

  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");
  for (const column of columns) {
    const th = document.createElement("th");
    th.scope = "col";
    th.textContent = headers[column] ?? column;
    if (numericColumns.has(column)) {
      th.classList.add("is-numeric");
    }
    headerRow.appendChild(th);
  }
  thead.appendChild(headerRow);
  tableEl.appendChild(thead);

  const tbody = document.createElement("tbody");
  for (const row of rows) {
    const tr = document.createElement("tr");
    for (const column of columns) {
      const td = document.createElement("td");
      td.textContent = formatCellValue(row[column]);
      if (numericColumns.has(column)) {
        td.classList.add("is-numeric");
      }
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  tableEl.appendChild(tbody);

  return tableEl;
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

  wrap.appendChild(
    renderHtmlTable(
      displayRows as Array<Record<string, unknown>>,
      data.columnNames,
      headers,
      numericColumns,
    ),
  );

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

export function xScaleType(
  rows: Row[],
  xKey: string,
): "time" | "category" | "linear" {
  const metaType = getRowSetMeta(rows)?.columnTypes[xKey];
  if (metaType === "temporal") return "time";
  if (metaType === "quantitative") return "linear";
  if (rows.some((row) => row[xKey] instanceof Date)) return "time";
  if (rows.some((row) => typeof row[xKey] === "number")) return "linear";
  return "category";
}

export function asNumber(value: Primitive | undefined): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
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

// ---------- ChartJS helpers ----------

// SVG-based renderers (pie, donut, state-timeline) can use raw `var(--series-N)` strings;
// SVG resolves CSS variables at paint time. Kept for those callers.
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

// Canvas (ChartJS) doesn't resolve CSS variables — values must be concrete colors at draw time.
// Uses a hidden probe element so the browser resolves both `var(--token)` and `light-dark()`
// (which `getComputedStyle().getPropertyValue()` would otherwise return as a literal string).
export function resolveCssVar(expr: string | undefined): string {
  if (!expr) {
    return "#000000";
  }
  if (!expr.includes("var(") && !expr.includes("light-dark")) {
    return expr;
  }
  if (typeof document === "undefined" || !document.body) {
    return expr;
  }
  const probe = document.createElement("span");
  probe.style.display = "none";
  probe.style.color = expr;
  document.body.appendChild(probe);
  const resolved = getComputedStyle(probe).color;
  probe.remove();
  return resolved || expr;
}

export function seriesPalette(): string[] {
  return seriesRange().map(resolveCssVar);
}

// Apply opacity to a resolved color string. Handles rgb()/rgba()/hex inputs;
// raw `var(...)`/`light-dark(...)` won't work — call resolveCssVar() first.
export function colorWithAlpha(color: string, alpha: number): string {
  if (color.startsWith("rgba(")) {
    // Replace the existing alpha rather than returning the input unchanged.
    return color.replace(/,\s*[\d.]+\s*\)$/, `, ${alpha})`);
  }
  if (color.startsWith("rgb(")) {
    return color.replace(/^rgb\(/, "rgba(").replace(/\)$/, `, ${alpha})`);
  }
  return `${color}${Math.round(alpha * 255).toString(16).padStart(2, "0")}`;
}

export interface ChartTokens {
  accent: string;
  info: string;
  textPrimary: string;
  textSecondary: string;
  border: string;
  panel: string;
  panelMuted: string;
  success: string;
  danger: string;
  textOnAccent: string;
}

export function chartTokens(): ChartTokens {
  return {
    accent: resolveCssVar("var(--color-accent)"),
    info: resolveCssVar("var(--color-text-info)"),
    textPrimary: resolveCssVar("var(--color-text-primary)"),
    textSecondary: resolveCssVar("var(--color-text-secondary)"),
    border: resolveCssVar("var(--color-border)"),
    panel: resolveCssVar("var(--color-panel)"),
    panelMuted: resolveCssVar("var(--color-panel-muted)"),
    success: resolveCssVar("var(--color-success)"),
    danger: resolveCssVar("var(--color-danger)"),
    textOnAccent: resolveCssVar("var(--color-text-on-accent)"),
  };
}

export interface ChartMount {
  wrapper: HTMLDivElement;
  canvas: HTMLCanvasElement;
}

export function createChartMount(height = 360): ChartMount {
  const wrapper = document.createElement("div");
  wrapper.className = "renderer-chart-canvas";
  wrapper.style.position = "relative";
  wrapper.style.height = `${height}px`;
  wrapper.style.width = "100%";
  const canvas = document.createElement("canvas");
  wrapper.appendChild(canvas);
  return { wrapper, canvas };
}

interface CanvasWithConfig extends HTMLCanvasElement {
  __chartConfig?: ChartConfiguration;
}

// Instantiate a ChartJS chart on the canvas. The prepared config is stashed on the canvas
// (via `__chartConfig`) so tests can introspect it without depending on a working 2D context.
// In environments without a 2D context (e.g. JSDOM), `new Chart()` is skipped.
export function instantiateChart(
  canvas: HTMLCanvasElement,
  config: ChartConfiguration,
): void {
  ensureChartJsRegistered();
  (canvas as CanvasWithConfig).__chartConfig = config;
  if (typeof canvas.getContext !== "function") {
    return;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }
  new Chart(canvas, config);
}

export function getChartConfig(
  canvas: HTMLCanvasElement,
): ChartConfiguration | undefined {
  return (canvas as CanvasWithConfig).__chartConfig;
}

export function commonChartOptions(): {
  responsive: boolean;
  maintainAspectRatio: boolean;
  plugins: Record<string, unknown>;
  scales: Record<string, unknown>;
} {
  const tokens = chartTokens();
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        labels: { color: tokens.textPrimary },
      },
      tooltip: {
        backgroundColor: tokens.panel,
        titleColor: tokens.textPrimary,
        bodyColor: tokens.textPrimary,
        borderColor: tokens.border,
        borderWidth: 1,
      },
      datalabels: { display: false },
    },
    scales: {
      x: {
        ticks: {
          color: tokens.textSecondary,
          autoSkip: true,
          maxRotation: 45,
          minRotation: 0,
        },
        grid: { color: tokens.border, drawOnChartArea: false },
      },
      y: {
        ticks: { color: tokens.textSecondary },
        grid: { color: tokens.border, drawOnChartArea: true },
      },
    },
  };
}
