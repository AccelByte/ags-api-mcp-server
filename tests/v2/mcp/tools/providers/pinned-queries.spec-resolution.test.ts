// Copyright (c) 2025 AccelByte Inc.
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

import { OpenApiTools } from "../../../../../src/tools/openapi-tools.js";

/**
 * Guard against provider/spec drift.
 *
 * Every other pinned-queries test mocks at the `runApi` boundary, so none of
 * them touch the real bundled `openapi-specs/afs.json` — a method/path the
 * provider issues can silently disappear from the spec and every unit test
 * still passes (the CRITICAL gap that shipped an entire PATCH-backed feature
 * with no matching operation in the bundled spec).
 *
 * This test builds a real `OpenApiTools` over the actual bundled specs and
 * asserts each operation the pinned-queries provider depends on resolves via
 * `describeApi`/`findOperation` — exactly the lookup `runApi` performs. If a
 * future spec sync drops one of these, this fails in CI instead of in a live
 * environment.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// tests/v2/mcp/tools/providers -> repo root -> openapi-specs (the real bundle).
const specsDir = path.join(__dirname, "../../../../../openapi-specs");

const PINNED_QUERIES_BASE =
  "/afs/v1/admin/namespaces/{namespace}/pinned-queries";

// The exact (method, path) pairs issued by src/v2/mcp/tools/providers/
// pinned-queries.ts. Keep in lockstep with that file.
const REQUIRED_OPERATIONS: ReadonlyArray<{ method: string; path: string }> = [
  { method: "GET", path: PINNED_QUERIES_BASE }, // listPins
  { method: "POST", path: PINNED_QUERIES_BASE }, // createPin
  { method: "PATCH", path: `${PINNED_QUERIES_BASE}/{id}` }, // updatePin
  { method: "DELETE", path: `${PINNED_QUERIES_BASE}/{id}` }, // deletePin
  { method: "POST", path: `${PINNED_QUERIES_BASE}/{id}/refresh` }, // refreshPin
];

describe("pinned-queries provider ↔ bundled afs spec", () => {
  const tools = new OpenApiTools({ specsDir });

  for (const { method, path: opPath } of REQUIRED_OPERATIONS) {
    test(`bundled afs spec defines ${method} ${opPath}`, async () => {
      const description = (await tools.describeApi({
        spec: "afs",
        method,
        path: opPath,
      })) as { method: string; path: string };

      assert.equal(description.method, method);
      assert.equal(description.path, opPath);
    });
  }

  // The PATCH edit endpoint is the one that was missing from the 0.5.0 bundle
  // (feature shipped ahead of the spec). Pin its operationId so a regression is
  // unambiguous.
  test("PATCH pinned-queries/{id} is AdminUpdatePinnedQuery", async () => {
    const description = (await tools.describeApi({
      spec: "afs",
      method: "PATCH",
      path: `${PINNED_QUERIES_BASE}/{id}`,
    })) as { operationId?: string };

    assert.equal(description.operationId, "AdminUpdatePinnedQuery");
  });
});
