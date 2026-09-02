// Copyright (c) 2025 AccelByte Inc.
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { test } from "node:test";
import type { Server } from "node:http";

import { create } from "../../src/v2/express.js";

async function listen(): Promise<{ server: Server; port: number }> {
  const app = create();
  const server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  const { port } = server.address() as { port: number };
  return { server, port };
}

test("exposes Mcp-Session-Id to cross-origin callers for the AFT-215 bridge", async () => {
  // The session bridge is only usable by a browser client if it can read the
  // minted id off the response, which same-origin policy hides unless the
  // header is explicitly exposed. This asserts the exposure so that removing
  // the bridge without reverting `cors({})` in src/v2/express.ts fails a test
  // rather than leaving a stale entry for a header the server no longer sends.
  const { server, port } = await listen();
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`, {
      headers: { Origin: "https://example.invalid" },
    });
    assert.match(
      response.headers.get("access-control-expose-headers") ?? "",
      /Mcp-Session-Id/i,
    );
  } finally {
    server.close();
  }
});
