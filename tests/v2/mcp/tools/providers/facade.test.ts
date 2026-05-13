import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";

import type { Config } from "../../../../../src/v2/config.js";
import {
  createFacadeProvider,
  FacadeError,
} from "../../../../../src/v2/mcp/tools/providers/facade.js";

const originalFetch = globalThis.fetch;

function createConfig(overrides: Partial<Config["openapi"]> = {}): Config {
  return {
    mcp: {
      port: 3000,
      path: "/mcp",
      serverUrl: "http://localhost:3000",
      enableAuth: true,
      authServerDiscoveryMode: "none",
    },
    openapi: {
      specsDir: "/tmp/openapi-specs",
      searchLimit: 10,
      maxSearchLimit: 50,
      runTimeoutMs: 25,
      maxRunTimeoutMs: 60_000,
      serverUrl: "https://analytics.example.com",
      includeWriteRequests: true,
      ...overrides,
    },
    runtime: {
      nodeEnv: "test",
      logLevel: "info",
    },
    hosted: {
      enabled: false,
      validateTokenIssuer: true,
      allowParentDomainIssuer: false,
    },
  } as Config;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("createFacadeProvider", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("uses the effectiveConfig serverUrl, encodes path params, forwards token and max_rows", async () => {
    let capturedUrl = "";
    let capturedAuthHeader = "";

    globalThis.fetch = async (
      input: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
      capturedUrl = String(input);
      capturedAuthHeader = String(
        new Headers(init?.headers).get("Authorization"),
      );

      return jsonResponse({
        query_id: "query/1",
        status: "succeeded",
        columns: [{ name: "value", type: "bigint" }],
        rows: [["1"]],
      });
    };

    const provider = createFacadeProvider(
      createConfig({ serverUrl: "https://tenant.example.com/base" }),
    );

    const result = await provider.resolve(
      {
        query_id: "query/1",
        namespace: "game space",
        max_rows: 42,
      },
      "token-123",
    );

    assert.equal(
      capturedUrl,
      "https://tenant.example.com/base/v1/admin/namespaces/game%20space/queries/query%2F1?max_rows=42",
    );
    assert.equal(capturedAuthHeader, "Bearer token-123");
    assert.deepEqual(result, {
      columns: [{ name: "value", type: "bigint" }],
      rows: [["1"]],
    });
  });

  test("returns columns and rows when status is succeeded", async () => {
    globalThis.fetch = async (): Promise<Response> =>
      jsonResponse({
        query_id: "q1",
        status: "succeeded",
        columns: [{ name: "state", type: "varchar" }],
        rows: [["ready"]],
        truncated: true,
      });

    const provider = createFacadeProvider(createConfig());
    const result = await provider.resolve(
      { query_id: "q1", namespace: "demo" },
      "token",
    );

    assert.deepEqual(result, {
      columns: [{ name: "state", type: "varchar" }],
      rows: [["ready"]],
    });
  });

  test("throws NOT_READY when status is running", async () => {
    globalThis.fetch = async (): Promise<Response> =>
      jsonResponse({
        query_id: "q1",
        status: "running",
        instruction: "retry in a few seconds",
      });

    const provider = createFacadeProvider(createConfig());

    await assert.rejects(
      provider.resolve({ query_id: "q1", namespace: "demo" }, "token"),
      (error: unknown) =>
        error instanceof FacadeError &&
        error.code === "NOT_READY" &&
        error.message.includes("running") &&
        error.message.includes("retry in a few seconds"),
    );
  });

  test("throws NOT_READY when status is queued", async () => {
    globalThis.fetch = async (): Promise<Response> =>
      jsonResponse({
        query_id: "q1",
        status: "queued",
      });

    const provider = createFacadeProvider(createConfig());

    await assert.rejects(
      provider.resolve({ query_id: "q1", namespace: "demo" }, "token"),
      (error: unknown) =>
        error instanceof FacadeError &&
        error.code === "NOT_READY" &&
        error.message.includes("queued"),
    );
  });

  test("throws CANCELLED when status is cancelled", async () => {
    globalThis.fetch = async (): Promise<Response> =>
      jsonResponse({
        query_id: "q1",
        status: "cancelled",
      });

    const provider = createFacadeProvider(createConfig());

    await assert.rejects(
      provider.resolve({ query_id: "q1", namespace: "demo" }, "token"),
      (error: unknown) =>
        error instanceof FacadeError &&
        error.code === "CANCELLED" &&
        error.message.includes("cancelled"),
    );
  });

  test("throws facade error details when status is failed", async () => {
    globalThis.fetch = async (): Promise<Response> =>
      jsonResponse({
        query_id: "q1",
        status: "failed",
        error: {
          code: "QUERY_FAILED",
          message: "Athena execution failed",
        },
      });

    const provider = createFacadeProvider(createConfig());

    await assert.rejects(
      provider.resolve({ query_id: "q1", namespace: "demo" }, "token"),
      (error: unknown) =>
        error instanceof FacadeError &&
        error.code === "QUERY_FAILED" &&
        error.message === "Athena execution failed",
    );
  });

  test("maps non-2xx response body error into FacadeError", async () => {
    globalThis.fetch = async (): Promise<Response> =>
      jsonResponse(
        {
          error: {
            code: "FORBIDDEN",
            message: "No access",
          },
        },
        403,
      );

    const provider = createFacadeProvider(createConfig());

    await assert.rejects(
      provider.resolve({ query_id: "q1", namespace: "demo" }, "token"),
      (error: unknown) =>
        error instanceof FacadeError &&
        error.code === "FORBIDDEN" &&
        error.message === "No access",
    );
  });

  test("throws without calling fetch when query_id is missing", async () => {
    let calls = 0;
    globalThis.fetch = async (): Promise<Response> => {
      calls += 1;
      return jsonResponse({});
    };

    const provider = createFacadeProvider(createConfig());

    await assert.rejects(
      provider.resolve({ namespace: "demo" }, "token"),
      (error: unknown) =>
        error instanceof FacadeError &&
        error.code === "INVALID_ARGUMENT" &&
        error.message.includes("query_id"),
    );
    assert.equal(calls, 0);
  });

  test("throws without calling fetch when namespace is missing", async () => {
    let calls = 0;
    globalThis.fetch = async (): Promise<Response> => {
      calls += 1;
      return jsonResponse({});
    };

    const provider = createFacadeProvider(createConfig());

    await assert.rejects(
      provider.resolve({ query_id: "q1" }, "token"),
      (error: unknown) =>
        error instanceof FacadeError &&
        error.code === "INVALID_ARGUMENT" &&
        error.message.includes("namespace"),
    );
    assert.equal(calls, 0);
  });

  test("aborts the request when the timeout elapses", async () => {
    let aborted = false;

    globalThis.fetch = async (
      _input: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          aborted = true;
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        });
      });

    const provider = createFacadeProvider(createConfig({ runTimeoutMs: 5 }));

    await assert.rejects(
      provider.resolve({ query_id: "q1", namespace: "demo" }, "token"),
      (error: unknown) =>
        error instanceof Error && error.name === "AbortError",
    );
    assert.equal(aborted, true);
  });
});
