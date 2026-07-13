#!/usr/bin/env node

// Keeps server.json in sync with package.json for the MCP registry manifest.
// package.json is the single source of truth for the version, so this runs at
// the front of `pnpm build` and rewrites server.json's version to match --
// the registry can never publish a stale version.
//
// The description is NOT auto-copied: server.schema.json (2025-12-11) caps
// description at 100 characters, so server.json may intentionally carry a
// shorter, hand-written variant than package.json. Instead we guard that
// invariant and fail the build loudly if server.json's description is empty
// or over the limit.

import fs from "node:fs";

const PACKAGE_FILE = "package.json";
const SERVER_FILE = "server.json";
const REGISTRY_DESCRIPTION_MAX_LENGTH = 100;

function syncServerVersion() {
  if (!fs.existsSync(SERVER_FILE)) {
    console.error(`${SERVER_FILE} not found`);
    process.exit(1);
  }

  const pkg = JSON.parse(fs.readFileSync(PACKAGE_FILE, "utf8"));
  const server = JSON.parse(fs.readFileSync(SERVER_FILE, "utf8"));

  const descriptionLength = server.description?.length ?? 0;
  if (descriptionLength === 0 || descriptionLength > REGISTRY_DESCRIPTION_MAX_LENGTH) {
    console.error(
      `${SERVER_FILE} description is ${descriptionLength} chars; ` +
        `must be 1-${REGISTRY_DESCRIPTION_MAX_LENGTH} for the MCP registry schema`
    );
    process.exit(1);
  }

  if (server.version === pkg.version) {
    console.log(`${SERVER_FILE} version already in sync (${pkg.version})`);
    return;
  }

  const previous = server.version;
  server.version = pkg.version;
  fs.writeFileSync(SERVER_FILE, `${JSON.stringify(server, null, 2)}\n`);
  console.log(`${SERVER_FILE} version ${previous} -> ${pkg.version}`);
}

syncServerVersion();
