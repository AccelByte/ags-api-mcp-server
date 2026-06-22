// Copyright (c) 2025 AccelByte Inc. All Rights Reserved.
// This is licensed software from AccelByte Inc, for limitations
// and restrictions contact your company contract manager.

import { ICONS } from "../../views/icons.js";
import { defineChrome } from "../types.js";

/**
 * Container-scoped "Refresh all" affordance in the dashboard header. Ported from
 * the inline button in `buildHeader`: shown only in the dashboard, only when
 * interactive (fullscreen) and there is at least one pin. The cost confirmation
 * is NOT a property of this button — it's `withCostConfirm` middleware on the
 * bound action (plan §2).
 */
export const refreshAllChrome = defineChrome<true>({
  id: "refresh-all",
  scope: "container",
  region: "header-end",
  priority: 10,
  select: (ctx) => {
    if (ctx.core.container !== "dashboard") {
      return null;
    }
    if (!ctx.surface.interactive) {
      return null; // manage affordances are fullscreen-only
    }
    if ((ctx.surface.pinCount ?? 0) <= 0) {
      return null; // nothing to refresh
    }
    return true;
  },
  render: () => {
    // Byte-identical to iconButton("Refresh all", "renderer-dashboard-refresh-all",
    // ICONS.refresh(), …) minus the click handler — the binder wires behavior.
    const button = document.createElement("button");
    button.type = "button";
    button.className = "renderer-dashboard-iconbtn renderer-dashboard-refresh-all";
    button.title = "Refresh all";
    button.setAttribute("aria-label", "Refresh all");
    button.appendChild(ICONS.refresh());
    return button;
  },
  intent: () => ({ type: "refresh-all" }),
});
