// Copyright (c) 2025 AccelByte Inc. All Rights Reserved.
// This is licensed software from AccelByte Inc, for limitations
// and restrictions contact your company contract manager.

import { z } from "zod/v3";

export const BUNDLE_VERSION = "1.0.0";

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

const CommonEnvelopeFields = {
  title: z.string().optional(),
  description: z.string().optional(),
  column_hints: z.record(z.string(), RenderColumnHintSchema).optional(),
  filters: z.array(FilterSchema).optional(),
  data: DataEnvelopeSchema,
  data_source: z.string().optional(),
  stats: RenderStatsSchema.optional(),
  sql: z.string().optional(),
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
]);
export type RenderOutput = z.infer<typeof RenderOutputSchema>;
