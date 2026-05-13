// Copyright (c) 2025 AccelByte Inc. All Rights Reserved.
// This is licensed software from AccelByte Inc, for limitations
// and restrictions contact your company contract manager.

import { z } from "zod/v3";

import type { Config } from "../../../config.js";
import log from "../../../logger.js";
import type { Provider, ProviderData } from "./interface.js";

interface FacadeQueryResponse {
  query_id: string;
  status: "running" | "queued" | "succeeded" | "failed" | "cancelled";
  instruction?: string;
  columns?: { name: string; type: string }[];
  rows?: string[][];
  truncated?: boolean;
  error?: { code: string; message: string };
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

export function createFacadeProvider(effectiveConfig: Config): Provider {
  return {
    name: "facade",
    schemaFields: {
      query_id: z
        .string()
        .optional()
        .describe(
          'Athena Facade query id (required when provider="facade"). Obtain by calling run-apis against POST /v1/admin/namespaces/{namespace}/queries and polling GET /v1/admin/namespaces/{namespace}/queries/{id} until status="succeeded".',
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

      const qs = maxRows !== undefined ? `?max_rows=${maxRows}` : "";
      const url = `${effectiveConfig.openapi.serverUrl}/v1/admin/namespaces/${encodeURIComponent(namespace)}/queries/${encodeURIComponent(queryId)}${qs}`;

      const controller = new AbortController();
      const timer = setTimeout(
        () => controller.abort(),
        effectiveConfig.openapi.runTimeoutMs,
      );

      let response: Response;
      try {
        response = await fetch(url, {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }

      if (!response.ok) {
        let code = "INTERNAL";
        let message = `Facade returned ${response.status}`;

        try {
          const body = (await response.json()) as {
            error?: { code?: string; message?: string };
          };
          if (body.error) {
            code = body.error.code ?? code;
            message = body.error.message ?? message;
          }
        } catch {
          // Non-JSON error body — keep defaults.
        }

        throw new FacadeError(code, message);
      }

      const body = (await response.json()) as FacadeQueryResponse;

      switch (body.status) {
        case "running":
        case "queued":
          throw new FacadeError(
            "NOT_READY",
            `Query ${body.query_id} is still ${body.status}${body.instruction ? `: ${body.instruction}` : ""}. Poll GET /v1/admin/namespaces/{namespace}/queries/{id} via run-apis until status="succeeded" before rendering.`,
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
          return { columns, rows };
        }
        default:
          throw new FacadeError(
            "INVALID_RESPONSE",
            `Query ${body.query_id} returned unsupported status "${String(body.status)}".`,
          );
      }
    },
  };
}
