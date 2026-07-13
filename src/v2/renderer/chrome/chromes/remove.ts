// Copyright (c) 2025 AccelByte Inc.
// SPDX-License-Identifier: Apache-2.0

import { ICONS } from "../../views/icons.js";
import { defineChrome } from "../types.js";

/** What "remove" forwards — the pin to unpin. */
export type RemoveSlice = { pinId: string };

/**
 * "Remove" affordance for a dashboard card, hosted in the kebab (`overflow`
 * region). Ported from the inline menu item in `buildOverflowMenu`: shown for any
 * card when interactive (fullscreen). The dropdown shell + open/close behavior
 * stay with the card; this declares the item's eligibility, presentation, and
 * the `remove` intent. Behavior (unpin) lives in the binder/orchestration.
 */
export const removeChrome = defineChrome<RemoveSlice>({
  id: "remove",
  scope: "item",
  region: "overflow",
  priority: 10,
  select: (ctx) => {
    if (ctx.core.container !== "dashboard-card") {
      return null;
    }
    if (!ctx.surface.interactive) {
      return null; // manage affordances are fullscreen-only
    }
    if (!ctx.core.pin) {
      return null; // no pin identity to remove
    }
    return { pinId: ctx.core.pin.pinId };
  },
  render: () => {
    // Byte-identical to the legacy Remove menu item built in buildOverflowMenu.
    const button = document.createElement("button");
    button.type = "button";
    button.className =
      "renderer-dashboard-card-menu-item renderer-dashboard-card-remove";
    button.setAttribute("role", "menuitem");
    button.appendChild(ICONS.trash());
    const label = document.createElement("span");
    label.textContent = "Remove";
    button.appendChild(label);
    return button;
  },
  intent: (slice) => ({ type: "remove", payload: { pin_id: slice.pinId } }),
});
