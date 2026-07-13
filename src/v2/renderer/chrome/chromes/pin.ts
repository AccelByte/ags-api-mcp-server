// Copyright (c) 2025 AccelByte Inc.
// SPDX-License-Identifier: Apache-2.0

import { ICONS } from "../../views/icons.js";
import { defineChrome } from "../types.js";

/** Exactly what the pin forwards into `pin_query` — the contract, made explicit. */
export type PinSlice = {
  title: string;
  queryId: string;
  renderTool: string;
  options: Record<string, unknown>;
};

/**
 * "Pin" affordance on a standalone single result. Ported from
 * `maybeAddPinAffordance`: its scattered guards (facade-backed + has a query_id +
 * pinnable chart type + a host that can call tools) are now one data-driven
 * `select`. Pinning forwards the `query_id` to the Athena facade (which
 * re-sources SQL/database/namespace from it), so it applies only to `facade`
 * results — never inline `direct` snapshots.
 */
export const pinChrome = defineChrome<PinSlice>({
  id: "pin",
  scope: "item",
  region: "header-end",
  priority: 10,
  select: (ctx) => {
    if (ctx.core.container !== "standalone") {
      return null;
    }
    if (!ctx.core.permissions.canManagePins) {
      return null; // host can't call server tools
    }
    if (ctx.provider.kind !== "facade" || !ctx.provider.queryId) {
      return null; // only facade-backed results carrying a query_id are pinnable
    }
    if (!ctx.render.renderTool) {
      return null; // chart type isn't in the pinnable set
    }
    return {
      title: ctx.render.title ?? "Pinned query",
      queryId: ctx.provider.queryId,
      renderTool: ctx.render.renderTool,
      options: ctx.render.options,
    };
  },
  render: () => {
    // Icon button, consistent with the dashboard's refresh/remove affordances.
    const button = document.createElement("button");
    button.type = "button";
    button.className = "renderer-dashboard-iconbtn renderer-pin-btn";
    button.title = "Pin";
    button.setAttribute("aria-label", "Pin");
    button.appendChild(ICONS.pin());
    return button;
  },
  intent: (slice) => ({
    type: "pin",
    payload: {
      title: slice.title,
      query_id: slice.queryId,
      render_tool: slice.renderTool,
      render_options: slice.options,
    },
  }),
});
