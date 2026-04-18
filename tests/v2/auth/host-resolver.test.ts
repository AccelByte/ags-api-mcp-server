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
  // Tokens for tenant-a must not be accepted at tenant-b, even if they
  // share the same parent domain.
  assert.equal(
    validateUrlMatchesIssuer(
      "https://tenant-b.gamingservices.accelbyte.io",
      "https://tenant-a.gamingservices.accelbyte.io",
    ),
    false,
  );
});

// --- ALLOW_PARENT_DOMAIN_ISSUER opt-in (AGS shared-auth-server topology) ---

function withParentDomainIssuer<T>(value: string | undefined, fn: () => T): T {
  const prev = process.env.ALLOW_PARENT_DOMAIN_ISSUER;
  if (value === undefined) {
    delete process.env.ALLOW_PARENT_DOMAIN_ISSUER;
  } else {
    process.env.ALLOW_PARENT_DOMAIN_ISSUER = value;
  }
  try {
    return fn();
  } finally {
    if (prev === undefined) {
      delete process.env.ALLOW_PARENT_DOMAIN_ISSUER;
    } else {
      process.env.ALLOW_PARENT_DOMAIN_ISSUER = prev;
    }
  }
}

test("validateUrlMatchesIssuer - parent-domain issuer accepted when ALLOW_PARENT_DOMAIN_ISSUER=true", () => {
  withParentDomainIssuer("true", () => {
    assert.equal(
      validateUrlMatchesIssuer(
        "https://abtestdewa-pong.internal.gamingservices.accelbyte.io",
        "https://internal.gamingservices.accelbyte.io",
      ),
      true,
    );
  });
});

test("validateUrlMatchesIssuer - parent-domain issuer still rejected when flag unset", () => {
  withParentDomainIssuer(undefined, () => {
    assert.equal(
      validateUrlMatchesIssuer(
        "https://abtestdewa-pong.internal.gamingservices.accelbyte.io",
        "https://internal.gamingservices.accelbyte.io",
      ),
      false,
    );
  });
});

test("validateUrlMatchesIssuer - bare suffix (not subdomain) still rejected even with flag on", () => {
  withParentDomainIssuer("true", () => {
    // "evil-internal..." merely shares a suffix with "internal..." — must
    // not be treated as a subdomain.
    assert.equal(
      validateUrlMatchesIssuer(
        "https://evil-internal.gamingservices.accelbyte.io",
        "https://internal.gamingservices.accelbyte.io",
      ),
      false,
    );
  });
});

test("validateUrlMatchesIssuer - issuer with path component blocks parent-domain match", () => {
  withParentDomainIssuer("true", () => {
    // When issuer carries a path, parent-domain semantics don't apply.
    assert.equal(
      validateUrlMatchesIssuer(
        "https://env.internal.gamingservices.accelbyte.io",
        "https://internal.gamingservices.accelbyte.io/iam",
      ),
      false,
    );
  });
});

test("validateUrlMatchesIssuer - flag value 'false' does not enable parent-domain match", () => {
  withParentDomainIssuer("false", () => {
    assert.equal(
      validateUrlMatchesIssuer(
        "https://env.internal.gamingservices.accelbyte.io",
        "https://internal.gamingservices.accelbyte.io",
      ),
      false,
    );
  });
});

test("validateUrlMatchesIssuer - flag honors deep subdomain (multiple labels)", () => {
  withParentDomainIssuer("true", () => {
    assert.equal(
      validateUrlMatchesIssuer(
        "https://a.b.c.example.com",
        "https://example.com",
      ),
      true,
    );
  });
});
