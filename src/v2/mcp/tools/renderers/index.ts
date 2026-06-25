// Copyright (c) 2025 AccelByte Inc. All Rights Reserved.
// This is licensed software from AccelByte Inc, for limitations
// and restrictions contact your company contract manager.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { OpenApiTools } from "../../../../tools/openapi-tools.js";
import { createDirectProvider } from "../providers/direct.js";
import { createFacadeProvider } from "../providers/facade.js";
import { createProviderRegistry } from "../providers/registry.js";
import { setupRenderAreaChart } from "./area.js";
import { setupRenderBarChart } from "./bar.js";
import { setupRenderBoxChart } from "./box.js";
import { setupDashboardTools } from "./dashboard.js";
import { setupRenderDonutChart } from "./donut.js";
import { setupRenderFunnelChart } from "./funnel.js";
import { setupRenderGaugeChart } from "./gauge.js";
import { setupRenderHeatmapChart } from "./heatmap.js";
import { setupRenderHistogramChart } from "./histogram.js";
import { setupRenderLineChart } from "./line.js";
import { setupRenderMeter } from "./meter.js";
import { setupRenderMetric } from "./metric.js";
import { setupRenderPieChart } from "./pie.js";
import { setupRenderScatterChart } from "./scatter.js";
import { setupRenderStateTimelineChart } from "./state-timeline.js";
import { setupRenderTable } from "./table.js";
import { setupRenderTextEditor } from "./text-editor.js";
import { setupRenderWaterfallChart } from "./waterfall.js";

/**
 * Single composition function. Every entry point gets the same render tools
 * plus the dashboard tool set. No entry-point-specific registration.
 *
 * @param defaultNamespace - namespace from the per-request context (hosted
 *   mode), used as the default for the dashboard's namespace-scoped tools.
 */
export function setupRenderTools(
  server: McpServer,
  openApiTools: OpenApiTools,
  defaultNamespace?: string,
  allowDirectPins = false,
): void {
  const registry = createProviderRegistry([
    createFacadeProvider(openApiTools),
    createDirectProvider(),
  ]);

  setupRenderBarChart(server, registry);
  setupRenderLineChart(server, registry);
  setupRenderAreaChart(server, registry);
  setupRenderScatterChart(server, registry);
  setupRenderHistogramChart(server, registry);
  setupRenderBoxChart(server, registry);
  setupRenderHeatmapChart(server, registry);
  setupRenderPieChart(server, registry);
  setupRenderDonutChart(server, registry);
  setupRenderWaterfallChart(server, registry);
  setupRenderFunnelChart(server, registry);
  setupRenderGaugeChart(server, registry);
  setupRenderStateTimelineChart(server, registry);
  setupRenderTable(server, registry);
  setupRenderMetric(server, registry);
  setupRenderMeter(server, registry);
  setupRenderTextEditor(server);

  // Dashboard home surface: open_dashboard (model-facing) + app-only
  // load/pin/unpin/refresh/usage tools, all bound to the same renderer resource.
  setupDashboardTools(server, openApiTools, defaultNamespace, allowDirectPins);
}

export default setupRenderTools;
