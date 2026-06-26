// Copyright (c) 2025 AccelByte Inc. All Rights Reserved.
// This is licensed software from AccelByte Inc, for limitations
// and restrictions contact your company contract manager.

import type { QuotaUsage, RenderStats } from "./render-schemas.js";

/**
 * The chrome system's context model.
 *
 * The context grows on TWO independent axes, each closed by a different
 * mechanism so neither silently re-grows into a god-struct:
 *
 *   - Provider axis (unbounded — "more than facade/direct"): closed by
 *     provider-contributed {@link ContextFragment}s. A new provider adds a
 *     member to the union; `CoreCtx` never learns provider fields.
 *   - Chrome axis (a new chrome wants a new field): closed by per-chrome
 *     slices (introduced with the resolver). A chrome reads only the slice it
 *     declares, so a field for one chrome cannot ripple into the others.
 *
 * Both are held in place by a SEALED {@link CoreCtx} + a build-failing
 * guardrail (see {@link CORE_CTX_KEY_WITNESS} below and the matching test).
 */

/** Where a render body lives. A stable string set — also used as a resolver axis. */
export type ChromeContainer = "standalone" | "dashboard" | "dashboard-card";

/**
 * Capabilities the host/session grants for chrome that mutates state. Kept
 * minimal on purpose; extend deliberately. (§8 open question: this may itself
 * become a fragment if permission data turns provider/feature-specific.)
 */
export type PermissionSet = {
  /** May the current session create/refresh/remove pins? */
  canManagePins?: boolean;
};

/** Pin identity available only inside a dashboard card (for remove/refresh payloads). */
export type PinMeta = {
  pinId: string;
};

/**
 * SEALED. The ONLY general-purpose context shared by every chrome. Adding a key
 * here is a reviewed event (see the guardrail below), NOT a casual diff.
 *
 * The key set is mirrored, by construction, in both {@link CORE_CTX_KEYS}
 * (runtime allowlist) and {@link CORE_CTX_KEY_WITNESS} (compile-time witness).
 * Growing this type fails `tsc` until the witness is updated, and fails
 * `pnpm test:unit` until the allowlist is updated — turning "add a field" into
 * an explicit, reviewed decision made in the same change.
 */
export type CoreCtx = {
  container: ChromeContainer;
  renderType: string; // "bar" | "table" | "metric" | ...
  permissions: PermissionSet;
  pin?: PinMeta; // present only inside a dashboard card
};

/**
 * The reviewed allowlist of {@link CoreCtx} keys. The runtime half of the
 * sealed-core guardrail: the guardrail test asserts this equals the witness's
 * keys, so an out-of-band edit to either side goes red.
 */
export const CORE_CTX_KEYS = [
  "container",
  "renderType",
  "permissions",
  "pin",
] as const;

/**
 * Compile-time half of the sealed-core guardrail. `Record<keyof CoreCtx, true>`
 * forces this object's keys to match {@link CoreCtx} EXACTLY: adding a field to
 * `CoreCtx` without a matching entry here is a `tsc` error (missing property),
 * and an entry with no matching field is a `tsc` error (excess property).
 *
 * Combined with the runtime test (`Object.keys(witness)` === `CORE_CTX_KEYS`),
 * this transitively pins `CoreCtx` ↔ `CORE_CTX_KEYS`. Do NOT "fix" a build break
 * by editing only this object: the test will then fail until `CORE_CTX_KEYS` is
 * updated too — which is the point.
 */
export const CORE_CTX_KEY_WITNESS: Record<keyof CoreCtx, true> = {
  container: true,
  renderType: true,
  permissions: true,
  pin: true,
};

// --- Provider fragments: each provider contributes its OWN typed slice. The
//     union is the provider axis's extension point; `CoreCtx` never enumerates
//     provider fields. New provider => new member here (a reviewed edit). ---

/** Live results resolved by reference from the facade — re-runnable (billed). */
export type FacadeFragment = {
  kind: "facade";
  /** SQL behind the result, when the facade returned it (drives the copy/foldout chrome). */
  sql?: string;
  /**
   * The Athena Facade query_id behind the result — the pin's source key. The pin
   * chrome forwards it to `pin_query`; the backend re-sources SQL/database/
   * namespace from it, so the model can't hallucinate them. Required for pinning.
   */
  queryId?: string;
  /** Execution stats, when present (drives the stats note). */
  stats?: RenderStats;
  /** Facade results can be re-fetched server-side. */
  canRefresh: true;
};

/** Inline (chat-described) data — a snapshot. Never billed, never refreshable. */
export type DirectFragment = {
  kind: "direct";
  canRefresh: false;
};

/** Discriminated union over `kind`; `select` narrows on it to read its fragment. */
export type ContextFragment = FacadeFragment | DirectFragment;

/**
 * The specific render payload being wrapped — "what is on screen right now,"
 * and the data chrome forwards when it acts (e.g. pin). Distinct from `core`
 * (general identity/placement) and `provider` (where the data came from). This
 * is the third axis the plan's pin description implies ("the opaque options
 * object passed by closure is exactly the implicit contract the Context makes
 * explicit"); keeping it out of the sealed `CoreCtx` preserves that seal.
 */
export type RenderMeta = {
  title?: string;
  /** Opaque, render-type-specific config (e.g. `{x,y}` for a bar). Forwarded verbatim on pin. */
  options: Record<string, unknown>;
  /** The render tool that produced this view (chart_type → tool), when pinnable. */
  renderTool?: string;
};

/**
 * Live state of the surrounding surface — beyond its static identity in
 * `core.container`. Container-scoped chrome reads this for eligibility (e.g.
 * refresh-all shows only in fullscreen with pins present). Kept separate from
 * the sealed `CoreCtx`: this is mutable, dashboard-ish state, not general identity.
 */
export type SurfaceState = {
  /** Manage affordances are interactive only in fullscreen. */
  interactive?: boolean;
  /** Count of pinned items on the board (gates refresh-all). */
  pinCount?: number;
  /** Last-known spend/usage snapshot (the quota chrome renders it). */
  usage?: QuotaUsage;
  /** AGS namespace the surface is scoped to. */
  namespace?: string;
};

/** Assembled context: core is closed; provider data, render payload, and surface state are namespaced. */
export type ChromeContext = {
  core: CoreCtx;
  provider: ContextFragment;
  render: RenderMeta;
  surface: SurfaceState;
};
