// Copyright (c) 2025 AccelByte Inc. All Rights Reserved.
// This is licensed software from AccelByte Inc, for limitations
// and restrictions contact your company contract manager.

import { ICONS } from "../../views/icons.js";
import { defineChrome } from "../types.js";

/**
 * Refresh affordance state. `canRefresh` distinguishes the two behaviors the
 * single button drives: a live (facade) pin re-runs server-side; a static
 * (snapshot/direct) pin re-renders its inline rows in place. The chrome declares
 * this from `provider.canRefresh`; the card wires the matching action.
 */
export type RefreshSlice = { canRefresh: boolean };

/**
 * Per-card "Refresh" primary icon. Ported from the inline button in `buildCard`:
 * shown for BOTH static and live pins when interactive (fullscreen). It has no
 * single `intent` because it is dual-mode — live → `refreshOne` (server, via
 * `binder.refresh`), static → `rerenderCard` (local, no server). The card glue
 * branches on `slice.canRefresh`; this chrome owns the "when shown" + the icon.
 */
export const refreshChrome = defineChrome<RefreshSlice>({
  id: "refresh",
  scope: "item",
  region: "header-end",
  priority: 10,
  select: (ctx) => {
    if (ctx.core.container !== "dashboard-card") {
      return null;
    }
    if (!ctx.surface.interactive) {
      return null; // manage affordances are fullscreen-only
    }
    return { canRefresh: ctx.provider.canRefresh };
  },
  render: () => {
    // Byte-identical to iconButton("Refresh", "renderer-dashboard-card-refresh",
    // ICONS.refresh(), …) minus the click handler — the card wires the dual mode.
    const button = document.createElement("button");
    button.type = "button";
    button.className = "renderer-dashboard-iconbtn renderer-dashboard-card-refresh";
    button.title = "Refresh";
    button.setAttribute("aria-label", "Refresh");
    button.appendChild(ICONS.refresh());
    return button;
  },
});
