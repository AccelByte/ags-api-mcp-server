import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { OpenApiTools } from "../../../../../src/tools/openapi-tools.js";
import { FacadeError } from "../../../../../src/v2/mcp/tools/providers/facade.js";
import {
  createPin,
  deletePin,
  listPins,
  refreshPin,
} from "../../../../../src/v2/mcp/tools/providers/pinned-queries.js";

type RunApi = OpenApiTools["runApi"];

interface RunApiCall {
  method?: string;
  path?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

/**
 * Fake runApi that records calls and returns a programmed envelope (or throws,
 * to model the "operation not in spec / endpoint not deployed" case).
 */
function fakeRunApi(
  respond: (call: RunApiCall) => unknown,
): { runApi: RunApi; calls: RunApiCall[] } {
  const calls: RunApiCall[] = [];
  const runApi = (async (args: RunApiCall) => {
    calls.push({
      method: args.method,
      path: args.path,
      body: args.body,
      headers: args.headers,
    });
    return respond(args);
  }) as RunApi;
  return { runApi, calls };
}

const tools = (runApi: RunApi): OpenApiTools => ({ runApi }) as OpenApiTools;

const RECORD = {
  pin_id: "p1",
  title: "Daily revenue",
  // sql is still returned by the backend (read-only — re-sourced from Athena at
  // create), alongside the server-sourced namespace + moving_window.
  sql: "SELECT day, rev FROM t",
  namespace: "studioalpha",
  moving_window: true,
  query_id: "q1",
  render_tool: "render_bar_chart",
  render_options: { x: "day", y: "rev" },
  position: 0,
  span: 6,
};

describe("pinned-queries provider", () => {
  describe("listPins", () => {
    test("flattens the data array into typed records", async () => {
      const { runApi } = fakeRunApi(() => ({
        response: { status: 200, data: { data: [RECORD] } },
      }));
      const pins = await listPins(tools(runApi), "studioalpha", "tok");
      assert.equal(pins.length, 1);
      assert.equal(pins[0].pin_id, "p1");
      assert.equal(pins[0].span, 6);
    });

    test("sends JSON Content-Type and Accept headers (AFS 415s without them)", async () => {
      const { runApi, calls } = fakeRunApi(() => ({
        response: { status: 200, data: { data: [] } },
      }));
      await listPins(tools(runApi), "studioalpha", "tok");
      // The list is a bodiless GET, so `runApi` won't auto-attach a content type
      // — the provider must, or AFS rejects it with 415.
      assert.equal(calls[0].headers?.["Content-Type"], "application/json");
      assert.equal(calls[0].headers?.["Accept"], "application/json");
    });

    test("skips a malformed record rather than dropping the whole list", async () => {
      const { runApi } = fakeRunApi(() => ({
        response: {
          status: 200,
          data: {
            data: [
              RECORD,
              { pin_id: "bad", title: "x", render_tool: "render_text_editor" }, // not pinnable
              { title: "no id", render_tool: "render_bar_chart" }, // missing pin_id
            ],
          },
        },
      }));
      const pins = await listPins(tools(runApi), "studioalpha", "tok");
      // Only the one valid record survives; the two bad ones are skipped.
      assert.equal(pins.length, 1);
      assert.equal(pins[0].pin_id, "p1");
    });

    test("returns [] when the payload shape is unexpected", async () => {
      const { runApi } = fakeRunApi(() => ({
        response: { status: 200, data: { not_data: true } },
      }));
      const pins = await listPins(tools(runApi), "studioalpha", "tok");
      assert.deepEqual(pins, []);
    });
  });

  describe("createPin", () => {
    test("returns the parsed record on success", async () => {
      const { runApi, calls } = fakeRunApi(() => ({
        response: { status: 201, data: RECORD },
      }));
      const record = await createPin(
        tools(runApi),
        "studioalpha",
        {
          title: "Daily revenue",
          query_id: "q1",
          render_tool: "render_bar_chart",
          render_options: { x: "day", y: "rev" },
        },
        "tok",
      );
      assert.equal(record.pin_id, "p1");
      // The backend sources these and returns them on the record.
      assert.equal(record.namespace, "studioalpha");
      assert.equal(record.moving_window, true);
      assert.equal(calls[0].method, "POST");
      // The create body forwards the query_id (the pin's source key); the client
      // no longer sends a trusted sql.
      const body = calls[0].body as { query_id?: string; sql?: string };
      assert.equal(body.query_id, "q1");
      assert.equal(body.sql, undefined);
    });

    test("rejects an invalid create payload as INVALID_RESPONSE", async () => {
      const { runApi } = fakeRunApi(() => ({
        response: { status: 201, data: { title: "no pin_id" } },
      }));
      await assert.rejects(
        () =>
          createPin(
            tools(runApi),
            "studioalpha",
            {
              title: "x",
              query_id: "q1",
              render_tool: "render_bar_chart",
              render_options: {},
            },
            "tok",
          ),
        (err: unknown) =>
          err instanceof FacadeError && err.code === "INVALID_RESPONSE",
      );
    });
  });

  describe("deletePin", () => {
    test("resolves on a 204 and issues a DELETE", async () => {
      const { runApi, calls } = fakeRunApi(() => ({
        response: { status: 204, data: undefined },
      }));
      await deletePin(tools(runApi), "studioalpha", "p1", "tok");
      assert.equal(calls[0].method, "DELETE");
      assert.ok(calls[0].path?.includes("/pinned-queries/{id}"));
    });

    test("maps a 4xx with an upstream error envelope to that FacadeError code", async () => {
      const { runApi } = fakeRunApi(() => ({
        response: {
          status: 404,
          data: { error: { code: "NOT_FOUND", message: "already gone" } },
        },
      }));
      await assert.rejects(
        () => deletePin(tools(runApi), "studioalpha", "p1", "tok"),
        (err: unknown) =>
          err instanceof FacadeError && err.code === "NOT_FOUND",
      );
    });

    test("falls back to HTTP_<status> when a 4xx has no error envelope", async () => {
      const { runApi } = fakeRunApi(() => ({
        response: { status: 403, data: {} },
      }));
      await assert.rejects(
        () => deletePin(tools(runApi), "studioalpha", "p1", "tok"),
        (err: unknown) =>
          err instanceof FacadeError && err.code === "HTTP_403",
      );
    });
  });

  describe("refreshPin", () => {
    test("uppercases status and returns the parsed result", async () => {
      const { runApi } = fakeRunApi(() => ({
        response: {
          status: 200,
          data: {
            pin_id: "p1",
            query_id: "q2",
            status: "succeeded",
            columns: [{ name: "day", type: "varchar" }],
            rows: [["2026-06-03"]],
            refreshed_at: "2026-06-19T00:00:00Z",
          },
        },
      }));
      const result = await refreshPin(tools(runApi), "studioalpha", "p1", "tok");
      assert.equal(result.status, "SUCCEEDED");
      assert.equal(result.query_id, "q2");
    });

    test("surfaces a 202 (async run) as NOT_READY rather than empty data", async () => {
      const { runApi } = fakeRunApi(() => ({
        response: { status: 202, data: { pin_id: "p1", status: "RUNNING" } },
      }));
      await assert.rejects(
        () => refreshPin(tools(runApi), "studioalpha", "p1", "tok"),
        (err: unknown) =>
          err instanceof FacadeError && err.code === "NOT_READY",
      );
    });

    test("falls back to the pin id when the result omits one", async () => {
      const { runApi } = fakeRunApi(() => ({
        response: { status: 200, data: { status: "SUCCEEDED" } },
      }));
      const result = await refreshPin(tools(runApi), "studioalpha", "p9", "tok");
      assert.equal(result.pin_id, "p9");
    });

    test("rejects a result with a missing status as INVALID_RESPONSE (no phantom UNKNOWN)", async () => {
      const { runApi } = fakeRunApi(() => ({
        response: { status: 200, data: { pin_id: "p1", rows: [] } },
      }));
      await assert.rejects(
        () => refreshPin(tools(runApi), "studioalpha", "p1", "tok"),
        (err: unknown) =>
          err instanceof FacadeError && err.code === "INVALID_RESPONSE",
      );
    });
  });

  describe("callPinnedQueries error translation", () => {
    test("surfaces the upstream error code on a >=400 response", async () => {
      const { runApi } = fakeRunApi(() => ({
        response: {
          status: 403,
          data: { error: { code: "FORBIDDEN", message: "nope" } },
        },
      }));
      await assert.rejects(
        () => listPins(tools(runApi), "studioalpha", "tok"),
        (err: unknown) =>
          err instanceof FacadeError && err.code === "FORBIDDEN",
      );
    });

    test("maps a non-spec operation (endpoint not deployed) to PINNED_QUERIES_UNAVAILABLE", async () => {
      const { runApi } = fakeRunApi(() => {
        throw new Error("operation not found: pinned-queries");
      });
      await assert.rejects(
        () => listPins(tools(runApi), "studioalpha", "tok"),
        (err: unknown) =>
          err instanceof FacadeError &&
          err.code === "PINNED_QUERIES_UNAVAILABLE",
      );
    });

    test("treats a response envelope with no numeric status as INVALID_RESPONSE", async () => {
      const { runApi } = fakeRunApi(() => ({
        response: { data: { data: [] } },
      }));
      await assert.rejects(
        () => listPins(tools(runApi), "studioalpha", "tok"),
        (err: unknown) =>
          err instanceof FacadeError && err.code === "INVALID_RESPONSE",
      );
    });
  });
});
