import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type {
  RegisteredTool,
  ToolCallback,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v3";

import type { OpenApiTools } from "../../../../../src/tools/openapi-tools.js";
import setupRenderTools from "../../../../../src/v2/mcp/tools/renderers/index.js";
import {
  buildPinRenderOutput,
  listRenderToolNames,
} from "../../../../../src/v2/mcp/tools/renderers/define.js";
import {
  DashboardDataSchema,
  DashboardOutputSchema,
  PIN_RENDER_TOOLS,
  PinnedQueryCardSchema,
  PinnedQueryMetaSchema,
  RenderOutputSchema,
} from "../../../../../src/v2/shared/render-schemas.js";

type RunApi = OpenApiTools["runApi"];
interface ToolEntry {
  config: Record<string, unknown>;
  cb: ToolCallback<Record<string, z.ZodTypeAny>>;
}

function setupTools(
  runApi: RunApi,
  namespace = "studioalpha",
  allowDirectPins = true,
): Map<string, ToolEntry> {
  const tools = new Map<string, ToolEntry>();
  const server = {
    registerTool(
      name: string,
      config: Record<string, unknown>,
      cb: ToolCallback<Record<string, z.ZodTypeAny>>,
    ): RegisteredTool {
      tools.set(name, { config, cb });
      return {} as RegisteredTool;
    },
  };
  setupRenderTools(
    server as never,
    { runApi } as OpenApiTools,
    namespace,
    allowDirectPins,
  );
  return tools;
}

const EXTRA = { authInfo: { token: "tok" } };

/** Build a fake runApi that dispatches on the resolved path. */
function fakeRunApi(
  handlers: Partial<{
    quotaUsage: () => unknown;
    query: () => unknown;
    pinnedQueries: () => unknown;
  }>,
): RunApi {
  return (async (args: { path?: string }) => {
    const path = args.path ?? "";
    if (path.includes("/quota/usage")) {
      return handlers.quotaUsage?.() ?? { response: { status: 200, data: {} } };
    }
    if (path.includes("/queries/")) {
      return handlers.query?.() ?? { response: { status: 200, data: {} } };
    }
    if (path.includes("/pinned-queries")) {
      if (handlers.pinnedQueries) {
        return handlers.pinnedQueries();
      }
      throw new Error("operation not found: pinned-queries");
    }
    return { response: { status: 200, data: {} } };
  }) as RunApi;
}

const USAGE_OK = () => ({
  response: {
    status: 200,
    data: {
      monthly: {
        used_usd: 1.2345,
        limit_usd: 10,
        projected_run_rate_usd: 0.5,
        period: "2026-06",
      },
      lifetime: { used_usd: 2.5, limit_usd: null },
    },
  },
});

const QUERY_SUCCEEDED = () => ({
  response: {
    status: 200,
    data: {
      query_id: "q1",
      status: "SUCCEEDED",
      columns: [
        { name: "day", type: "varchar" },
        { name: "rev", type: "double" },
      ],
      rows: [
        ["2026-06-01", "100"],
        ["2026-06-02", "150"],
      ],
      stats: { data_scanned_bytes: 2048 },
      sql: "SELECT day, rev FROM t",
    },
  },
});

const BAR_PIN = {
  pin_id: "p1",
  title: "Daily revenue",
  sql: "SELECT day, rev FROM t WHERE namespacez='studioalpha'",
  query_id: "q1",
  render_tool: "render_bar_chart",
  render_options: { x: "day", y: "rev" },
};

/** A static (inline-data) pin — rows described in chat, no query_id. */
const STATIC_PIN = {
  pin_id: "s1",
  title: "Revenue by SKU",
  render_tool: "render_bar_chart",
  render_options: { x: "sku", y: "revenue" },
  data_columns: [
    { name: "sku", type: "string" },
    { name: "revenue", type: "number" },
  ],
  data_rows: [
    ["A", "120"],
    ["B", "90"],
    ["C", "60"],
  ],
};

/** A runApi that counts which downstream paths were hit (to assert the facade
 *  query path is never touched for static pins, and refresh fans out to live
 *  pins only). `pinnedQueries` defaults to "not deployed" (throws). */
function recordingRunApi(
  handlers: Partial<{
    quotaUsage: () => unknown;
    query: () => unknown;
    pinnedQueries: () => unknown;
  }> = {},
): { runApi: RunApi; counts: { query: number; refresh: number } } {
  const counts = { query: 0, refresh: 0 };
  const runApi = (async (args: { path?: string }) => {
    const path = args.path ?? "";
    if (path.includes("/quota/usage")) {
      return (handlers.quotaUsage ?? USAGE_OK)();
    }
    if (path.includes("/queries/")) {
      counts.query += 1;
      return (handlers.query ?? QUERY_SUCCEEDED)();
    }
    if (path.includes("/pinned-queries")) {
      if (path.includes("/refresh")) {
        counts.refresh += 1;
      }
      if (handlers.pinnedQueries) {
        return handlers.pinnedQueries();
      }
      throw new Error("operation not found: pinned-queries");
    }
    return { response: { status: 200, data: {} } };
  }) as RunApi;
  return { runApi, counts };
}

const REFRESH_OK = () => ({
  response: {
    status: 200,
    data: {
      pin_id: "p1",
      query_id: "q2",
      status: "SUCCEEDED",
      columns: [
        { name: "day", type: "varchar" },
        { name: "rev", type: "double" },
      ],
      rows: [["2026-06-03", "200"]],
      stats: { data_scanned_bytes: 1024 },
      sql: "SELECT day, rev FROM t",
      refreshed_at: "2026-06-19T00:00:00Z",
    },
  },
});

describe("dashboard render-tool registry", () => {
  test("registry covers every pinnable render tool", () => {
    setupTools(fakeRunApi({}));
    const names = listRenderToolNames();
    for (const tool of PIN_RENDER_TOOLS) {
      assert.ok(names.includes(tool), `registry missing ${tool}`);
    }
  });

  test("buildPinRenderOutput rebuilds a chart from stored render_tool + options", () => {
    setupTools(fakeRunApi({}));
    const output = buildPinRenderOutput(
      "render_bar_chart",
      { x: "day", y: "rev" },
      {
        columns: [
          { name: "day", type: "varchar" },
          { name: "rev", type: "double" },
        ],
        rows: [["2026-06-01", "100"]],
      },
      { title: "Daily revenue" },
    );
    const parsed = RenderOutputSchema.parse(output);
    assert.equal(parsed.chart_type, "bar");
  });

  test("buildPinRenderOutput throws on an unknown render tool", () => {
    setupTools(fakeRunApi({}));
    assert.throws(
      () => buildPinRenderOutput("render_nope", {}, { columns: [], rows: [] }),
      /Unknown render tool/,
    );
  });
});

describe("open_dashboard", () => {
  test("returns a metadata-only dashboard payload with usage, never rows", async () => {
    const tools = setupTools(fakeRunApi({ quotaUsage: USAGE_OK }));
    const result = await tools
      .get("open_dashboard")!
      .cb({ pins: [BAR_PIN], namespace: "studioalpha" }, EXTRA as never);

    const payload = DashboardOutputSchema.parse(result.structuredContent);
    assert.equal(payload.chart_type, "dashboard");
    assert.equal(payload.pins.length, 1);
    assert.equal(payload.pins[0].title, "Daily revenue");
    assert.equal(payload.usage?.monthly?.used_usd, 1.2345);
    // Metadata only — the persisted payload carries no row data (§8A.9).
    assert.equal("data" in payload.pins[0], false);
    assert.equal(JSON.stringify(payload).includes('"rows"'), false);
  });

  test("flags moving-window SQL at pin time", async () => {
    const tools = setupTools(fakeRunApi({ quotaUsage: USAGE_OK }));
    const result = await tools.get("open_dashboard")!.cb(
      {
        pins: [
          {
            ...BAR_PIN,
            sql: "SELECT day, rev FROM t WHERE day > current_date - interval '30' day",
          },
        ],
        namespace: "studioalpha",
      },
      EXTRA as never,
    );
    const payload = DashboardOutputSchema.parse(result.structuredContent);
    assert.equal(payload.pins[0].moving_window, true);
  });

  test("stored moving_window flag wins over the SQL heuristic", async () => {
    const tools = setupTools(fakeRunApi({ quotaUsage: USAGE_OK }));
    const result = await tools.get("open_dashboard")!.cb(
      {
        pins: [
          // Moving-window-looking SQL, but the stored flag says false → false wins.
          {
            ...BAR_PIN,
            position: 0,
            sql: "SELECT day, rev FROM t WHERE day > current_date - interval '30' day",
            moving_window: false,
          },
          // Plain snapshot SQL, but the stored flag says true → true wins.
          {
            ...BAR_PIN,
            pin_id: "p2",
            position: 1,
            moving_window: true,
          },
        ],
        namespace: "studioalpha",
      },
      EXTRA as never,
    );
    const payload = DashboardOutputSchema.parse(result.structuredContent);
    assert.equal(payload.pins[0].moving_window, false);
    assert.equal(payload.pins[1].moving_window, true);
  });
});

describe("load_dashboard", () => {
  test("resolves cached rows into a render_output card (no re-run on open)", async () => {
    const tools = setupTools(
      fakeRunApi({ quotaUsage: USAGE_OK, query: QUERY_SUCCEEDED }),
    );
    const result = await tools
      .get("load_dashboard")!
      .cb({ pins: [BAR_PIN], namespace: "studioalpha" }, EXTRA as never);

    const data = DashboardDataSchema.parse(result.structuredContent);
    assert.equal(data.pins.length, 1);
    const card = data.pins[0];
    assert.ok(card.render_output, "expected a resolved render_output");
    assert.equal(card.stale, undefined);
    assert.equal(card.error, undefined);
    const output = RenderOutputSchema.parse(card.render_output);
    assert.equal(output.chart_type, "bar");
    assert.equal(
      "data" in output && Array.isArray(output.data.rows)
        ? output.data.rows.length
        : 0,
      2,
    );
  });

  test("marks a pin stale when its cached result has expired (404), not an error", async () => {
    const tools = setupTools(
      fakeRunApi({
        quotaUsage: USAGE_OK,
        query: () => ({
          response: {
            status: 404,
            data: { error: { code: "NOT_FOUND", message: "expired" } },
          },
        }),
      }),
    );
    const result = await tools
      .get("load_dashboard")!
      .cb({ pins: [BAR_PIN], namespace: "studioalpha" }, EXTRA as never);

    const data = DashboardDataSchema.parse(result.structuredContent);
    assert.equal(data.pins[0].stale, true);
    assert.equal(data.pins[0].render_output, undefined);
    assert.equal(data.pins[0].error, undefined);
  });

  test("marks a pin stale when it has no query_id yet", async () => {
    const tools = setupTools(fakeRunApi({ quotaUsage: USAGE_OK }));
    const result = await tools.get("load_dashboard")!.cb(
      {
        pins: [{ ...BAR_PIN, query_id: undefined }],
        namespace: "studioalpha",
      },
      EXTRA as never,
    );
    const data = DashboardDataSchema.parse(result.structuredContent);
    assert.equal(data.pins[0].stale, true);
  });

  test("isolates a poison-pill render_options into a per-card error (§8A.9)", async () => {
    const tools = setupTools(
      fakeRunApi({ quotaUsage: USAGE_OK, query: QUERY_SUCCEEDED }),
    );
    const result = await tools.get("load_dashboard")!.cb(
      // bar requires x + y; an empty options object fails outputSchema.parse.
      { pins: [{ ...BAR_PIN, render_options: {} }], namespace: "studioalpha" },
      EXTRA as never,
    );
    const data = DashboardDataSchema.parse(result.structuredContent);
    assert.ok(data.pins[0].error, "expected a per-card error");
    assert.equal(data.pins[0].render_output, undefined);
  });
});

describe("get_quota_usage", () => {
  test("returns the usage snapshot", async () => {
    const tools = setupTools(fakeRunApi({ quotaUsage: USAGE_OK }));
    const result = await tools
      .get("get_quota_usage")!
      .cb({ namespace: "studioalpha" }, EXTRA as never);
    assert.notEqual(result.isError, true);
    assert.equal(
      (result.structuredContent as { monthly?: { period?: string } }).monthly
        ?.period,
      "2026-06",
    );
  });

  test("surfaces a 401 as an isError with the code (re-auth signal)", async () => {
    const tools = setupTools(
      fakeRunApi({
        quotaUsage: () => ({
          response: {
            status: 401,
            data: { error: { code: "UNAUTHORIZED", message: "expired" } },
          },
        }),
      }),
    );
    const result = await tools
      .get("get_quota_usage")!
      .cb({ namespace: "studioalpha" }, EXTRA as never);
    assert.equal(result.isError, true);
    assert.equal((result._meta as { code?: string }).code, "UNAUTHORIZED");
  });
});

describe("pin_query / unpin_query degrade gracefully without the facade endpoint", () => {
  test("pin_query reports PINNED_QUERIES_UNAVAILABLE rather than throwing", async () => {
    const tools = setupTools(fakeRunApi({}));
    const result = await tools.get("pin_query")!.cb(
      {
        title: "Daily revenue",
        query_id: "q1",
        render_tool: "render_bar_chart",
        render_options: { x: "day", y: "rev" },
        namespace: "studioalpha",
      },
      EXTRA as never,
    );
    assert.equal(result.isError, true);
    assert.equal(
      (result._meta as { code?: string }).code,
      "PINNED_QUERIES_UNAVAILABLE",
    );
  });

  test("requires a namespace (none in context) → isError", async () => {
    const tools = setupTools(fakeRunApi({}), "");
    const result = await tools.get("pin_query")!.cb(
      {
        title: "x",
        query_id: "q1",
        render_tool: "render_bar_chart",
        render_options: { x: "day", y: "rev" },
      },
      EXTRA as never,
    );
    assert.equal(result.isError, true);
    assert.equal((result._meta as { code?: string }).code, "INVALID_ARGUMENT");
  });
});

describe("update_pinned_query", () => {
  const UPDATED = {
    pin_id: "p1",
    title: "Renamed",
    render_tool: "render_bar_chart",
    render_options: { x: "day", y: "rev" },
    position: 0,
    span: 8,
  };

  test("PATCHes and returns the updated pin metadata (title + span)", async () => {
    const tools = setupTools(
      fakeRunApi({
        pinnedQueries: () => ({ response: { status: 200, data: UPDATED } }),
      }),
    );
    const result = await tools.get("update_pinned_query")!.cb(
      { pin_id: "p1", title: "Renamed", span: 8, namespace: "studioalpha" },
      EXTRA as never,
    );
    assert.notEqual(result.isError, true);
    const meta = PinnedQueryMetaSchema.parse(result.structuredContent);
    assert.equal(meta.title, "Renamed");
    assert.equal(meta.span, 8);
  });

  test("degrades gracefully without the facade endpoint (PINNED_QUERIES_UNAVAILABLE)", async () => {
    const tools = setupTools(fakeRunApi({}));
    const result = await tools.get("update_pinned_query")!.cb(
      { pin_id: "p1", span: 6, namespace: "studioalpha" },
      EXTRA as never,
    );
    assert.equal(result.isError, true);
    assert.equal(
      (result._meta as { code?: string }).code,
      "PINNED_QUERIES_UNAVAILABLE",
    );
  });

  test("requires a namespace (none in context) → INVALID_ARGUMENT", async () => {
    const tools = setupTools(fakeRunApi({}), "");
    const result = await tools.get("update_pinned_query")!.cb(
      { pin_id: "p1", span: 6 },
      EXTRA as never,
    );
    assert.equal(result.isError, true);
    assert.equal((result._meta as { code?: string }).code, "INVALID_ARGUMENT");
  });

  test("a title-only edit whose response omits position does not fabricate position 0", async () => {
    // A facade PATCH response that echoes no position must not resolve to a
    // hardcoded 0 — that would silently reorder a renamed pin to the front.
    const { position: _dropped, ...UPDATED_NO_POSITION } = UPDATED;
    void _dropped;
    const tools = setupTools(
      fakeRunApi({
        pinnedQueries: () => ({
          response: { status: 200, data: UPDATED_NO_POSITION },
        }),
      }),
    );
    const result = await tools.get("update_pinned_query")!.cb(
      { pin_id: "p1", title: "Renamed", namespace: "studioalpha" },
      EXTRA as never,
    );
    assert.notEqual(result.isError, true);
    const meta = PinnedQueryMetaSchema.parse(result.structuredContent);
    assert.equal(meta.position, undefined);
  });

  test("an explicit position edit is echoed back as the fallback when the response omits it", async () => {
    const { position: _dropped, ...UPDATED_NO_POSITION } = UPDATED;
    void _dropped;
    const tools = setupTools(
      fakeRunApi({
        pinnedQueries: () => ({
          response: { status: 200, data: UPDATED_NO_POSITION },
        }),
      }),
    );
    const result = await tools.get("update_pinned_query")!.cb(
      { pin_id: "p1", position: 3, namespace: "studioalpha" },
      EXTRA as never,
    );
    assert.notEqual(result.isError, true);
    const meta = PinnedQueryMetaSchema.parse(result.structuredContent);
    assert.equal(meta.position, 3);
  });

  test("an empty patch (no mutable fields) → INVALID_ARGUMENT, no PATCH sent", async () => {
    const calls: string[] = [];
    const tools = setupTools(
      fakeRunApi({
        pinnedQueries: () => {
          calls.push("patch");
          return { response: { status: 200, data: UPDATED } };
        },
      }),
    );
    const result = await tools.get("update_pinned_query")!.cb(
      { pin_id: "p1", namespace: "studioalpha" },
      EXTRA as never,
    );
    assert.equal(result.isError, true);
    assert.equal((result._meta as { code?: string }).code, "INVALID_ARGUMENT");
    assert.equal(calls.length, 0, "must not round-trip an empty patch");
  });
});

describe("dashboard schemas", () => {
  test("dashboard is a member of the render union (open_dashboard dispatch)", () => {
    const parsed = RenderOutputSchema.parse({
      chart_type: "dashboard",
      pins: [],
    });
    assert.equal(parsed.chart_type, "dashboard");
  });

  test("pinned-query metadata round-trips with opaque render_options", () => {
    const payload = DashboardOutputSchema.parse({
      chart_type: "dashboard",
      pins: [BAR_PIN],
    });
    assert.deepEqual(payload.pins[0].render_options, { x: "day", y: "rev" });
  });

  test("span round-trips, defaults to 4, and is permissive (never throws)", () => {
    const base = {
      pin_id: "p",
      title: "t",
      render_tool: "render_bar_chart",
    } as const;
    assert.equal(PinnedQueryMetaSchema.parse(base).span, 4);
    assert.equal(PinnedQueryMetaSchema.parse({ ...base, span: 8 }).span, 8);
    // Garbage falls back to 4 — clamping to [1,12] is done in code, not the schema.
    assert.equal(
      PinnedQueryMetaSchema.parse({ ...base, span: "nope" }).span,
      4,
    );
  });
});

describe("static pins (inline data)", () => {
  test("a static pin builds a direct render_output without touching the query path", async () => {
    const { runApi, counts } = recordingRunApi();
    const tools = setupTools(runApi);
    const result = await tools
      .get("load_dashboard")!
      .cb({ pins: [STATIC_PIN], namespace: "studioalpha" }, EXTRA as never);

    const data = DashboardDataSchema.parse(result.structuredContent);
    const card = data.pins[0];
    assert.ok(card.render_output, "expected a resolved render_output");
    assert.equal(card.stale, undefined);
    assert.equal(card.error, undefined);
    // Inline rows ride along for the round-trip.
    assert.equal(card.data_rows?.length, 3);
    const output = RenderOutputSchema.parse(card.render_output) as {
      chart_type: string;
      data_source?: string;
    };
    assert.equal(output.chart_type, "bar");
    assert.equal(output.data_source, "direct");
    // The facade query path was never hit (no cached result fetch, no bill).
    assert.equal(counts.query, 0);
  });

  test("static pins resolve across a representative spread of render tools", async () => {
    const cases: Array<{ tool: string; options: Record<string, unknown> }> = [
      { tool: "render_bar_chart", options: { x: "a", y: "b" } },
      { tool: "render_line_chart", options: { x: "a", y: "b" } },
      { tool: "render_pie_chart", options: { category: "a", value: "b" } },
      { tool: "render_metric", options: { value: "b" } },
      { tool: "render_table", options: {} },
    ];
    for (const c of cases) {
      const { runApi, counts } = recordingRunApi();
      const tools = setupTools(runApi);
      const result = await tools.get("load_dashboard")!.cb(
        {
          pins: [
            {
              pin_id: "s",
              title: c.tool,
              render_tool: c.tool,
              render_options: c.options,
              data_columns: [
                { name: "a", type: "string" },
                { name: "b", type: "number" },
              ],
              data_rows: [["x", "1"]],
            },
          ],
          namespace: "studioalpha",
        },
        EXTRA as never,
      );
      const data = DashboardDataSchema.parse(result.structuredContent);
      assert.ok(data.pins[0].render_output, `${c.tool} should resolve`);
      assert.equal(counts.query, 0, `${c.tool} must not hit the query path`);
      const output = RenderOutputSchema.parse(data.pins[0].render_output) as {
        data_source?: string;
      };
      assert.equal(output.data_source, "direct");
    }
  });

  test("a malformed static payload becomes a per-card error, not a thrown handler", async () => {
    const tools = setupTools(fakeRunApi({ quotaUsage: USAGE_OK }));
    const result = await tools.get("load_dashboard")!.cb(
      {
        // bar requires x + y; empty options fails outputSchema.parse.
        pins: [
          {
            pin_id: "s1",
            title: "bad",
            render_tool: "render_bar_chart",
            render_options: {},
            data_columns: [{ name: "a", type: "string" }],
            data_rows: [["1"]],
          },
        ],
        namespace: "studioalpha",
      },
      EXTRA as never,
    );
    const data = DashboardDataSchema.parse(result.structuredContent);
    assert.ok(data.pins[0].error, "expected a per-card error");
    assert.equal(data.pins[0].render_output, undefined);
  });

  test("a mixed live+static dashboard resolves each correctly", async () => {
    const { runApi, counts } = recordingRunApi();
    const tools = setupTools(runApi);
    const result = await tools
      .get("load_dashboard")!
      .cb(
        { pins: [BAR_PIN, STATIC_PIN], namespace: "studioalpha" },
        EXTRA as never,
      );

    const data = DashboardDataSchema.parse(result.structuredContent);
    const live = data.pins.find((p) => p.pin_id === "p1");
    const stat = data.pins.find((p) => p.pin_id === "s1");
    const liveOut = RenderOutputSchema.parse(live!.render_output) as {
      data_source?: string;
    };
    const statOut = RenderOutputSchema.parse(stat!.render_output) as {
      data_source?: string;
    };
    assert.equal(liveOut.data_source, "facade");
    assert.equal(statOut.data_source, "direct");
    // Only the live pin resolved via the query path.
    assert.equal(counts.query, 1);
  });

  test("refresh_all_pinned re-runs only live pins; static pins return unchanged", async () => {
    const { runApi, counts } = recordingRunApi({ pinnedQueries: REFRESH_OK });
    const tools = setupTools(runApi);
    const result = await tools
      .get("refresh_all_pinned")!
      .cb(
        { pins: [BAR_PIN, STATIC_PIN], namespace: "studioalpha" },
        EXTRA as never,
      );

    const data = DashboardDataSchema.parse(result.structuredContent);
    const live = data.pins.find((p) => p.pin_id === "p1");
    const stat = data.pins.find((p) => p.pin_id === "s1");
    // Live pin re-ran (refreshed rows); static pin rebuilt from inline data.
    const liveOut = RenderOutputSchema.parse(live!.render_output) as {
      data_source?: string;
      data: { rows: string[][] };
    };
    const statOut = RenderOutputSchema.parse(stat!.render_output) as {
      data_source?: string;
    };
    assert.equal(liveOut.data_source, "facade");
    assert.deepEqual(liveOut.data.rows, [["2026-06-03", "200"]]);
    assert.equal(statOut.data_source, "direct");
    // Exactly one refresh call — only the live pin was billed.
    assert.equal(counts.refresh, 1);
  });

  test("refresh preserves the moving_window flag when the refresh response omits it", async () => {
    // The refresh response (REFRESH_OK) carries no moving_window and BAR_PIN's SQL
    // is a plain snapshot (regex → false). The card must still come back true,
    // carried through from the meta the caller already resolved — otherwise a
    // refresh would silently drop the moving-window caption.
    const { runApi } = recordingRunApi({ pinnedQueries: REFRESH_OK });
    const tools = setupTools(runApi);
    const result = await tools.get("refresh_all_pinned")!.cb(
      { pins: [{ ...BAR_PIN, moving_window: true }], namespace: "studioalpha" },
      EXTRA as never,
    );

    const data = DashboardDataSchema.parse(result.structuredContent);
    assert.equal(data.pins[0].moving_window, true);
  });

  test("refresh_pinned_query preserves the moving_window flag when the refresh response omits it", async () => {
    // Single-pin refresh: REFRESH_OK carries no moving_window and BAR_PIN's SQL
    // is a plain snapshot (regex → false). The caller-supplied flag must keep the
    // caption — without it the single-pin path degrades to the SQL heuristic.
    const { runApi } = recordingRunApi({ pinnedQueries: REFRESH_OK });
    const tools = setupTools(runApi);
    const result = await tools.get("refresh_pinned_query")!.cb(
      {
        pin_id: "p1",
        title: "Daily revenue",
        render_tool: "render_bar_chart",
        render_options: { x: "day", y: "rev" },
        sql: BAR_PIN.sql,
        moving_window: true,
        namespace: "studioalpha",
      },
      EXTRA as never,
    );

    const data = DashboardDataSchema.parse(result.structuredContent);
    assert.equal(data.pins[0].moving_window, true);
  });

  test("refresh_all_pinned keeps moving_window on a stale (not-ready) card", async () => {
    // A 202 → NOT_READY refresh yields a stale card; the stored flag must ride
    // along so the next load_dashboard's cardToMeta doesn't drop the caption.
    const REFRESH_PENDING = () => ({ response: { status: 202, data: {} } });
    const { runApi } = recordingRunApi({ pinnedQueries: REFRESH_PENDING });
    const tools = setupTools(runApi);
    const result = await tools.get("refresh_all_pinned")!.cb(
      { pins: [{ ...BAR_PIN, moving_window: true }], namespace: "studioalpha" },
      EXTRA as never,
    );

    const data = DashboardDataSchema.parse(result.structuredContent);
    assert.equal(data.pins[0].stale, true);
    assert.equal(data.pins[0].moving_window, true);
  });

  test("static-pin rows beyond MAX_ROWS_DEFAULT are truncated in the render_output", async () => {
    const tools = setupTools(fakeRunApi({ quotaUsage: USAGE_OK }));
    const rows = Array.from({ length: 10_005 }, (_, i) => [
      String(i),
      String(i),
    ]);
    const result = await tools.get("load_dashboard")!.cb(
      {
        pins: [
          {
            pin_id: "s1",
            title: "big",
            render_tool: "render_table",
            render_options: {},
            data_columns: [
              { name: "a", type: "string" },
              { name: "b", type: "string" },
            ],
            data_rows: rows,
          },
        ],
        namespace: "studioalpha",
      },
      EXTRA as never,
    );
    const data = DashboardDataSchema.parse(result.structuredContent);
    const output = RenderOutputSchema.parse(data.pins[0].render_output) as {
      data: { rows: string[][] };
    };
    assert.equal(output.data.rows.length, 10_000);
    // The original (full) rows still ride along on the card for the round-trip.
    assert.equal(data.pins[0].data_rows?.length, 10_005);
  });

  test("open_dashboard resolves span: >12 clamps to 12, invalid/absent falls back to 4", async () => {
    const tools = setupTools(fakeRunApi({ quotaUsage: USAGE_OK }));
    const result = await tools.get("open_dashboard")!.cb(
      {
        pins: [
          { ...BAR_PIN, pin_id: "hi", span: 99 },
          { ...BAR_PIN, pin_id: "zero", span: 0 },
          { ...BAR_PIN, pin_id: "neg", span: -5 },
          { ...BAR_PIN, pin_id: "ok", span: 6 },
          { ...BAR_PIN, pin_id: "def" },
        ],
        namespace: "studioalpha",
      },
      EXTRA as never,
    );
    const payload = DashboardOutputSchema.parse(result.structuredContent);
    const span = (id: string) =>
      payload.pins.find((p) => p.pin_id === id)?.span;
    assert.equal(span("hi"), 12); // >12 clamps down
    assert.equal(span("zero"), 4); // 0 is invalid → default 4 (not the sliver)
    assert.equal(span("neg"), 4); // negative → default 4
    assert.equal(span("ok"), 6); // honored as-is
    assert.equal(span("def"), 4); // absent → default 4
  });
});

/** A runApi for store-backed load tests: GET list, live-pin query resolve, usage. */
function storeBackedRunApi(
  listResponse: () => unknown,
): RunApi {
  return (async (args: { path?: string }) => {
    const path = args.path ?? "";
    if (path.includes("/quota/usage")) {
      return USAGE_OK();
    }
    if (path.includes("/queries/")) {
      return QUERY_SUCCEEDED();
    }
    if (path.includes("/pinned-queries")) {
      return listResponse();
    }
    return { response: { status: 200, data: {} } };
  }) as RunApi;
}

const STORED_P1 = {
  pin_id: "p1",
  title: "Stored P1",
  sql: "SELECT day, rev FROM t",
  query_id: "q1",
  render_tool: "render_bar_chart",
  render_options: { x: "day", y: "rev" },
  position: 0,
};

describe("refresh_all_pinned quota stop", () => {
  test("stops at the first quota error and never bills the remaining pins", async () => {
    let refreshCalls = 0;
    const runApi = (async (args: { path?: string }) => {
      const path = args.path ?? "";
      if (path.includes("/quota/usage")) {
        return USAGE_OK();
      }
      if (path.includes("/refresh")) {
        refreshCalls += 1;
        if (refreshCalls === 1) {
          return {
            response: {
              status: 429,
              data: {
                error: { code: "QUOTA_EXCEEDED", message: "quota reached" },
              },
            },
          };
        }
        return REFRESH_OK();
      }
      return { response: { status: 200, data: {} } };
    }) as RunApi;
    const tools = setupTools(runApi);
    const result = await tools.get("refresh_all_pinned")!.cb(
      {
        pins: [BAR_PIN, { ...BAR_PIN, pin_id: "p2" }],
        namespace: "studioalpha",
      },
      EXTRA as never,
    );

    // The serial loop stopped the moment the 429 was seen — the second pin's
    // refresh was never issued, so we never bill past the cap.
    assert.equal(refreshCalls, 1);
    const data = DashboardDataSchema.parse(result.structuredContent);
    assert.equal(data.pins.length, 1);
    assert.ok(data.pins[0].error && /quota/i.test(data.pins[0].error));
    assert.match(
      (result.content as Array<{ text: string }>)[0].text,
      /quota/i,
    );
  });

  test("renders a still-running (202 NOT_READY) pin as stale, not an error", async () => {
    const runApi = (async (args: { path?: string }) => {
      const path = args.path ?? "";
      if (path.includes("/quota/usage")) {
        return USAGE_OK();
      }
      if (path.includes("/refresh")) {
        // A 202 means the re-run went async — refreshPin throws NOT_READY.
        return { response: { status: 202, data: {} } };
      }
      return { response: { status: 200, data: {} } };
    }) as RunApi;
    const tools = setupTools(runApi);
    const result = await tools.get("refresh_all_pinned")!.cb(
      { pins: [BAR_PIN], namespace: "studioalpha" },
      EXTRA as never,
    );

    const data = DashboardDataSchema.parse(result.structuredContent);
    assert.equal(data.pins.length, 1);
    // Still-running is a pending state, not a failure: stale, no error card.
    assert.equal(data.pins[0].stale, true);
    assert.equal(data.pins[0].error, undefined);
    assert.equal(data.pins[0].render_output, undefined);
  });
});

describe("load_dashboard with a pin store", () => {
  test("a malformed stored record is skipped, not allowed to blank the board", async () => {
    const runApi = storeBackedRunApi(() => ({
      response: {
        status: 200,
        data: {
          data: [
            STORED_P1,
            { pin_id: "bad", title: "Bad", render_tool: "not_a_tool" },
          ],
        },
      },
    }));
    const tools = setupTools(runApi);
    const result = await tools
      .get("load_dashboard")!
      .cb({ pins: [], namespace: "studioalpha" }, EXTRA as never);

    const data = DashboardDataSchema.parse(result.structuredContent);
    // The one good stored pin still renders; the malformed one is dropped.
    assert.equal(data.pins.length, 1);
    assert.equal(data.pins[0].pin_id, "p1");
    // Store was reachable, so no degraded notice.
    assert.equal(data.notice, undefined);
  });

  test("a non-UNAVAILABLE store error keeps inline pins and surfaces a notice", async () => {
    const runApi = storeBackedRunApi(() => ({
      response: {
        status: 500,
        data: { error: { code: "HTTP_500", message: "boom" } },
      },
    }));
    const tools = setupTools(runApi);
    const result = await tools
      .get("load_dashboard")!
      .cb({ pins: [BAR_PIN], namespace: "studioalpha" }, EXTRA as never);

    const data = DashboardDataSchema.parse(result.structuredContent);
    // The inline pin still paints rather than presenting an empty board.
    assert.equal(data.pins.length, 1);
    assert.equal(data.pins[0].pin_id, "p1");
    // The failure is surfaced as a non-blocking notice, not silently swallowed.
    assert.ok(data.notice && /store/i.test(data.notice));
  });

  test("dedupes a static pin sharing a stored pin_id and offsets static positions", async () => {
    const runApi = storeBackedRunApi(() => ({
      response: { status: 200, data: { data: [STORED_P1] } },
    }));
    const tools = setupTools(runApi);
    // Inline pins: a static dup of the stored "p1" plus a distinct static "s1".
    const result = await tools.get("load_dashboard")!.cb(
      {
        pins: [{ ...STATIC_PIN, pin_id: "p1" }, STATIC_PIN],
        namespace: "studioalpha",
      },
      EXTRA as never,
    );

    const data = DashboardDataSchema.parse(result.structuredContent);
    // p1 appears exactly once (the stored, live pin wins over the inline dup).
    assert.deepEqual(
      data.pins.map((p) => p.pin_id).sort(),
      ["p1", "s1"],
    );
    const p1 = data.pins.find((p) => p.pin_id === "p1")!;
    const p1Out = RenderOutputSchema.parse(p1.render_output) as {
      data_source?: string;
    };
    assert.equal(p1Out.data_source, "facade");
    // The surviving static pin is positioned past the stored set (1 stored → 1).
    assert.equal(data.pins.find((p) => p.pin_id === "s1")!.position, 1);
  });
});

describe("PinnedQueryCardSchema result-state exclusivity", () => {
  test("rejects a card that sets more than one of render_output/stale/error", () => {
    assert.throws(() =>
      PinnedQueryCardSchema.parse({
        pin_id: "x",
        title: "t",
        render_tool: "render_bar_chart",
        render_output: { chart_type: "bar" },
        error: "boom",
      }),
    );
  });

  test("accepts a card with exactly one result state", () => {
    const card = PinnedQueryCardSchema.parse({
      pin_id: "x",
      title: "t",
      render_tool: "render_bar_chart",
      stale: true,
    });
    assert.equal(card.stale, true);
  });
});
