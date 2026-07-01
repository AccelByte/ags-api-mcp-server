// Copyright (c) 2025 AccelByte Inc. All Rights Reserved.
// This is licensed software from AccelByte Inc, for limitations
// and restrictions contact your company contract manager.

import { clampSpan, MAX_SPAN, MIN_SPAN } from "../../../shared/render-schemas.js";
import { ICONS } from "../../views/icons.js";
import { defineChrome } from "../types.js";
import type { ChromeContext } from "../types.js";

/** Pin identity + current width the "Wider"/"Narrower" items act on. */
export type ResizeSlice = { pinId: string; span: number };

/**
 * Shared eligibility for the two width items: a dashboard card, fullscreen
 * (interactive), with a pin identity, and **live only**. Static/snapshot pins
 * (`canRefresh === false`) have no durable store row to PATCH, so they get no
 * resize control — a snapshot's width is changed by re-prompting the model to
 * re-open the dashboard. This mirrors `removeChrome`'s gating plus the same
 * `canRefresh` signal `refreshChrome` reads.
 */
function selectResize(ctx: ChromeContext): ResizeSlice | null {
  if (ctx.core.container !== "dashboard-card") {
    return null;
  }
  if (!ctx.surface.interactive) {
    return null; // manage affordances are fullscreen-only
  }
  if (!ctx.core.pin) {
    return null; // no pin identity to resize
  }
  if (!ctx.provider.canRefresh) {
    return null; // static/snapshot pins are not durably editable
  }
  return { pinId: ctx.core.pin.pinId, span: clampSpan(ctx.core.pin.span) };
}

/**
 * A kebab menu item that steps a pin's grid width. Same base shell as
 * `removeChrome`'s item (button + role=menuitem + icon + label span), plus a
 * `disabled` branch: at a bound it renders a greyed item that also can't fire a
 * click (so the bound needs no extra guard in the card wiring).
 */
function resizeMenuItem(
  className: string,
  label: string,
  icon: SVGElement,
  disabled: boolean,
): HTMLElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `renderer-dashboard-card-menu-item ${className}`;
  button.setAttribute("role", "menuitem");
  if (disabled) {
    button.disabled = true;
    button.setAttribute("aria-disabled", "true");
  }
  button.appendChild(icon);
  const text = document.createElement("span");
  text.textContent = label;
  button.appendChild(text);
  return button;
}

/** "Wider" (+1 column). Disabled at the 12-col max. */
export const growChrome = defineChrome<ResizeSlice>({
  id: "grow",
  scope: "item",
  region: "overflow",
  priority: 5, // ahead of Remove (10) — width controls read first in the kebab
  select: selectResize,
  render: (slice) =>
    resizeMenuItem(
      "renderer-dashboard-card-grow",
      "Wider",
      ICONS.plus(),
      slice.span >= MAX_SPAN,
    ),
  intent: (slice) => ({
    type: "update",
    payload: { pin_id: slice.pinId, span: Math.min(MAX_SPAN, slice.span + 1) },
  }),
});

/** "Narrower" (−1 column). Disabled at the 1-col min. */
export const shrinkChrome = defineChrome<ResizeSlice>({
  id: "shrink",
  scope: "item",
  region: "overflow",
  priority: 6, // just after Wider, still before Remove
  select: selectResize,
  render: (slice) =>
    resizeMenuItem(
      "renderer-dashboard-card-shrink",
      "Narrower",
      ICONS.minus(),
      slice.span <= MIN_SPAN,
    ),
  intent: (slice) => ({
    type: "update",
    payload: { pin_id: slice.pinId, span: Math.max(MIN_SPAN, slice.span - 1) },
  }),
});
