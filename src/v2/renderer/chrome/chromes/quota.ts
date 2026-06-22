// Copyright (c) 2025 AccelByte Inc. All Rights Reserved.
// This is licensed software from AccelByte Inc, for limitations
// and restrictions contact your company contract manager.

import type { QuotaUsage } from "../../../shared/render-schemas.js";
import { buildUsageBar } from "../../views/usage-bar.js";
import { defineChrome } from "../types.js";

/** The spend/usage snapshot the bar renders. */
export type QuotaSlice = { usage: QuotaUsage | undefined; namespace?: string };

/**
 * The dashboard's spend/usage meter (`.renderer-usage-bar`). A container-scoped
 * chrome that owns the bar's DOM via {@link buildUsageBar} (pure render). Its
 * data is shared session state refreshed elsewhere (`load_dashboard` /
 * `get_quota_usage`), so it has no `effect` of its own — instead the dashboard
 * keeps the {@link EffectHost} returned by `attachEffect` and calls `host.update`
 * when `session.usage` changes, re-rendering the bar in place. The host's
 * lifecycle (and the dashboard's update hook) is torn down by the surface's
 * `MountScope` on each repaint / teardown.
 */
export const quotaChrome = defineChrome<QuotaSlice>({
  id: "quota",
  scope: "container",
  region: "header-end",
  priority: 30,
  select: (ctx) =>
    ctx.core.container === "dashboard"
      ? { usage: ctx.surface.usage, namespace: ctx.surface.namespace }
      : null,
  render: (slice) => buildUsageBar(slice.usage),
});
