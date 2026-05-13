import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { z } from "zod/v3";

import {
  createProviderRegistry,
  type ProviderRegistry,
} from "../../../../../src/v2/mcp/tools/providers/registry.js";
import type {
  Provider,
  ProviderData,
} from "../../../../../src/v2/mcp/tools/providers/interface.js";

function createStubProvider(
  name: string,
  schemaFields: Provider["schemaFields"] = {},
): Provider {
  return {
    name,
    schemaFields,
    async resolve(): Promise<ProviderData> {
      return { columns: [], rows: [] };
    },
  };
}

describe("createProviderRegistry", () => {
  test("registerProvider and getProvider round-trip by name", () => {
    const registry = createProviderRegistry();
    const provider = createStubProvider("direct");

    registry.registerProvider(provider);

    assert.equal(registry.getProvider("direct"), provider);
  });

  test("duplicate registerProvider throws", () => {
    const registry = createProviderRegistry();
    registry.registerProvider(createStubProvider("direct"));

    assert.throws(
      () => registry.registerProvider(createStubProvider("direct")),
      /Provider already registered: direct/,
    );
  });

  test("listProviderNames returns registered names", () => {
    const registry = createProviderRegistry([
      createStubProvider("direct"),
      createStubProvider("facade"),
    ]);

    assert.deepEqual(registry.listProviderNames(), ["direct", "facade"]);
  });

  test("mergedSchemaFields merges providers with last-write-wins", () => {
    const firstField = z.string();
    const secondField = z.number();

    const registry = createProviderRegistry([
      createStubProvider("first", {
        alpha: firstField,
        shared: firstField,
      }),
      createStubProvider("second", {
        beta: secondField,
        shared: secondField,
      }),
    ]);

    const merged = registry.mergedSchemaFields();

    assert.equal(merged.alpha, firstField);
    assert.equal(merged.beta, secondField);
    assert.equal(merged.shared, secondField);
  });

  test("registries are isolated from each other", () => {
    const first: ProviderRegistry = createProviderRegistry();
    const second: ProviderRegistry = createProviderRegistry();

    first.registerProvider(createStubProvider("direct"));

    assert.deepEqual(first.listProviderNames(), ["direct"]);
    assert.deepEqual(second.listProviderNames(), []);
    assert.equal(second.getProvider("direct"), undefined);
  });
});
