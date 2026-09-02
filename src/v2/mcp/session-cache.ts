// Copyright (c) 2025 AccelByte Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * TEMPORARY BRIDGE — delete with AFT-215, once AFT-174 lands the SDK upgrade.
 *
 * This entire module exists only because MCP revisions up to 2025-11-25 send
 * the client identity once, on `initialize`. Revision 2026-07-28 removes that
 * handshake and puts `clientInfo` in `params._meta` on every request, at which
 * point `routes.ts` reads it directly and nothing here is consulted. That
 * revision also instructs servers not to mint or echo `Mcp-Session-Id`, which
 * this module's key depends on — so it is not merely redundant after the
 * upgrade, it is contrary to the spec. Remove the module, the minted session
 * id in `routes.ts`, and the `Mcp-Session-Id` CORS exposure together.
 *
 * Best-effort provenance memory for a stateless MCP server.
 *
 * The V2 server builds a fresh McpServer and transport per HTTP POST, so the
 * JSON-RPC `initialize` params and any later `tools/call` land on different
 * instances. Two provenance values are only knowable across that boundary: the
 * MCP client identity (sent once, at initialize) and the analytics context
 * version (observed when the context document is fetched, replayed when a query
 * is submitted).
 *
 * This cache retains that tuple — roughly a hundred bytes — keyed by the
 * session id the route mints on initialize. The MCP machinery itself stays
 * stateless: no transport, server, or token is held here, and every read is a
 * miss-tolerant lookup. A miss degrades to *absent* provenance, never to wrong
 * provenance, so a cold replica or an evicted entry costs telemetry fidelity
 * and nothing else.
 */

const SESSION_TTL_MS = 60 * 60 * 1000;
const MAX_SESSIONS = 10_000;

export interface SessionProvenance {
  clientName?: string;
  clientVersion?: string;
  /**
   * Catalog version per namespace. The analytics context is namespace-scoped,
   * so a single session that reads `alpha`'s catalog and then queries `beta`
   * must not stamp `beta`'s query with `alpha`'s revision — wrong attribution
   * is worse for the corpus than none.
   */
  contextVersions?: Record<string, string>;
}

interface Entry extends SessionProvenance {
  expiresAt: number;
}

const sessions = new Map<string, Entry>();

function evictExpired(now: number): void {
  Array.from(sessions.entries()).forEach(([id, entry]) => {
    if (entry.expiresAt <= now) sessions.delete(id);
  });
}

/** Merge values into a session, creating it if absent. Refreshes the TTL. */
export function rememberSession(
  sessionId: string,
  values: SessionProvenance,
): void {
  const now = Date.now();
  const existing = sessions.get(sessionId);

  // Map preserves insertion order, so re-inserting moves the entry to the tail
  // and makes the head the least recently written — the right eviction victim.
  if (existing) sessions.delete(sessionId);
  else if (sessions.size >= MAX_SESSIONS) {
    evictExpired(now);
    while (sessions.size >= MAX_SESSIONS) {
      const oldest = sessions.keys().next().value;
      if (oldest === undefined) break;
      sessions.delete(oldest);
    }
  }

  sessions.set(sessionId, {
    // Client identity is first-write-wins: a session is claimed by the client
    // that initialized it, and a later `initialize` replayed onto the same id —
    // by a buggy client or one that learned the id from the response header —
    // must not be able to restamp another client's queries.
    clientName: existing?.clientName ?? values.clientName,
    clientVersion: existing?.clientVersion ?? values.clientVersion,
    // Catalog versions accumulate per namespace, newest wins: re-reading a
    // catalog after it changes should update the version that gets stamped.
    contextVersions: {
      ...existing?.contextVersions,
      ...values.contextVersions,
    },
    expiresAt: now + SESSION_TTL_MS,
  });
}

/** Read a session's provenance, or undefined when unknown or expired. */
export function recallSession(
  sessionId: string | undefined,
): SessionProvenance | undefined {
  if (!sessionId) return undefined;
  const entry = sessions.get(sessionId);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    sessions.delete(sessionId);
    return undefined;
  }
  return {
    clientName: entry.clientName,
    clientVersion: entry.clientVersion,
    contextVersions: entry.contextVersions,
  };
}

/** Test seam. */
export function clearSessions(): void {
  sessions.clear();
}
