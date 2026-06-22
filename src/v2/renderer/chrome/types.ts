// Copyright (c) 2025 AccelByte Inc. All Rights Reserved.
// This is licensed software from AccelByte Inc, for limitations
// and restrictions contact your company contract manager.

/**
 * The client-owned half of the chrome system.
 * The server emits pure context (provider data, stats, capabilities); the
 * renderer bundle owns the chrome registry, resolver (placement), and binder
 * (behavior). These are the shared shapes the three concerns talk through.
 */

import type { ChromeContext } from "../../shared/chrome-context.js";

export type { ChromeContext } from "../../shared/chrome-context.js";

/**
 * Named placement slots a {@link Frame} exposes. `overflow` is the kebab-collapse
 * target (a dropdown, not a corner — see §catalog "kebab"). Several regions can
 * map to the same physical DOM container; placement stays logical.
 */
export type Region =
  | "header-start"
  | "header-end"
  | "footer-start"
  | "footer-end"
  | "overflow";

/**
 * Canonical order the frame mounts regions in. Intra-region order is by chrome
 * `priority`; inter-region order is fixed here. Footer source-note (footer-start)
 * thus precedes the stats-note (footer-end), matching the legacy append order.
 */
export const REGION_ORDER: readonly Region[] = [
  "header-start",
  "header-end",
  "overflow",
  "footer-start",
  "footer-end",
];

/** A chrome's rendered output — a DOM node the frame mounts into a region. */
export type ChromeView = HTMLElement;

/**
 * The closed set of actions a chrome can emit. A union (not `string`) so a chrome
 * can't emit an intent no surface handles — adding one is a deliberate, compile-
 * checked edit. The dashboard routes these to the tool binder (`pin`/`remove`/
 * `refresh-all`) or to a container action (`reload`).
 */
export type IntentType = "pin" | "remove" | "refresh-all" | "reload";

/**
 * What a chrome emits on activation. The binder (Phase 3) maps `type` →
 * `callServerTool`; a chrome NEVER calls a tool itself. Presentational chrome
 * (footer notes) leaves `intent` undefined.
 */
export type Intent = { type: IntentType; payload?: Record<string, unknown> };

/** What a server-tool call resolves to (the subset chrome behavior reads). */
export type ToolResult = {
  isError?: boolean;
  structuredContent?: unknown;
  content?: Array<{ type?: string; text?: string }>;
  _meta?: Record<string, unknown>;
};

/** Returned by a cost-confirm gate when declined — no tool call happened. */
export type Cancelled = { cancelled: true };

/** Cleanup returned by an effect; the frame runs it on unmount / re-resolve. */
export type Dispose = () => void;

/**
 * What an {@link Chrome.effect} may do. It drives behavior THROUGH the binder
 * (never calls a tool directly) and re-renders in place — it must not reach for
 * the DOM raw. The frame builds one per mounted effect-chrome.
 */
export interface EffectHost {
  /** The element this chrome rendered (kept current across `update`). */
  readonly element: ChromeView;
  /** Fire an intent through the binder — the SAME path a click takes. */
  dispatch(intent: Intent): Promise<ToolResult | Cancelled>;
  /** Re-run `render` with a new slice and swap the element in place. No-op after dispose. */
  update(slice: unknown): void;
  /** Register a cleanup (sugar for multiple subscriptions). */
  onDispose(fn: Dispose): void;
}

/**
 * One chrome, declared once. `select` fuses "do I apply here" with "do I have my
 * data": returning `null` means not shown, a non-null slice is exactly the data
 * `render`/`intent` read. So eligibility can't drift out of sync with the data.
 */
export type Chrome<Slice> = {
  /** Stable string — enables future persisted reorder/hide. */
  id: string;
  scope: "item" | "container";
  region: Region;
  /** Order within a region + overflow-collapse order. */
  priority: number;
  /** Data-driven eligibility: `null` ⇒ not shown. */
  select: (ctx: ChromeContext) => Slice | null;
  /** Pure presentation from the selected slice. */
  render: (slice: Slice) => ChromeView;
  /** Emits an intent (does NOT call). Undefined for presentational chrome. */
  intent?: (slice: Slice) => Intent;
  /**
   * Lifecycle/event-driven behavior — runs ONCE after mount with the same slice
   * `render` got + an {@link EffectHost}. Subscribe to events here and return a
   * disposer (or use `host.onDispose`); the frame runs it on unmount/re-resolve.
   * Drive behavior via `host.dispatch` (→ binder) and re-paint via `host.update`.
   */
  effect?: (slice: Slice, host: EffectHost) => Dispose | void;
};

/**
 * A chrome of unknown slice type, for heterogeneous registries. `any` (not
 * `unknown`) is deliberate: `select`/`render` are functions of `Slice`, so a
 * concrete `Chrome<X>` is only assignable to the registry element type under
 * `any`'s bivariance. The slice is re-paired with its chrome by {@link resolve},
 * so the looseness never escapes the pipe. (Renderer files are not ESLint-typed.)
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyChrome = Chrome<any>;

/** Reorder/hide inputs to the resolver. Empty today — no config UI is built. */
export type UserPrefs = {
  hidden?: ReadonlySet<string>;
  /** Chrome ids in desired order; ids absent here keep their declared priority. */
  order?: readonly string[];
};

/** Author a chrome with full slice type-safety, then store it as an AnyChrome. */
export function defineChrome<Slice>(chrome: Chrome<Slice>): Chrome<Slice> {
  return chrome;
}
