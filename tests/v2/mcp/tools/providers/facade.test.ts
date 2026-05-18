import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { OpenApiTools } from "../../../../../src/tools/openapi-tools.js";
import {
  createFacadeProvider,
  FacadeError,
} from "../../../../../src/v2/mcp/tools/providers/facade.js";

type RunApiResult = Awaited<ReturnType<OpenApiTools["runApi"]>>;
type RunApiStub = (
  args: Record<string, unknown>,
  userContext?: unknown,
  accessToken?: string,
) => Promise<RunApiResult>;

function createOpenApiToolsStub(runApi: RunApiStub): OpenApiTools {
  return {
    runApi,
  } as unknown as OpenApiTools;
}

describe("createFacadeProvider", () => {
  test("throws without calling runApi when query_id is missing", async () => {
    let calls = 0;
    const provider = createFacadeProvider(
      createOpenApiToolsStub(async () => {
        calls += 1;
        return {};
      }),
    );

    await assert.rejects(
      provider.resolve({ namespace: "demo" }, "token"),
      (error: unknown) =>
        error instanceof FacadeError &&
        error.code === "INVALID_ARGUMENT" &&
        error.message.includes("query_id"),
    );
    assert.equal(calls, 0);
  });

  test("throws without calling runApi when namespace is missing", async () => {
    let calls = 0;
    const provider = createFacadeProvider(
      createOpenApiToolsStub(async () => {
        calls += 1;
        return {};
      }),
    );

    await assert.rejects(
      provider.resolve({ query_id: "q1" }, "token"),
      (error: unknown) =>
        error instanceof FacadeError &&
        error.code === "INVALID_ARGUMENT" &&
        error.message.includes("namespace"),
    );
    assert.equal(calls, 0);
  });

  test("calls runApi with the afs query-status operation, max_rows, and token", async () => {
    const captured: {
      args?: Record<string, unknown>;
      userContext?: unknown;
      accessToken?: string;
    } = {};

    const provider = createFacadeProvider(
      createOpenApiToolsStub(async (args, userContext, accessToken) => {
        captured.args = args;
        captured.userContext = userContext;
        captured.accessToken = accessToken;

        return {
          response: {
            status: 200,
            data: {
              query_id: "query/1",
              status: "succeeded",
              columns: [{ name: "value", type: "bigint" }],
              rows: [["1"]],
            },
          },
        };
      }),
    );

    const result = await provider.resolve(
      {
        query_id: "query/1",
        namespace: "game-space",
        max_rows: 42,
      },
      "token-123",
    );

    assert.deepEqual(captured, {
      args: {
        spec: "afs",
        method: "GET",
        path: "/afs/v1/admin/namespaces/{namespace}/queries/{id}",
        pathParams: {
          namespace: "game-space",
          id: "query/1",
        },
        query: {
          max_rows: 42,
        },
        useAccessToken: true,
      },
      userContext: undefined,
      accessToken: "token-123",
    });
    assert.deepEqual(result, {
      columns: [{ name: "value", type: "bigint" }],
      rows: [["1"]],
    });
  });

  test("returns columns and rows when status is succeeded", async () => {
    const provider = createFacadeProvider(
      createOpenApiToolsStub(async () => ({
        response: {
          status: 200,
          data: {
            query_id: "q1",
            status: "succeeded",
            columns: [{ name: "state", type: "varchar" }],
            rows: [["ready"]],
            truncated: true,
          },
        },
      })),
    );

    const result = await provider.resolve(
      { query_id: "q1", namespace: "demo" },
      "token",
    );

    assert.deepEqual(result, {
      columns: [{ name: "state", type: "varchar" }],
      rows: [["ready"]],
    });
  });

  test("throws FORBIDDEN from structured non-2xx response", async () => {
    const provider = createFacadeProvider(
      createOpenApiToolsStub(async () => ({
        response: {
          status: 403,
          data: {
            error: {
              code: "FORBIDDEN",
              message: "No access",
            },
          },
        },
      })),
    );

    await assert.rejects(
      provider.resolve({ query_id: "q1", namespace: "demo" }, "token"),
      (error: unknown) =>
        error instanceof FacadeError &&
        error.code === "FORBIDDEN" &&
        error.message === "No access",
    );
  });

  test("falls back on unstructured non-2xx response", async () => {
    const provider = createFacadeProvider(
      createOpenApiToolsStub(async () => ({
        response: {
          status: 500,
          data: {
            message: "oops",
          },
        },
      })),
    );

    await assert.rejects(
      provider.resolve({ query_id: "q1", namespace: "demo" }, "token"),
      (error: unknown) =>
        error instanceof FacadeError &&
        error.code === "INTERNAL" &&
        error.message === "Facade returned 500",
    );
  });

  test("throws NOT_READY when status is running", async () => {
    const provider = createFacadeProvider(
      createOpenApiToolsStub(async () => ({
        response: {
          status: 200,
          data: {
            query_id: "q1",
            status: "running",
            instruction: "retry in a few seconds",
          },
        },
      })),
    );

    await assert.rejects(
      provider.resolve({ query_id: "q1", namespace: "demo" }, "token"),
      (error: unknown) =>
        error instanceof FacadeError &&
        error.code === "NOT_READY" &&
        error.message.includes("running") &&
        error.message.includes("retry in a few seconds") &&
        error.message.includes("/afs/v1/admin/namespaces/{namespace}/queries/{id}"),
    );
  });

  test("throws NOT_READY when status is queued", async () => {
    const provider = createFacadeProvider(
      createOpenApiToolsStub(async () => ({
        response: {
          status: 200,
          data: {
            query_id: "q1",
            status: "queued",
          },
        },
      })),
    );

    await assert.rejects(
      provider.resolve({ query_id: "q1", namespace: "demo" }, "token"),
      (error: unknown) =>
        error instanceof FacadeError &&
        error.code === "NOT_READY" &&
        error.message.includes("queued"),
    );
  });

  test("throws CANCELLED when status is cancelled", async () => {
    const provider = createFacadeProvider(
      createOpenApiToolsStub(async () => ({
        response: {
          status: 200,
          data: {
            query_id: "q1",
            status: "cancelled",
          },
        },
      })),
    );

    await assert.rejects(
      provider.resolve({ query_id: "q1", namespace: "demo" }, "token"),
      (error: unknown) =>
        error instanceof FacadeError &&
        error.code === "CANCELLED" &&
        error.message.includes("cancelled"),
    );
  });

  test("throws facade error details when status is failed", async () => {
    const provider = createFacadeProvider(
      createOpenApiToolsStub(async () => ({
        response: {
          status: 200,
          data: {
            query_id: "q1",
            status: "failed",
            error: {
              code: "QUERY_FAILED",
              message: "Athena execution failed",
            },
          },
        },
      })),
    );

    await assert.rejects(
      provider.resolve({ query_id: "q1", namespace: "demo" }, "token"),
      (error: unknown) =>
        error instanceof FacadeError &&
        error.code === "QUERY_FAILED" &&
        error.message === "Athena execution failed",
    );
  });

  test("falls back when failed status omits structured error details", async () => {
    const provider = createFacadeProvider(
      createOpenApiToolsStub(async () => ({
        response: {
          status: 200,
          data: {
            query_id: "q1",
            status: "failed",
          },
        },
      })),
    );

    await assert.rejects(
      provider.resolve({ query_id: "q1", namespace: "demo" }, "token"),
      (error: unknown) =>
        error instanceof FacadeError &&
        error.code === "QUERY_FAILED" &&
        error.message === "Query q1 failed.",
    );
  });

  test("maps timeout transport envelopes to TIMEOUT", async () => {
    const provider = createFacadeProvider(
      createOpenApiToolsStub(async () => ({
        error: {
          code: "ECONNABORTED",
          message: "timeout of 15000ms exceeded",
        },
      })),
    );

    await assert.rejects(
      provider.resolve({ query_id: "q1", namespace: "demo" }, "token"),
      (error: unknown) =>
        error instanceof FacadeError &&
        error.code === "TIMEOUT" &&
        error.message === "timeout of 15000ms exceeded",
    );
  });

  test("maps non-timeout transport envelopes to TRANSPORT_ERROR", async () => {
    const provider = createFacadeProvider(
      createOpenApiToolsStub(async () => ({
        error: {
          code: "ECONNRESET",
          message: "socket hang up",
        },
      })),
    );

    await assert.rejects(
      provider.resolve({ query_id: "q1", namespace: "demo" }, "token"),
      (error: unknown) =>
        error instanceof FacadeError &&
        error.code === "TRANSPORT_ERROR" &&
        error.message === "socket hang up",
    );
  });

  test("wraps thrown runtime errors as INTERNAL", async () => {
    const provider = createFacadeProvider(
      createOpenApiToolsStub(async () => {
        throw new Error("spec lookup failed");
      }),
    );

    await assert.rejects(
      provider.resolve({ query_id: "q1", namespace: "demo" }, "token"),
      (error: unknown) =>
        error instanceof FacadeError &&
        error.code === "INTERNAL" &&
        error.message === "spec lookup failed",
    );
  });
});
