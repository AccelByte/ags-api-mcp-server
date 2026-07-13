// Copyright (c) 2025 AccelByte Inc.
// SPDX-License-Identifier: Apache-2.0

import type { RenderStats } from "../../../shared/render-schemas.js";
import { defineChrome, type AnyChrome } from "../types.js";

// --- formatting (ported verbatim from base.ts's appendStatsNote) ---

// NOTE: intentionally distinct from the dashboard spend-header byte formatter
// (views/dashboard.ts `formatBytes`): this one scales to PB for scanned-bytes
// stats; that one stops at TB with different precision. Don't "dedup" them — the
// formatted output differs by call site.
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

/** Build the stats label, or "" when there's nothing displayable (the eligibility gate). */
function formatStatsText(stats: RenderStats): string {
  const parts: string[] = [];
  if (typeof stats.data_scanned_bytes === "number") {
    parts.push(`scanned ${formatBytes(stats.data_scanned_bytes)}`);
  }
  if (typeof stats.engine_execution_time_ms === "number") {
    parts.push(formatDurationMs(stats.engine_execution_time_ms));
  }
  return parts.join(" · ");
}

// --- chromes ---

/**
 * "source: inline" label, shown only for inline (direct-provider) data. Ported
 * from `appendInlineSourceNote`; its `dataSource !== "direct"` guard is now the
 * fragment-kind check in `select`.
 */
export const sourceNoteChrome = defineChrome<true>({
  id: "source-note",
  scope: "item",
  region: "footer-start",
  priority: 10,
  select: (ctx) => (ctx.provider.kind === "direct" ? true : null),
  render: () => {
    const note = document.createElement("span");
    note.className = "renderer-footer-source";
    note.textContent = "source: inline";
    return note;
  },
});

/**
 * Scanned-bytes + execution-time label, shown when the facade returned stats.
 * Ported from `appendStatsNote`; `select` returns the pre-formatted text so
 * eligibility ("is there anything to show?") can't drift from what `render` draws.
 */
export const statsNoteChrome = defineChrome<{ text: string }>({
  id: "stats-note",
  scope: "item",
  region: "footer-end",
  priority: 20,
  select: (ctx) => {
    if (ctx.provider.kind !== "facade" || !ctx.provider.stats) {
      return null;
    }
    const text = formatStatsText(ctx.provider.stats);
    return text.length > 0 ? { text } : null;
  },
  render: (slice) => {
    const note = document.createElement("span");
    note.className = "renderer-footer-stats";
    note.textContent = slice.text;
    return note;
  },
});

/** The first two ported chromes — both presentational, data-gated, no intent. */
export const FOOTER_NOTE_CHROMES: readonly AnyChrome[] = [
  sourceNoteChrome,
  statsNoteChrome,
];
