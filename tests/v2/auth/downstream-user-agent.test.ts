import assert from "node:assert/strict";
import { test } from "node:test";

import { prewarmJwksCache } from "../../../src/v2/auth/middleware.js";
import {
  clientUserAgent,
  runWithRequestProvenance,
} from "../../../src/v2/mcp/provenance.js";
import { version } from "../../../src/v2/version.js";

async function captureJwksUserAgent(
  host: string,
  run: (call: () => Promise<void>) => Promise<void>,
): Promise<string | undefined> {
  const originalFetch = globalThis.fetch;
  let capturedUserAgent: string | undefined;
  globalThis.fetch = async (_url, init) => {
    capturedUserAgent =
      new Headers(init?.headers).get("User-Agent") ?? undefined;
    return new Response(JSON.stringify({ jwks_uri: `https://${host}/jwks` }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  try {
    await run(async () => {
      await prewarmJwksCache(`https://${host}`);
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
  return capturedUserAgent;
}

test("JWKS discovery identifies this server when no request scope exists", async () => {
  // Auth runs before the MCP route opens a provenance scope, so this is the
  // value every production auth fetch actually carries today.
  const captured = await captureJwksUserAgent("no-scope.example.com", (call) =>
    call(),
  );
  assert.equal(captured, `ags-api-mcp-server/${version}`);
});

test("a downstream fetch inside a request scope carries client attribution", async () => {
  // Pins the AsyncLocalStorage lookup itself: without it this test fails while
  // the one above still passes, so the helper cannot silently become a constant.
  const captured = await captureJwksUserAgent("in-scope.example.com", (call) =>
    runWithRequestProvenance(
      { userAgent: clientUserAgent("Cursor", "1.2.3") },
      call,
    ),
  );
  assert.equal(
    captured,
    `ags-api-mcp-server/${version} (MCP-Client Cursor/1.2.3)`,
  );
});
