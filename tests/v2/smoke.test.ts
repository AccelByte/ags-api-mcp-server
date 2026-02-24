/**
 * Smoke test for the MCP server.
 *
 * Starts the V2 server (auth disabled) and verifies:
 *  1. Health endpoint responds
 *  2. MCP initialize handshake succeeds
 *  3. tools/list returns expected tools
 *  4. resources/list returns expected resources
 *  5. prompts/list returns expected prompts
 *
 * Run:  pnpm test:smoke
 */

import { describe, it, after, before } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";

const PORT = 9876; // Use a non-default port to avoid conflicts
const BASE = `http://localhost:${PORT}`;
const MCP_URL = `${BASE}/mcp`;

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

    await waitForServer();
  });

  after(() => {
    if (server && !server.killed) {
      server.kill("SIGTERM");
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

    const toolNames = res.result.tools.map((t: { name: string }) => t.name);
    const expectedTools = [
      "search-apis",
      "describe-apis",
      "run-apis",
      "get_token_info",
    ];
    for (const name of expectedTools) {
      assert.ok(
        toolNames.includes(name),
        `Missing tool: ${name}. Got: ${toolNames}`,
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
    ];
    for (const uri of expectedResources) {
      assert.ok(
        resourceUris.includes(uri),
        `Missing resource: ${uri}. Got: ${resourceUris}`,
      );
    }
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
