import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import Ajv from "ajv";
import Ajv2020 from "ajv/dist/2020.js";

import type { Config } from "../../../src/v2/config.js";
import createServer from "../../../src/v2/mcp/server.js";

function testConfig(specsDir: string): Config {
  return {
    mcp: {
      port: 3000,
      path: "/mcp",
      serverUrl: "http://localhost:3000",
      enableAuth: false,
      enableRenderTools: true,
      allowDirectPins: true,
      authServerDiscoveryMode: "none",
    },
    openapi: {
      specsDir,
      searchLimit: 10,
      maxSearchLimit: 50,
      runTimeoutMs: 15_000,
      maxRunTimeoutMs: 60_000,
      serverUrl: "https://ags.invalid",
      includeWriteRequests: true,
    },
    runtime: { nodeEnv: "development", logLevel: "error" },
    hosted: {
      enabled: false,
      validateTokenIssuer: true,
      allowParentDomainIssuer: false,
    },
  };
}

function findSchemaKeys(value: unknown, path = "$"): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, i) => findSchemaKeys(item, `${path}[${i}]`));
  }
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, child]) => [
    ...(key === "$schema" ? [`${path}.$schema`] : []),
    ...findSchemaKeys(child, `${path}.${key}`),
  ]);
}

describe("tools/list outputSchema dialect", () => {
  let specsDir: string;
  let server: McpServer;
  let client: Client;
  let tools: Tool[];

  before(async () => {
    specsDir = await mkdtemp(join(tmpdir(), "output-schema-dialect-"));
    server = await createServer("test", "1", testConfig(specsDir));
    client = new Client({ name: "test-client", version: "1" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);
    ({ tools } = await client.listTools());
  });

  after(async () => {
    await client.close();
    await server.close();
    await rm(specsDir, { recursive: true, force: true });
  });

  test("covers the tools named in the report", () => {
    const withOutput = tools.filter((t) => t.outputSchema).map((t) => t.name);
    for (const name of [
      "search-apis",
      "describe-apis",
      "run-apis",
      "get_token_info",
    ]) {
      assert.ok(withOutput.includes(name), `${name} has an outputSchema`);
    }
  });

  test("no outputSchema declares a $schema at any depth", () => {
    for (const tool of tools.filter((t) => t.outputSchema)) {
      assert.deepEqual(findSchemaKeys(tool.outputSchema), [], tool.name);
    }
  });

  test("every outputSchema compiles under strict 2020-12 and draft-07", () => {
    // `type: [...]` unions are valid 2020-12; Ajv's strictTypes lint flags them.
    const strict2020 = new Ajv2020.default({
      strict: true,
      allowUnionTypes: true,
    });
    const draft07 = new Ajv.default();
    for (const tool of tools.filter((t) => t.outputSchema)) {
      assert.doesNotThrow(
        () => strict2020.compile(tool.outputSchema!),
        tool.name,
      );
      assert.doesNotThrow(() => draft07.compile(tool.outputSchema!), tool.name);
    }
  });

  test("leaves the rest of the tool definition intact", () => {
    for (const tool of tools.filter((t) => t.outputSchema)) {
      assert.equal(tool.outputSchema!.type, "object", tool.name);
    }
    const tokenInfo = tools.find((t) => t.name === "get_token_info");
    assert.ok(tokenInfo?.inputSchema, "inputSchema still present");
  });
});
