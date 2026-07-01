import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type {
  RegisteredTool,
  ToolCallback,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v3";

import type { OpenApiTools } from "../../../../../src/tools/openapi-tools.js";
import { setupRenderTools } from "../../../../../src/v2/mcp/tools/renderers/index.js";

interface CapturedTool {
  name: string;
  config: Record<string, unknown>;
  callback: ToolCallback<Record<string, z.ZodTypeAny>>;
}

function createCapturingServer(capturedTools: CapturedTool[]) {
  return {
    registerTool(
      name: string,
      config: Record<string, unknown>,
      callback: ToolCallback<Record<string, z.ZodTypeAny>>,
    ): RegisteredTool {
      capturedTools.push({ name, config, callback });
      return {} as RegisteredTool;
    },
  };
}

describe("setupRenderTools", () => {
  test("registers exactly 24 tools on each server instance without shared provider state", () => {
    const firstServerTools: CapturedTool[] = [];
    const secondServerTools: CapturedTool[] = [];
    const openApiToolsStub = {} as OpenApiTools;

    setupRenderTools(
      createCapturingServer(firstServerTools) as never,
      openApiToolsStub,
    );
    setupRenderTools(
      createCapturingServer(secondServerTools) as never,
      openApiToolsStub,
    );

    const expectedToolNames = [
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
      "render_text_editor",
      // Dashboard home surface (open_dashboard is model-facing; the rest app-only).
      "open_dashboard",
      "load_dashboard",
      "get_quota_usage",
      "pin_query",
      "unpin_query",
      "update_pinned_query",
      "refresh_pinned_query",
      "refresh_all_pinned",
    ];

    assert.equal(firstServerTools.length, 25);
    assert.equal(secondServerTools.length, 25);
    assert.deepEqual(
      firstServerTools.map((tool) => tool.name),
      expectedToolNames,
    );
    assert.deepEqual(
      secondServerTools.map((tool) => tool.name),
      expectedToolNames,
    );
  });
});
