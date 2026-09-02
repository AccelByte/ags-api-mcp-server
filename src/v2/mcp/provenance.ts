// Copyright (c) 2025 AccelByte Inc.
// SPDX-License-Identifier: Apache-2.0

import { AsyncLocalStorage } from "node:async_hooks";

import { version } from "../version.js";
import { rememberSession } from "./session-cache.js";

export interface RequestProvenance {
  userAgent: string;
  playbookVersion?: string;
  /** Catalog version observed by this session, keyed by namespace. */
  contextVersions?: Record<string, string>;
  /** Key for writing newly observed provenance back to the session cache. */
  sessionId?: string;
}

const provenanceStorage = new AsyncLocalStorage<RequestProvenance>();
const MAX_FACADE_PRODUCT_BYTES = 128;
const MAX_USER_AGENT_BYTES = 1024;

/**
 * Reduce a value to something the facade will accept as a provenance token.
 *
 * Provenance is telemetry, so this fails open: anything malformed or over the
 * facade's per-value cap becomes `undefined` and is simply not sent. Forwarding
 * an over-cap value would make the facade reject the whole submission with 400,
 * turning a telemetry defect into a failed query.
 */
export function normalizeProvenanceValue(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().replace(/\s+/g, "-");
  return /^[A-Za-z0-9._-]+$/.test(normalized) &&
    Buffer.byteLength(normalized, "utf8") <= MAX_FACADE_PRODUCT_BYTES
    ? normalized
    : undefined;
}

/** Normalize a request-time MCP client identity into a safe User-Agent marker. */
export function clientUserAgent(name: unknown, clientVersion: unknown): string {
  const normalizedName = normalizeProvenanceValue(name);
  const normalizedVersion = normalizeProvenanceValue(clientVersion);
  const serverUserAgent = `ags-api-mcp-server/${version}`;
  const clientMarker =
    normalizedName && normalizedVersion
      ? ` (MCP-Client ${normalizedName}/${normalizedVersion})`
      : undefined;
  return clientMarker &&
    Buffer.byteLength(serverUserAgent + clientMarker, "utf8") <=
      MAX_USER_AGENT_BYTES
    ? serverUserAgent + clientMarker
    : serverUserAgent;
}

export function runWithRequestProvenance<T>(
  provenance: RequestProvenance,
  callback: () => T,
): T {
  return provenanceStorage.run(provenance, callback);
}

export function getRequestProvenance(): RequestProvenance | undefined {
  return provenanceStorage.getStore();
}

/**
 * Record a context version observed during this request against the session,
 * so a later submit on the same session and namespace can attribute to it.
 */
export function recordContextVersion(namespace: unknown, value: unknown): void {
  const provenance = getRequestProvenance();
  const normalized = normalizeProvenanceValue(value);
  // The namespace the catalog was read for is part of the fact being recorded;
  // without it the version cannot be safely replayed onto a later query.
  if (typeof namespace !== "string" || !namespace) return;
  if (!provenance?.sessionId || !normalized) return;
  const contextVersions = {
    ...provenance.contextVersions,
    [namespace]: normalized,
  };
  provenance.contextVersions = contextVersions;
  rememberSession(provenance.sessionId, { contextVersions });
}

/** The catalog version this session observed for `namespace`, if any. */
export function contextVersionFor(namespace: unknown): string | undefined {
  if (typeof namespace !== "string" || !namespace) return undefined;
  return getRequestProvenance()?.contextVersions?.[namespace];
}

/** Central identity header for every V2 request sent to a downstream service. */
export function downstreamUserAgent(): string {
  return (
    getRequestProvenance()?.userAgent ?? clientUserAgent(undefined, undefined)
  );
}
