// Copyright (c) 2025 AccelByte Inc.
// SPDX-License-Identifier: Apache-2.0

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { deriveBaseUrl } from "../../src/v2/utils.js";

// Minimal request double for deriveBaseUrl with a trusted proxy peer, so the
// forwarded-header branch (and its port-inclusion logic) is exercised.
function trustedProxyReq(headers: Record<string, string>) {
  const lowered = Object.fromEntries(
    Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]),
  );
  return {
    get: (name: string) => lowered[name.toLowerCase()],
    protocol: "http",
    app: {
      get: (setting: string) =>
        setting === "trust proxy fn" ? () => true : undefined,
    },
    socket: { remoteAddress: "127.0.0.1" },
  };
}

describe("deriveBaseUrl forwarded-port handling", () => {
  test("omits the port when it is the default for the forwarded scheme", () => {
    assert.equal(
      deriveBaseUrl(
        trustedProxyReq({
          "x-forwarded-host": "api.example.com",
          "x-forwarded-proto": "https",
          "x-forwarded-port": "443",
        }),
      ),
      "https://api.example.com",
    );
    assert.equal(
      deriveBaseUrl(
        trustedProxyReq({
          "x-forwarded-host": "api.example.com",
          "x-forwarded-proto": "http",
          "x-forwarded-port": "80",
        }),
      ),
      "http://api.example.com",
    );
  });

  test("keeps a port that is non-default for the forwarded scheme", () => {
    // https on 80 / http on 443 are unusual proxy setups, but the URL is only
    // reachable if the non-default port stays explicit.
    assert.equal(
      deriveBaseUrl(
        trustedProxyReq({
          "x-forwarded-host": "api.example.com",
          "x-forwarded-proto": "https",
          "x-forwarded-port": "80",
        }),
      ),
      "https://api.example.com:80",
    );
    assert.equal(
      deriveBaseUrl(
        trustedProxyReq({
          "x-forwarded-host": "api.example.com",
          "x-forwarded-proto": "http",
          "x-forwarded-port": "443",
        }),
      ),
      "http://api.example.com:443",
    );
  });

  test("keeps an explicit non-default port", () => {
    assert.equal(
      deriveBaseUrl(
        trustedProxyReq({
          "x-forwarded-host": "api.example.com",
          "x-forwarded-proto": "https",
          "x-forwarded-port": "8443",
        }),
      ),
      "https://api.example.com:8443",
    );
  });

  test("leaves a host that already carries a port untouched", () => {
    assert.equal(
      deriveBaseUrl(
        trustedProxyReq({
          "x-forwarded-host": "api.example.com:9000",
          "x-forwarded-proto": "https",
          "x-forwarded-port": "8443",
        }),
      ),
      "https://api.example.com:9000",
    );
  });
});
