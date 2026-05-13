import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { z } from "zod/v3";

import { createDirectProvider } from "../../../../../src/v2/mcp/tools/providers/direct.js";
import { createFacadeProvider } from "../../../../../src/v2/mcp/tools/providers/facade.js";
import type { Config } from "../../../../../src/v2/config.js";
import { createProviderRegistry } from "../../../../../src/v2/mcp/tools/providers/registry.js";
import type {
  Provider,
  ProviderData,
} from "../../../../../src/v2/mcp/tools/providers/interface.js";
import {
  resolveData,
  sharedRenderFields,
} from "../../../../../src/v2/mcp/tools/renderers/shared-input.js";

function createConfig(): Config {
  return {
    mcp: {
      port: 3000,
      path: "/mcp",
      serverUrl: "http://localhost:3000",
      enableAuth: true,
      authServerDiscoveryMode: "none",
    },
    openapi: {
      specsDir: "/tmp/openapi-specs",
      searchLimit: 10,
      maxSearchLimit: 50,
      runTimeoutMs: 25,
      maxRunTimeoutMs: 60_000,
      serverUrl: "https://analytics.example.com",
      includeWriteRequests: true,
    },
    runtime: {
      nodeEnv: "test",
      logLevel: "info",
    },
    hosted: {
      enabled: false,
      validateTokenIssuer: true,
      allowParentDomainIssuer: false,
    },
  } as Config;
}

describe("shared render input helpers", () => {
  test("resolveData routes direct provider inputs to direct", async () => {
    const registry = createProviderRegistry([createDirectProvider()]);

    const result = await resolveData(
      registry,
      {
        provider: "direct",
        data_columns: [{ name: "value", type: "bigint" }],
        data_rows: [["7"]],
      },
      "",
    );

    assert.deepEqual(result, {
      columns: [{ name: "value", type: "bigint" }],
      rows: [["7"]],
    });
  });

  test("resolveData routes facade provider inputs to facade", async () => {
    let receivedToken = "";
    let receivedInput: Record<string, unknown> | undefined;

    const stubFacade: Provider = {
      ...createFacadeProvider(createConfig()),
      async resolve(input, token): Promise<ProviderData> {
        receivedInput = input;
        receivedToken = token;
        return {
          columns: [{ name: "value", type: "bigint" }],
          rows: [["9"]],
        };
      },
    };

    const registry = createProviderRegistry([stubFacade]);

    const result = await resolveData(
      registry,
      {
        provider: "facade",
        query_id: "q1",
        namespace: "demo",
      },
      "token-123",
    );

    assert.deepEqual(result, {
      columns: [{ name: "value", type: "bigint" }],
      rows: [["9"]],
    });
    assert.equal(receivedToken, "token-123");
    assert.deepEqual(receivedInput, {
      provider: "facade",
      query_id: "q1",
      namespace: "demo",
    });
  });

  test("resolveData unknown provider error includes registered names", async () => {
    const registry = createProviderRegistry([
      createDirectProvider(),
      createFacadeProvider(createConfig()),
    ]);

    await assert.rejects(
      resolveData(registry, { provider: "missing" }, ""),
      /Registered providers: direct, facade/,
    );
  });

  test("sharedRenderFields includes the built-in provider fields", () => {
    const registry = createProviderRegistry([
      createDirectProvider(),
      createFacadeProvider(createConfig()),
    ]);

    const fields = sharedRenderFields(registry);

    for (const key of [
      "provider",
      "query_id",
      "namespace",
      "data_columns",
      "data_rows",
      "max_rows",
      "title",
      "description",
      "column_hints",
      "filters",
    ]) {
      assert.ok(fields[key], `expected sharedRenderFields to include ${key}`);
    }
  });

  test("sharedRenderFields picks up extra provider schema fields", () => {
    const registry = createProviderRegistry([
      createDirectProvider(),
      {
        name: "custom",
        schemaFields: {
          sample_field: z.string().optional(),
        },
        async resolve(): Promise<ProviderData> {
          return { columns: [], rows: [] };
        },
      },
    ]);

    const fields = sharedRenderFields(registry);

    assert.ok(fields.sample_field);
  });
});
