// Copyright (c) 2025 AccelByte Inc.
// SPDX-License-Identifier: Apache-2.0

import type {
  ChromeContainer,
  ChromeContext,
  ContextFragment,
  PermissionSet,
  PinMeta,
} from "../../shared/chrome-context.js";
import type { QuotaUsage, RenderStats } from "../../shared/render-schemas.js";
import { DIRECT_DATA_SOURCE } from "../../shared/render-schemas.js";

/**
 * The render payload's context fields, as the bundle sees them. This is the
 * client side of the "split" boundary: the server already emits provider/stats
 * as plain JSON; here we translate that into the typed {@link ChromeContext}.
 */
export type ChromeContextInput = {
  container?: ChromeContainer;
  renderType?: string;
  /** `data_source` from the render output ("direct" ⇒ inline snapshot). */
  dataSource?: string;
  stats?: RenderStats;
  sql?: string;
  /** Athena Facade query_id behind the result — the pin's source key. */
  queryId?: string;
  permissions?: PermissionSet;
  pin?: PinMeta;
  title?: string;
  /** Opaque render options forwarded on pin (the chart's `options` object). */
  options?: Record<string, unknown>;
  /** Precomputed chart_type → render tool (the caller owns the mapping). */
  renderTool?: string;
  /** Surface live-state: manage affordances active (fullscreen). */
  interactive?: boolean;
  /** Surface live-state: number of pins on the board. */
  pinCount?: number;
  /** Surface live-state: last-known spend/usage snapshot. */
  usage?: QuotaUsage;
  /** Surface live-state: AGS namespace. */
  namespace?: string;
};

/**
 * Map the payload's `data_source` to a provider fragment. Only `"direct"` is a
 * snapshot; everything else (incl. absent) is treated as facade-resolved — the
 * exact rule the legacy footer notes encoded (source note iff direct; stats note
 * iff facade stats present). New providers add a fragment member, not a branch
 * widened here.
 */
function toFragment(input: ChromeContextInput): ContextFragment {
  if (input.dataSource === DIRECT_DATA_SOURCE) {
    return { kind: "direct", canRefresh: false };
  }
  return {
    kind: "facade",
    canRefresh: true,
    ...(input.sql !== undefined && { sql: input.sql }),
    ...(input.queryId !== undefined && { queryId: input.queryId }),
    ...(input.stats !== undefined && { stats: input.stats }),
  };
}

/** Assemble the sealed core + the provider fragment + render meta into a {@link ChromeContext}. */
export function buildChromeContext(input: ChromeContextInput): ChromeContext {
  return {
    core: {
      container: input.container ?? "standalone",
      renderType: input.renderType ?? "",
      permissions: input.permissions ?? {},
      ...(input.pin !== undefined && { pin: input.pin }),
    },
    provider: toFragment(input),
    render: {
      options: input.options ?? {},
      ...(input.title !== undefined && { title: input.title }),
      ...(input.renderTool !== undefined && { renderTool: input.renderTool }),
    },
    surface: {
      ...(input.interactive !== undefined && { interactive: input.interactive }),
      ...(input.pinCount !== undefined && { pinCount: input.pinCount }),
      ...(input.usage !== undefined && { usage: input.usage }),
      ...(input.namespace !== undefined && { namespace: input.namespace }),
    },
  };
}
