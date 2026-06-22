// Copyright (c) 2025 AccelByte Inc. All Rights Reserved.
// This is licensed software from AccelByte Inc, for limitations
// and restrictions contact your company contract manager.

import type {
  AnyChrome,
  ChromeContext,
  Region,
  UserPrefs,
} from "./types.js";
import { REGION_ORDER } from "./types.js";

/** A chrome paired with the slice its `select` returned (never null here). */
export type ResolvedChrome = { chrome: AnyChrome; slice: unknown };

/** Resolver output: active chromes grouped by region, ordered within each. */
export type Resolved = Record<Region, ResolvedChrome[]>;

function emptyResolved(): Resolved {
  return {
    "header-start": [],
    "header-end": [],
    "footer-start": [],
    "footer-end": [],
    overflow: [],
  };
}

/**
 * Rank by explicit `prefs.order` first (future reorder; empty today), then by a
 * chrome's declared `priority`. Stable for equal keys.
 */
function rank(chrome: AnyChrome, order?: readonly string[]): number {
  const index = order?.indexOf(chrome.id) ?? -1;
  // Ordered ids sort ahead of unordered ones, by their position in `order`.
  return index >= 0 ? index : Number.MAX_SAFE_INTEGER;
}

/**
 * ALL presence + order decisions live here — the single choke point. The frame
 * never hardcodes order; a chrome never hides itself. `prefs` is the seam for
 * future reorder/hide (empty today, a no-op): keeping it in the signature means
 * those features are a data change, not a structural one.
 */
export function resolve(
  all: readonly AnyChrome[],
  ctx: ChromeContext,
  prefs?: UserPrefs,
): Resolved {
  const active = all
    .map((chrome) => ({ chrome, slice: chrome.select(ctx) }))
    .filter((entry): entry is ResolvedChrome => entry.slice !== null) // eligibility
    .filter((entry) => !prefs?.hidden?.has(entry.chrome.id)) // future "hide"
    .sort((a, b) => {
      const byOrder = rank(a.chrome, prefs?.order) - rank(b.chrome, prefs?.order);
      return byOrder !== 0 ? byOrder : a.chrome.priority - b.chrome.priority;
    });

  const grouped = emptyResolved();
  for (const entry of active) {
    grouped[entry.chrome.region].push(entry);
  }
  return grouped;
}

/** Total count of active chromes — handy for tests and overflow decisions. */
export function activeCount(resolved: Resolved): number {
  return REGION_ORDER.reduce((sum, region) => sum + resolved[region].length, 0);
}
