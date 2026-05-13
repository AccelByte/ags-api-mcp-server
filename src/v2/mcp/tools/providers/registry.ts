// Copyright (c) 2025 AccelByte Inc. All Rights Reserved.
// This is licensed software from AccelByte Inc, for limitations
// and restrictions contact your company contract manager.

import type { ZodTypeAny } from "zod/v3";
import type { Provider } from "./interface.js";

export interface ProviderRegistry {
  registerProvider(provider: Provider): void;
  getProvider(name: string): Provider | undefined;
  listProviderNames(): string[];
  mergedSchemaFields(): Record<string, ZodTypeAny>;
}

export function createProviderRegistry(
  initialProviders: Provider[] = [],
): ProviderRegistry {
  const providers = new Map<string, Provider>();

  function registerProvider(provider: Provider): void {
    if (providers.has(provider.name)) {
      throw new Error(`Provider already registered: ${provider.name}`);
    }
    providers.set(provider.name, provider);
  }

  function getProvider(name: string): Provider | undefined {
    return providers.get(name);
  }

  function listProviderNames(): string[] {
    return Array.from(providers.keys());
  }

  /**
   * Merge schemaFields across providers. Last-write-wins. Same-name fields across
   * providers must declare schema-compatible Zod types — enforced at review time,
   * documented on Provider.schemaFields.
   */
  function mergedSchemaFields(): Record<string, ZodTypeAny> {
    return Array.from(providers.values()).reduce<Record<string, ZodTypeAny>>(
      (merged, provider) => {
        const providerFields = Object.fromEntries(
          Object.entries(provider.schemaFields ?? {}).map(([key, value]) => [
            key,
            value,
          ]),
        );
        return { ...merged, ...providerFields };
      },
      {},
    );
  }

  initialProviders.forEach((provider) => {
    registerProvider(provider);
  });

  return {
    registerProvider,
    getProvider,
    listProviderNames,
    mergedSchemaFields,
  };
}
