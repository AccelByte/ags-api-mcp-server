// Copyright (c) 2025 AccelByte Inc. All Rights Reserved.
// This is licensed software from AccelByte Inc, for limitations
// and restrictions contact your company contract manager.

// The dashboard spend/usage meter (`.renderer-usage-bar`). Extracted from
// dashboard.ts so the `quota` chrome can render it without importing the whole
// dashboard module.

import type { QuotaUsage } from "../../shared/render-schemas.js";

function round2(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "—";
  }
  return `$${value.toFixed(2)}`;
}

function buildUsageMeter(
  label: string,
  used: number | undefined,
  limit: number | null,
  suffix: string,
): HTMLElement {
  const cell = document.createElement("div");
  cell.className = "renderer-usage-cell";

  const head = document.createElement("div");
  head.className = "renderer-usage-head";
  const name = document.createElement("span");
  name.className = "renderer-usage-label";
  name.textContent = label;
  const value = document.createElement("span");
  value.className = "renderer-usage-value";
  value.textContent =
    limit !== null
      ? `${round2(used)} / ${round2(limit)}${suffix}`
      : `${round2(used)}${suffix}`;
  head.append(name, value);
  cell.append(head);

  if (limit !== null && limit > 0 && typeof used === "number") {
    const track = document.createElement("div");
    track.className = "renderer-usage-track";
    const fill = document.createElement("div");
    fill.className = "renderer-usage-fill";
    const ratio = Math.min(1, Math.max(0, used / limit));
    fill.style.width = `${(ratio * 100).toFixed(1)}%`;
    if (used >= limit) {
      fill.dataset.state = "over";
    }
    track.append(fill);
    cell.append(track);
  }
  return cell;
}

export function buildUsageBar(usage: QuotaUsage | undefined): HTMLElement {
  const bar = document.createElement("div");
  bar.className = "renderer-usage-bar";

  if (!usage || (!usage.monthly && !usage.lifetime)) {
    const empty = document.createElement("span");
    empty.className = "renderer-usage-empty";
    empty.textContent = "Usage unavailable";
    bar.append(empty);
    return bar;
  }

  if (usage.monthly) {
    const m = usage.monthly;
    const label = m.period ? `Monthly · ${m.period}` : "Monthly";
    const suffix =
      typeof m.projected_run_rate_usd === "number" &&
      m.projected_run_rate_usd > 0
        ? ` · projected ${round2(m.projected_run_rate_usd)}`
        : "";
    bar.append(buildUsageMeter(label, m.used_usd, m.limit_usd ?? null, suffix));
  }
  if (usage.lifetime) {
    const l = usage.lifetime;
    bar.append(
      buildUsageMeter("Lifetime", l.used_usd, l.limit_usd ?? null, ""),
    );
  }
  return bar;
}
