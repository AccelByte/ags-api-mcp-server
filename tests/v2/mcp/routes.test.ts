// Copyright (c) 2025 AccelByte Inc.
// SPDX-License-Identifier: Apache-2.0

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";

import registerMcpRoutes from "../../../src/v2/mcp/routes.js";
import registerOAuthRoutes from "../../../src/v2/auth/routes.js";
import { resolveAgsHost } from "../../../src/v2/auth/host-resolver.js";

// Stand up a minimal MCP server instance with hosted-mode wiring matching
// production. Tests assert OAuth discovery stays on the client-facing public
// origin and includes the complete MCP resource path required by RFC 9728.

const MCP_SERVER_URL = "http://localhost:9999";
const AGS_BASE_URL = "https://development.accelbyte.io";

let server: http.Server;
let baseUrl: string;

async function startServer(): Promise<void> {
  const app = express();
  app.set("trust proxy", 1);
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

  test("advertises the path-aware URL on the client-facing origin", async () => {
    const agsHost = "teststudio-beta.internal.gamingservices.accelbyte.io";

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
      advertisedUrl.startsWith(`https://${agsHost}`),
      `advertised URL must use client-facing host (${agsHost}), got: ${advertisedUrl}`,
    );
    assert.ok(
      !advertisedUrl.startsWith(MCP_SERVER_URL),
      `advertised URL must not expose backend host (${MCP_SERVER_URL}), got: ${advertisedUrl}`,
    );
    assert.equal(
      advertisedUrl,
      `https://${agsHost}/.well-known/oauth-protected-resource/mcp`,
    );
  });

  test("namespace-aware WWW-Authenticate includes the full resource path", async () => {
    const agsHost = "teststudio-beta.internal.gamingservices.accelbyte.io";

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
      `https://${agsHost}/.well-known/oauth-protected-resource/mcp/myns`,
    );
  });

  test("root compatibility URL identifies the public MCP resource", async () => {
    const agsHost = "teststudio-beta.internal.gamingservices.accelbyte.io";
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
    // RFC 9728 §3.3 requires this value to match the public resource URL the
    // client originally requested.
    assert.equal(body.resource, `https://${agsHost}/mcp`);
    assert.ok(
      !body.resource.startsWith(MCP_SERVER_URL),
      `resource must not expose backend host (${MCP_SERVER_URL}), got: ${body.resource}`,
    );
    assert.equal(body.authorization_servers[0], `https://${agsHost}`);
  });

  test("protected resource metadata advertises offline_access so clients request a refresh token", async () => {
    const agsHost = "teststudio-beta.internal.gamingservices.accelbyte.io";
    const protectedResourceUrl = `${baseUrl}/.well-known/oauth-protected-resource`;

    const res = await fetch(protectedResourceUrl, {
      headers: {
        "X-Forwarded-Host": agsHost,
        "X-Forwarded-Proto": "https",
      },
    });

    assert.equal(res.status, 200);
    const body = (await res.json()) as { scopes_supported?: string[] };
    // Without this, MCP clients that resolve scope from the resource metadata
    // (per the MCP SDK's OAuth client) never request offline_access, so IAM
    // never issues a refresh token and sessions can't silently renew.
    assert.ok(
      Array.isArray(body.scopes_supported),
      "expected scopes_supported to be present on the protected resource metadata",
    );
    assert.ok(body.scopes_supported!.includes("offline_access"));
  });

  test("protected resource metadata omits scopes AGS IAM rejects", async () => {
    const res = await fetch(`${baseUrl}/.well-known/oauth-protected-resource`, {
      headers: {
        "X-Forwarded-Host":
          "teststudio-beta.internal.gamingservices.accelbyte.io",
        "X-Forwarded-Proto": "https",
      },
    });

    assert.equal(res.status, 200);
    const body = (await res.json()) as { scopes_supported: string[] };
    // A client that requests the advertised set verbatim must not be handed
    // an invalid_scope error by IAM.
    assert.ok(!body.scopes_supported.includes("openid"));
    assert.ok(!body.scopes_supported.includes("email"));
  });

  test("path-aware protected resource doc for /mcp does not fall into namespace route", async () => {
    const agsHost = "teststudio-beta.internal.gamingservices.accelbyte.io";

    const res = await fetch(
      `${baseUrl}/.well-known/oauth-protected-resource/mcp`,
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
    assert.equal(body.resource, `https://${agsHost}/mcp`);
    assert.equal(body.authorization_servers[0], `https://${agsHost}`);
  });

  test("short backend namespace route keeps the public resource identity", async () => {
    const agsHost = "teststudio-beta.internal.gamingservices.accelbyte.io";
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
    assert.equal(body.resource, `https://${agsHost}/mcp/myns`);
    assert.equal(body.authorization_servers[0], `https://${agsHost}/myns`);
  });

  test("full path-aware namespace route works without an ingress rewrite", async () => {
    const agsHost = "teststudio-beta.internal.gamingservices.accelbyte.io";
    const res = await fetch(
      `${baseUrl}/.well-known/oauth-protected-resource/mcp/myns`,
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
    assert.equal(body.resource, `https://${agsHost}/mcp/myns`);
    assert.equal(body.authorization_servers[0], `https://${agsHost}/myns`);
  });
});

describe("hosted mode without a trusted proxy", () => {
  let untrustedServer: http.Server;
  let untrustedBaseUrl: string;

  before(async () => {
    const app = express();
    // Deliberately leave Express `trust proxy` disabled. resolveAgsHost still
    // creates req.ags from raw headers, so these requests exercise the hosted
    // fallback that previously reintroduced host-header injection.
    app.use(express.json());
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

    return new Promise<void>((resolve) => {
      untrustedServer = app.listen(0, "127.0.0.1", () => {
        const addr = untrustedServer.address() as { port: number };
        untrustedBaseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  after(
    async () =>
      new Promise<void>((resolve) => untrustedServer.close(() => resolve())),
  );

  test("ignores attacker-controlled hosted headers in WWW-Authenticate", async () => {
    const attackerHost = "attacker.example.com";
    const res = await fetch(`${untrustedBaseUrl}/mcp/myns`, {
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
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "test", version: "0" },
        },
      }),
    });

    assert.equal(res.status, 401);
    assert.equal(
      res.headers
        .get("www-authenticate")
        ?.match(/resource_metadata="([^"]+)"/)?.[1],
      `${MCP_SERVER_URL}/.well-known/oauth-protected-resource/mcp/myns`,
    );

    const metadataRes = await fetch(
      `${untrustedBaseUrl}/.well-known/oauth-protected-resource/mcp/myns`,
      {
        headers: {
          "X-Forwarded-Host": attackerHost,
          "X-Forwarded-Proto": "https",
        },
      },
    );
    const metadata = (await metadataRes.json()) as {
      resource: string;
      authorization_servers: string[];
    };
    assert.equal(metadata.resource, `${MCP_SERVER_URL}/mcp/myns`);
    assert.deepEqual(metadata.authorization_servers, [`${AGS_BASE_URL}/myns`]);
  });

  test("uses the configured public URL for direct metadata requests", async () => {
    const res = await fetch(
      `${untrustedBaseUrl}/.well-known/oauth-protected-resource/mcp/myns`,
    );

    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      resource: string;
      authorization_servers: string[];
    };
    assert.equal(body.resource, `${MCP_SERVER_URL}/mcp/myns`);
    assert.deepEqual(body.authorization_servers, [`${AGS_BASE_URL}/myns`]);
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
      new Promise<void>((resolve) => standaloneServer.close(() => resolve())),
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
      `https://${proxyHost}/.well-known/oauth-protected-resource/mcp`,
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
      `${MCP_SERVER_URL}/.well-known/oauth-protected-resource/mcp`,
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
    assert.ok(
      !match![1].includes(attackerHost),
      `URL must NOT contain attacker-supplied host (${attackerHost}), got: ${match![1]}`,
    );
    assert.equal(
      match![1],
      `${MCP_SERVER_URL}/.well-known/oauth-protected-resource/mcp`,
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
      `${AGS_BASE_URL}/.well-known/oauth-protected-resource/mcp`,
    );
  });
});

describe("MCP mounted at the web root (MCP_PATH='/')", () => {
  // Guards the root-path configuration: a namespaced request must be served
  // at /:namespace (not the unreachable //:namespace pattern), and the
  // advertised resource_metadata URL must not contain a double slash —
  // otherwise OAuth discovery 404s for root-mounted deployments.
  let s: http.Server;
  let url: string;

  before(async () => {
    const app = express();
    app.use(express.json());
    registerOAuthRoutes(app, MCP_SERVER_URL, AGS_BASE_URL, {
      hostedMode: false,
      mcpPath: "/",
    });
    registerMcpRoutes(
      app,
      async () => {
        throw new Error("factory should not be called for unauthenticated 401");
      },
      {
        path: "/",
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

  function initializeBody(): string {
    return JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "t", version: "0" },
      },
    });
  }

  test("namespaced request is routed and advertises a single-slash metadata URL", async () => {
    const res = await fetch(`${url}/myns`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: initializeBody(),
    });

    assert.equal(res.status, 401);
    const wwwAuth = res.headers.get("www-authenticate");
    const match = wwwAuth!.match(/resource_metadata="([^"]+)"/);
    assert.ok(match, `resource_metadata not found in: ${wwwAuth}`);
    assert.equal(
      match![1],
      `${MCP_SERVER_URL}/.well-known/oauth-protected-resource/myns`,
    );
    assert.ok(
      !match![1].includes("//myns"),
      `advertised URL must not contain a double slash, got: ${match![1]}`,
    );
  });

  test("advertised namespaced metadata URL is actually served", async () => {
    const res = await fetch(`${url}/.well-known/oauth-protected-resource/myns`);

    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      resource: string;
      authorization_servers: string[];
    };
    assert.equal(body.resource, `${MCP_SERVER_URL}/myns`);
    assert.deepEqual(body.authorization_servers, [`${AGS_BASE_URL}/myns`]);
  });

  test("non-namespaced request advertises the root well-known document", async () => {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: initializeBody(),
    });

    assert.equal(res.status, 401);
    const match = res.headers
      .get("www-authenticate")!
      .match(/resource_metadata="([^"]+)"/);
    assert.equal(
      match![1],
      `${MCP_SERVER_URL}/.well-known/oauth-protected-resource`,
    );

    const metadataRes = await fetch(match![1].replace(MCP_SERVER_URL, url));
    assert.equal(metadataRes.status, 200);
    const body = (await metadataRes.json()) as { resource: string };
    assert.equal(body.resource, MCP_SERVER_URL);
  });
});

describe("GET on MCP paths (server-identity probe vs. OAuth discovery)", () => {
  // serverInfo once came from the `:namespace` catch-all, so every
  // GET /mcp/<anything> answered 200 and rmcp-based clients read it as OAuth
  // metadata. Identity now has its own path; the MCP paths answer 405.
  const SERVER_INFO = { name: "ags-api-mcp-server", version: "9.9.9" };

  let s: http.Server;
  let url: string;

  before(async () => {
    const app = express();
    app.use(express.json());
    registerOAuthRoutes(app, MCP_SERVER_URL, AGS_BASE_URL, {
      hostedMode: false,
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
        hostedMode: false,
        serverInfo: SERVER_INFO,
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

  test("GET /mcp/version.json returns serverInfo", async () => {
    const res = await fetch(`${url}/mcp/version.json`);

    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), SERVER_INFO);
  });

  test("GET /mcp answers 405, never a 200 JSON body", async () => {
    const res = await fetch(`${url}/mcp`);

    assert.equal(res.status, 405);
    const body = (await res.json()) as { error?: { message?: string } };
    assert.equal(body.error?.message, "Method not allowed");
  });

  test("405 responses name the allowed method", async () => {
    // RFC 9110 §15.5.6: a 405 without Allow leaves a method-aware proxy no way
    // to learn that POST is the supported verb.
    for (const [method, path] of [
      ["GET", "/mcp"],
      ["GET", "/mcp/teststudio-testgame"],
      ["DELETE", "/mcp"],
      ["DELETE", "/mcp/teststudio-testgame"],
    ] as const) {
      const res = await fetch(`${url}${path}`, { method });
      assert.equal(res.status, 405, `${method} ${path}`);
      assert.equal(res.headers.get("allow"), "POST", `${method} ${path}`);
    }
  });

  test("GET /mcp/:namespace answers 405, never a 200 JSON body", async () => {
    const res = await fetch(`${url}/mcp/teststudio-testgame`);

    assert.equal(res.status, 405);
  });

  test("rmcp-style discovery reaches valid resource metadata after the 405", async () => {
    // Mirrors rmcp's discover_resource_metadata_url(): probe the MCP URL, then
    // on a non-200/401 fall through to the path-inserted well-known URL, which
    // must carry a `resource` field or discovery aborts.
    const probe = await fetch(`${url}/mcp/teststudio-testgame`);
    assert.notEqual(probe.status, 200);

    const metadata = await fetch(
      `${url}/.well-known/oauth-protected-resource/mcp/teststudio-testgame`,
    );
    assert.equal(metadata.status, 200);
    const body = (await metadata.json()) as { resource?: string };
    assert.equal(body.resource, `${MCP_SERVER_URL}/mcp/teststudio-testgame`);
  });

  test("omitting serverInfo leaves no version route", async () => {
    const app = express();
    app.use(express.json());
    registerMcpRoutes(app, async () => {
      throw new Error("factory should not be called");
    });

    const bare = await new Promise<http.Server>((resolve) => {
      const srv = app.listen(0, "127.0.0.1", () => resolve(srv));
    });
    const addr = bare.address() as { port: number };

    try {
      // Falls through to the :namespace GET handler — 405, not a 200.
      const res = await fetch(`http://127.0.0.1:${addr.port}/mcp/version.json`);
      assert.equal(res.status, 405);
    } finally {
      await new Promise<void>((resolve) => bare.close(() => resolve()));
    }
  });
});

describe("MCP_PATH carrying a trailing slash", () => {
  // "/mcp/" used to build "/mcp//:namespace" and "/mcp//version.json" — routes
  // no ordinary request matches, while the advertised URLs carried the same
  // double slash. config.ts normalizes the env var; this pins the route layer
  // so a direct caller gets the same treatment.
  let s: http.Server;
  let url: string;

  before(async () => {
    const app = express();
    app.use(express.json());
    registerOAuthRoutes(app, MCP_SERVER_URL, AGS_BASE_URL, {
      hostedMode: false,
      mcpPath: "/mcp/",
    });
    registerMcpRoutes(
      app,
      async () => {
        throw new Error("factory should not be called");
      },
      {
        path: "/mcp/",
        serverInfo: { name: "ags-api-mcp-server", version: "9.9.9" },
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

  test("routes are reachable at the single-slash paths", async () => {
    assert.equal((await fetch(`${url}/mcp/version.json`)).status, 200);
    assert.equal((await fetch(`${url}/mcp`)).status, 405);
    assert.equal((await fetch(`${url}/mcp/somestudio`)).status, 405);
  });

  test("double-slash paths are not what got registered", async () => {
    assert.equal((await fetch(`${url}/mcp//version.json`)).status, 404);
  });

  test("well-known documents avoid the double slash too", async () => {
    const res = await fetch(
      `${url}/.well-known/oauth-protected-resource/mcp/somestudio`,
    );

    assert.equal(res.status, 200);
    const body = (await res.json()) as { resource: string };
    assert.equal(body.resource, `${MCP_SERVER_URL}/mcp/somestudio`);
    assert.ok(!body.resource.includes("//mcp"));
  });
});

describe("version.json when MCP is mounted at the web root", () => {
  let s: http.Server;
  let url: string;

  before(async () => {
    const app = express();
    app.use(express.json());
    registerMcpRoutes(
      app,
      async () => {
        throw new Error("factory should not be called");
      },
      {
        path: "/",
        serverInfo: { name: "ags-api-mcp-server", version: "9.9.9" },
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

  test("is served at /version.json, not //version.json", async () => {
    const res = await fetch(`${url}/version.json`);

    assert.equal(res.status, 200);
    assert.equal(((await res.json()) as { version: string }).version, "9.9.9");
  });
});
