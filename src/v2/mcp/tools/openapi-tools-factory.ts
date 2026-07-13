// Copyright (c) 2025 AccelByte Inc.
// SPDX-License-Identifier: Apache-2.0

import { OpenApiTools } from "../../../tools/openapi-tools.js";
import type { Config } from "../../config.js";

let cachedConfigKey: string | null = null;
let cachedOpenApiTools: OpenApiTools | null = null;

function getConfigKey(config: Config): string {
  return JSON.stringify(config.openapi);
}

async function getOrCreateOpenApiTools(config: Config): Promise<OpenApiTools> {
  const configKey = getConfigKey(config);

  if (cachedOpenApiTools && cachedConfigKey === configKey) {
    return cachedOpenApiTools;
  }

  cachedOpenApiTools = new OpenApiTools({
    specsDir: config.openapi.specsDir,
    defaultSearchLimit: config.openapi.searchLimit,
    maxSearchLimit: config.openapi.maxSearchLimit,
    defaultRunTimeoutMs: config.openapi.runTimeoutMs,
    maxRunTimeoutMs: config.openapi.maxRunTimeoutMs,
    defaultServerUrl: config.openapi.serverUrl,
    includeWriteRequests: config.openapi.includeWriteRequests,
    loadSpecs: false,
  });

  await cachedOpenApiTools.loadSpecsAsync();

  cachedConfigKey = configKey;

  return cachedOpenApiTools;
}

export { getOrCreateOpenApiTools };

export default getOrCreateOpenApiTools;
