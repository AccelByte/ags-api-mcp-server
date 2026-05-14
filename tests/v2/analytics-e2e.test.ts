import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { spawn, type ChildProcess } from "node:child_process";

const PORT = 9877;
const BASE = `http://localhost:${PORT}`;
const MCP_URL = `${BASE}/mcp`;
const RUN_E2E = process.env.RUN_E2E === "1";
const E2E_BEARER_TOKEN = process.env.E2E_BEARER_TOKEN;
const E2E_NAMESPACE = process.env.E2E_NAMESPACE;
const E2E_DATABASE = process.env.E2E_DATABASE ?? "default";
const E2E_SQL =
  process.env.E2E_SQL ?? "SELECT 1 AS value, 'ok' AS label LIMIT 1";

type JsonRpcSuccess<T> = { result: T; error?: never };
type JsonRpcFailure = { error: { message?: string }; result?: never };

type QueryStatusResponse = {
  response?: {
    status?: number;
    data?: {
      query_id?: string;
      status?: string;
      columns?: Array<{ name: string; type: string }>;
      rows?: string[][];
    };
  };
  error?: { message?: string };
};

function requiresEnv(): string | null {
  if (!RUN_E2E) {
    return "RUN_E2E is not enabled.";
  }
  if (!E2E_BEARER_TOKEN) {
    return "E2E_BEARER_TOKEN is not set.";
  }
  if (!E2E_NAMESPACE) {
    return "E2E_NAMESPACE is not set.";
  }
  return null;
}

async function mcpRequest<T>(
  method: string,
  params: unknown = {},
  id = 1,
): Promise<JsonRpcSuccess<T> | JsonRpcFailure> {
  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${E2E_BEARER_TOKEN}`,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });

  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("text/event-stream")) {
    const text = await res.text();
    for (const line of text.split("\n")) {
      if (line.startsWith("data: ")) {
        return JSON.parse(line.slice(6)) as JsonRpcSuccess<T> | JsonRpcFailure;
      }
    }
    throw new Error(`No matching response found in SSE stream for id=${id}`);
  }

  return (await res.json()) as JsonRpcSuccess<T> | JsonRpcFailure;
}

async function waitForServer(timeoutMs = 15_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) return;
    } catch {
      // Not ready yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`Server did not become ready within ${timeoutMs}ms`);
}

async function initialize() {
  const res = await mcpRequest<{
    protocolVersion: string;
    serverInfo: { name: string };
  }>("initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "analytics-e2e", version: "1.0.0" },
  });

  assert.ok("result" in res, `Expected initialize result, got ${JSON.stringify(res)}`);
  assert.equal(res.result.protocolVersion, "2025-03-26");
}

async function callTool<T>(name: string, args: Record<string, unknown>, id: number) {
  const res = await mcpRequest<{ structuredContent?: T; content?: unknown }>(
    "tools/call",
    { name, arguments: args },
    id,
  );

  assert.ok("result" in res, `Tool ${name} failed: ${JSON.stringify(res)}`);
  return res.result;
}

function extractTables(data: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(data)) {
    return data.filter(
      (entry): entry is Record<string, unknown> =>
        typeof entry === "object" && entry !== null,
    );
  }

  if (typeof data !== "object" || data === null) {
    return [];
  }

  for (const key of ["tables", "items", "results", "data"]) {
    const value = (data as Record<string, unknown>)[key];
    if (Array.isArray(value)) {
      return value.filter(
        (entry): entry is Record<string, unknown> =>
          typeof entry === "object" && entry !== null,
      );
    }
  }

  return [];
}

async function pollQueryUntilSucceeded(queryId: string): Promise<QueryStatusResponse> {
  const deadline = Date.now() + 60_000;

  while (Date.now() < deadline) {
    const result = await callTool<QueryStatusResponse>(
      "run-apis",
      {
        spec: "afs",
        method: "GET",
        path: "/afs/v1/admin/namespaces/{namespace}/queries/{id}",
        pathParams: {
          namespace: E2E_NAMESPACE,
          id: queryId,
        },
      },
      20,
    );

    const structured = result.structuredContent as QueryStatusResponse;
    const status = structured.response?.data?.status;
    if (status === "succeeded") {
      return structured;
    }
    if (status === "failed" || status === "cancelled") {
      throw new Error(
        `Query ${queryId} ended in terminal state ${status}: ${JSON.stringify(structured)}`,
      );
    }

    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }

  throw new Error(`Query ${queryId} did not succeed within 60 seconds.`);
}

describe("analytics e2e", () => {
  let server: ChildProcess | undefined;
  const skipReason = requiresEnv();

  before(async () => {
    if (skipReason) {
      return;
    }

    server = spawn("node", ["dist/v2/index.js"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_ENV: "test",
        MCP_PORT: String(PORT),
        LOG_LEVEL: "warn",
        MCP_AUTH: "true",
        MCP_AUTH_SERVER_DISCOVERY_MODE: "none",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    server.stderr?.on("data", (chunk: Buffer) => {
      const msg = chunk.toString();
      if (msg.includes('"level":50') || msg.includes('"level":60')) {
        process.stderr.write(`[analytics-e2e] ${msg}`);
      }
    });

    await waitForServer();
    await initialize();
  });

  after(() => {
    if (server && !server.killed) {
      server.kill("SIGTERM");
    }
  });

  it("covers afs run-apis and render tools against a real environment", async (context) => {
    if (skipReason) {
      context.skip(skipReason);
      return;
    }

    const submit = await callTool<QueryStatusResponse>(
      "run-apis",
      {
        spec: "afs",
        method: "POST",
        path: "/afs/v1/admin/namespaces/{namespace}/queries",
        pathParams: {
          namespace: E2E_NAMESPACE,
        },
        body: {
          database: E2E_DATABASE,
          sql: E2E_SQL,
          wait_ms: 0,
          max_rows: 50,
        },
      },
      10,
    );

    const submitted = submit.structuredContent as QueryStatusResponse;
    const queryId = submitted.response?.data?.query_id;
    assert.ok(queryId, `Expected query_id from submit response: ${JSON.stringify(submitted)}`);

    const polled = await pollQueryUntilSucceeded(queryId);
    assert.equal(polled.response?.data?.status, "succeeded");

    const tables = await callTool<{ response?: { data?: unknown } }>(
      "run-apis",
      {
        spec: "afs",
        method: "GET",
        path: "/afs/v1/admin/namespaces/{namespace}/tables",
        pathParams: {
          namespace: E2E_NAMESPACE,
        },
        query: {
          database: E2E_DATABASE,
          limit: 20,
        },
      },
      11,
    );

    const listedTables = extractTables(tables.structuredContent?.response?.data);
    assert.ok(
      listedTables.length > 0,
      `Expected non-empty table list: ${JSON.stringify(tables.structuredContent)}`,
    );

    const firstTable = listedTables[0];
    const tableName =
      typeof firstTable?.name === "string"
        ? firstTable.name
        : typeof firstTable?.table_name === "string"
          ? firstTable.table_name
          : typeof firstTable?.table === "string"
            ? firstTable.table
            : null;
    assert.ok(tableName, `Could not determine table name from ${JSON.stringify(firstTable)}`);

    const tableDetails = await callTool<{ response?: { data?: unknown } }>(
      "run-apis",
      {
        spec: "afs",
        method: "GET",
        path: "/afs/v1/admin/namespaces/{namespace}/tables/{database}/{table}",
        pathParams: {
          namespace: E2E_NAMESPACE,
          database: E2E_DATABASE,
          table: tableName,
        },
      },
      12,
    );
    assert.ok(
      tableDetails.structuredContent?.response?.data,
      `Expected table details: ${JSON.stringify(tableDetails.structuredContent)}`,
    );

    const bar = await callTool<{
      chart_type: string;
      data: { rows: string[][] };
    }>(
      "render_bar_chart",
      {
        provider: "facade",
        namespace: E2E_NAMESPACE,
        query_id: queryId,
        x: "label",
        y: "value",
      },
      13,
    );
    assert.equal(bar.structuredContent?.chart_type, "bar");
    assert.ok((bar.structuredContent?.data.rows.length ?? 0) > 0);

    const table = await callTool<{ chart_type: string }>(
      "render_table",
      {
        provider: "direct",
        data_columns: [
          { name: "label", type: "string" },
          { name: "value", type: "number" },
        ],
        data_rows: [["ok", "1"]],
      },
      14,
    );
    assert.equal(table.structuredContent?.chart_type, "table");

    const metric = await callTool<{ chart_type: string }>(
      "render_metric",
      {
        provider: "facade",
        namespace: E2E_NAMESPACE,
        query_id: queryId,
        value: "value",
      },
      15,
    );
    assert.equal(metric.structuredContent?.chart_type, "metric");
  });
});
