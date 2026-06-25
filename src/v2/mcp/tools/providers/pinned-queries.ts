// Copyright (c) 2025 AccelByte Inc. All Rights Reserved.
// This is licensed software from AccelByte Inc, for limitations
// and restrictions contact your company contract manager.

import { z } from "zod/v3";

import log from "../../../logger.js";
import type { OpenApiTools } from "../../../../tools/openapi-tools.js";
import { PinRenderToolSchema } from "../../../shared/render-schemas.js";
import { FacadeError } from "./facade.js";

/**
 * Thin stateless proxy over the downstream `.../pinned-queries` AFS resource.
 * The facade owns persistence, submit→poll, and auto-heal; this helper just
 * translates `runApi` envelopes into typed, Zod-validated results and
 * `FacadeError`s, exactly as `facade.ts` does for query resolution. No
 * server-side state — every call hits AFS.
 *
 * NOTE: these endpoints are now in the bundled afs spec, so `runApi` resolves
 * them and issues a real call. An environment whose facade hasn't deployed them
 * returns an HTTP error (handled by the dashboard's generic fallback). The
 * `PINNED_QUERIES_UNAVAILABLE` path below only fires on a server build whose
 * bundled spec predates these endpoints — `runApi` then throws a lookup miss,
 * which we surface as a clear message rather than a stack trace.
 */

const PINNED_QUERIES_BASE =
  "/afs/v1/admin/namespaces/{namespace}/pinned-queries";

/**
 * A stored pin as returned by the facade. Non-strict (default `z.object` strips
 * unknown keys) since this mirrors an upstream shape we don't own — but the
 * fields the dashboard depends on are validated. In particular `render_tool` is
 * constrained to the pinnable set, so a record carrying an unrenderable tool is
 * rejected at this boundary (and skipped by `listPins`) rather than throwing
 * deeper in `recordToMeta`.
 */
export const PinnedQueryRecordSchema = z.object({
  pin_id: z.string(),
  title: z.string(),
  sql: z.string().optional(),
  query_id: z.string().nullable().optional(),
  render_tool: PinRenderToolSchema,
  render_options: z.record(z.string(), z.unknown()).optional(),
  position: z.number().int().optional(),
  // Layout-only width (1–12); the facade stores it verbatim. Modeled here so
  // callers read it from a typed field instead of an ad-hoc cast.
  span: z.number().int().optional(),
  refreshed_at: z.string().nullable().optional(),
  authored_by: z.string().optional(),
  created_at: z.string().optional(),
  updated_by: z.string().optional(),
  updated_at: z.string().optional(),
});
export type PinnedQueryRecord = z.infer<typeof PinnedQueryRecordSchema>;

/** One refresh result row-set. Non-strict; `status` is required (see `parseResult`). */
export const PinnedQueryResultRecordSchema = z.object({
  pin_id: z.string().optional(),
  query_id: z.string().optional(),
  status: z.string(),
  columns: z.array(z.object({ name: z.string(), type: z.string() })).optional(),
  rows: z.array(z.array(z.string())).optional(),
  truncated: z.boolean().optional(),
  stats: z
    .object({
      data_scanned_bytes: z.number().optional(),
      engine_execution_time_ms: z.number().optional(),
    })
    .optional(),
  sql: z.string().optional(),
  refreshed_at: z.string().optional(),
  healed: z.boolean().optional(),
});
export type PinnedQueryResultRecord = z.infer<
  typeof PinnedQueryResultRecordSchema
>;

export interface CreatePinInput {
  title: string;
  sql: string;
  render_tool: string;
  render_options: Record<string, unknown>;
  query_id?: string;
  position?: number;
}

interface RunApiEnvelope {
  response?: { status?: number; data?: unknown };
  error?: { code?: string; message?: string };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function structuredError(
  value: unknown,
): { code?: string; message?: string } | undefined {
  if (!isRecord(value) || !isRecord(value.error)) {
    return undefined;
  }
  return {
    code: typeof value.error.code === "string" ? value.error.code : undefined,
    message:
      typeof value.error.message === "string" ? value.error.message : undefined,
  };
}

function httpError(status: number, data: unknown): FacadeError {
  const upstream = structuredError(data);
  return new FacadeError(
    upstream?.code ?? `HTTP_${status}`,
    upstream?.message ?? `Pinned-queries request returned ${status}.`,
  );
}

/**
 * Execute a pinned-queries `runApi` call and return the success body. Throws a
 * `FacadeError` for transport failures, `>=400` responses, and (importantly) a
 * spec-lookup miss when the endpoints aren't deployed yet.
 */
async function callPinnedQueries(
  openApiTools: OpenApiTools,
  args: {
    method: "GET" | "POST" | "PUT" | "DELETE";
    path: string;
    pathParams: Record<string, string>;
    query?: Record<string, string | number | (string | number)[]>;
    body?: unknown;
    headers?: Record<string, string>;
  },
  token: string,
): Promise<{ status: number; data: unknown }> {
  let envelope: RunApiEnvelope;
  try {
    envelope = (await openApiTools.runApi(
      {
        spec: "afs",
        method: args.method,
        path: args.path,
        pathParams: args.pathParams,
        query: args.query,
        body: args.body,
        headers: args.headers,
        useAccessToken: true,
      },
      undefined,
      token,
    )) as RunApiEnvelope;
  } catch (error) {
    // `runApi` throws (rather than returning an envelope) only when the
    // operation isn't in the loaded spec — i.e. this server build's bundled afs
    // spec predates the pinned-queries endpoints. (A deployed-but-erroring
    // facade returns an HTTP error envelope, handled below, not here.)
    const message = error instanceof Error ? error.message : String(error);
    log.warn({ err: message, path: args.path }, "pinned-queries call failed");
    throw new FacadeError(
      "PINNED_QUERIES_UNAVAILABLE",
      `The pinned-queries endpoint is not in this server's bundled spec (${message}). ` +
        "Durable pin save/refresh requires a build whose afs spec includes the pinned-queries resource.",
    );
  }

  if (isRecord(envelope.response)) {
    const { status } = envelope.response;
    // A response envelope without a numeric status is malformed — treat it as an
    // error rather than coercing to 0 and reporting a phantom success.
    if (typeof status !== "number") {
      throw new FacadeError(
        "INVALID_RESPONSE",
        "Pinned-queries response had no numeric status.",
      );
    }
    if (status >= 400) {
      throw httpError(status, envelope.response.data);
    }
    return { status, data: envelope.response.data };
  }

  if (isRecord(envelope.error)) {
    throw new FacadeError(
      typeof envelope.error.code === "string"
        ? envelope.error.code
        : "TRANSPORT_ERROR",
      envelope.error.message ?? "Pinned-queries request failed.",
    );
  }

  throw new FacadeError(
    "INTERNAL",
    "OpenAPI transport returned an unexpected result envelope.",
  );
}

function parsePin(data: unknown): PinnedQueryRecord {
  const parsed = PinnedQueryRecordSchema.safeParse(data);
  if (!parsed.success) {
    throw new FacadeError(
      "INVALID_RESPONSE",
      "Facade returned an invalid pinned-query payload.",
    );
  }
  return parsed.data;
}

/**
 * List all pins for a namespace (full objects — the dashboard's working set).
 * Each record is validated individually: a single malformed record is skipped
 * with a warning so it can't take down the entire authoritative pin list (one
 * corrupt row would otherwise blank the whole dashboard).
 */
export async function listPins(
  openApiTools: OpenApiTools,
  namespace: string,
  token: string,
): Promise<PinnedQueryRecord[]> {
  const { data } = await callPinnedQueries(
    openApiTools,
    { method: "GET", path: PINNED_QUERIES_BASE, pathParams: { namespace } },
    token,
  );
  if (!isRecord(data) || !Array.isArray(data.data)) {
    return [];
  }
  const pins = data.data.flatMap((entry) => {
    const parsed = PinnedQueryRecordSchema.safeParse(entry);
    return parsed.success ? [parsed.data] : [];
  });
  const skipped = data.data.length - pins.length;
  if (skipped > 0) {
    log.warn(
      { skipped, namespace },
      "listPins: skipped malformed pinned-query record(s) from the store",
    );
  }
  return pins;
}

/** Create a pin → `POST .../pinned-queries`. */
export async function createPin(
  openApiTools: OpenApiTools,
  namespace: string,
  input: CreatePinInput,
  token: string,
): Promise<PinnedQueryRecord> {
  const { data } = await callPinnedQueries(
    openApiTools,
    {
      method: "POST",
      path: PINNED_QUERIES_BASE,
      pathParams: { namespace },
      body: input,
    },
    token,
  );
  return parsePin(data);
}

/** Delete a pin → `DELETE .../pinned-queries/{id}` (idempotent → 204). */
export async function deletePin(
  openApiTools: OpenApiTools,
  namespace: string,
  pinId: string,
  token: string,
): Promise<void> {
  await callPinnedQueries(
    openApiTools,
    {
      method: "DELETE",
      path: `${PINNED_QUERIES_BASE}/{id}`,
      pathParams: { namespace, id: pinId },
    },
    token,
  );
}

function parseResult(
  data: unknown,
  fallbackPinId: string,
): PinnedQueryResultRecord {
  // `status` is required: a result payload with a missing/non-string status is
  // malformed and surfaced as an error rather than coerced to a phantom "UNKNOWN"
  // success that would render as empty rows.
  const parsed = PinnedQueryResultRecordSchema.safeParse(data);
  if (!parsed.success) {
    throw new FacadeError(
      "INVALID_RESPONSE",
      "Facade returned an invalid pinned-query result payload.",
    );
  }
  return {
    ...parsed.data,
    pin_id: parsed.data.pin_id ?? fallbackPinId,
    status: parsed.data.status.toUpperCase(),
  };
}

/**
 * Force a re-run → `POST .../pinned-queries/{id}/refresh`. The only billable,
 * SQL-re-running path (open never re-runs SQL). A `202` means the run went
 * async; surface it as `NOT_READY` so the caller can report "still running".
 */
export async function refreshPin(
  openApiTools: OpenApiTools,
  namespace: string,
  pinId: string,
  token: string,
): Promise<PinnedQueryResultRecord> {
  const { status, data } = await callPinnedQueries(
    openApiTools,
    {
      method: "POST",
      path: `${PINNED_QUERIES_BASE}/{id}/refresh`,
      pathParams: { namespace, id: pinId },
    },
    token,
  );
  if (status === 202) {
    throw new FacadeError(
      "NOT_READY",
      `Refresh for pin ${pinId} is running. Poll the query and re-open the dashboard when it completes.`,
    );
  }
  return parseResult(data, pinId);
}
