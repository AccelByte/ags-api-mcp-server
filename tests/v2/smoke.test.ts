/**
 * Smoke test for the MCP server.
 *
 * Starts the V2 server (auth disabled) and verifies:
 *  1. Health endpoint responds
 *  2. MCP initialize handshake succeeds
 *  3. tools/list returns expected tools and renderer metadata
 *  4. resources/list returns expected resources
 *  5. resources/read returns the renderer bundle
 *  6. prompts/list returns expected prompts
 *  7. render_bar_chart works end-to-end with provider="direct"
 *
 * Run:  pnpm test:smoke
 */

import { describe, it, after, before } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";

import { RENDERER_RESOURCE_URI } from "../../src/v2/mcp/renderer-resource.js";
import { BUNDLE_VERSION } from "../../src/v2/shared/render-schemas.js";

const PORT = 9876; // Use a non-default port to avoid conflicts
const BASE = `http://localhost:${PORT}`;
const MCP_URL = `${BASE}/mcp`;
const RENDER_TOOL_NAMES = [
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
] as const;
const CORE_TOOL_NAMES = [
  "search-apis",
  "describe-apis",
  "run-apis",
  "get_token_info",
] as const;

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Send a JSON-RPC request to the MCP endpoint and return the parsed response. */
async function mcpRequest(method: string, params: unknown = {}, id = 1) {
  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });

  const contentType = res.headers.get("content-type") ?? "";

  // Streamable HTTP transport may return SSE
  if (contentType.includes("text/event-stream")) {
    const text = await res.text();
    // Parse SSE: find lines starting with "data: " and extract JSON
    for (const line of text.split("\n")) {
      if (line.startsWith("data: ")) {
        const data = JSON.parse(line.slice(6));
        if (data.id === id) return data;
      }
    }
    throw new Error(`No matching response found in SSE stream for id=${id}`);
  }

  return res.json();
}

/** Wait for the server to be ready by polling the health endpoint. */
async function waitForServer(timeoutMs = 15_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) return;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Server did not become ready within ${timeoutMs}ms`);
}

async function waitForServerOrExit(
  server: ChildProcess,
  timeoutMs = 15_000,
): Promise<void> {
  let stderr = "";
  const onStderr = (chunk: Buffer) => {
    stderr += chunk.toString();
  };
  server.stderr?.on("data", onStderr);

  try {
    await Promise.race([
      waitForServer(timeoutMs),
      new Promise<never>((_, reject) => {
        server.once("exit", (code, signal) => {
          server.stdout?.destroy();
          server.stderr?.destroy();
          const details = stderr.trim();
          reject(
            new Error(
              `Server exited before becoming ready (code=${String(code)} signal=${String(signal)})${details ? `\n${details}` : ""}`,
            ),
          );
        });
      }),
    ]);
  } finally {
    server.stderr?.off("data", onStderr);
  }
}

async function stopServerProcess(server: ChildProcess): Promise<void> {
  server.stdout?.destroy();
  server.stderr?.destroy();

  if (server.exitCode !== null || server.signalCode !== null) {
    return;
  }

  await new Promise<void>((resolve) => {
    server.once("close", () => resolve());
    server.kill("SIGTERM");
  });
}

// ── Test suite ───────────────────────────────────────────────────────────────

describe("MCP server smoke tests", () => {
  let server: ChildProcess;

  before(async () => {
    server = spawn("node", ["dist/v2/index.js"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_ENV: "development",
        MCP_PORT: String(PORT),
        MCP_AUTH: "false",
        LOG_LEVEL: "warn",
        MCP_AUTH_SERVER_DISCOVERY_MODE: "none",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    server.on("error", (err) => {
      console.error("[server spawn error]", err);
    });

    // Forward server errors for debugging
    server.stderr?.on("data", (chunk: Buffer) => {
      const msg = chunk.toString();
      if (msg.includes('"level":50') || msg.includes('"level":60')) {
        process.stderr.write(`[server] ${msg}`);
      }
    });

    try {
      await waitForServerOrExit(server);
    } catch (error) {
      await stopServerProcess(server);
      throw error;
    }
  });

  after(async () => {
    if (server) {
      await stopServerProcess(server);
    }
  });

  it("health endpoint returns ok", async () => {
    const res = await fetch(`${BASE}/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, "ok");
    assert.ok(body.timestamp);
  });

  it("MCP initialize succeeds", async () => {
    const res = await mcpRequest("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "smoke-test", version: "1.0.0" },
    });

    assert.ok(res.result, `Expected result, got: ${JSON.stringify(res)}`);
    assert.equal(res.result.protocolVersion, "2025-03-26");
    assert.ok(res.result.serverInfo);
    assert.equal(res.result.serverInfo.name, "ags-api-mcp-server");
  });

  it("tools/list returns expected tools", async () => {
    // Each request creates a new stateless MCP session, so initialize first
    await mcpRequest("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "smoke-test", version: "1.0.0" },
    });

    const res = await mcpRequest("tools/list", {}, 2);
    assert.ok(res.result, `Expected result, got: ${JSON.stringify(res)}`);

    const tools = res.result.tools as Array<{
      name: string;
      _meta?: { ui?: { resourceUri?: string } };
    }>;
    const toolNames = tools.map((tool) => tool.name);
    const expectedTools = [...CORE_TOOL_NAMES, ...RENDER_TOOL_NAMES];
    for (const name of expectedTools) {
      assert.ok(
        toolNames.includes(name),
        `Missing tool: ${name}. Got: ${toolNames}`,
      );
    }

    const renderBarTool = tools.find((tool) => tool.name === "render_bar_chart");
    assert.ok(renderBarTool, "Expected render_bar_chart to be registered.");
    assert.equal(
      renderBarTool._meta?.ui?.resourceUri,
      RENDERER_RESOURCE_URI,
    );

    const totalPayloadBytes = Buffer.byteLength(JSON.stringify(tools), "utf8");
    const corePayloadBytes = Buffer.byteLength(
      JSON.stringify(tools.filter((tool) => !tool.name.startsWith("render_"))),
      "utf8",
    );
    const renderPayloadBytes = Buffer.byteLength(
      JSON.stringify(tools.filter((tool) => tool.name.startsWith("render_"))),
      "utf8",
    );

    console.info(
      `[smoke] tools/list payload bytes: total=${totalPayloadBytes} core=${corePayloadBytes} render=${renderPayloadBytes}`,
    );
  });

  it("search-apis exposes the four afs operations", async () => {
    await mcpRequest("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "smoke-test", version: "1.0.0" },
    });

    const res = await mcpRequest(
      "tools/call",
      {
        name: "search-apis",
        arguments: {
          spec: "afs",
          limit: 10,
        },
      },
      21,
    );

    assert.ok(res.result, `Expected result, got: ${JSON.stringify(res)}`);

    const result = res.result.structuredContent as {
      matched: number;
      results: Array<{ method: string; path: string }>;
    };

    assert.ok(result.matched >= 4, `Expected at least 4 matches, got ${result.matched}`);

    const operations = new Set(
      result.results.map((entry) => `${entry.method} ${entry.path}`),
    );

    const expectedOperations = [
      "POST /afs/v1/admin/namespaces/{namespace}/queries",
      "GET /afs/v1/admin/namespaces/{namespace}/queries/{id}",
      "GET /afs/v1/admin/namespaces/{namespace}/tables",
      "GET /afs/v1/admin/namespaces/{namespace}/tables/{database}/{table}",
    ];

    for (const operation of expectedOperations) {
      assert.ok(
        operations.has(operation),
        `Missing afs operation: ${operation}. Got: ${Array.from(operations).join(", ")}`,
      );
    }
  });

  it("resources/list returns expected resources", async () => {
    await mcpRequest("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "smoke-test", version: "1.0.0" },
    });

    const res = await mcpRequest("resources/list", {}, 3);
    assert.ok(res.result, `Expected result, got: ${JSON.stringify(res)}`);

    const resourceUris = res.result.resources.map(
      (r: { uri: string }) => r.uri,
    );
    const expectedResources = [
      "resource://workflows/schema",
      "resource://workflows/technical-specification",
      "resource://workflows",
      RENDERER_RESOURCE_URI,
    ];
    for (const uri of expectedResources) {
      assert.ok(
        resourceUris.includes(uri),
        `Missing resource: ${uri}. Got: ${resourceUris}`,
      );
    }

    const rendererResource = (
      res.result.resources as Array<{
        uri: string;
        _meta?: Record<string, unknown>;
      }>
    ).find((resource) => resource.uri === RENDERER_RESOURCE_URI);
    assert.ok(rendererResource, "Expected renderer resource to be listed.");
    assert.equal(
      rendererResource._meta?.["ags/bundleVersion"],
      BUNDLE_VERSION,
    );
  });

  it("resources/read returns the renderer bundle", async () => {
    await mcpRequest("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "smoke-test", version: "1.0.0" },
    });

    const res = await mcpRequest(
      "resources/read",
      { uri: RENDERER_RESOURCE_URI },
      31,
    );
    assert.ok(res.result, `Expected result, got: ${JSON.stringify(res)}`);

    const contents = res.result.contents as Array<{
      uri: string;
      text?: string;
    }>;
    assert.equal(contents[0]?.uri, RENDERER_RESOURCE_URI);
    assert.ok(contents[0]?.text);
    assert.match(contents[0]?.text ?? "", /<main id="app"><\/main>/);
  });

  it('render_bar_chart returns a bar payload for provider="direct"', async () => {
    await mcpRequest("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "smoke-test", version: "1.0.0" },
    });

    const res = await mcpRequest(
      "tools/call",
      {
        name: "render_bar_chart",
        arguments: {
          provider: "direct",
          data_columns: [
            { name: "category", type: "string" },
            { name: "value", type: "number" },
          ],
          data_rows: [
            ["alpha", "3"],
            ["beta", "8"],
          ],
          x: "category",
          y: "value",
        },
      },
      32,
    );
    assert.ok(res.result, `Expected result, got: ${JSON.stringify(res)}`);

    const structured = res.result.structuredContent as {
      chart_type: string;
      data: { rows: string[][] };
    };
    assert.equal(structured.chart_type, "bar");
    assert.ok(structured.data.rows.length > 0);
  });

  it("prompts/list returns expected prompts", async () => {
    await mcpRequest("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "smoke-test", version: "1.0.0" },
    });

    const res = await mcpRequest("prompts/list", {}, 4);
    assert.ok(res.result, `Expected result, got: ${JSON.stringify(res)}`);

    const promptNames = res.result.prompts.map(
      (p: { name: string }) => p.name,
    );
    assert.ok(
      promptNames.includes("run-workflow"),
      `Missing prompt: run-workflow. Got: ${promptNames}`,
    );
  });

  // ── Negative / error-handling tests ──────────────────────────────────────

  it("returns error for unknown method", async () => {
    await mcpRequest("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "smoke-test", version: "1.0.0" },
    });

    const res = await mcpRequest("nonexistent/method", {}, 11);
    assert.ok(
      res.error,
      `Expected error for unknown method, got: ${JSON.stringify(res)}`,
    );
  });

  it("server does not crash on malformed JSON body", async () => {
    const res = await fetch(MCP_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: "not-valid-json{{{",
    });
    // Server should respond (not crash) — any 4xx/5xx is acceptable
    assert.ok(res.status >= 400, `Expected error status, got ${res.status}`);

    // Verify server is still alive after bad request
    const health = await fetch(`${BASE}/health`);
    assert.equal(health.status, 200);
  });
});
