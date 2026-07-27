import { test, describe } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import http from "node:http";
import jwt from "jsonwebtoken";

import {
  validateUrlMatchesIssuer,
  resolveAgsHost,
} from "../../../src/v2/auth/host-resolver.js";

test("validateUrlMatchesIssuer - exact match", () => {
  assert.equal(
    validateUrlMatchesIssuer(
      "https://example.com",
      "https://example.com",
    ),
    true,
  );
});

test("validateUrlMatchesIssuer - issuer is sub-path of derived URL (namespace suffix)", () => {
  assert.equal(
    validateUrlMatchesIssuer(
      "https://example.com",
      "https://example.com/mynamespace",
    ),
    true,
  );
});

test("validateUrlMatchesIssuer - rejects derived host that is subdomain of issuer", () => {
  // A token issued for "internal.gamingservices.accelbyte.io" must NOT be
  // accepted at "foo-bar.internal.gamingservices.accelbyte.io" — subdomain
  // matching is intentionally disabled to prevent token reuse across tenants.
  assert.equal(
    validateUrlMatchesIssuer(
      "https://foo-bar.internal.gamingservices.accelbyte.io",
      "https://internal.gamingservices.accelbyte.io",
    ),
    false,
  );
});

test("validateUrlMatchesIssuer - scheme-insensitive comparison (same host)", () => {
  assert.equal(
    validateUrlMatchesIssuer(
      "https://example.com",
      "http://example.com",
    ),
    true,
  );
});

test("validateUrlMatchesIssuer - rejects subdomain even with different scheme", () => {
  assert.equal(
    validateUrlMatchesIssuer(
      "https://sub.example.com",
      "http://example.com",
    ),
    false,
  );
});

test("validateUrlMatchesIssuer - trailing slash ignored (same host)", () => {
  assert.equal(
    validateUrlMatchesIssuer(
      "https://example.com/",
      "https://example.com/",
    ),
    true,
  );
});

test("validateUrlMatchesIssuer - completely different domains", () => {
  assert.equal(
    validateUrlMatchesIssuer(
      "https://example.com",
      "https://attacker.com",
    ),
    false,
  );
});

test("validateUrlMatchesIssuer - does not allow partial domain suffix match", () => {
  // 'evil-example.com' must not match issuer 'example.com'
  assert.equal(
    validateUrlMatchesIssuer(
      "https://evil-example.com",
      "https://example.com",
    ),
    false,
  );
});

test("validateUrlMatchesIssuer - case insensitive (same host)", () => {
  assert.equal(
    validateUrlMatchesIssuer(
      "https://Example.COM",
      "https://example.com",
    ),
    true,
  );
});

// --- Edge cases requested in VAPT review ---

test("validateUrlMatchesIssuer - trailing slash on derived only", () => {
  assert.equal(
    validateUrlMatchesIssuer(
      "https://dev.accelbyte.io/",
      "https://dev.accelbyte.io",
    ),
    true,
  );
});

test("validateUrlMatchesIssuer - trailing slash on issuer only", () => {
  assert.equal(
    validateUrlMatchesIssuer(
      "https://dev.accelbyte.io",
      "https://dev.accelbyte.io/",
    ),
    true,
  );
});

test("validateUrlMatchesIssuer - issuer with path component (e.g. /iam)", () => {
  assert.equal(
    validateUrlMatchesIssuer(
      "https://dev.accelbyte.io",
      "https://dev.accelbyte.io/iam",
    ),
    true,
  );
});

test("validateUrlMatchesIssuer - issuer with deeper path component", () => {
  assert.equal(
    validateUrlMatchesIssuer(
      "https://dev.accelbyte.io",
      "https://dev.accelbyte.io/iam/v3",
    ),
    true,
  );
});

test("validateUrlMatchesIssuer - rejects issuer that is a subdomain of derived", () => {
  // issuer 'api.dev.accelbyte.io' should NOT match derived 'dev.accelbyte.io'
  // because the issuer's hostname is more specific (subdomain)
  assert.equal(
    validateUrlMatchesIssuer(
      "https://dev.accelbyte.io",
      "https://api.dev.accelbyte.io",
    ),
    false,
  );
});

test("validateUrlMatchesIssuer - rejects entirely different TLD", () => {
  assert.equal(
    validateUrlMatchesIssuer(
      "https://accelbyte.io",
      "https://accelbyte.com",
    ),
    false,
  );
});

test("validateUrlMatchesIssuer - protocol mismatch still matches (http vs https)", () => {
  assert.equal(
    validateUrlMatchesIssuer(
      "http://dev.accelbyte.io",
      "https://dev.accelbyte.io",
    ),
    true,
  );
});

// --- Attack scenarios from VAPT round 3 ---

test("validateUrlMatchesIssuer - rejects parent-domain issuer token at subdomain (token reuse attack)", () => {
  // An attacker controlling evil.accelbyte.io must NOT be able to reuse
  // a token issued for the parent domain accelbyte.io.
  assert.equal(
    validateUrlMatchesIssuer(
      "https://evil.accelbyte.io",
      "https://accelbyte.io",
    ),
    false,
  );
});

test("validateUrlMatchesIssuer - rejects cross-tenant subdomain token reuse", () => {
  // Tokens for teststudio-alpha must not be accepted at teststudio-beta,
  // even if they share the same parent domain.
  assert.equal(
    validateUrlMatchesIssuer(
      "https://teststudio-beta.gamingservices.accelbyte.io",
      "https://teststudio-alpha.gamingservices.accelbyte.io",
    ),
    false,
  );
});

// --- allowParentDomainIssuer opt-in (AGS shared-auth-server topology) ---

test("validateUrlMatchesIssuer - parent-domain issuer accepted when allowParentDomainIssuer=true", () => {
  assert.equal(
    validateUrlMatchesIssuer(
      "https://teststudio-beta.internal.gamingservices.accelbyte.io",
      "https://internal.gamingservices.accelbyte.io",
      true,
    ),
    true,
  );
});

test("validateUrlMatchesIssuer - parent-domain issuer still rejected when flag defaults to false", () => {
  assert.equal(
    validateUrlMatchesIssuer(
      "https://teststudio-beta.internal.gamingservices.accelbyte.io",
      "https://internal.gamingservices.accelbyte.io",
    ),
    false,
  );
});

test("validateUrlMatchesIssuer - bare suffix (not subdomain) still rejected even with flag on", () => {
  // "evil-internal..." merely shares a suffix with "internal..." — must
  // not be treated as a subdomain.
  assert.equal(
    validateUrlMatchesIssuer(
      "https://evil-internal.gamingservices.accelbyte.io",
      "https://internal.gamingservices.accelbyte.io",
      true,
    ),
    false,
  );
});

test("validateUrlMatchesIssuer - issuer with path component blocks parent-domain match", () => {
  // When issuer carries a path, parent-domain semantics don't apply.
  assert.equal(
    validateUrlMatchesIssuer(
      "https://env.internal.gamingservices.accelbyte.io",
      "https://internal.gamingservices.accelbyte.io/iam",
      true,
    ),
    false,
  );
});

test("validateUrlMatchesIssuer - flag explicitly false does not enable parent-domain match", () => {
  assert.equal(
    validateUrlMatchesIssuer(
      "https://env.internal.gamingservices.accelbyte.io",
      "https://internal.gamingservices.accelbyte.io",
      false,
    ),
    false,
  );
});

test("validateUrlMatchesIssuer - flag honors deep subdomain (multiple labels)", () => {
  assert.equal(
    validateUrlMatchesIssuer(
      "https://a.b.c.example.com",
      "https://example.com",
      true,
    ),
    true,
  );
});

// --- resolveAgsHost: interaction between validateTokenIssuer and
//     allowParentDomainIssuer (issue surfaced by code review on PR #48).
//
// IMPORTANT: these tests cover only the resolveAgsHost middleware stage
// (the early host-vs-issuer pre-check). Full pipeline acceptance also
// requires the JWKS-verified issuer check in setAuthFromToken to honor the
// same flag — see SetAuthFromTokenOptions.allowParentDomainIssuer wired
// from src/v2/index.ts via registerMcpRoutes. A 200 here does not by
// itself prove that a real (signed, JWKS-verifiable) token would be
// accepted end to end. ---

describe("resolveAgsHost - allowParentDomainIssuer × validateTokenIssuer", () => {
  function makeBearer(claims: Record<string, unknown>): string {
    // SECURITY: this helper produces a JWS-shaped token whose signature is
    // INTENTIONALLY unverifiable here (HS256 with an arbitrary secret, no
    // JWKS). It is safe ONLY because `resolveAgsHost` is a pre-check that
    // *only* base64-decodes the payload to read `iss` — it never verifies
    // the signature. Anything that arrives here would still be re-validated
    // (signature + issuer) downstream by `setAuthFromToken` against the
    // real JWKS. Do NOT reuse this helper to test middleware that performs
    // signature verification: such a token would always be rejected (which
    // is correct), masking what you actually intended to test. The
    // signature-verifying counterpart lives in middleware.test.ts and uses
    // the real RSA keypair plus the mock JWKS endpoint there.
    return jwt.sign(claims, "test-secret");
  }

  async function startApp(
    config: {
      enabled: boolean;
      validateTokenIssuer: boolean;
      allowParentDomainIssuer: boolean;
    },
  ): Promise<{ url: string; close: () => Promise<void> }> {
    const app = express();
    app.use(resolveAgsHost(config));
    app.get("/probe", (req, res) => {
      res.json({ baseUrl: req.ags?.baseUrl });
    });

    return new Promise((resolve, reject) => {
      const server = http.createServer(app);
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.off("error", reject);
        const addr = server.address() as { port: number };
        resolve({
          url: `http://127.0.0.1:${addr.port}`,
          close: () =>
            new Promise<void>((done) => server.close(() => done())),
        });
      });
    });
  }

  test("validateTokenIssuer=false: parent-domain issuer flag is a no-op (issuer check skipped entirely)", async () => {
    // Documents (and locks in) the fact that allowParentDomainIssuer has no
    // observable effect when validateTokenIssuer is off — a request that
    // would be rejected with the issuer check on still succeeds here.
    const { url, close } = await startApp({
      enabled: true,
      validateTokenIssuer: false,
      allowParentDomainIssuer: false,
    });
    try {
      const token = makeBearer({
        iss: "https://internal.gamingservices.accelbyte.io",
      });
      const res = await fetch(`${url}/probe`, {
        headers: {
          "X-Forwarded-Host":
            "teststudio-beta.internal.gamingservices.accelbyte.io",
          Authorization: `Bearer ${token}`,
        },
      });
      assert.equal(res.status, 200);
    } finally {
      await close();
    }
  });

  test("validateTokenIssuer=true + allowParentDomainIssuer=false: parent-domain issuer is rejected", async () => {
    const { url, close } = await startApp({
      enabled: true,
      validateTokenIssuer: true,
      allowParentDomainIssuer: false,
    });
    try {
      const token = makeBearer({
        iss: "https://internal.gamingservices.accelbyte.io",
      });
      const res = await fetch(`${url}/probe`, {
        headers: {
          "X-Forwarded-Host":
            "teststudio-beta.internal.gamingservices.accelbyte.io",
          Authorization: `Bearer ${token}`,
        },
      });
      assert.equal(res.status, 403);
    } finally {
      await close();
    }
  });

  test("validateTokenIssuer=true + allowParentDomainIssuer=true: parent-domain issuer is accepted", async () => {
    const { url, close } = await startApp({
      enabled: true,
      validateTokenIssuer: true,
      allowParentDomainIssuer: true,
    });
    try {
      const token = makeBearer({
        iss: "https://internal.gamingservices.accelbyte.io",
      });
      const res = await fetch(`${url}/probe`, {
        headers: {
          "X-Forwarded-Host":
            "teststudio-beta.internal.gamingservices.accelbyte.io",
          Authorization: `Bearer ${token}`,
        },
      });
      assert.equal(res.status, 200);
    } finally {
      await close();
    }
  });
});
