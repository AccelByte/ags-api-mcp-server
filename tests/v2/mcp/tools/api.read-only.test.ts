import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import axios from "axios";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { Config } from "../../../../src/v2/config.js";
import createServer from "../../../../src/v2/mcp/server.js";

const spec = `openapi: 3.0.0
info: { title: Demo, version: 1.0.0 }
servers: [{ url: https://ags.invalid }]
paths:
  /items:
    get:
      responses: { '200': { description: OK } }
    post:
      responses: { '200': { description: OK } }
`;

function testConfig(specsDir: string): Config {
  return {
    mcp: {
      port: 3000,
      path: "/mcp",
      serverUrl: "http://localhost:3000",
      enableAuth: false,
      enableRenderTools: false,
      allowDirectPins: false,
      authServerDiscoveryMode: "none",
    },
    openapi: {
      specsDir,
      searchLimit: 10,
      maxSearchLimit: 50,
      runTimeoutMs: 15_000,
      maxRunTimeoutMs: 60_000,
      serverUrl: "https://ags.invalid",
      includeWriteRequests: false,
    },
    runtime: { nodeEnv: "development", logLevel: "error" },
    hosted: {
      enabled: false,
      validateTokenIssuer: true,
      allowParentDomainIssuer: false,
    },
  };
}

describe("run-apis in read-only mode", () => {
  const originalAdapter = axios.defaults.adapter;
  let specsDir: string;
  let server: McpServer;
  let client: Client;
  let downstreamCalls = 0;

  before(async () => {
    specsDir = await mkdtemp(join(tmpdir(), "run-apis-read-only-"));
    await writeFile(join(specsDir, "demo.yaml"), spec);
    axios.defaults.adapter = async (config) => {
      downstreamCalls += 1;
      return { data: {}, status: 200, statusText: "OK", headers: {}, config };
    };
    server = await createServer("test", "1", testConfig(specsDir));
    client = new Client({ name: "test-client", version: "1" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);
  });

  after(async () => {
    axios.defaults.adapter = originalAdapter;
    await client.close();
    await server.close();
    await rm(specsDir, { recursive: true, force: true });
  });

  test("refuses a write without eliciting consent or calling downstream", async () => {
    downstreamCalls = 0;
    // No `allow` and no client elicitation capability: reaching the consent
    // step would fail differently, so the read-only message proves it was skipped.
    const result = await client.callTool({
      name: "run-apis",
      arguments: { spec: "demo", method: "POST", path: "/items" },
    });
    const structured = result.structuredContent as {
      error?: { message?: string };
    };
    assert.match(structured.error?.message ?? "", /read-only mode/);
    assert.equal(downstreamCalls, 0);
  });

  test("still runs a GET", async () => {
    downstreamCalls = 0;
    const result = await client.callTool({
      name: "run-apis",
      arguments: { spec: "demo", method: "GET", path: "/items" },
    });
    const structured = result.structuredContent as { error?: unknown };
    assert.equal(structured.error, undefined);
    assert.equal(downstreamCalls, 1);
  });
});
