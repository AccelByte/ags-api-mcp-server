import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import http from "node:http";
import jwt from "jsonwebtoken";

import setAuthFromToken from "../../../src/v2/auth/middleware.js";

// ---------------------------------------------------------------------------
// Helpers: generate an RSA key pair and build a minimal JWKS endpoint
// ---------------------------------------------------------------------------

const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

const KID = "test-kid-001";

/** Convert PEM → JWK for the JWKS response */
function pemToJwk(pem: string, kid: string) {
  const key = crypto.createPublicKey(pem);
  const jwk = key.export({ format: "jwk" });
  return { ...jwk, kid, use: "sig", alg: "RS256" };
}

function signToken(
  payload: Record<string, unknown>,
  options: { kid?: string; algorithm?: jwt.Algorithm; expiresIn?: jwt.SignOptions["expiresIn"] } = {},
) {
  const kid = options.kid ?? KID;
  const algorithm = options.algorithm ?? "RS256";
  const expiresIn = options.expiresIn ?? "1h";
  return jwt.sign(payload, privateKey, {
    algorithm,
    keyid: kid,
    expiresIn,
  });
}

// ---------------------------------------------------------------------------
// Local HTTP server that acts as the JWKS / discovery endpoint
// ---------------------------------------------------------------------------

let server: http.Server;
let agsBaseUrl: string;

async function startMockServer(): Promise<void> {
  return new Promise((resolve) => {
    server = http.createServer((req, res) => {
      res.setHeader("Content-Type", "application/json");

      if (req.url === "/.well-known/oauth-authorization-server") {
        res.end(JSON.stringify({ jwks_uri: `${agsBaseUrl}/jwks` }));
        return;
      }

      if (req.url === "/jwks") {
        res.end(JSON.stringify({ keys: [pemToJwk(publicKey, KID)] }));
        return;
      }

      res.statusCode = 404;
      res.end("{}");
    });

    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      agsBaseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });
}

async function stopMockServer(): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

// ---------------------------------------------------------------------------
// Minimal Express-compatible request / response / next stubs
// ---------------------------------------------------------------------------

function createReq(authHeader?: string) {
  return {
    headers: { authorization: authHeader },
    ip: "127.0.0.1",
    path: "/mcp",
    ags: undefined as { baseUrl: string } | undefined,
  } as any;
}

function createRes() {
  let _status = 200;
  let _body: any;
  return {
    status(code: number) {
      _status = code;
      return this;
    },
    json(body: any) {
      _body = body;
      return this;
    },
    get statusCode() {
      return _status;
    },
    get body() {
      return _body;
    },
  } as any;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("setAuthFromToken middleware", () => {
  before(async () => startMockServer());
  after(async () => stopMockServer());

  test("accepts a valid JWT with correct RS256 signature", async () => {
    const middleware = setAuthFromToken({ defaultAgsBaseUrl: agsBaseUrl });
    const token = signToken({
      client_id: "my-client",
      scope: "read write",
      iss: agsBaseUrl,
    });

    const req = createReq(`Bearer ${token}`);
    const res = createRes();
    let nextCalled = false;

    await middleware(req, res, () => {
      nextCalled = true;
    });

    assert.ok(nextCalled, "next() should be called");
    assert.equal(req.auth?.clientId, "my-client");
    assert.deepEqual(req.auth?.scopes, ["read", "write"]);
  });

  test("rejects a JWT with invalid signature (401)", async () => {
    const middleware = setAuthFromToken({ defaultAgsBaseUrl: agsBaseUrl });
    const { privateKey: otherKey } = crypto.generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });

    const forgedToken = jwt.sign(
      { client_id: "evil", scope: "admin", iss: agsBaseUrl },
      otherKey,
      { algorithm: "RS256", keyid: KID, expiresIn: "1h" },
    );

    const req = createReq(`Bearer ${forgedToken}`);
    const res = createRes();
    let nextCalled = false;

    await middleware(req, res, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, false, "next() should NOT be called");
    assert.equal(res.statusCode, 401);
  });

  test("rejects an expired JWT (401)", async () => {
    const middleware = setAuthFromToken({ defaultAgsBaseUrl: agsBaseUrl });
    // Expire well beyond the 30s clock tolerance
    const token = jwt.sign(
      { client_id: "c", scope: "read", iss: agsBaseUrl, exp: Math.floor(Date.now() / 1000) - 120 },
      privateKey,
      { algorithm: "RS256", keyid: KID },
    );

    const req = createReq(`Bearer ${token}`);
    const res = createRes();
    let nextCalled = false;

    await middleware(req, res, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 401);
  });

  test("rejects a JWT with missing kid (401)", async () => {
    const middleware = setAuthFromToken({ defaultAgsBaseUrl: agsBaseUrl });
    const token = jwt.sign(
      { client_id: "c", scope: "read", iss: agsBaseUrl },
      privateKey,
      { algorithm: "RS256", expiresIn: "1h" }, // no keyid
    );

    const req = createReq(`Bearer ${token}`);
    const res = createRes();
    let nextCalled = false;

    await middleware(req, res, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 401);
  });

  test("rejects a JWT with unknown kid (401)", async () => {
    const middleware = setAuthFromToken({ defaultAgsBaseUrl: agsBaseUrl });
    const token = signToken(
      { client_id: "c", scope: "read", iss: agsBaseUrl },
      { kid: "unknown-kid-999" },
    );

    const req = createReq(`Bearer ${token}`);
    const res = createRes();
    let nextCalled = false;

    await middleware(req, res, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 401);
  });

  test("rejects a JWT whose issuer does not match agsBaseUrl (401)", async () => {
    const middleware = setAuthFromToken({ defaultAgsBaseUrl: agsBaseUrl });
    const token = signToken({
      client_id: "c",
      scope: "read",
      iss: "https://attacker.example.com",
    });

    const req = createReq(`Bearer ${token}`);
    const res = createRes();
    let nextCalled = false;

    await middleware(req, res, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 401);
  });

  test("rejects malformed Bearer token that is not a JWT (401)", async () => {
    const middleware = setAuthFromToken({ defaultAgsBaseUrl: agsBaseUrl });
    const req = createReq("Bearer notajwt");
    const res = createRes();
    let nextCalled = false;

    await middleware(req, res, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, false, "next() must NOT be called for malformed bearer");
    assert.equal(res.statusCode, 401);
    assert.equal(res.body?.error, "Unauthorized");
  });

  test("rejects HS256 forged JWT (attacker-controlled HMAC secret) (401)", async () => {
    const middleware = setAuthFromToken({ defaultAgsBaseUrl: agsBaseUrl });

    const forgedToken = jwt.sign(
      {
        iss: agsBaseUrl,
        sub: "admin@development.accelbyte.io",
        client_id: "forged-client",
        scope: "admin mcp:write mcp:read",
      },
      "completely-random-secret",
      { algorithm: "HS256", keyid: "forged-key-id", expiresIn: "1h" },
    );

    const req = createReq(`Bearer ${forgedToken}`);
    const res = createRes();
    let nextCalled = false;

    await middleware(req, res, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, false, "next() must NOT be called for forged HS256 token");
    assert.equal(res.statusCode, 401);
  });

  test("calls next() without auth when no Authorization header present", async () => {
    const middleware = setAuthFromToken({ defaultAgsBaseUrl: agsBaseUrl });
    const req = createReq(undefined);
    const res = createRes();
    let nextCalled = false;

    await middleware(req, res, () => {
      nextCalled = true;
    });

    assert.ok(nextCalled, "next() should be called");
    assert.equal(req.auth, undefined);
  });

  test("rejects non-Bearer schemes (Basic, Digest, etc.) with 401", async () => {
    const middleware = setAuthFromToken({ defaultAgsBaseUrl: agsBaseUrl });
    const req = createReq("Basic abc123");
    const res = createRes();
    let nextCalled = false;

    await middleware(req, res, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, false, "next() must NOT be called for unsupported scheme");
    assert.equal(res.statusCode, 401);
    assert.equal(res.body?.error, "Unauthorized");
  });
});

describe("setAuthFromToken with audience validation", () => {
  before(async () => {
    // Server may already be running from prior describe block — that's fine,
    // the port is reused via the module-level `agsBaseUrl`.
    if (!server?.listening) {
      await startMockServer();
    }
  });
  after(async () => stopMockServer());

  test("accepts token with matching audience", async () => {
    const middleware = setAuthFromToken({
      defaultAgsBaseUrl: agsBaseUrl,
      audience: "ags-api-mcp-server",
    });
    const token = signToken({
      client_id: "c",
      scope: "read",
      iss: agsBaseUrl,
      aud: "ags-api-mcp-server",
    });

    const req = createReq(`Bearer ${token}`);
    const res = createRes();
    let nextCalled = false;

    await middleware(req, res, () => {
      nextCalled = true;
    });

    assert.ok(nextCalled);
    assert.equal(req.auth?.clientId, "c");
  });

  test("rejects token with wrong audience (401)", async () => {
    const middleware = setAuthFromToken({
      defaultAgsBaseUrl: agsBaseUrl,
      audience: "ags-api-mcp-server",
    });
    const token = signToken({
      client_id: "c",
      scope: "read",
      iss: agsBaseUrl,
      aud: "some-other-service",
    });

    const req = createReq(`Bearer ${token}`);
    const res = createRes();
    let nextCalled = false;

    await middleware(req, res, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 401);
  });
});

describe("algorithm confusion attack prevention", () => {
  before(async () => {
    if (!server?.listening) {
      await startMockServer();
    }
  });
  after(async () => stopMockServer());

  test("rejects HS256 token signed with public key as HMAC secret (algorithm confusion)", async () => {
    const middleware = setAuthFromToken({ defaultAgsBaseUrl: agsBaseUrl });

    // Attack scenario: sign with HS256 using the RSA public key as HMAC secret
    const maliciousToken = jwt.sign(
      { client_id: "attacker", scope: "admin", iss: agsBaseUrl },
      publicKey,
      { algorithm: "HS256", keyid: KID, expiresIn: "1h" },
    );

    const req = createReq(`Bearer ${maliciousToken}`);
    const res = createRes();
    let nextCalled = false;

    await middleware(req, res, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, false, "Should reject HS256 tokens");
    assert.equal(res.statusCode, 401);
  });
});
