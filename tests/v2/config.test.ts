// Copyright (c) 2025 AccelByte Inc.
// SPDX-License-Identifier: Apache-2.0

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The V2 config module loads on import and calls process.exit(1) on
// validation failure. Exercise the startup guards by spawning a fresh
// subprocess with controlled env, then asserting on its exit code and
// captured stderr. This avoids polluting the parent test process's
// module cache and process.env.

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, "../..");
const configEntry = path.join(projectRoot, "src/v2/config.ts");

interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function runConfigImport(envOverrides: Record<string, string | undefined>): RunResult {
  // Strip the parent's .env-derived hosted vars so the subprocess only sees
  // exactly what we hand it. We pass a complete env (not partial) because
  // tsx itself needs PATH / HOME etc. to run.
  const baseEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    // Do not inherit any MCP_*, AB_*, ALLOW_* vars from the parent env or
    // a local .env file — they would defeat the controlled-env premise.
    if (
      k.startsWith("MCP_") ||
      k.startsWith("AB_") ||
      k.startsWith("ALLOW_") ||
      k === "TRUST_PROXY" ||
      k === "NODE_ENV" ||
      k === "PORT" ||
      k === "INCLUDE_WRITE_REQUESTS"
    ) {
      continue;
    }
    if (v !== undefined) baseEnv[k] = v;
  }
  baseEnv.NODE_ENV = "production";
  baseEnv.LOG_LEVEL = "info";
  baseEnv.MCP_AUTH_SERVER_DISCOVERY_MODE = "none";
  for (const [k, v] of Object.entries(envOverrides)) {
    if (v === undefined) {
      delete baseEnv[k];
    } else {
      baseEnv[k] = v;
    }
  }

  // Use the project's tsx binary to import the TS module directly.
  const result = spawnSync(
    "node",
    [
      "--import",
      "tsx/esm",
      "--input-type=module",
      "-e",
      `import('${configEntry.replace(/\\/g, "\\\\")}').then(() => process.exit(0)).catch((e) => { console.error(e?.message ?? e); process.exit(2); });`,
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

describe("config startup guards (V2)", () => {
  test("MCP_HOSTED=true without MCP_SERVER_URL exits non-zero with explanatory error", () => {
    const result = runConfigImport({
      MCP_HOSTED: "true",
      MCP_AUTH: "true",
      AB_BASE_URL: "https://development.accelbyte.io",
      // MCP_SERVER_URL deliberately not set
    });

    assert.notEqual(
      result.status,
      0,
      `expected non-zero exit; stdout=${result.stdout} stderr=${result.stderr}`,
    );
    const combined = `${result.stdout}\n${result.stderr}`;
    assert.match(
      combined,
      /MCP_SERVER_URL/,
      "error output must mention MCP_SERVER_URL so operators know which env var is missing",
    );
    assert.match(
      combined,
      /MCP_HOSTED/,
      "error output must mention MCP_HOSTED so the conditional nature is clear",
    );
  });

  test("MCP_HOSTED=true with MCP_SERVER_URL set succeeds", () => {
    const result = runConfigImport({
      MCP_HOSTED: "true",
      MCP_AUTH: "true",
      MCP_SERVER_URL: "http://localhost:3030",
      AB_BASE_URL: "https://development.accelbyte.io",
    });

    assert.equal(
      result.status,
      0,
      `expected clean exit; stdout=${result.stdout} stderr=${result.stderr}`,
    );
  });

  test("MCP_HOSTED=false (standalone) without MCP_SERVER_URL succeeds via auto-derive", () => {
    const result = runConfigImport({
      MCP_HOSTED: "false",
      MCP_AUTH: "false", // skip JWKS pre-warm so the test stays offline-safe
      AB_BASE_URL: "https://development.accelbyte.io",
    });

    assert.equal(
      result.status,
      0,
      `expected clean exit; stdout=${result.stdout} stderr=${result.stderr}`,
    );
  });
});
