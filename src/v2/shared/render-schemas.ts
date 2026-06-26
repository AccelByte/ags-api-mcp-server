// Copyright (c) 2025 AccelByte Inc. All Rights Reserved.
// This is licensed software from AccelByte Inc, for limitations
// and restrictions contact your company contract manager.

import { z } from "zod/v3";

// Bumped to 1.4.0 for the `notice` field on the load_dashboard payload (degraded
// pin-store load) + the tightened 1–12 `span` constraint. 1.3.0 added static-pin
// inline data (data_columns/data_rows) + per-pin `span`; 1.2.0 added
// chart_type:"dashboard" + pinned-query metadata. The app-shell asserts
// host-advertised version == bundle version, so any change to a render payload
// schema MUST bump this.
export const BUNDLE_VERSION = "1.5.0";

export function strictObject<T extends z.ZodRawShape>(
  shape: T,
): z.ZodObject<T, "strict"> {
  return z.object(shape).strict();
}

export const ProviderColumnSchema = strictObject({
  name: z.string(),
  type: z.string(),
});

/** Per-column rendering hint supplied by the user (override format/label). */
export const RenderColumnHintSchema = strictObject({
  type: z.enum(["quantitative", "nominal", "ordinal", "temporal"]).optional(),
  label: z.string().optional(),
  format: z.string().optional(),
});
export type RenderColumnHint = z.infer<typeof RenderColumnHintSchema>;

/** Schema-introspection hint returned by describe-table.insights (not a user input). */
export const SchemaColumnHintSchema = strictObject({
  semantic_type: z
    .enum(["quantitative", "nominal", "ordinal", "temporal"])
    .optional(),
  nullable: z.boolean().optional(),
  aggregatable: z.boolean().optional(),
  known_values: z.array(z.string()).optional(),
  note: z.string().optional(),
});
export type SchemaColumnHint = z.infer<typeof SchemaColumnHintSchema>;

export const FilterValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
]);

export const FilterSchema = strictObject({
  column: z.string(),
  op: z.enum(["eq", "neq", "gt", "gte", "lt", "lte", "in", "not_in"]),
  value: z.union([FilterValueSchema, z.array(FilterValueSchema)]),
});
export type Filter = z.infer<typeof FilterSchema>;

const DataEnvelopeSchema = strictObject({
  columns: z.array(ProviderColumnSchema),
  rows: z.array(z.array(z.string())),
});

export const RenderStatsSchema = strictObject({
  data_scanned_bytes: z.number().optional(),
  engine_execution_time_ms: z.number().optional(),
});
export type RenderStats = z.infer<typeof RenderStatsSchema>;

/**
 * The `data_source` sentinel marking an inline snapshot (never billed, never
 * refreshable). Equals the `direct` provider's name; the renderer keys
 * refreshability off this exact value, so it's one shared constant rather than a
 * literal duplicated across the server payload and the bundle.
 */
export const DIRECT_DATA_SOURCE = "direct";

const CommonEnvelopeFields = {
  title: z.string().optional(),
  description: z.string().optional(),
  column_hints: z.record(z.string(), RenderColumnHintSchema).optional(),
  filters: z.array(FilterSchema).optional(),
  data: DataEnvelopeSchema,
  data_source: z.string().optional(),
  stats: RenderStatsSchema.optional(),
  sql: z.string().optional(),
  // The Athena Facade query_id behind a facade-backed result. Carried through so
  // the standalone Pin button can forward it to `pin_query` as the pin's source
  // key — the backend re-sources SQL/database/namespace from it, so the model
  // can't hallucinate them. Absent for `direct` snapshots (not pinnable).
  query_id: z.string().optional(),
  // The AGS namespace a facade-backed result was resolved from. Carried through
  // so the standalone Pin button can forward it to `pin_query` — AFS queries are
  // namespace-scoped, so it can't be recovered from the `query_id` alone. Absent
  // for `direct` snapshots (which aren't pinnable anyway).
  namespace: z.string().optional(),
};

export const BarChartOutputSchema = strictObject({
  chart_type: z.literal("bar"),
  ...CommonEnvelopeFields,
  options: strictObject({
    x: z.string(),
    y: z.string(),
    color: z.string().optional(),
    bar_mode: z.enum(["grouped", "stacked", "normalized"]).default("grouped"),
    orientation: z.enum(["vertical", "horizontal"]).default("vertical"),
    label: z.string().optional(),
    x_label: z.string().optional(),
    y_label: z.string().optional(),
    tooltip: z.array(z.string()).optional(),
  }),
});

export const LineChartOutputSchema = strictObject({
  chart_type: z.literal("line"),
  ...CommonEnvelopeFields,
  options: strictObject({
    x: z.string(),
    y: z.string(),
    color: z.string().optional(),
    show_points: z.boolean().default(false),
    curve: z.enum(["linear", "smooth", "step"]).default("linear"),
    x_label: z.string().optional(),
    y_label: z.string().optional(),
    tooltip: z.array(z.string()).optional(),
  }),
});

export const AreaChartOutputSchema = strictObject({
  chart_type: z.literal("area"),
  ...CommonEnvelopeFields,
  options: strictObject({
    x: z.string(),
    y: z.string(),
    color: z.string().optional(),
    stack_mode: z.enum(["stacked", "normalized", "overlap"]).default("stacked"),
    curve: z.enum(["linear", "smooth", "step"]).default("linear"),
    x_label: z.string().optional(),
    y_label: z.string().optional(),
    tooltip: z.array(z.string()).optional(),
  }),
});

export const ScatterChartOutputSchema = strictObject({
  chart_type: z.literal("scatter"),
  ...CommonEnvelopeFields,
  options: strictObject({
    x: z.string(),
    y: z.string(),
    color: z.string().optional(),
    size: z.string().optional(),
    trend_line: z.enum(["none", "linear"]).default("none"),
    x_label: z.string().optional(),
    y_label: z.string().optional(),
    tooltip: z.array(z.string()).optional(),
  }),
});

export const HistogramChartOutputSchema = strictObject({
  chart_type: z.literal("histogram"),
  ...CommonEnvelopeFields,
  options: strictObject({
    column: z.string(),
    bin_count: z.number().int().min(1).max(200).optional(),
    normalize: z.boolean().default(false),
    color: z.string().optional(),
    x_label: z.string().optional(),
    y_label: z.string().optional(),
  }),
});

export const BoxChartOutputSchema = strictObject({
  chart_type: z.literal("box"),
  ...CommonEnvelopeFields,
  options: strictObject({
    x: z.string(),
    y: z.string(),
    color: z.string().optional(),
    x_label: z.string().optional(),
    y_label: z.string().optional(),
  }),
});

export const HeatmapChartOutputSchema = strictObject({
  chart_type: z.literal("heatmap"),
  ...CommonEnvelopeFields,
  options: strictObject({
    x: z.string(),
    y: z.string(),
    value: z.string(),
    color_scheme: z.enum(["sequential", "diverging"]).default("sequential"),
    show_values: z.boolean().default(false),
    x_label: z.string().optional(),
    y_label: z.string().optional(),
  }),
});

export const PieChartOutputSchema = strictObject({
  chart_type: z.literal("pie"),
  ...CommonEnvelopeFields,
  options: strictObject({
    category: z.string(),
    value: z.string(),
    show_labels: z.boolean().default(true),
    other_threshold: z.number().min(0).max(1).optional(),
  }),
});

export const DonutChartOutputSchema = strictObject({
  chart_type: z.literal("donut"),
  ...CommonEnvelopeFields,
  options: strictObject({
    category: z.string(),
    value: z.string(),
    show_labels: z.boolean().default(true),
    other_threshold: z.number().min(0).max(1).optional(),
    center_label: z.string().optional(),
    hole: z.number().min(0.3).max(0.7).default(0.5),
  }),
});

export const WaterfallChartOutputSchema = strictObject({
  chart_type: z.literal("waterfall"),
  ...CommonEnvelopeFields,
  options: strictObject({
    category: z.string(),
    value: z.string(),
    is_total: z.string().optional(),
    x_label: z.string().optional(),
    y_label: z.string().optional(),
  }),
});

export const FunnelChartOutputSchema = strictObject({
  chart_type: z.literal("funnel"),
  ...CommonEnvelopeFields,
  options: strictObject({
    stage: z.string(),
    value: z.string(),
    orientation: z.enum(["vertical", "horizontal"]).default("vertical"),
    show_conversion: z.boolean().default(true),
  }),
});

export const GaugeChartOutputSchema = strictObject({
  chart_type: z.literal("gauge"),
  ...CommonEnvelopeFields,
  options: strictObject({
    value: z.string(),
    min: z.number().default(0),
    max: z.number(),
    thresholds: z
      .array(strictObject({ value: z.number(), color: z.string() }))
      .optional(),
    unit: z.string().optional(),
  }),
});

export const StateTimelineChartOutputSchema = strictObject({
  chart_type: z.literal("state_timeline"),
  ...CommonEnvelopeFields,
  options: strictObject({
    entity: z.string(),
    start: z.string(),
    end: z.string(),
    state: z.string(),
  }),
});

export const TableOutputSchema = strictObject({
  chart_type: z.literal("table"),
  ...CommonEnvelopeFields,
  options: strictObject({
    columns_order: z.array(z.string()).optional(),
    page_size: z.number().int().min(1).max(500).default(50),
  }),
});

export const MetricOutputSchema = strictObject({
  chart_type: z.literal("metric"),
  ...CommonEnvelopeFields,
  options: strictObject({
    value: z.string(),
    compare: z.string().optional(),
    label: z.string().optional(),
    unit: z.string().optional(),
    format: z.string().optional(),
  }),
});

export const MeterOutputSchema = strictObject({
  chart_type: z.literal("meter"),
  ...CommonEnvelopeFields,
  options: strictObject({
    value: z.string(),
    max: z.string().optional(),
    label: z.string().optional(),
    color: z.string().optional(),
    unit: z.string().optional(),
    // "percent" is intentionally absent: percentage mode is auto-displayed in the
    // label (e.g. "75%") whenever max is omitted, so an Intl percent format would
    // double-encode whole-number percentage inputs (42 → "4,200%").
    format: z.enum(["number", "compact", "integer"]).optional(),
  }),
});

// ---------- Dashboard (home surface: usage header + pinned-query grid) ----------

/**
 * The render tools a pin may carry. Mirrors the `render_tool` enum the downstream
 * pinned-queries facade resource accepts and stores verbatim. Excludes
 * `render_text_editor` — only data visualizations are pinnable.
 */
export const PIN_RENDER_TOOLS = [
  "render_bar_chart",
  "render_line_chart",
  "render_area_chart",
  "render_scatter_chart",
  "render_histogram_chart",
  "render_box_chart",
  "render_heatmap_chart",
  "render_pie_chart",
  "render_donut_chart",
  "render_waterfall_chart",
  "render_funnel_chart",
  "render_gauge_chart",
  "render_state_timeline_chart",
  "render_table",
  "render_metric",
  "render_meter",
] as const;

export const PinRenderToolSchema = z.enum(PIN_RENDER_TOOLS);
export type PinRenderTool = z.infer<typeof PinRenderToolSchema>;

/**
 * A pin is **static** when it carries its rows inline (a chat-described snapshot)
 * rather than resolving them from the facade via a `query_id`. Shared by the
 * server tools and the webview bundle so the rule can't drift between them.
 *
 * Empty arrays are truthy, so we require a non-empty `data_columns`: a live pin
 * that happens to carry empty inline arrays must NOT be misread as a snapshot and
 * short-circuited away from its facade resolve/refresh.
 */
export function isStaticPin(pin: {
  data_columns?: unknown;
  data_rows?: unknown;
}): boolean {
  return (
    Array.isArray(pin.data_columns) &&
    pin.data_columns.length > 0 &&
    Array.isArray(pin.data_rows)
  );
}

/**
 * Resolve a layout span to the fullscreen 12-col grid. Only an explicit 1–12 is
 * honored; anything wider clamps to 12, and anything invalid (absent, ≤0, NaN,
 * garbage) falls back to the default 4 rather than an unreadable 1-col sliver.
 * Shared by the server tools and the webview bundle to keep layout identical.
 */
export function clampSpan(span: number | undefined): number {
  if (typeof span !== "number" || !Number.isFinite(span) || span < 1) {
    return 4;
  }
  return Math.min(12, Math.floor(span));
}

/**
 * One quota dimension (monthly or lifetime). `limit_usd: null` ⇒ unlimited.
 * Non-strict on purpose: this mirrors an upstream AFS response we don't control
 * (the spec sets no `additionalProperties:false`), so a field added there is
 * stripped rather than throwing and silently blanking the whole usage header.
 */
export const QuotaDimensionSchema = z.object({
  used_usd: z.number().optional(),
  limit_usd: z.number().nullable().optional(),
  projected_run_rate_usd: z.number().optional(),
  period: z.string().optional(),
});
export type QuotaDimension = z.infer<typeof QuotaDimensionSchema>;

/** Snapshot mirroring `GET .../quota/usage` (afs.json `handler.usageResponse`). Non-strict (see above). */
export const QuotaUsageSchema = z.object({
  monthly: QuotaDimensionSchema.optional(),
  lifetime: QuotaDimensionSchema.optional(),
});
export type QuotaUsage = z.infer<typeof QuotaUsageSchema>;

/**
 * Pin metadata carried in the dashboard payload. **No rows** — the row body is
 * fetched per pin via `load_dashboard`, keeping the persisted result small and
 * query data out of the transcript. `render_options` is an opaque object
 * validated per-card at render time (poison-pill isolation).
 */
export const PinnedQueryMetaSchema = strictObject({
  pin_id: z.string(),
  title: z.string(),
  sql: z.string().optional(),
  query_id: z.string().nullable().optional(),
  render_tool: PinRenderToolSchema,
  render_options: z.record(z.string(), z.unknown()).default({}),
  refreshed_at: z.string().nullable().optional(),
  position: z.number().int().optional(),
  updated_at: z.string().optional(),
  /** SQL uses a relative/moving window (current_date - N, now(), …) — re-scans on every refresh. */
  moving_window: z.boolean().optional(),
  /** The pin's cached result is unavailable (expired id / never run) — show "click Refresh". */
  stale: z.boolean().optional(),
  /**
   * Static pin: rows described inline in chat (a snapshot). Their presence marks
   * the pin as static (no facade, never refreshed) — there is no `provider` flag.
   * Reuses `ProviderColumnSchema` (symmetric with the `direct` render provider).
   */
  data_columns: z.array(ProviderColumnSchema).optional(),
  data_rows: z.array(z.array(z.string())).optional(),
  /**
   * Layout width on the fullscreen 12-col grid. The 1–12 range is expressed here;
   * permissive on purpose — out-of-range/garbage never throws, it falls back to 4
   * (`clampSpan` is the matching pre-normalizer for untyped inputs).
   */
  span: z.number().int().min(1).max(12).default(4).catch(4),
});
export type PinnedQueryMeta = z.infer<typeof PinnedQueryMetaSchema>;

/**
 * `open_dashboard` structuredContent — a member of the render union so the
 * app-shell dispatches it. **Metadata only**: pins + usage header, never rows.
 */
export const DashboardOutputSchema = strictObject({
  chart_type: z.literal("dashboard"),
  title: z.string().optional(),
  namespace: z.string().optional(),
  usage: QuotaUsageSchema.optional(),
  pins: z.array(PinnedQueryMetaSchema).default([]),
});
export type DashboardOutput = z.infer<typeof DashboardOutputSchema>;

/**
 * One resolved card in the `load_dashboard` payload: pin metadata plus its
 * resolved body. `render_output` is an opaque RenderOutput (re-validated by the
 * bundle against `RenderOutputSchema` inside a per-card try/catch — defense in
 * depth). `stale`/`error` are mutually exclusive with `render_output` (enforced
 * by the superRefine below).
 */
export const PinnedQueryCardSchema = strictObject({
  pin_id: z.string(),
  title: z.string(),
  render_tool: PinRenderToolSchema,
  render_options: z.record(z.string(), z.unknown()).default({}),
  sql: z.string().optional(),
  query_id: z.string().nullable().optional(),
  refreshed_at: z.string().nullable().optional(),
  position: z.number().int().optional(),
  moving_window: z.boolean().optional(),
  render_output: z.record(z.string(), z.unknown()).optional(),
  stale: z.boolean().optional(),
  error: z.string().optional(),
  /** Static pin: the original inline rows ride along so a focus-reload round-trips them. */
  data_columns: z.array(ProviderColumnSchema).optional(),
  data_rows: z.array(z.array(z.string())).optional(),
  /** Layout width on the fullscreen 12-col grid (1–12); permissive, clamped in code. */
  span: z.number().int().min(1).max(12).default(4).catch(4),
}).superRefine((card, ctx) => {
  // A card resolves to exactly one outcome: a rendered body, a stale marker, or
  // an error. Enforce the documented exclusivity so an illegal "render_output +
  // error" card can't slip through (the view branches on which one is present).
  const present = [card.render_output, card.stale, card.error].filter(
    (v) => v !== undefined && v !== false,
  ).length;
  if (present > 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        "A pinned-query card may set at most one of render_output, stale, or error.",
    });
  }
});
export type PinnedQueryCard = z.infer<typeof PinnedQueryCardSchema>;

/**
 * `load_dashboard` structuredContent — the widget's data + self-rehydrate
 * payload (app-only). Carries resolved card bodies (rows) + usage. Never
 * persisted in conversation history.
 */
export const DashboardDataSchema = strictObject({
  namespace: z.string().optional(),
  usage: QuotaUsageSchema.optional(),
  pins: z.array(PinnedQueryCardSchema).default([]),
  /**
   * Non-fatal degradation message (e.g. the pin store returned a server error so
   * the board fell back to model-held pins). The widget surfaces it as a reconnect
   * hint instead of blanking — distinct from an isError result.
   */
  notice: z.string().optional(),
});
export type DashboardData = z.infer<typeof DashboardDataSchema>;

/** Editable document view (the first input tool — value originates in the webview). */
export const TextEditorOutputSchema = strictObject({
  chart_type: z.literal("text_editor"),
  title: z.string().optional(),
  content: z.string(),
  language: z
    .enum(["markdown", "json", "yaml", "javascript", "text"])
    .optional(),
  filename: z.string().optional(),
});

export const RenderOutputSchema = z.discriminatedUnion("chart_type", [
  BarChartOutputSchema,
  LineChartOutputSchema,
  AreaChartOutputSchema,
  ScatterChartOutputSchema,
  HistogramChartOutputSchema,
  BoxChartOutputSchema,
  HeatmapChartOutputSchema,
  PieChartOutputSchema,
  DonutChartOutputSchema,
  WaterfallChartOutputSchema,
  FunnelChartOutputSchema,
  GaugeChartOutputSchema,
  StateTimelineChartOutputSchema,
  TableOutputSchema,
  MetricOutputSchema,
  MeterOutputSchema,
  TextEditorOutputSchema,
  DashboardOutputSchema,
]);
export type RenderOutput = z.infer<typeof RenderOutputSchema>;
