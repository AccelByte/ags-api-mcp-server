import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  CORE_CTX_KEYS,
  CORE_CTX_KEY_WITNESS,
} from "../../../src/v2/shared/chrome-context.js";

describe("chrome-context guardrail §3.1 — CoreCtx is sealed", () => {
  test("the runtime allowlist matches the compile-time witness exactly", () => {
    // The witness is `Record<keyof CoreCtx, true>`, so `tsc` already forces its
    // keys to equal CoreCtx's. This ties that witness to CORE_CTX_KEYS at
    // runtime — so adding a CoreCtx field (which `tsc` makes you add to the
    // witness) goes red here until CORE_CTX_KEYS is updated in the same change.
    assert.deepEqual(
      Object.keys(CORE_CTX_KEY_WITNESS).sort(),
      [...CORE_CTX_KEYS].sort(),
    );
  });

  test("CORE_CTX_KEYS has no duplicate entries", () => {
    assert.equal(new Set(CORE_CTX_KEYS).size, CORE_CTX_KEYS.length);
  });
});
