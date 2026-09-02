import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import http from "node:http";
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import axios from "axios";

import { OpenApiTools } from "../../../src/tools/openapi-tools.js";
import type { Config } from "../../../src/v2/config.js";
import {
  clientUserAgent,
  runWithRequestProvenance,
} from "../../../src/v2/mcp/provenance.js";
import {
  describePlaybook,
  getPlaybookVersion,
} from "../../../src/v2/mcp/prompts/playbooks.js";
import createServer from "../../../src/v2/mcp/server.js";
import registerMcpRoutes from "../../../src/v2/mcp/routes.js";
import { clearSessions } from "../../../src/v2/mcp/session-cache.js";
import { version } from "../../../src/v2/version.js";

const originalAdapter = axios.defaults.adapter;
beforeEach(() => {
  // The AFT-215 bridge is a module global; without this the suite only passes
  // because minted session ids happen not to collide.
  clearSessions();
});
afterEach(() => {
  axios.defaults.adapter = originalAdapter;
});

const afsSpec = `openapi: 3.0.0
info: { title: AFS, version: 1.0.0 }
servers: [{ url: https://afs.invalid }]
paths:
  /afs/v1/admin/namespaces/{namespace}/context:
    get:
      parameters:
        - { name: namespace, in: path, required: true, schema: { type: string } }
      responses: { '200': { description: OK } }
  /afs/v1/admin/namespaces/{namespace}/queries:
    post:
      parameters:
        - { name: namespace, in: path, required: true, schema: { type: string } }
      responses: { '200': { description: OK } }
  /afs/v1/admin/namespaces/{namespace}/queries/estimate:
    post:
      parameters:
        - { name: namespace, in: path, required: true, schema: { type: string } }
      responses: { '200': { description: OK } }
  /afs/v1/admin/namespaces/{namespace}/pinned-queries:
    post:
      parameters:
        - { name: namespace, in: path, required: true, schema: { type: string } }
      responses: { '200': { description: OK } }
  /afs/v1/admin/namespaces/{namespace}/pinned-queries/{id}/refresh:
    post:
      parameters:
        - { name: namespace, in: path, required: true, schema: { type: string } }
        - { name: id, in: path, required: true, schema: { type: string } }
      responses: { '200': { description: OK } }
`;

async function postToolCall(
  clientInfo?: unknown,
  meta?: Record<string, unknown>,
): Promise<Record<string, string>> {
  const specsDir = await mkdtemp(join(tmpdir(), "afs-provenance-route-"));
  await writeFile(join(specsDir, "afs.yaml"), afsSpec);
  const tools = new OpenApiTools({ specsDir });
  let captured: Record<string, string> | undefined;
  axios.defaults.adapter = async (config) => {
    captured = config.headers?.toJSON() as Record<string, string>;
    return { data: {}, status: 200, statusText: "OK", headers: {}, config };
  };

  const app = express();
  app.use(express.json());
  registerMcpRoutes(app, async () => {
    const mcp = new McpServer({ name: "test", version: "1" });
    mcp.registerTool(
      "record-downstream-request",
      { description: "test", inputSchema: {} },
      async () => {
        await tools.runApi({
          spec: "afs",
          method: "POST",
          path: "/afs/v1/admin/namespaces/{namespace}/queries",
          pathParams: { namespace: "demo" },
        });
        return { content: [{ type: "text", text: "ok" }] };
      },
    );
    return mcp;
  });

  const server = await new Promise<http.Server>((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  try {
    const { port } = server.address() as { port: number };
    const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "record-downstream-request",
          arguments: {},
          ...(clientInfo !== undefined && { clientInfo }),
          ...(meta !== undefined && { _meta: meta }),
        },
      }),
    });
    const responseBody = await response.text();
    assert.equal(response.status, 200, responseBody);
    assert.ok(
      captured,
      `expected tool callback to make a recorded downstream request: ${responseBody}`,
    );
    return captured;
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(specsDir, { recursive: true, force: true });
  }
}

interface DownstreamCall {
  url: string;
  headers: Record<string, string>;
}

interface Harness {
  /** POST a JSON-RPC body; returns the parsed response and the session id. */
  post: (
    body: unknown,
    sessionId?: string,
  ) => Promise<{ status: number; text: string; sessionId: string | null }>;
  /** Downstream (axios) requests made so far, in order. */
  calls: DownstreamCall[];
  /** Convenience: the most recent downstream call. */
  last: () => DownstreamCall | undefined;
}

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
      serverUrl: "https://afs.invalid",
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

/**
 * Boot the real production route + server factory over HTTP, and let the test
 * script its own request sequence. Downstream AFS calls are intercepted at the
 * axios adapter; a `/context` request answers with an `x-context-version`
 * header, exactly as the facade does.
 */
async function withProductionServer(
  run: (harness: Harness) => Promise<void>,
  contextVersions: Record<string, string> = { demo: "context-v2" },
): Promise<void> {
  const specsDir = await mkdtemp(join(tmpdir(), "afs-provenance-production-"));
  await writeFile(join(specsDir, "afs.yaml"), afsSpec);
  const config = testConfig(specsDir);

  const calls: DownstreamCall[] = [];
  axios.defaults.adapter = async (axiosConfig) => {
    const url = axiosConfig.url ?? "";
    calls.push({
      url,
      headers: axiosConfig.headers?.toJSON() as Record<string, string>,
    });
    const contextMatch = /\/namespaces\/([^/]+)\/context$/.exec(url);
    const namespace = contextMatch?.[1];
    return {
      data: {},
      status: 200,
      statusText: "OK",
      headers:
        namespace && contextVersions[namespace]
          ? { "x-context-version": contextVersions[namespace] }
          : {},
      config: axiosConfig,
    };
  };

  const app = express();
  app.use(express.json());
  registerMcpRoutes(
    app,
    (context) => createServer("test", "1", config, context),
    { path: "/mcp", defaultAgsBaseUrl: config.openapi.serverUrl },
  );
  const server = await new Promise<http.Server>((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });

  try {
    const { port } = server.address() as { port: number };
    const post = async (body: unknown, sessionId?: string) => {
      const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          ...(sessionId ? { "Mcp-Session-Id": sessionId } : {}),
        },
        body: JSON.stringify(body),
      });
      return {
        status: response.status,
        text: await response.text(),
        sessionId: response.headers.get("mcp-session-id"),
      };
    };
    await run({ post, calls, last: () => calls[calls.length - 1] });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(specsDir, { recursive: true, force: true });
  }
}

const initializeBody = (name: string, clientVersion: string) => ({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name, version: clientVersion },
  },
});

const runApiBody = (
  id: number,
  method: string,
  path: string,
  pathParams: Record<string, string>,
  extra: Record<string, unknown> = {},
) => ({
  jsonrpc: "2.0",
  id,
  method: "tools/call",
  params: {
    name: "run-apis",
    arguments: { spec: "afs", method, path, pathParams, allow: true },
    ...extra,
  },
});

const fetchContext = (id: number, namespace: string) =>
  runApiBody(id, "GET", "/afs/v1/admin/namespaces/{namespace}/context", {
    namespace,
  });

const submitQuery = (id: number, namespace: string) =>
  runApiBody(id, "POST", "/afs/v1/admin/namespaces/{namespace}/queries", {
    namespace,
  });

describe("V2 downstream provenance", () => {
  test("normalizes valid request-time client identity and omits invalid or oversized identity", () => {
    const valid = clientUserAgent("Cursor IDE", "1.2.3");
    assert.equal(valid.split(" ")[0], `ags-api-mcp-server/${version}`);
    assert.match(valid, /\(MCP-Client Cursor-IDE\/1.2.3\)$/);
    assert.doesNotMatch(clientUserAgent("bad/name", "1.2.3"), /MCP-Client/);
    assert.doesNotMatch(clientUserAgent("Cursor", undefined), /MCP-Client/);
    assert.match(clientUserAgent("a".repeat(128), "1"), /MCP-Client/);
    assert.doesNotMatch(clientUserAgent("a".repeat(129), "1"), /MCP-Client/);
  });

  test("carries client and context provenance across a stateless session", async () => {
    const playbookVersion = await getPlaybookVersion("afs");
    assert.ok(playbookVersion, "expected served AFS playbook version");

    await withProductionServer(async ({ post, last }) => {
      const init = await post(initializeBody("Cursor", "1.2.3"));
      assert.equal(init.status, 200, init.text);
      const sid = init.sessionId;
      assert.ok(sid, "expected the route to issue a session id");

      await post(fetchContext(2, "demo"), sid);
      const submit = await post(submitQuery(3, "demo"), sid);
      assert.equal(submit.status, 200, submit.text);

      // Identity came from `initialize`, two requests earlier.
      assert.equal(
        last()?.headers["User-Agent"],
        `ags-api-mcp-server/${version} (MCP-Client Cursor/1.2.3)`,
      );
      assert.equal(
        last()?.headers["X-Ab-AFS-Metadata"],
        `playbook="${playbookVersion}", context="context-v2"`,
      );
    });
  });

  test("never replays another namespace's catalog version", async () => {
    await withProductionServer(
      async ({ post, last }) => {
        const init = await post(initializeBody("Cursor", "1.2.3"));
        const sid = init.sessionId;

        await post(fetchContext(2, "alpha"), sid);
        await post(submitQuery(3, "beta"), sid);

        // alpha's catalog says nothing about beta's tables. Absent attribution
        // beats confidently wrong attribution in the corpus.
        const metadata = last()?.headers["X-Ab-AFS-Metadata"] ?? "";
        assert.match(metadata, /playbook="/);
        assert.doesNotMatch(metadata, /context=/);

        // The same session still attributes alpha correctly.
        await post(submitQuery(4, "alpha"), sid);
        assert.match(
          last()?.headers["X-Ab-AFS-Metadata"] ?? "",
          /context="catalog-alpha"/,
        );
      },
      { alpha: "catalog-alpha", beta: "catalog-beta" },
    );
  });

  test("a replayed session id cannot restamp another client's attribution", async () => {
    await withProductionServer(async ({ post, last }) => {
      const victim = await post(initializeBody("Victim", "1.0.0"));
      const sid = victim.sessionId;
      assert.ok(sid);

      // Someone who learned the id re-initializes onto it.
      await post(initializeBody("Attacker", "6.6.6"), sid);
      await post(submitQuery(3, "demo"), sid);

      assert.equal(
        last()?.headers["User-Agent"],
        `ags-api-mcp-server/${version} (MCP-Client Victim/1.0.0)`,
      );
    });
  });

  test("ignores clientInfo asserted on a method other than initialize", async () => {
    await withProductionServer(async ({ post, last }) => {
      const init = await post(initializeBody("Cursor", "1.2.3"));
      const sid = init.sessionId;

      // A tool call must not be able to restamp its own identity.
      await post(
        {
          ...submitQuery(2, "demo"),
          params: {
            ...submitQuery(2, "demo").params,
            clientInfo: { name: "Forged", version: "9.9.9" },
          },
        },
        sid,
      );

      assert.equal(
        last()?.headers["User-Agent"],
        `ags-api-mcp-server/${version} (MCP-Client Cursor/1.2.3)`,
      );
    });
  });

  test("prefers per-request _meta client identity over the AFT-215 bridge", async () => {
    await withProductionServer(async ({ post, last }) => {
      // Both sources present and disagreeing: the MCP 2026-07-28 envelope wins.
      const init = await post(initializeBody("BridgeClient", "1.0.0"));
      const sid = init.sessionId;

      await post(
        {
          ...submitQuery(2, "demo"),
          params: {
            ...submitQuery(2, "demo").params,
            _meta: {
              "io.modelcontextprotocol/clientInfo": {
                name: "ModernClient",
                version: "9.9.9",
              },
            },
          },
        },
        sid,
      );

      assert.equal(
        last()?.headers["User-Agent"],
        `ags-api-mcp-server/${version} (MCP-Client ModernClient/9.9.9)`,
      );
    });
  });

  test("omits client attribution when no session is recalled", async () => {
    await withProductionServer(async ({ post, last }) => {
      // No initialize, and no session id echoed back: nothing to recall.
      await post(fetchContext(1, "demo"));
      await post(submitQuery(2, "demo"));
      assert.equal(
        last()?.headers["User-Agent"],
        `ags-api-mcp-server/${version}`,
      );
    });
  });

  test("omits the context version when the session never fetched context", async () => {
    await withProductionServer(async ({ post, last }) => {
      const init = await post(initializeBody("Cursor", "1.2.3"));
      await post(submitQuery(2, "demo"), init.sessionId);

      const metadata = last()?.headers["X-Ab-AFS-Metadata"] ?? "";
      // Assert the header is still emitted, so this cannot pass by the whole
      // feature being silently disabled.
      assert.match(metadata, /^playbook="sha256-[0-9a-f]{64}"$/);
      assert.doesNotMatch(metadata, /context=/);
    });
  });

  test("attributes exactly the AFS endpoints that execute SQL", async () => {
    const cases: [string, Record<string, string>, boolean][] = [
      ["/afs/v1/admin/namespaces/{namespace}/queries", { namespace: "demo" }, true],
      [
        "/afs/v1/admin/namespaces/{namespace}/pinned-queries/{id}/refresh",
        { namespace: "demo", id: "p1" },
        true,
      ],
      [
        "/afs/v1/admin/namespaces/{namespace}/queries/estimate",
        { namespace: "demo" },
        false,
      ],
      [
        "/afs/v1/admin/namespaces/{namespace}/pinned-queries",
        { namespace: "demo" },
        false,
      ],
    ];

    await withProductionServer(async ({ post, last }) => {
      const init = await post(initializeBody("Cursor", "1.2.3"));
      const sid = init.sessionId;
      await post(fetchContext(2, "demo"), sid);

      let id = 3;
      // eslint-disable-next-line no-restricted-syntax
      for (const [path, pathParams, expected] of cases) {
        id += 1;
        // eslint-disable-next-line no-await-in-loop
        await post(runApiBody(id, "POST", path, pathParams), sid);
        const metadata = last()?.headers["X-Ab-AFS-Metadata"];
        assert.equal(
          metadata !== undefined,
          expected,
          `${path} should ${expected ? "" : "not "}carry provenance`,
        );
      }
    });
  });

  test("drops an over-cap context version rather than failing the query", async () => {
    // The facade rejects the whole submission with 400 above 128 bytes, so an
    // over-cap value must be dropped here, not forwarded.
    await withProductionServer(
      async ({ post, last }) => {
        const init = await post(initializeBody("Cursor", "1.2.3"));
        const sid = init.sessionId;

        await post(fetchContext(2, "atcap"), sid);
        await post(submitQuery(3, "atcap"), sid);
        assert.match(
          last()?.headers["X-Ab-AFS-Metadata"] ?? "",
          new RegExp(`context="${"c".repeat(128)}"`),
        );

        await post(fetchContext(4, "overcap"), sid);
        await post(submitQuery(5, "overcap"), sid);
        const metadata = last()?.headers["X-Ab-AFS-Metadata"] ?? "";
        assert.match(metadata, /playbook="/);
        assert.doesNotMatch(metadata, /context=/);
      },
      { atcap: "c".repeat(128), overcap: "c".repeat(129) },
    );
  });

  test("emits only the playbook and context members", async () => {
    await withProductionServer(async ({ post, last }) => {
      const init = await post(initializeBody("Cursor", "1.2.3"));
      const sid = init.sessionId;
      await post(fetchContext(2, "demo"), sid);
      await post(submitQuery(3, "demo"), sid);

      const metadata = last()?.headers["X-Ab-AFS-Metadata"] ?? "";
      const keys = metadata.split(",").map((part) => part.trim().split("=")[0]);
      assert.deepEqual(keys, ["playbook", "context"]);
      assert.ok(Buffer.byteLength(metadata, "utf8") <= 1024);
      // Client identity belongs in the User-Agent, never here.
      assert.doesNotMatch(metadata, /client/i);
    });
  });

  test("never forwards caller-supplied provenance headers", async () => {
    await withProductionServer(async ({ post, last }) => {
      const init = await post(initializeBody("Cursor", "1.2.3"));
      const sid = init.sessionId;
      await post(
        runApiBody(
          2,
          "POST",
          "/afs/v1/admin/namespaces/{namespace}/queries",
          { namespace: "demo" },
        ),
        sid,
      );

      const forged = await post(
        {
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: {
            name: "run-apis",
            arguments: {
              spec: "afs",
              method: "POST",
              path: "/afs/v1/admin/namespaces/{namespace}/queries",
              pathParams: { namespace: "demo" },
              allow: true,
              headers: {
                "User-Agent": "caller/1.0",
                "X-Ab-AFS-Metadata": 'playbook="forged", context="forged"',
              },
            },
          },
        },
        sid,
      );
      assert.equal(forged.status, 200, forged.text);

      const metadata = last()?.headers["X-Ab-AFS-Metadata"] ?? "";
      assert.doesNotMatch(metadata, /forged/);
      assert.equal(
        last()?.headers["User-Agent"],
        `ags-api-mcp-server/${version} (MCP-Client Cursor/1.2.3)`,
      );
    });
  });

  test("an unavailable playbook costs attribution, never a request", async () => {
    // The build copies assets with `|| true` and the Dockerfile ships only
    // dist, so "no playbook asset" is a reachable deployment state. Attribution
    // is telemetry: losing it must degrade to an absent header, never to a
    // thrown request. (The two halves are exercised separately because this
    // runtime cannot mock a frozen ESM export.)
    const config = testConfig(
      await mkdtemp(join(tmpdir(), "afs-provenance-noplaybook-")),
    );
    await writeFile(join(config.openapi.specsDir, "afs.yaml"), afsSpec);

    // 1. Building a server for a request with no playbook version must work.
    const server = await createServer("test", "1", config, {
      agsBaseUrl: config.openapi.serverUrl,
      namespace: "demo",
      userAgent: clientUserAgent("Cursor", "1.2.3"),
      playbookVersion: undefined,
    });
    await server.close();

    // 2. The submit still goes out, carrying identity but no metadata.
    const tools = new OpenApiTools({ specsDir: config.openapi.specsDir });
    let captured: Record<string, string> | undefined;
    axios.defaults.adapter = async (axiosConfig) => {
      captured = axiosConfig.headers?.toJSON() as Record<string, string>;
      return {
        data: {},
        status: 200,
        statusText: "OK",
        headers: {},
        config: axiosConfig,
      };
    };
    try {
      await runWithRequestProvenance(
        {
          userAgent: clientUserAgent("Cursor", "1.2.3"),
          playbookVersion: undefined,
          contextVersions: { demo: "context-v2" },
        },
        () =>
          tools.runApi({
            spec: "afs",
            method: "POST",
            path: "/afs/v1/admin/namespaces/{namespace}/queries",
            pathParams: { namespace: "demo" },
          }),
      );
      assert.equal(
        captured?.["User-Agent"],
        `ags-api-mcp-server/${version} (MCP-Client Cursor/1.2.3)`,
      );
      // The two members are independent facts. Losing the playbook asset must
      // not also discard the catalog revision, which is still true and still
      // useful for the corpus.
      assert.equal(captured?.["X-Ab-AFS-Metadata"], 'context="context-v2"');
    } finally {
      await rm(config.openapi.specsDir, { recursive: true, force: true });
    }
  });

  test("playbook versions follow served content", () => {
    const first = describePlaybook("afs", "# AFS\nfirst");
    const changed = describePlaybook("afs", "# AFS\nchanged");
    assert.notEqual(first.version, changed.version);
    assert.match(first.version, /^sha256-[0-9a-f]{64}$/);
  });

  test("forces the central User-Agent on the direct provenance scope", async () => {
    const specsDir = await mkdtemp(join(tmpdir(), "afs-provenance-"));
    await writeFile(join(specsDir, "afs.yaml"), afsSpec);
    const tools = new OpenApiTools({ specsDir });
    let captured: Record<string, string> | undefined;
    axios.defaults.adapter = async (config) => {
      captured = config.headers?.toJSON() as Record<string, string>;
      return { data: {}, status: 200, statusText: "OK", headers: {}, config };
    };

    try {
      await runWithRequestProvenance(
        {
          userAgent: clientUserAgent("Cursor", "1.2.3"),
          playbookVersion: "sha256-playbook-a",
          contextVersions: { demo: "context-v2" },
        },
        () =>
          tools.runApi({
            spec: "afs",
            method: "POST",
            path: "/afs/v1/admin/namespaces/{namespace}/queries",
            pathParams: { namespace: "demo" },
            headers: {
              "User-Agent": "caller/1.0",
              "X-Ab-AFS-Metadata": 'playbook="caller", context="caller-forged"',
            },
          }),
      );

      assert.equal(captured?.["User-Agent"], clientUserAgent("Cursor", "1.2.3"));
      assert.equal(
        captured?.["X-Ab-AFS-Metadata"],
        'playbook="sha256-playbook-a", context="context-v2"',
      );
    } finally {
      await rm(specsDir, { recursive: true, force: true });
    }
  });
});
