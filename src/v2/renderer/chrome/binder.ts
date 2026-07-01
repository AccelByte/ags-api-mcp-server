// Copyright (c) 2025 AccelByte Inc. All Rights Reserved.
// This is licensed software from AccelByte Inc, for limitations
// and restrictions contact your company contract manager.

import type { DashboardHostBridge } from "../views/dashboard.js";
import type { Cancelled, ToolResult } from "./types.js";

// Re-exported for callers that import the result/cancelled shapes from the binder
// (their natural home); the canonical definitions live in `types.js`.
export type { Cancelled, ToolResult } from "./types.js";

/**
 * Maps an intent `type` to behavior. This is the ONE place a chrome's action
 * becomes a `callServerTool`; a chrome never calls a tool itself. Per-container,
 * so the same `pin`/`refresh` intent can mean different tools in different
 * surfaces. Cross-cutting guards (cost confirm, 429 halt) wrap an entry here as
 * middleware rather than living on a button.
 */
/** One binder entry: invoke a server tool and resolve its result. */
export type BinderEntry = (
  payload?: Record<string, unknown>,
) => Promise<ToolResult>;

export type Binder = Record<string, BinderEntry>;

/**
 * A binder entry wrapped by a gate (e.g. {@link withCostConfirm}) that may
 * decline before the tool runs — so it can resolve the {@link Cancelled}
 * sentinel as well as a {@link ToolResult}. Entries in the {@link Binder} map
 * itself never cancel; only a gate introduces that possibility.
 */
export type GatedBinderAction = (
  payload?: Record<string, unknown>,
) => Promise<ToolResult | Cancelled>;

/**
 * The standalone/dashboard binder — the single table mapping an action to its
 * server tool. Phase 3 shipped `pin`; Phase 4 adds the dashboard's actions so
 * tool names live in ONE place instead of scattered across the data-flow
 * functions. Each entry returns the tool-call promise so the caller (or, later,
 * middleware like `withCostConfirm`) can react to the result.
 */
export function createDashboardBinder(bridge: DashboardHostBridge): Binder {
  const call = (
    name: string,
    payload?: Record<string, unknown>,
  ): Promise<ToolResult> => {
    if (!bridge.callServerTool) {
      return Promise.reject(new Error("Host cannot call server tools."));
    }
    return bridge.callServerTool({ name, arguments: payload });
  };

  return {
    pin: (payload) => call("pin_query", payload),
    refresh: (payload) => call("refresh_pinned_query", payload),
    remove: (payload) => call("unpin_query", payload),
    refreshAll: (payload) => call("refresh_all_pinned", payload),
    quotaRefresh: (payload) => call("get_quota_usage", payload),
    // Edit a pin's layout/label (span resize + title rename). Not billable.
    update: (payload) => call("update_pinned_query", payload),
  };
}

export function isCancelled(
  result: ToolResult | Cancelled,
): result is Cancelled {
  return (result as Cancelled).cancelled === true;
}

/**
 * Cross-cutting cost gate, applied as middleware around an action rather than
 * baked into a button (plan §2). Runs `confirm` first; if declined, short-circuits
 * to a {@link Cancelled} sentinel and the wrapped `action` never runs. The caller
 * supplies `confirm` (it needs surface state — pins/cards — to estimate cost).
 * `confirm` may be async — the gate is an in-DOM dialog, since sandboxed webview
 * hosts block the native `window.confirm`.
 */
export function withCostConfirm(
  confirm: () => boolean | Promise<boolean>,
  action: BinderEntry,
): GatedBinderAction {
  return async (payload) =>
    (await confirm()) ? action(payload) : { cancelled: true };
}
