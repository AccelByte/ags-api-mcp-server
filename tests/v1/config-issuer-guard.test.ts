// Copyright (c) 2025 AccelByte Inc.
// SPDX-License-Identifier: Apache-2.0

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

// AFT-178. The v1 config module resolves on import and calls process.exit(1)
// on validation failure, so the guard is exercised by spawning a fresh
// subprocess with controlled env — the same approach tests/v2/config.test.ts
// uses, and the only way to reach the real branch rather than a reimplemented
// copy of its logic.
//
// The case that matters: `config.oidc.issuer` is handed to the JWT verifier as
// its `issuer` option, and jsonwebtoken skips issuer validation entirely when
// that option is falsy. A blank JWT_ISSUER normalizes to "" and therefore
// turns the `iss` check off instead of failing it. An earlier attempt at this
// guard placed the check after a `!config.oidc.issuer` incompleteness warning,
// which swallowed exactly this case and let the server start — these tests
// exist so that ordering cannot silently come back.

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, "../..");
const configEntry = path.join(projectRoot, "src/config.ts");

interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function runConfigImport(
  envOverrides: Record<string, string | undefined>,
): RunResult {
  // Do not inherit the parent's (or a local .env's) AGS/OAuth vars — they
  // would defeat the controlled-env premise.
  const baseEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (
      k.startsWith("MCP_") ||
      k.startsWith("AB_") ||
      k.startsWith("OAUTH_") ||
      k.startsWith("JWT_") ||
      k.startsWith("ALLOW_") ||
      k === "JWKS_URI" ||
      k === "TRANSPORT" ||
      k === "NODE_ENV" ||
      k === "PORT"
    ) {
      continue;
    }
    if (v !== undefined) baseEnv[k] = v;
  }
  baseEnv.NODE_ENV = "production";
  // "silent" is not an accepted level here — it fails validation and exits
  // before the guard under test runs, which looks like the guard firing.
  baseEnv.LOG_LEVEL = "error";
  for (const [k, v] of Object.entries(envOverrides)) {
    if (v === undefined) {
      delete baseEnv[k];
    } else {
      baseEnv[k] = v;
    }
  }

  const result = spawnSync(
    "node",
    [
      "--import",
      "tsx/esm",
      "--input-type=module",
      "-e",
      `import('${configEntry.replace(/\\/g, "\\\\")}').then((m) => { console.log('ISSUER=' + JSON.stringify(m.oidcConfig.issuer)); process.exit(0); }).catch((e) => { console.error(e?.message ?? e); process.exit(2); });`,
    ],
    {
      cwd: projectRoot,
      env: baseEnv,
      encoding: "utf8",
      timeout: 30_000,
    },
  );

  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

describe("config startup guards (V1 OAuth issuer)", () => {
  test("a whitespace-only JWT_ISSUER is fatal, not a warning", () => {
    const result = runConfigImport({ JWT_ISSUER: "   " });

    assert.notEqual(
      result.status,
      0,
      `expected non-zero exit; stdout=${result.stdout} stderr=${result.stderr}`,
    );
    const combined = `${result.stdout}\n${result.stderr}`;
    assert.match(
      combined,
      /JWT_ISSUER/,
      "error output must name the variable so an operator knows what to fix",
    );
    assert.doesNotMatch(
      combined,
      /ISSUER=""/,
      "an empty issuer must never reach the JWT verifier — it disables issuer validation rather than failing it",
    );
  });

  test("a whitespace-only AB_BASE_URL is fatal too, since the issuer falls back to it", () => {
    const result = runConfigImport({ AB_BASE_URL: "  " });

    assert.notEqual(
      result.status,
      0,
      `expected non-zero exit; stdout=${result.stdout} stderr=${result.stderr}`,
    );
  });

  test("a normal configuration still starts, with the issuer normalized", () => {
    const result = runConfigImport({
      AB_BASE_URL: "https://development.accelbyte.io",
      JWT_ISSUER: "https://development.accelbyte.io/",
    });

    assert.equal(
      result.status,
      0,
      `expected clean start; stdout=${result.stdout} stderr=${result.stderr}`,
    );
    // The trailing slash is stripped: RFC 8414 §3.3 compares byte-for-byte and
    // AGS IAM emits none.
    assert.match(result.stdout, /ISSUER="https:\/\/development\.accelbyte\.io"/);
  });

  test("an unset issuer falls back to AB_BASE_URL and still starts", () => {
    const result = runConfigImport({
      AB_BASE_URL: "https://development.accelbyte.io",
      JWT_ISSUER: undefined,
    });

    assert.equal(
      result.status,
      0,
      `expected clean start; stdout=${result.stdout} stderr=${result.stderr}`,
    );
    assert.match(result.stdout, /ISSUER="https:\/\/development\.accelbyte\.io"/);
  });
});
