// Copyright (c) 2025 AccelByte Inc. All Rights Reserved.
// This is licensed software from AccelByte Inc, for limitations
// and restrictions contact your company contract manager.

import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v3";

import log from "../../../logger.js";
import type { OpenApiTools } from "../../../../tools/openapi-tools.js";
import {
  clampSpan,
  DashboardDataSchema,
  DashboardOutputSchema,
  DIRECT_DATA_SOURCE,
  isStaticPin,
  MAX_SPAN,
  MIN_SPAN,
  PinnedQueryCardSchema,
  PinnedQueryMetaSchema,
  PinRenderToolSchema,
  ProviderColumnSchema,
  QuotaUsageSchema,
  type PinnedQueryCard,
  type PinnedQueryMeta,
  type QuotaUsage,
} from "../../../shared/render-schemas.js";
import { RENDERER_RESOURCE_URI } from "../../renderer-resource.js";
import { createFacadeProvider, FacadeError } from "../providers/facade.js";
import {
  createPin,
  deletePin,
  listPins,
  refreshPin,
  updatePin,
  type PinnedQueryRecord,
  type PinnedQueryResultRecord,
} from "../providers/pinned-queries.js";
import { MAX_ROWS_DEFAULT } from "./shared-input.js";
import { buildPinRenderOutput } from "./define.js";

/** App-only tools are callable by the widget, hidden from the model. */
const APP_ONLY_META = {
  ui: { resourceUri: RENDERER_RESOURCE_URI, visibility: ["app"] as const },
};
const MODEL_FACING_META = { ui: { resourceUri: RENDERER_RESOURCE_URI } };

/** FacadeError codes that mean "no cached result" — show a stale card, not an error. */
const STALE_CODES = new Set([
  "NOT_FOUND",
  "NOT_READY",
  "CANCELLED",
  "TIMEOUT",
  "PINNED_QUERY_RESULT_EXPIRED",
  "INVALID_ARGUMENT",
]);

/**
 * Heuristic FALLBACK for the rolling-window flag. The authoritative source is
 * the backend's stored `moving_window` (model-declared at submit, persisted on
 * the durable query row and the pin record); this regex fires only when that
 * flag is absent — a legacy pin, or one whose durable row aged out. SQL with a
 * relative/moving window re-scans a sliding range on every refresh.
 *
 * Known gaps (uncommon in Athena; expand only if they show up): getdate(),
 * `AT TIME ZONE`, and date_trunc/trunc patterns that don't also reference
 * current_date. These misclassify as snapshots — acceptable for a fallback.
 */
function isMovingWindowSql(sql: string | undefined): boolean {
  if (!sql) {
    return false;
  }
  return /\b(current_date|current_timestamp|now\s*\(\s*\)|date_add|date_diff|interval\s+'?\d)/i.test(
    sql,
  );
}

const PinInputSchema = z.object({
  pin_id: z.string().optional(),
  title: z.string(),
  sql: z.string().optional(),
  query_id: z.string().nullable().optional(),
  render_tool: PinRenderToolSchema,
  render_options: z.record(z.string(), z.unknown()).default({}),
  position: z.number().int().optional(),
  refreshed_at: z.string().nullable().optional(),
  // Carried on model-held pins so the stored rolling-window flag survives a
  // round-trip through the model (used as the preferred source over the regex).
  moving_window: z.boolean().optional(),
  // Static pin: inline rows described in chat. Presence ⇒ static (no facade).
  data_columns: z.array(ProviderColumnSchema).optional(),
  data_rows: z.array(z.array(z.string())).optional(),
  // Layout width (1–12); clamped in normalizePins (absent → 4).
  span: z.number().int().optional(),
});
type PinInput = z.infer<typeof PinInputSchema>;

// Per-tool input schemas. Each tool's `inputSchema` is derived from `.shape` and
// its handler reads `Schema.parse(input)`, so the registered shape and the typed
// value the handler consumes can never drift (it'd be a compile error).
const OpenDashboardInputSchema = z.object({
  pins: z.array(PinInputSchema).optional(),
  namespace: z.string().optional(),
  title: z.string().optional(),
});
const LoadDashboardInputSchema = z.object({
  pins: z.array(PinInputSchema).optional(),
  namespace: z.string().optional(),
});
const QuotaUsageInputSchema = z.object({ namespace: z.string().optional() });
const PinQueryInputSchema = z.object({
  title: z.string(),
  // query_id is the pin's source key — the backend re-sources SQL/database/
  // namespace from it. SQL is no longer accepted as a trusted client input.
  query_id: z.string(),
  render_tool: PinRenderToolSchema,
  render_options: z.record(z.string(), z.unknown()).default({}),
  position: z.number().int().optional(),
  namespace: z.string().optional(),
});
const UnpinQueryInputSchema = z.object({
  pin_id: z.string(),
  namespace: z.string().optional(),
});
const RefreshPinnedQueryInputSchema = z.object({
  pin_id: z.string(),
  render_tool: PinRenderToolSchema,
  render_options: z.record(z.string(), z.unknown()).default({}),
  title: z.string().optional(),
  sql: z.string().optional(),
  // Carried so the refresh response's stored flag has a fallback (matches the
  // refresh-all path): if the backend omits moving_window on the result, the
  // widget's already-resolved value keeps the caption instead of degrading to
  // the SQL heuristic.
  moving_window: z.boolean().optional(),
  data_columns: z.array(ProviderColumnSchema).optional(),
  data_rows: z.array(z.array(z.string())).optional(),
  span: z.number().int().optional(),
  namespace: z.string().optional(),
});
const RefreshAllPinnedInputSchema = z.object({
  pins: z.array(PinInputSchema),
  namespace: z.string().optional(),
});
const UpdatePinnedQueryInputSchema = z.object({
  pin_id: z.string(),
  // Rename: trimmed + non-empty (the backend also rejects a blank title).
  title: z.string().trim().min(1).max(200).optional(),
  // Grid width; the backend clamps out-of-range, but bound it here too.
  span: z.number().int().min(MIN_SPAN).max(MAX_SPAN).optional(),
  // Forward-looking / model-facing only: the backend accepts a position edit
  // (author-controlled grid order), but no renderer chrome constructs an update
  // intent carrying `position` yet — only title (rename) and span (resize) are
  // wired to UI affordances. If a reorder UI is added later, give `position` the
  // same optimistic-apply + rollback + server-reconcile handling span/title have
  // (spanFromResult/titleFromResult) rather than assuming it's already exercised.
  position: z.number().int().optional(),
  namespace: z.string().optional(),
});

function token(extra: { authInfo?: { token?: string } }): string {
  return extra.authInfo?.token ?? "";
}

function resolveNamespace(
  input: { namespace?: string },
  defaultNamespace?: string,
): string {
  const ns = input.namespace ?? defaultNamespace;
  if (!ns) {
    throw new FacadeError(
      "INVALID_ARGUMENT",
      "namespace is required (none provided and no namespace in the request context).",
    );
  }
  return ns;
}

/** Normalize model-held pin inputs into stable pin metadata (synthesizing ids). */
function normalizePins(pins: PinInput[] | undefined): PinnedQueryMeta[] {
  return (pins ?? []).map((pin, index) =>
    PinnedQueryMetaSchema.parse({
      pin_id: pin.pin_id ?? `mh-${index}`,
      title: pin.title,
      sql: pin.sql,
      query_id: pin.query_id ?? undefined,
      render_tool: pin.render_tool,
      render_options: pin.render_options ?? {},
      position: pin.position ?? index,
      refreshed_at: pin.refreshed_at ?? undefined,
      // Prefer the stored flag; fall back to the SQL heuristic only when absent.
      moving_window: pin.moving_window ?? isMovingWindowSql(pin.sql),
      data_columns: pin.data_columns,
      data_rows: pin.data_rows,
      span: clampSpan(pin.span),
    }),
  );
}

/**
 * Map a stored facade pin record into pin metadata (the authoritative list, post-M3).
 * `fallbackPosition` supplies a position only when the record omits one — the
 * list index in `buildDashboard`, or the caller-requested position in a single-pin
 * edit. When it's also undefined (a stateless edit that didn't touch position and a
 * response that didn't echo one), `position` is left unset rather than fabricated,
 * so a title/span-only edit can't silently assert a position it never had.
 */
function recordToMeta(
  record: PinnedQueryRecord,
  fallbackPosition?: number,
): PinnedQueryMeta {
  return PinnedQueryMetaSchema.parse({
    pin_id: record.pin_id,
    title: record.title,
    sql: record.sql,
    query_id: record.query_id ?? undefined,
    render_tool: record.render_tool,
    render_options: record.render_options ?? {},
    position: record.position ?? fallbackPosition,
    refreshed_at: record.refreshed_at ?? undefined,
    updated_at: record.updated_at,
    // The backend stores the authoritative flag (model-declared at submit);
    // fall back to the SQL heuristic only for legacy/aged-out records.
    moving_window: record.moving_window ?? isMovingWindowSql(record.sql),
    // The facade stores `span` verbatim (layout-only); carry it through clamped.
    span: clampSpan(record.span),
  });
}

/**
 * Build a card for a **static** pin (rows described inline in chat). Never
 * touches the facade — rows come from the pin itself. The `render_output` is
 * built from a `MAX_ROWS_DEFAULT`-capped slice, but the *original* inline data +
 * `span` ride along on the card so a focus-reload round-trips it instead of
 * dropping the pin to stale. A bad inline payload is caught here as a per-card
 * error (the inline payload is never executed).
 */
function buildStaticCard(pin: PinnedQueryMeta): PinnedQueryCard {
  const base = {
    pin_id: pin.pin_id,
    title: pin.title,
    render_tool: pin.render_tool,
    render_options: pin.render_options,
    sql: pin.sql,
    query_id: pin.query_id ?? undefined,
    refreshed_at: pin.refreshed_at ?? undefined,
    position: pin.position,
    moving_window: pin.moving_window,
    span: pin.span,
    data_columns: pin.data_columns,
    data_rows: pin.data_rows,
  };
  try {
    const renderOutput = buildPinRenderOutput(
      pin.render_tool,
      pin.render_options,
      {
        columns: pin.data_columns ?? [],
        rows: (pin.data_rows ?? []).slice(0, MAX_ROWS_DEFAULT),
      },
      { title: pin.title, dataSource: DIRECT_DATA_SOURCE },
    );
    return PinnedQueryCardSchema.parse({
      ...base,
      render_output: renderOutput,
    });
  } catch (error) {
    return PinnedQueryCardSchema.parse({
      ...base,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Quota-exceeded detection (stop refresh-all cleanly on a 429). */
function isQuotaError(error: FacadeError): boolean {
  return (
    error.code === "QUOTA_EXCEEDED" ||
    error.code === "HTTP_429" ||
    /quota|429/i.test(error.message)
  );
}

/** Turn a thrown error into a standard isError tool result with a `code` meta. */
function facadeErrorResult(error: unknown): {
  content: { type: "text"; text: string }[];
  isError: true;
  _meta: { code: string };
} {
  const code = error instanceof FacadeError ? error.code : "INTERNAL";
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: "text", text: message }],
    isError: true,
    _meta: { code },
  };
}

export function setupDashboardTools(
  server: McpServer,
  openApiTools: OpenApiTools,
  defaultNamespace?: string,
  allowDirectPins = false,
): void {
  const facade = createFacadeProvider(openApiTools);

  /**
   * Drop static/direct (inline-data) pins when they're gated off, returning the
   * surviving pins plus how many were dropped. Live (facade-backed) pins always
   * pass. With `DASHBOARD_ALLOW_DIRECT_PINS` unset the dashboard is live-only —
   * snapshot pins route data through the model and bypass the facade, so an
   * operator can forbid them.
   */
  function admitPins(pins: PinnedQueryMeta[]): {
    pins: PinnedQueryMeta[];
    droppedDirect: number;
  } {
    if (allowDirectPins) {
      return { pins, droppedDirect: 0 };
    }
    const kept = pins.filter((pin) => !isStaticPin(pin));
    return { pins: kept, droppedDirect: pins.length - kept.length };
  }

  const directPinsNotice = (dropped: number): string =>
    `Snapshot (direct) pins are disabled on this server — ${dropped} pin${
      dropped === 1 ? "" : "s"
    } omitted. Pin a live query instead.`;

  /** Best-effort `GET .../quota/usage` → usage snapshot. Returns the FacadeError on failure. */
  async function fetchUsage(
    namespace: string,
    authToken: string,
  ): Promise<{ usage?: QuotaUsage; error?: FacadeError }> {
    try {
      const envelope = (await openApiTools.runApi(
        {
          spec: "afs",
          method: "GET",
          path: "/afs/v1/admin/namespaces/{namespace}/quota/usage",
          pathParams: { namespace },
          useAccessToken: true,
        },
        undefined,
        authToken,
      )) as { response?: { status?: number; data?: unknown } };

      const status = envelope.response?.status;
      const data = envelope.response?.data;
      if (typeof status === "number" && status >= 400) {
        const code =
          data && typeof data === "object" && "error" in data
            ? String(
                (data as { error?: { code?: string } }).error?.code ??
                  `HTTP_${status}`,
              )
            : `HTTP_${status}`;
        log.warn(
          { code, status },
          "quota/usage returned an error; spend header keeps its last value.",
        );
        return {
          error: new FacadeError(code, `quota/usage returned ${status}.`),
        };
      }

      const record = (data ?? {}) as {
        monthly?: Record<string, unknown>;
        lifetime?: Record<string, unknown>;
      };
      const usage = QuotaUsageSchema.parse({
        monthly: record.monthly,
        lifetime: record.lifetime,
      });
      return { usage };
    } catch (error) {
      log.warn(
        { err: error instanceof Error ? error.message : String(error) },
        "quota/usage fetch failed; spend header keeps its last value.",
      );
      return {
        error:
          error instanceof FacadeError
            ? error
            : new FacadeError(
                "INTERNAL",
                error instanceof Error ? error.message : String(error),
              ),
      };
    }
  }

  /**
   * Resolve one pin into a card. Resolves rows via the existing facade
   * `query_id` path — cache-only by nature, so an expired id yields a *stale*
   * card (click Refresh) rather than re-running SQL on open. A malformed
   * `render_options` (poison pill) is caught here and surfaced as a per-card
   * error, never executed.
   */
  async function resolvePinCard(
    pin: PinnedQueryMeta,
    namespace: string,
    authToken: string,
  ): Promise<PinnedQueryCard> {
    // Static pin: rows are described inline (a snapshot) — build directly,
    // never touch the facade.
    if (isStaticPin(pin)) {
      return buildStaticCard(pin);
    }

    const base = {
      pin_id: pin.pin_id,
      title: pin.title,
      render_tool: pin.render_tool,
      render_options: pin.render_options,
      sql: pin.sql,
      query_id: pin.query_id ?? undefined,
      refreshed_at: pin.refreshed_at ?? undefined,
      position: pin.position,
      moving_window: pin.moving_window,
      span: pin.span,
    };

    // null and undefined are both "no query_id" — the consumption sites collapse
    // them via `?? undefined` (the backend uses null for a pin whose durable
    // query row was removed; undefined for a legacy pin that was never linked).
    // Either way there is no source key to resolve, so the card is stale.
    if (!pin.query_id) {
      return PinnedQueryCardSchema.parse({ ...base, stale: true });
    }

    try {
      const data = await facade.resolve(
        { query_id: pin.query_id, namespace, max_rows: MAX_ROWS_DEFAULT },
        authToken,
      );
      const renderOutput = buildPinRenderOutput(
        pin.render_tool,
        pin.render_options,
        {
          columns: data.columns,
          rows: data.rows,
          stats: data.stats,
          sql: data.sql ?? pin.sql,
        },
        { title: pin.title },
      );
      return PinnedQueryCardSchema.parse({
        ...base,
        render_output: renderOutput,
      });
    } catch (error) {
      if (error instanceof FacadeError && STALE_CODES.has(error.code)) {
        return PinnedQueryCardSchema.parse({ ...base, stale: true });
      }
      return PinnedQueryCardSchema.parse({
        ...base,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /** Build a card from a refresh result (the only re-run path). */
  function cardFromResult(
    pin: {
      pin_id: string;
      title: string;
      render_tool: string;
      render_options: Record<string, unknown>;
      sql?: string;
      moving_window?: boolean;
      span?: number;
    },
    result: PinnedQueryResultRecord,
  ): PinnedQueryCard {
    const base = {
      pin_id: pin.pin_id,
      title: pin.title,
      render_tool: pin.render_tool,
      render_options: pin.render_options,
      sql: result.sql ?? pin.sql,
      query_id: result.query_id,
      refreshed_at: result.refreshed_at,
      // Prefer the refresh response's stored flag, then the already-resolved
      // value the meta carried in, then the SQL heuristic — so the moving-window
      // caption survives a refresh even if a future change rebuilds pins from the
      // refreshed card (the load path does exactly this via cardToMeta).
      moving_window:
        result.moving_window ??
        pin.moving_window ??
        isMovingWindowSql(result.sql ?? pin.sql),
      span: pin.span,
    };
    try {
      const renderOutput = buildPinRenderOutput(
        pin.render_tool,
        pin.render_options,
        {
          columns: result.columns ?? [],
          rows: result.rows ?? [],
          stats: result.stats,
          sql: result.sql ?? pin.sql,
        },
        { title: pin.title },
      );
      return PinnedQueryCardSchema.parse({
        ...base,
        render_output: renderOutput,
      });
    } catch (error) {
      return PinnedQueryCardSchema.parse({
        ...base,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // ---------- Model-facing: open_dashboard ----------

  registerAppTool(
    server,
    "open_dashboard",
    {
      title: "Open Analytics Dashboard",
      description:
        "Open the analytics dashboard surface — a home for pinned Athena queries plus a spend/usage header. " +
        "Pass the pins the user is curating (each with its title, query_id, render_tool, render_options, and moving_window flag); " +
        "the dashboard renders the last-known cached result for each and never re-runs SQL on open (refresh is an explicit click). " +
        "The payload is metadata-only; the widget fetches row data itself. Use this when the user wants to see their pinned charts at a glance.",
      inputSchema: OpenDashboardInputSchema.shape,
      outputSchema: DashboardOutputSchema.shape,
      _meta: MODEL_FACING_META,
    },
    async (
      input: Record<string, unknown>,
      extra: { authInfo?: { token?: string } },
    ) => {
      const typed = OpenDashboardInputSchema.parse(input);
      const authToken = token(extra);
      // The dashboard still opens without a namespace (metadata paint), but the
      // widget's follow-up load_dashboard will fail to resolve rows/usage. Log
      // why rather than swallowing it, so an inert board is diagnosable.
      let namespace: string | undefined;
      try {
        namespace = resolveNamespace(typed, defaultNamespace);
      } catch (error) {
        namespace = undefined;
        log.warn(
          { err: error instanceof Error ? error.message : String(error) },
          "open_dashboard: no namespace resolved — usage and pin rows will be unavailable",
        );
      }

      const { pins, droppedDirect } = admitPins(normalizePins(typed.pins));
      const { usage } = namespace
        ? await fetchUsage(namespace, authToken)
        : { usage: undefined };

      const payload = DashboardOutputSchema.parse({
        chart_type: "dashboard",
        title: typed.title,
        namespace,
        usage,
        pins,
      });

      // DashboardOutput carries no notice field, so tell the model about gated
      // pins in the text content (the widget's follow-up load_dashboard repeats
      // the omission as a user-visible notice).
      const directNote =
        droppedDirect > 0 ? ` ${directPinsNotice(droppedDirect)}` : "";
      return {
        content: [
          {
            type: "text" as const,
            text: `Opening dashboard with ${pins.length} pinned ${pins.length === 1 ? "query" : "queries"}.${directNote}`,
          },
        ],
        structuredContent: payload,
      };
    },
  );

  // ---------- App-only: load_dashboard (self-rehydrate + row fetch) ----------

  registerAppTool(
    server,
    "load_dashboard",
    {
      title: "Load Dashboard Data",
      description:
        "Internal: fetch pinned-query rows and usage for the dashboard widget. Resolves each pin's last cached result (no SQL re-run) and the quota/usage header.",
      inputSchema: LoadDashboardInputSchema.shape,
      outputSchema: DashboardDataSchema.shape,
      _meta: APP_ONLY_META,
    },
    async (
      input: Record<string, unknown>,
      extra: { authInfo?: { token?: string } },
    ) => {
      const typed = LoadDashboardInputSchema.parse(input);
      const authToken = token(extra);
      let namespace: string;
      try {
        namespace = resolveNamespace(typed, defaultNamespace);
      } catch (error) {
        return facadeErrorResult(error);
      }

      // Authoritative pin list comes from the facade store when available;
      // otherwise fall back to the widget-supplied (model-held) list. Static
      // (direct) pins are dropped up front when gated off, so they never reach
      // the merge or the per-card resolve.
      const admitted = admitPins(normalizePins(typed.pins));
      let { pins } = admitted;
      const notices: string[] = [];
      if (admitted.droppedDirect > 0) {
        notices.push(directPinsNotice(admitted.droppedDirect));
      }
      try {
        const stored = await listPins(openApiTools, namespace, authToken);
        const storedMeta = stored.map((record, index) =>
          recordToMeta(record, index),
        );
        // Static (inline-data) pins are model-held and never persisted, so the
        // store can't return them — carry them alongside the authoritative
        // stored (live) pins instead of dropping snapshots on a store-backed
        // load. Dedupe by pin_id (a stored pin wins over an inline duplicate, so
        // the grid never renders two cards under one id) and offset static
        // positions past the stored set so the two index spaces don't collide
        // when the grid sorts by position.
        const storedIds = new Set(storedMeta.map((meta) => meta.pin_id));
        const staticPins = pins
          .filter((pin) => isStaticPin(pin) && !storedIds.has(pin.pin_id))
          .map((pin, index) => ({
            ...pin,
            position: storedMeta.length + index,
          }));
        pins = [...storedMeta, ...staticPins];
      } catch (error) {
        const code = error instanceof FacadeError ? error.code : "INTERNAL";
        const message = error instanceof Error ? error.message : String(error);
        if (code === "PINNED_QUERIES_UNAVAILABLE") {
          // Benign: the facade hasn't shipped pin persistence yet — the
          // model-held pins are the working set. Expected pre-deployment.
          log.debug(
            { err: message },
            "load_dashboard: pin store not deployed, using inline pins",
          );
        } else {
          // A genuine store failure (auth, 5xx, transport). Don't present an
          // empty/partial board as if the store simply had no pins: keep the
          // inline pins so the board still paints, but surface a notice the
          // widget shows as a non-blocking hint.
          log.warn(
            { err: message, code },
            "load_dashboard: pin store error, falling back to inline pins",
          );
          notices.push(
            "Couldn't reach the pinned-query store — showing model-held pins only. Some saved pins may be missing.",
          );
        }
      }

      const cards = await Promise.all(
        pins.map((pin) => resolvePinCard(pin, namespace, authToken)),
      );
      const { usage } = await fetchUsage(namespace, authToken);

      const payload = DashboardDataSchema.parse({
        namespace,
        usage,
        notice: notices.length > 0 ? notices.join(" ") : undefined,
        pins: cards,
      });
      return {
        content: [
          {
            type: "text" as const,
            text: `Loaded ${cards.length} dashboard cards.`,
          },
        ],
        structuredContent: payload,
      };
    },
  );

  // ---------- App-only: get_quota_usage ----------

  registerAppTool(
    server,
    "get_quota_usage",
    {
      title: "Get Quota Usage",
      description:
        "Internal: fetch the namespace's Athena spend snapshot (monthly + lifetime) for the dashboard usage header.",
      inputSchema: QuotaUsageInputSchema.shape,
      outputSchema: QuotaUsageSchema.shape,
      _meta: APP_ONLY_META,
    },
    async (
      input: Record<string, unknown>,
      extra: { authInfo?: { token?: string } },
    ) => {
      const typed = QuotaUsageInputSchema.parse(input);
      let namespace: string;
      try {
        namespace = resolveNamespace(typed, defaultNamespace);
      } catch (error) {
        return facadeErrorResult(error);
      }
      const { usage, error } = await fetchUsage(namespace, token(extra));
      if (error) {
        return {
          content: [{ type: "text" as const, text: error.message }],
          isError: true,
          _meta: { code: error.code },
        };
      }
      return {
        content: [{ type: "text" as const, text: "Quota usage snapshot." }],
        structuredContent: QuotaUsageSchema.parse(usage ?? {}),
      };
    },
  );

  // ---------- App-only: pin_query ----------

  registerAppTool(
    server,
    "pin_query",
    {
      title: "Pin Query",
      description:
        "Internal: persist a pinned query (title + query_id + render spec) to the namespace's dashboard. The query_id is the source key — the facade re-sources SQL/database/namespace from it, so they can't be hallucinated.",
      inputSchema: PinQueryInputSchema.shape,
      outputSchema: PinnedQueryMetaSchema.shape,
      _meta: APP_ONLY_META,
    },
    async (
      input: Record<string, unknown>,
      extra: { authInfo?: { token?: string } },
    ) => {
      const typed = PinQueryInputSchema.parse(input);
      try {
        const namespace = resolveNamespace(typed, defaultNamespace);
        const record = await createPin(
          openApiTools,
          namespace,
          {
            title: typed.title,
            render_tool: typed.render_tool,
            render_options: typed.render_options ?? {},
            query_id: typed.query_id,
            position: typed.position,
          },
          token(extra),
        );
        return {
          content: [
            { type: "text" as const, text: `Pinned "${record.title}".` },
          ],
          structuredContent: recordToMeta(record, record.position ?? 0),
        };
      } catch (error) {
        return facadeErrorResult(error);
      }
    },
  );

  // ---------- App-only: unpin_query ----------

  registerAppTool(
    server,
    "unpin_query",
    {
      title: "Unpin Query",
      description:
        "Internal: remove a pinned query from the namespace's dashboard.",
      inputSchema: UnpinQueryInputSchema.shape,
      outputSchema: { pin_id: z.string(), removed: z.boolean() },
      _meta: APP_ONLY_META,
    },
    async (
      input: Record<string, unknown>,
      extra: { authInfo?: { token?: string } },
    ) => {
      const typed = UnpinQueryInputSchema.parse(input);
      try {
        const namespace = resolveNamespace(typed, defaultNamespace);
        await deletePin(openApiTools, namespace, typed.pin_id, token(extra));
        return {
          content: [
            { type: "text" as const, text: `Removed pin ${typed.pin_id}.` },
          ],
          structuredContent: { pin_id: typed.pin_id, removed: true },
        };
      } catch (error) {
        return facadeErrorResult(error);
      }
    },
  );

  // ---------- App-only: update_pinned_query ----------

  registerAppTool(
    server,
    "update_pinned_query",
    {
      title: "Update Pinned Query",
      description:
        "Internal: edit a pin's mutable layout/label metadata — title (rename), span (grid width 1–12), and/or position. Partial update; SQL, query_id and the render spec are immutable. At least one field must be supplied. Never re-runs SQL (not billable).",
      inputSchema: UpdatePinnedQueryInputSchema.shape,
      outputSchema: PinnedQueryMetaSchema.shape,
      _meta: APP_ONLY_META,
    },
    async (
      input: Record<string, unknown>,
      extra: { authInfo?: { token?: string } },
    ) => {
      const typed = UpdatePinnedQueryInputSchema.parse(input);
      try {
        // Partial update, but an empty patch is a client error, not a no-op write
        // (the backend also 400s it). Enforce here so the contract in the tool
        // description holds and we skip a pointless round-trip.
        if (
          typed.title === undefined &&
          typed.span === undefined &&
          typed.position === undefined
        ) {
          throw new FacadeError(
            "INVALID_ARGUMENT",
            "Supply at least one of title, span, or position to update.",
          );
        }
        const namespace = resolveNamespace(typed, defaultNamespace);
        const record = await updatePin(
          openApiTools,
          namespace,
          typed.pin_id,
          { title: typed.title, span: typed.span, position: typed.position },
          token(extra),
        );
        return {
          content: [
            { type: "text" as const, text: `Updated pin ${typed.pin_id}.` },
          ],
          // The backend echoes `position` on the updated record (0.7.0+), so
          // recordToMeta uses that. The fallback is the *requested* position
          // (undefined for a title/span-only edit) — never a hardcoded 0, which
          // would silently reposition a renamed pin to the front if a facade
          // ever omitted position from its PATCH response.
          structuredContent: recordToMeta(record, typed.position),
        };
      } catch (error) {
        return facadeErrorResult(error);
      }
    },
  );

  // ---------- App-only: refresh_pinned_query ----------

  registerAppTool(
    server,
    "refresh_pinned_query",
    {
      title: "Refresh Pinned Query",
      description:
        "Internal: re-run a pinned query's SQL (the only billing path) and return the refreshed card. Always an explicit user click.",
      inputSchema: RefreshPinnedQueryInputSchema.shape,
      outputSchema: DashboardDataSchema.shape,
      _meta: APP_ONLY_META,
    },
    async (
      input: Record<string, unknown>,
      extra: { authInfo?: { token?: string } },
    ) => {
      const typed = RefreshPinnedQueryInputSchema.parse(input);
      try {
        const namespace = resolveNamespace(typed, defaultNamespace);

        // Static pins are never re-run (no facade, no bill) — rebuild from the
        // inline rows and return unchanged. (The view shows no Refresh on a
        // static pin, so this is a guard the UI won't normally trigger.)
        if (isStaticPin(typed)) {
          const card = buildStaticCard(
            normalizePins([
              {
                pin_id: typed.pin_id,
                title: typed.title ?? typed.pin_id,
                render_tool: typed.render_tool,
                render_options: typed.render_options ?? {},
                sql: typed.sql,
                data_columns: typed.data_columns,
                data_rows: typed.data_rows,
                span: typed.span,
              },
            ])[0],
          );
          const { usage } = await fetchUsage(namespace, token(extra));
          return {
            content: [
              {
                type: "text" as const,
                text: `Pin ${typed.pin_id} is a static snapshot — not re-run.`,
              },
            ],
            structuredContent: DashboardDataSchema.parse({
              namespace,
              usage,
              pins: [card],
            }),
          };
        }

        const result = await refreshPin(
          openApiTools,
          namespace,
          typed.pin_id,
          token(extra),
        );
        const card = cardFromResult(
          {
            pin_id: typed.pin_id,
            title: typed.title ?? typed.pin_id,
            render_tool: typed.render_tool,
            render_options: typed.render_options ?? {},
            sql: typed.sql,
            moving_window: typed.moving_window,
            span: typed.span,
          },
          result,
        );
        const { usage } = await fetchUsage(namespace, token(extra));
        return {
          content: [
            { type: "text" as const, text: `Refreshed pin ${typed.pin_id}.` },
          ],
          structuredContent: DashboardDataSchema.parse({
            namespace,
            usage,
            pins: [card],
          }),
        };
      } catch (error) {
        return facadeErrorResult(error);
      }
    },
  );

  // ---------- App-only: refresh_all_pinned (budget-gated by the widget) ----------

  registerAppTool(
    server,
    "refresh_all_pinned",
    {
      title: "Refresh All Pinned Queries",
      description:
        "Internal: re-run every pinned query (budget-gated by the widget). Runs sequentially and stops on a 429 quota error.",
      inputSchema: RefreshAllPinnedInputSchema.shape,
      outputSchema: DashboardDataSchema.shape,
      _meta: APP_ONLY_META,
    },
    async (
      input: Record<string, unknown>,
      extra: { authInfo?: { token?: string } },
    ) => {
      const typed = RefreshAllPinnedInputSchema.parse(input);
      let namespace: string;
      try {
        namespace = resolveNamespace(typed, defaultNamespace);
      } catch (error) {
        return facadeErrorResult(error);
      }
      const authToken = token(extra);
      // Refresh exactly the widget's pin set — the cost confirmation the user
      // approved was computed against this list. Re-reading the store here could
      // re-run (and bill) pins added in another view that were never in that
      // estimate; those are picked up by the next load_dashboard instead.
      const pins = normalizePins(typed.pins);

      // `stopped` lives on an object (not a reassigned closure variable) so the
      // per-pin refresher can be declared once, outside the refresh loop.
      const quota = { stopped: false };
      const refreshOne = async (
        pin: PinnedQueryMeta,
      ): Promise<PinnedQueryCard> => {
        // Static pins carry their rows — never billed, never re-run.
        if (isStaticPin(pin)) {
          return buildStaticCard(pin);
        }
        try {
          const result = await refreshPin(
            openApiTools,
            namespace,
            pin.pin_id,
            authToken,
          );
          return cardFromResult(
            {
              pin_id: pin.pin_id,
              title: pin.title,
              render_tool: pin.render_tool,
              render_options: pin.render_options,
              sql: pin.sql,
              moving_window: pin.moving_window,
              span: pin.span,
            },
            result,
          );
        } catch (error) {
          if (error instanceof FacadeError && isQuotaError(error)) {
            quota.stopped = true;
          }
          // A still-running/expired refresh (202 NOT_READY, 404, TIMEOUT, …) is a
          // pending state, not a failure — keep the card as stale, matching the
          // load path (resolvePinCard). Quota errors fall through to an error card
          // so the user sees why the batch stopped.
          if (
            error instanceof FacadeError &&
            !isQuotaError(error) &&
            STALE_CODES.has(error.code)
          ) {
            return PinnedQueryCardSchema.parse({
              pin_id: pin.pin_id,
              title: pin.title,
              render_tool: pin.render_tool,
              render_options: pin.render_options,
              sql: pin.sql,
              query_id: pin.query_id ?? undefined,
              moving_window: pin.moving_window,
              span: pin.span,
              stale: true,
            });
          }
          return PinnedQueryCardSchema.parse({
            pin_id: pin.pin_id,
            title: pin.title,
            render_tool: pin.render_tool,
            render_options: pin.render_options,
            sql: pin.sql,
            query_id: pin.query_id ?? undefined,
            moving_window: pin.moving_window,
            span: pin.span,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      };

      // Refresh sequentially and stop the moment a quota error is seen: bounded
      // fan-out would issue sibling re-runs that bill past the cap before the
      // 429 is observed. A dashboard holds a small number of pins, so a serial
      // walk is cheap and keeps the "stops on 429" guarantee exact.
      const cards: PinnedQueryCard[] = [];
      for (let i = 0; i < pins.length && !quota.stopped; i += 1) {
        // eslint-disable-next-line no-await-in-loop -- serial so we stop billing at the quota cap
        cards.push(await refreshOne(pins[i]));
      }

      const { usage } = await fetchUsage(namespace, authToken);
      const message = quota.stopped
        ? "Refresh stopped: quota reached. Some pins were not refreshed."
        : `Refreshed ${cards.length} pinned ${cards.length === 1 ? "query" : "queries"}.`;
      return {
        content: [{ type: "text" as const, text: message }],
        structuredContent: DashboardDataSchema.parse({
          namespace,
          usage,
          pins: cards,
        }),
      };
    },
  );
}

export default setupDashboardTools;
