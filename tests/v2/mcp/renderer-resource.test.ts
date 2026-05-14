import assert from "node:assert/strict";
import { rename } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";
import type {
  ReadResourceCallback,
  RegisteredResource,
  ResourceMetadata,
} from "@modelcontextprotocol/sdk/server/mcp.js";

import {
  __clearRendererCacheForTesting,
  registerRendererResource,
  RENDERER_RESOURCE_URI,
} from "../../../src/v2/mcp/renderer-resource.js";
import { BUNDLE_VERSION } from "../../../src/v2/shared/render-schemas.js";

interface CapturedResource {
  name: string;
  uri: string;
  metadata: ResourceMetadata;
  readCallback: ReadResourceCallback;
  registered?: RegisteredResource;
}

function createCapturingServer(captured: CapturedResource) {
  return {
    registerResource(
      name: string,
      uri: string,
      metadata: ResourceMetadata,
      readCallback: ReadResourceCallback,
    ): RegisteredResource {
      captured.name = name;
      captured.uri = uri;
      captured.metadata = metadata;
      captured.readCallback = readCallback;
      captured.registered = {} as RegisteredResource;
      return captured.registered;
    },
  };
}

const here = path.dirname(fileURLToPath(import.meta.url));
const rendererHtmlPath = path.resolve(
  here,
  "../../../src/v2/renderer/index.html",
);
const rendererHtmlTempPath = `${rendererHtmlPath}.bak-test`;

async function moveRendererBundleTemporarily<T>(
  callback: () => Promise<T>,
): Promise<T> {
  await rename(rendererHtmlPath, rendererHtmlTempPath);

  try {
    return await callback();
  } finally {
    await rename(rendererHtmlTempPath, rendererHtmlPath);
  }
}

describe("registerRendererResource", () => {
  test("registers the renderer resource with bundle-version metadata", async () => {
    __clearRendererCacheForTesting();

    const captured = {} as CapturedResource;
    await registerRendererResource(createCapturingServer(captured) as never);

    assert.equal(captured.name, "AGS Analytics Renderer");
    assert.equal(captured.uri, RENDERER_RESOURCE_URI);
    assert.equal(
      captured.metadata.mimeType,
      "text/html;profile=mcp-app",
    );
    assert.equal(
      captured.metadata.description,
      "Self-contained HTML/JS bundle that renders chart/table/metric tool results inside an MCP host webview.",
    );
    assert.deepEqual(captured.metadata._meta, {
      "ags/bundleVersion": BUNDLE_VERSION,
    });

    const result = await captured.readCallback(new URL(RENDERER_RESOURCE_URI), {});
    assert.equal(result.contents.length, 1);
    assert.equal(result.contents[0]?.uri, RENDERER_RESOURCE_URI);
    assert.equal(result.contents[0]?.mimeType, "text/html;profile=mcp-app");
    assert.match(result.contents[0]?.text ?? "", /<main id="app"><\/main>/);
  });

  test("memoizes the bundle after the first successful load", async () => {
    __clearRendererCacheForTesting();

    const first = {} as CapturedResource;
    await registerRendererResource(createCapturingServer(first) as never);

    await moveRendererBundleTemporarily(async () => {
      const second = {} as CapturedResource;
      await registerRendererResource(createCapturingServer(second) as never);
      const result = await second.readCallback(
        new URL(RENDERER_RESOURCE_URI),
        {},
      );
      assert.match(result.contents[0]?.text ?? "", /<main id="app"><\/main>/);
    });
  });

  test("fails fast when the bundle is missing and cache is cold", async () => {
    await moveRendererBundleTemporarily(async () => {
      __clearRendererCacheForTesting();

      await assert.rejects(
        async () =>
          registerRendererResource(createCapturingServer({} as CapturedResource) as never),
        /ENOENT|no such file/i,
      );
    });
  });
});
