import { test } from "node:test";
import assert from "node:assert/strict";

import { validateUrlMatchesIssuer } from "../../../src/v2/auth/host-resolver.js";

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

test("validateUrlMatchesIssuer - shared cloud: derived host is subdomain of issuer", () => {
  // Real-world case: issuer = root IAM domain, deployment host = subdomain
  // e.g. token iss = "https://internal.gamingservices.accelbyte.io"
  //      Host header derived URL = "https://foo-bar.internal.gamingservices.accelbyte.io"
  assert.equal(
    validateUrlMatchesIssuer(
      "https://foo-bar.internal.gamingservices.accelbyte.io",
      "https://internal.gamingservices.accelbyte.io",
    ),
    true,
  );
});

test("validateUrlMatchesIssuer - scheme-insensitive comparison", () => {
  assert.equal(
    validateUrlMatchesIssuer(
      "https://sub.example.com",
      "http://example.com",
    ),
    true,
  );
});

test("validateUrlMatchesIssuer - trailing slash ignored", () => {
  assert.equal(
    validateUrlMatchesIssuer(
      "https://sub.example.com/",
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

test("validateUrlMatchesIssuer - case insensitive", () => {
  assert.equal(
    validateUrlMatchesIssuer(
      "https://Sub.Example.COM",
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
