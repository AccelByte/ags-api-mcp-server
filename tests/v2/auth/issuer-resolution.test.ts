// Copyright (c) 2025 AccelByte Inc.
// SPDX-License-Identifier: Apache-2.0

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  deriveTenantIssuer,
  isIssuerAcceptableForHost,
} from "../../../src/v2/auth/routes.js";

// In hosted mode the advertised issuer is resolved from the tenant host the
// client reached: read from that host's authorization-server document, with a
// derived fallback. These cover the fallback and the check that decides
// whether a read issuer may be republished.
//
// Placeholder hosts, modelling a tenant subdomain named after the namespace it
// serves under an environment root.

describe("deriveTenantIssuer (fallback when the tenant's IAM cannot be asked)", () => {
  test("drops the subdomain when it names the namespace", () => {
    // IAM identifies the namespace as `{environmentRoot}/{namespace}` while
    // the client reaches this server at `{namespace}.{environmentRoot}`.
    assert.equal(
      deriveTenantIssuer("https://myns.tenants.example.com", "myns"),
      "https://tenants.example.com/myns",
    );
  });

  test("keeps a host that is already the environment root", () => {
    assert.equal(
      deriveTenantIssuer("https://tenants.example.com", "myns"),
      "https://tenants.example.com/myns",
    );
  });

  test("keeps a subdomain that does not name the namespace", () => {
    // Nothing ties the label to the namespace, so the host is left alone
    // rather than reduced to a parent serving another environment.
    assert.equal(
      deriveTenantIssuer("https://other.tenants.example.com", "myns"),
      "https://other.tenants.example.com/myns",
    );
  });

  test("matches the subdomain label case-insensitively", () => {
    // DNS is case-insensitive; IAM namespaces are lowercase.
    assert.equal(
      deriveTenantIssuer("https://MyNS.tenants.example.com", "myns"),
      "https://tenants.example.com/myns",
    );
  });

  test("returns the origin unchanged when no namespace is being described", () => {
    // No namespace means no label to compare against and nothing to strip.
    assert.equal(
      deriveTenantIssuer("https://myns.tenants.example.com"),
      "https://myns.tenants.example.com",
    );
  });

  test("leaves a single-label parent alone", () => {
    // Stripping would leave "http://localhost", a different host.
    assert.equal(
      deriveTenantIssuer("http://myns.localhost", "myns"),
      "http://myns.localhost/myns",
    );
  });

  test("preserves a non-default port and strips a trailing slash", () => {
    assert.equal(
      deriveTenantIssuer("https://myns.tenants.example.com:8443/", "myns"),
      "https://tenants.example.com:8443/myns",
    );
  });
});

describe("isIssuerAcceptableForHost (what an upstream document may publish)", () => {
  const REQUEST_ORIGIN = "https://myns.tenants.example.com";

  test("accepts the environment root the tenant host sits under", () => {
    assert.equal(
      isIssuerAcceptableForHost(
        "https://tenants.example.com/myns",
        REQUEST_ORIGIN,
        "myns",
      ),
      true,
    );
  });

  test("accepts the tenant host itself", () => {
    assert.equal(
      isIssuerAcceptableForHost(
        "https://myns.tenants.example.com/myns",
        REQUEST_ORIGIN,
        "myns",
      ),
      true,
    );
  });

  test("rejects an unrelated host", () => {
    // The document comes from a host derived from forwarded headers, so
    // without this check whatever answers there names any authorization
    // server it likes.
    assert.equal(
      isIssuerAcceptableForHost(
        "https://attacker.example.net/myns",
        REQUEST_ORIGIN,
        "myns",
      ),
      false,
    );
  });

  test("rejects a suffix that is not a domain boundary", () => {
    assert.equal(
      isIssuerAcceptableForHost(
        "https://nottenants.example.com/myns",
        REQUEST_ORIGIN,
        "myns",
      ),
      false,
    );
  });

  test("rejects a host below the one the client reached", () => {
    assert.equal(
      isIssuerAcceptableForHost(
        "https://deeper.myns.tenants.example.com/myns",
        REQUEST_ORIGIN,
        "myns",
      ),
      false,
    );
  });

  test("rejects a path that is not the namespace being described", () => {
    // `/othertenant` would send this tenant's clients elsewhere.
    assert.equal(
      isIssuerAcceptableForHost(
        "https://tenants.example.com/othertenant",
        REQUEST_ORIGIN,
        "myns",
      ),
      false,
    );
  });

  test("rejects extra path segments", () => {
    assert.equal(
      isIssuerAcceptableForHost(
        "https://tenants.example.com/iam/myns",
        REQUEST_ORIGIN,
        "myns",
      ),
      false,
    );
  });

  test("rejects a namespace path on the root document", () => {
    assert.equal(
      isIssuerAcceptableForHost(
        "https://tenants.example.com/myns",
        REQUEST_ORIGIN,
      ),
      false,
    );
    assert.equal(
      isIssuerAcceptableForHost("https://tenants.example.com", REQUEST_ORIGIN),
      true,
    );
  });

  test("rejects a scheme downgrade", () => {
    // The document this server read must not move discovery off https.
    assert.equal(
      isIssuerAcceptableForHost(
        "http://tenants.example.com/myns",
        REQUEST_ORIGIN,
        "myns",
      ),
      false,
    );
  });

  test("rejects a query, fragment, or credentials", () => {
    for (const issuer of [
      "https://tenants.example.com/myns?x=1",
      "https://tenants.example.com/myns#f",
      "https://user:pw@tenants.example.com/myns",
    ]) {
      assert.equal(
        isIssuerAcceptableForHost(issuer, REQUEST_ORIGIN, "myns"),
        false,
        `expected ${issuer} to be rejected`,
      );
    }
  });

  test("rejects a port the client did not reach", () => {
    assert.equal(
      isIssuerAcceptableForHost(
        "https://tenants.example.com:8443/myns",
        REQUEST_ORIGIN,
        "myns",
      ),
      false,
    );
  });

  test("rejects a value that is not a URL", () => {
    assert.equal(
      isIssuerAcceptableForHost("not-a-url", REQUEST_ORIGIN, "myns"),
      false,
    );
  });
});
