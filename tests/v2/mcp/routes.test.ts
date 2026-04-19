// Copyright (c) 2025 AccelByte Inc. All Rights Reserved.
// This is licensed software from AccelByte Inc, for limitations
// and restrictions contact your company contract manager.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";

import registerMcpRoutes from "../../../src/v2/mcp/routes.js";
import registerOAuthRoutes from "../../../src/v2/auth/routes.js";
import { resolveAgsHost } from "../../../src/v2/auth/host-resolver.js";

// Stand up a minimal MCP server instance with hosted-mode wiring matching
// production. Tests assert the WWW-Authenticate header points at THIS server's
// /.well-known/oauth-protected-resource — not the upstream AGS host carried
// in X-Forwarded-Host.

const MCP_SERVER_URL = "http://localhost:9999";
const AGS_BASE_URL = "https://development.accelbyte.io";

let server: http.Server;
let baseUrl: string;

async function startServer(): Promise<void> {
  const app = express();
  app.use(express.json());
  // validateTokenIssuer:false intentionally — these tests exercise URL
  // construction in the WWW-Authenticate / oauth-protected-resource paths,
  // which trigger before any token-issuer comparison and don't need a
  // signed JWT. allowParentDomainIssuer defaults to false here for the
  // same reason. End-to-end issuer checks live in host-resolver.test.ts.
  app.use(
    resolveAgsHost({
      enabled: true,
      validateTokenIssuer: false,
      allowParentDomainIssuer: false,
    }),
  );

  registerOAuthRoutes(app, MCP_SERVER_URL, AGS_BASE_URL, {
    hostedMode: true,
    mcpPath: "/mcp",
  });

  registerMcpRoutes(
    app,
    async () => {
      throw new Error("factory should not be called for unauthenticated 401");
    },
    {
      path: "/mcp",
      enableAuth: true,
      defaultAgsBaseUrl: AGS_BASE_URL,
      mcpServerUrl: MCP_SERVER_URL,
      hostedMode: true,
    },
  );

  return new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });
}

async function stopServer(): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

describe("WWW-Authenticate header in hosted mode (non-colocated AGS)", () => {
  before(async () => startServer());
  after(async () => stopServer());

  test("advertises MCP server URL — not AGS host from X-Forwarded-Host", async () => {
    const agsHost = "abtestdewa-pong.internal.gamingservices.accelbyte.io";

    const res = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "X-Forwarded-Host": agsHost,
        "X-Forwarded-Proto": "https",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "test", version: "0" },
        },
      }),
    });

    assert.equal(res.status, 401);
    const wwwAuth = res.headers.get("www-authenticate");
    assert.ok(wwwAuth, "WWW-Authenticate header must be present");

    const match = wwwAuth!.match(/resource_metadata="([^"]+)"/);
    assert.ok(match, `resource_metadata not found in: ${wwwAuth}`);
    const advertisedUrl = match![1];

    assert.ok(
      advertisedUrl.startsWith(MCP_SERVER_URL),
      `advertised URL must point to MCP server (${MCP_SERVER_URL}), got: ${advertisedUrl}`,
    );
    assert.ok(
      !advertisedUrl.includes(agsHost),
      `advertised URL must NOT contain AGS host from X-Forwarded-Host (${agsHost}), got: ${advertisedUrl}`,
    );
    assert.equal(
      advertisedUrl,
      `${MCP_SERVER_URL}/.well-known/oauth-protected-resource`,
    );
  });

  test("namespace-aware WWW-Authenticate also points to MCP server", async () => {
    const agsHost = "abtestdewa-pong.internal.gamingservices.accelbyte.io";

    const res = await fetch(`${baseUrl}/mcp/myns`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "X-Forwarded-Host": agsHost,
        "X-Forwarded-Proto": "https",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "test", version: "0" },
        },
      }),
    });

    assert.equal(res.status, 401);
    const wwwAuth = res.headers.get("www-authenticate");
    const match = wwwAuth!.match(/resource_metadata="([^"]+)"/);
    assert.equal(
      match![1],
      `${MCP_SERVER_URL}/.well-known/oauth-protected-resource/myns`,
    );
  });

  test("advertised URL actually resolves on this server (no 404)", async () => {
    // The whole point of fixing the bug: the URL must be fetchable.
    // Translate the configured MCP_SERVER_URL to the test server's port.
    const agsHost = "abtestdewa-pong.internal.gamingservices.accelbyte.io";
    const protectedResourceUrl = `${baseUrl}/.well-known/oauth-protected-resource`;

    const res = await fetch(protectedResourceUrl, {
      headers: {
        "X-Forwarded-Host": agsHost,
        "X-Forwarded-Proto": "https",
      },
    });

    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      resource: string;
      authorization_servers: string[];
    };
    assert.ok(body.resource);
    assert.ok(Array.isArray(body.authorization_servers));
    assert.equal(body.authorization_servers.length, 1);
    // resource must point at the MCP server (RFC 9728 §3): clients validate
    // it against the URL they originally requested. In hosted mode the AGS
    // host carried in X-Forwarded-Host is *not* the MCP server's location.
    assert.equal(body.resource, `${MCP_SERVER_URL}/mcp`);
    assert.ok(
      !body.resource.includes(agsHost),
      `resource must NOT contain AGS host (${agsHost}), got: ${body.resource}`,
    );
    // authorization_servers should still derive from forwarded host (AGS env)
    assert.ok(body.authorization_servers[0].includes(agsHost));
  });

  test("namespace-aware protected resource doc pins resource to MCP server", async () => {
    const agsHost = "abtestdewa-pong.internal.gamingservices.accelbyte.io";
    const res = await fetch(
      `${baseUrl}/.well-known/oauth-protected-resource/myns`,
      {
        headers: {
          "X-Forwarded-Host": agsHost,
          "X-Forwarded-Proto": "https",
        },
      },
    );

    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      resource: string;
      authorization_servers: string[];
    };
    assert.equal(body.resource, `${MCP_SERVER_URL}/mcp/myns`);
    assert.ok(body.authorization_servers[0].includes(agsHost));
    assert.ok(body.authorization_servers[0].endsWith("/myns"));
  });
});

describe("WWW-Authenticate header in standalone (non-hosted) mode with trusted proxy", () => {
  let standaloneServer: http.Server;
  let standaloneBaseUrl: string;

  before(async () => {
    const app = express();
    // Operator-supplied trust proxy setting models a real reverse-proxy
    // deployment. Without it, deriveBaseUrl ignores forwarded headers as a
    // host-injection guard.
    app.set("trust proxy", 1);
    app.use(express.json());

    registerMcpRoutes(
      app,
      async () => {
        throw new Error("factory should not be called for unauthenticated 401");
      },
      {
        path: "/mcp",
        enableAuth: true,
        defaultAgsBaseUrl: AGS_BASE_URL,
        mcpServerUrl: MCP_SERVER_URL,
        hostedMode: false,
      },
    );

    return new Promise<void>((resolve) => {
      standaloneServer = app.listen(0, "127.0.0.1", () => {
        const addr = standaloneServer.address() as { port: number };
        standaloneBaseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  after(
    async () =>
      new Promise<void>((resolve) =>
        standaloneServer.close(() => resolve()),
      ),
  );

  test("uses request-derived URL when X-Forwarded-Host present and proxy trusted", async () => {
    const proxyHost = "api.example.com";

    const res = await fetch(`${standaloneBaseUrl}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "X-Forwarded-Host": proxyHost,
        "X-Forwarded-Proto": "https",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "0" } },
      }),
    });

    assert.equal(res.status, 401);
    const wwwAuth = res.headers.get("www-authenticate");
    const match = wwwAuth!.match(/resource_metadata="([^"]+)"/);
    assert.equal(
      match![1],
      `https://${proxyHost}/.well-known/oauth-protected-resource`,
    );
  });

  test("falls back to mcpServerUrl when no proxy headers", async () => {
    const res = await fetch(`${standaloneBaseUrl}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "t", version: "0" },
        },
      }),
    });

    assert.equal(res.status, 401);
    const wwwAuth = res.headers.get("www-authenticate");
    const match = wwwAuth!.match(/resource_metadata="([^"]+)"/);
    assert.equal(
      match![1],
      `${MCP_SERVER_URL}/.well-known/oauth-protected-resource`,
    );
  });
});

describe("WWW-Authenticate header in standalone mode WITHOUT trusted proxy (host-injection guard)", () => {
  // Guards the [HIGH] finding: when no proxy is trusted, deriveBaseUrl must
  // ignore X-Forwarded-Host so an untrusted client cannot drive the
  // resource_metadata URL that OAuth-discovering clients fetch.
  let s: http.Server;
  let url: string;

  before(async () => {
    const app = express();
    // Deliberately do NOT call app.set("trust proxy", ...) — Express defaults
    // to false, which is the secure default we want to verify.
    app.use(express.json());
    registerMcpRoutes(
      app,
      async () => {
        throw new Error("factory should not be called for unauthenticated 401");
      },
      {
        path: "/mcp",
        enableAuth: true,
        defaultAgsBaseUrl: AGS_BASE_URL,
        mcpServerUrl: MCP_SERVER_URL,
        hostedMode: false,
      },
    );
    return new Promise<void>((resolve) => {
      s = app.listen(0, "127.0.0.1", () => {
        const addr = s.address() as { port: number };
        url = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  after(async () => new Promise<void>((resolve) => s.close(() => resolve())));

  test("ignores X-Forwarded-Host from untrusted client and uses configured mcpServerUrl", async () => {
    const attackerHost = "attacker.example.com";

    const res = await fetch(`${url}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "X-Forwarded-Host": attackerHost,
        "X-Forwarded-Proto": "https",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "0" } },
      }),
    });

    assert.equal(res.status, 401);
    const wwwAuth = res.headers.get("www-authenticate");
    const match = wwwAuth!.match(/resource_metadata="([^"]+)"/);
    assert.ok(
      !match![1].includes(attackerHost),
      `URL must NOT contain attacker-supplied host (${attackerHost}), got: ${match![1]}`,
    );
    assert.equal(
      match![1],
      `${MCP_SERVER_URL}/.well-known/oauth-protected-resource`,
    );
  });
});

describe("WWW-Authenticate header in standalone mode without mcpServerUrl", () => {
  // Guards the deriveBaseUrl(req, mcpServerUrl || defaultAgsBaseUrl) fallback
  // chain: when mcpServerUrl is undefined and the request has no proxy
  // headers, the URL must come from defaultAgsBaseUrl rather than the
  // hardcoded fallback inside deriveBaseUrl.
  let s: http.Server;
  let url: string;

  before(async () => {
    const app = express();
    app.use(express.json());
    registerMcpRoutes(
      app,
      async () => {
        throw new Error("factory should not be called for unauthenticated 401");
      },
      {
        path: "/mcp",
        enableAuth: true,
        defaultAgsBaseUrl: AGS_BASE_URL,
        // mcpServerUrl deliberately omitted
        hostedMode: false,
      },
    );

    return new Promise<void>((resolve) => {
      s = app.listen(0, "127.0.0.1", () => {
        const addr = s.address() as { port: number };
        url = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  after(async () => new Promise<void>((resolve) => s.close(() => resolve())));

  test("uses defaultAgsBaseUrl when mcpServerUrl is undefined and no proxy headers", async () => {
    const res = await fetch(`${url}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "t", version: "0" },
        },
      }),
    });

    assert.equal(res.status, 401);
    const wwwAuth = res.headers.get("www-authenticate");
    const match = wwwAuth!.match(/resource_metadata="([^"]+)"/);
    assert.equal(
      match![1],
      `${AGS_BASE_URL}/.well-known/oauth-protected-resource`,
    );
  });
});
