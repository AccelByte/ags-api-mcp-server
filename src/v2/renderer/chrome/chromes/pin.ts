// Copyright (c) 2025 AccelByte Inc. All Rights Reserved.
// This is licensed software from AccelByte Inc, for limitations
// and restrictions contact your company contract manager.

import { defineChrome } from "../types.js";

/** Exactly what the pin forwards into `pin_query` — the contract, made explicit. */
export type PinSlice = {
  title: string;
  sql: string;
  renderTool: string;
  options: Record<string, unknown>;
};

/**
 * "Pin" affordance on a standalone single result. Ported from
 * `maybeAddPinAffordance`: its scattered guards (facade-backed + has SQL +
 * pinnable chart type + a host that can call tools) are now one data-driven
 * `select`. Pinning persists SQL to the Athena facade, so it applies only to
 * `facade` results — never inline `direct` snapshots.
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
    if (ctx.provider.kind !== "facade" || !ctx.provider.sql) {
      return null; // only facade-backed results carrying SQL are pinnable
    }
    if (!ctx.render.renderTool) {
      return null; // chart type isn't in the pinnable set
    }
    return {
      title: ctx.render.title ?? "Pinned query",
      sql: ctx.provider.sql,
      renderTool: ctx.render.renderTool,
      options: ctx.render.options,
    };
  },
  render: () => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "renderer-pin-btn";
    button.textContent = "Pin";
    button.title = "Keep this chart on the dashboard";
    return button;
  },
  intent: (slice) => ({
    type: "pin",
    payload: {
      title: slice.title,
      sql: slice.sql,
      render_tool: slice.renderTool,
      render_options: slice.options,
    },
  }),
});
