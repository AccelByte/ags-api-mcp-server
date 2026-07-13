// Copyright (c) 2025 AccelByte Inc.
// SPDX-License-Identifier: Apache-2.0

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v3";

import { MeterOutputSchema } from "../../../shared/render-schemas.js";
import type { ProviderRegistry } from "../providers/registry.js";
import { defineRenderTool } from "./define.js";

export function setupRenderMeter(
  server: McpServer,
  registry: ProviderRegistry,
): void {
  defineRenderTool({
    server,
    registry,
    name: "render_meter",
    title: "Render Meter",
    description:
      "Render a query result as one or more horizontal meters (progress / fill bars), one meter per row — each showing a value against a maximum. " +
      "value names the current-value column; max names an optional per-row maximum (fill = value/max). When max is omitted, value is treated as a 0–100 percentage. " +
      "Meters whose fill exceeds 100% are automatically clamped to full-width and recolored to the danger token (red); supplying a color column suppresses this automatic recolor. " +
      'Use provider="facade" to render server-side results by reference (fidelity-preserving). ' +
      'Use provider="direct" only for small inline datasets.',
    chartType: "meter",
    outputSchema: MeterOutputSchema,
    optionFields: {
      value: z
        .string()
        .describe(
          "Column name for each meter's current value (one meter per row).",
        ),
      max: z
        .string()
        .optional()
        .describe(
          "Optional column for each meter's maximum. When omitted, value is treated as a 0–100 percentage.",
        ),
      label: z
        .string()
        .optional()
        .describe(
          "Optional column providing each meter's label. Falls back to 'Meter 1', 'Meter 2', … when omitted.",
        ),
      color: z
        .string()
        .optional()
        .describe(
          "Optional column providing a per-meter fill color override (CSS color or var(--…)). Defaults to the brand series palette. " +
            "When supplied, this override wins even on over-limit rows — omit it if you want the automatic danger highlight.",
        ),
      unit: z
        .string()
        .optional()
        .describe(
          "Optional column providing each meter's unit suffix (e.g. GB, users), shown once after the max value. Lets meters carry different units.",
        ),
      format: z
        .enum(["number", "compact", "integer"])
        .optional()
        .describe(
          "Optional number format for displayed values: number (default, grouped), compact (1.5M), or integer.",
        ),
    },
    mapInputToOptions: (input) => ({
      value: input.value,
      max: input.max,
      label: input.label,
      color: input.color,
      unit: input.unit,
      format: input.format,
    }),
  });
}

export default setupRenderMeter;
