// Copyright (c) 2025 AccelByte Inc. All Rights Reserved.
// This is licensed software from AccelByte Inc, for limitations
// and restrictions contact your company contract manager.

import { getRowSetMeta, type Row } from "./types.js";

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

export interface MountShellOptions {
  title?: string;
  description?: string;
  chartType?: string;
  dataSource?: string;
  stats?: RenderStats;
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

  appendInlineSourceNote(footer, options.dataSource);
  appendStatsNote(footer, options.stats);

  return { body, footer };
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
