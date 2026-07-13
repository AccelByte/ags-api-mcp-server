// Copyright (c) 2025 AccelByte Inc.
// SPDX-License-Identifier: Apache-2.0

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  registerAppResource,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import log from "../logger.js";
import { BUNDLE_VERSION } from "../shared/render-schemas.js";

export const RENDERER_RESOURCE_URI = "ui://renderer/index.html";

let cachedHtml: string | undefined;

function rendererBundlePath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "../renderer/index.html");
}

async function loadRendererHtml(): Promise<string> {
  if (cachedHtml !== undefined) {
    return cachedHtml;
  }

  const bundlePath = rendererBundlePath();

  try {
    cachedHtml = await readFile(bundlePath, "utf8");
    log.info(
      {
        path: bundlePath,
        bytes: cachedHtml.length,
        bundleVersion: BUNDLE_VERSION,
      },
      "Renderer bundle loaded",
    );
    return cachedHtml;
  } catch (error) {
    log.error(
      {
        path: bundlePath,
        err: error instanceof Error ? error.message : error,
      },
      "Renderer bundle missing — run `pnpm build:renderer`",
    );
    throw error;
  }
}

export async function registerRendererResource(
  server: McpServer,
): Promise<void> {
  await loadRendererHtml();

  registerAppResource(
    server,
    "AGS Analytics Renderer",
    RENDERER_RESOURCE_URI,
    {
      mimeType: RESOURCE_MIME_TYPE,
      description:
        "Self-contained HTML/JS bundle that renders chart/table/metric tool results inside an MCP host webview.",
      _meta: { "ags/bundleVersion": BUNDLE_VERSION },
    },
    async () => ({
      contents: [
        {
          uri: RENDERER_RESOURCE_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: await loadRendererHtml(),
        },
      ],
    }),
  );
}

// eslint-disable-next-line no-underscore-dangle, @typescript-eslint/naming-convention
export function __clearRendererCacheForTesting(): void {
  cachedHtml = undefined;
}

export default RENDERER_RESOURCE_URI;
