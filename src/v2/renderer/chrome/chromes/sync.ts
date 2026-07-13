// Copyright (c) 2025 AccelByte Inc.
// SPDX-License-Identifier: Apache-2.0

import { defineChrome } from "../types.js";

/**
 * A behavior-only container chrome: the dashboard's "reload on refocus" rule.
 * It's the first real `Chrome.effect` event-subscription consumer — on mount it
 * subscribes to `visibilitychange` and, when the tab becomes visible, dispatches
 * a `reload` intent (the container binder maps it to `loadData`); cleanup removes
 * the listener. Mounting/unmounting is owned by the surface's `MountScope`
 * (disposed on every repaint/teardown), so exactly one listener is live while the
 * dashboard is shown — replacing the old module-level singleton listener.
 *
 * Renders a hidden marker: it's the runtime handle for the effect, not visible UI.
 */
export const syncChrome = defineChrome<true>({
  id: "sync",
  scope: "container",
  region: "header-start",
  priority: 0,
  select: (ctx) => (ctx.core.container === "dashboard" ? true : null),
  render: () => {
    const marker = document.createElement("span");
    marker.className = "renderer-dashboard-sync";
    marker.hidden = true;
    marker.setAttribute("aria-hidden", "true");
    return marker;
  },
  effect: (_slice, host) => {
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void host.dispatch({ type: "reload" });
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  },
});
