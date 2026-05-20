// Copyright (c) 2025 AccelByte Inc. All Rights Reserved.
// This is licensed software from AccelByte Inc, for limitations
// and restrictions contact your company contract manager.

import { z } from "zod/v3";

import log from "../../../logger.js";
import type { OpenApiTools } from "../../../../tools/openapi-tools.js";
import type { Provider, ProviderData } from "./interface.js";

interface FacadeQueryResponse {
  query_id: string;
  status: "running" | "queued" | "succeeded" | "failed" | "cancelled";
  instruction?: string;
  columns?: { name: string; type: string }[];
  rows?: string[][];
  truncated?: boolean;
  error?: { code: string; message: string };
  stats?: {
    data_scanned_bytes?: number;
    engine_execution_time_ms?: number;
  };
  sql?: string;
}

interface RunApiEnvelope {
  response?: {
    status?: number;
    data?: unknown;
  };
  error?: {
    code?: string;
    message?: string;
  };
}

export class FacadeError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FacadeError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function extractStructuredError(
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

function isTimeoutError(error: { code?: string; message?: string }): boolean {
  return (
    error.code === "ECONNABORTED" ||
    error.code === "ETIMEDOUT" ||
    error.message?.toLowerCase().includes("timeout") === true
  );
}

function normalizeTransportError(error: {
  code?: string;
  message?: string;
}): FacadeError {
  if (isTimeoutError(error)) {
    return new FacadeError(
      "TIMEOUT",
      error.message ?? "Facade request timed out.",
    );
  }

  return new FacadeError(
    "TRANSPORT_ERROR",
    error.message ?? "Facade request failed before a response was received.",
  );
}

function normalizeHttpError(
  status: number | undefined,
  data: unknown,
): FacadeError {
  const upstreamError = extractStructuredError(data);

  if (status === 404) {
    const baseMessage = upstreamError?.message ?? "query_id not found";
    const message =
      `${baseMessage}. ` +
      'If this id came from a POST /afs/.../queries fast-path 200 response with inline rows, render those rows via provider="direct" or re-run the query with wait_ms=0 and then poll GET /afs/v1/admin/namespaces/{namespace}/queries/{id}.';

    return new FacadeError(upstreamError?.code ?? "NOT_FOUND", message);
  }

  return new FacadeError(
    upstreamError?.code ?? "INTERNAL",
    upstreamError?.message ?? `Facade returned ${status ?? "unknown status"}`,
  );
}

function parseFacadeQueryResponse(data: unknown): FacadeQueryResponse {
  if (!isRecord(data) || typeof data.query_id !== "string") {
    throw new FacadeError(
      "INVALID_RESPONSE",
      "Facade returned an invalid query payload.",
    );
  }

  const rawStatus = typeof data.status === "string" ? data.status : undefined;
  const status = rawStatus?.toLowerCase();
  if (
    status !== "running" &&
    status !== "queued" &&
    status !== "succeeded" &&
    status !== "failed" &&
    status !== "cancelled"
  ) {
    throw new FacadeError(
      "INVALID_RESPONSE",
      `Query ${data.query_id} returned unsupported status "${String(data.status)}".`,
    );
  }

  const columns = Array.isArray(data.columns)
    ? data.columns.flatMap((column) =>
        isRecord(column) &&
        typeof column.name === "string" &&
        typeof column.type === "string"
          ? [{ name: column.name, type: column.type }]
          : [],
      )
    : undefined;

  const rows = Array.isArray(data.rows)
    ? data.rows.flatMap((row) =>
        Array.isArray(row) && row.every((cell) => typeof cell === "string")
          ? [row]
          : [],
      )
    : undefined;

  let stats: FacadeQueryResponse["stats"];
  if (isRecord(data.stats)) {
    const dataScannedBytes =
      typeof data.stats.data_scanned_bytes === "number"
        ? data.stats.data_scanned_bytes
        : undefined;
    const engineExecutionTimeMs =
      typeof data.stats.engine_execution_time_ms === "number"
        ? data.stats.engine_execution_time_ms
        : undefined;
    if (dataScannedBytes !== undefined || engineExecutionTimeMs !== undefined) {
      stats = {
        ...(dataScannedBytes !== undefined && {
          data_scanned_bytes: dataScannedBytes,
        }),
        ...(engineExecutionTimeMs !== undefined && {
          engine_execution_time_ms: engineExecutionTimeMs,
        }),
      };
    }
  }

  return {
    query_id: data.query_id,
    status,
    instruction:
      typeof data.instruction === "string" ? data.instruction : undefined,
    columns,
    rows,
    truncated: typeof data.truncated === "boolean" ? data.truncated : undefined,
    error: extractStructuredError(data) as
      | { code: string; message: string }
      | undefined,
    stats,
    sql: typeof data.sql === "string" ? data.sql : undefined,
  };
}

export function createFacadeProvider(openApiTools: OpenApiTools): Provider {
  return {
    name: "facade",
    schemaFields: {
      query_id: z
        .string()
        .optional()
        .describe(
          'Athena Facade query id (required when provider="facade"). Prefer obtaining it by calling run-apis against POST /afs/v1/admin/namespaces/{namespace}/queries with wait_ms=0, then polling GET /afs/v1/admin/namespaces/{namespace}/queries/{id} until status="succeeded". If POST returns 200 with inline rows on the fast path, render those rows via provider="direct" instead of reusing the returned query_id.',
        ),
      namespace: z
        .string()
        .optional()
        .describe(
          'AGS namespace (required when provider="facade"). Agents should derive from get_token_info.hints.namespace when not explicitly specified.',
        ),
    },

    async resolve(input, token): Promise<ProviderData> {
      const {
        query_id: queryId,
        namespace,
        max_rows: maxRows,
      } = input as {
        query_id?: string;
        namespace?: string;
        max_rows?: number;
      };

      if (!queryId) {
        throw new FacadeError(
          "INVALID_ARGUMENT",
          'provider="facade" requires query_id',
        );
      }
      if (!namespace) {
        throw new FacadeError(
          "INVALID_ARGUMENT",
          'provider="facade" requires namespace',
        );
      }

      try {
        const rawResult = (await openApiTools.runApi(
          {
            spec: "afs",
            method: "GET",
            path: "/afs/v1/admin/namespaces/{namespace}/queries/{id}",
            pathParams: {
              namespace,
              id: queryId,
            },
            query: maxRows !== undefined ? { max_rows: maxRows } : undefined,
            useAccessToken: true,
          },
          undefined,
          token,
        )) as RunApiEnvelope;

        if (isRecord(rawResult.response)) {
          const status =
            typeof rawResult.response.status === "number"
              ? rawResult.response.status
              : undefined;

          if (status !== undefined && status >= 400) {
            throw normalizeHttpError(status, rawResult.response.data);
          }

          const body = parseFacadeQueryResponse(rawResult.response.data);

          switch (body.status) {
            case "running":
            case "queued":
              throw new FacadeError(
                "NOT_READY",
                `Query ${body.query_id} is still ${body.status}${body.instruction ? `: ${body.instruction}` : ""}. Poll GET /afs/v1/admin/namespaces/{namespace}/queries/{id} via run-apis until status="succeeded" before rendering.`,
              );
            case "cancelled":
              throw new FacadeError(
                "CANCELLED",
                `Query ${body.query_id} was cancelled.`,
              );
            case "failed":
              throw new FacadeError(
                body.error?.code ?? "QUERY_FAILED",
                body.error?.message ?? `Query ${body.query_id} failed.`,
              );
            case "succeeded": {
              const columns = body.columns ?? [];
              const rows = body.rows ?? [];
              log.debug(
                {
                  query_id: queryId,
                  namespace,
                  columns: columns.length,
                  rows: rows.length,
                  truncated: body.truncated ?? false,
                },
                "facadeProvider.resolve succeeded",
              );
              const result: ProviderData = { columns, rows };
              if (body.stats) {
                result.stats = body.stats;
              }
              if (body.sql !== undefined) {
                result.sql = body.sql;
              }
              return result;
            }
            default:
              throw new FacadeError(
                "INVALID_RESPONSE",
                `Query ${body.query_id} returned unsupported status "${String(body.status)}".`,
              );
          }
        }

        if (isRecord(rawResult.error)) {
          throw normalizeTransportError({
            code:
              typeof rawResult.error.code === "string"
                ? rawResult.error.code
                : undefined,
            message:
              typeof rawResult.error.message === "string"
                ? rawResult.error.message
                : undefined,
          });
        }

        throw new FacadeError(
          "INTERNAL",
          "OpenAPI transport returned an unexpected result envelope.",
        );
      } catch (error) {
        if (error instanceof FacadeError) {
          throw error;
        }

        throw new FacadeError(
          "INTERNAL",
          error instanceof Error ? error.message : String(error),
        );
      }
    },
  };
}
