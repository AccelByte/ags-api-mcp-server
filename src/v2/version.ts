// Copyright (c) 2025 AccelByte Inc. All Rights Reserved.
// This is licensed software from AccelByte Inc, for limitations
// and restrictions contact your company contract manager.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// Resolve package.json relative to this module so it works for both the
// compiled output (dist/v2/version.js) and tsx dev mode (src/v2/version.ts).
// rootDir is "src", so importing the JSON directly is not an option.
const here = dirname(fileURLToPath(import.meta.url));
const pkgPath = resolve(here, "../../package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
  name: string;
  version: string;
};

export const name: string = pkg.name;
export const version: string = pkg.version;
