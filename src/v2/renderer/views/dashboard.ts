// Copyright (c) 2025 AccelByte Inc.
// SPDX-License-Identifier: Apache-2.0

import { z } from "zod/v3";

import type {
  McpUiDisplayMode,
  McpUiHostCapabilities,
  McpUiHostContext,
} from "@modelcontextprotocol/ext-apps";

import {
  clampSpan,
  DashboardDataSchema,
  DIRECT_DATA_SOURCE,
  isStaticPin,
  QuotaUsageSchema,
  RenderOutputSchema,
  type DashboardOutput,
  type PinnedQueryCard,
  type PinnedQueryMeta,
  type QuotaUsage,
  type RenderOutput,
} from "../../shared/render-schemas.js";
import { buildChromeContext } from "../chrome/context.js";
import { resolve, type ResolvedChrome } from "../chrome/resolve.js";
import { type ChromeContext } from "../chrome/types.js";
import {
  attachEffect,
  createMountScope,
  type BindFn,
  type MountScope,
} from "../chrome/frame.js";
import { CHROMES } from "../chrome/registry.js";
import { buildUsageBar } from "./usage-bar.js";
import {
  createDashboardBinder,
  isCancelled,
  withCostConfirm,
} from "../chrome/binder.js";
// Chrome are resolved from the unified CHROMES registry; only their slice TYPES
// are referenced here (for the per-chrome wiring casts).
import { type PinSlice } from "../chrome/chromes/pin.js";
import { type QuotaSlice } from "../chrome/chromes/quota.js";
import { type RefreshSlice } from "../chrome/chromes/refresh.js";
import { ICONS, iconButton } from "./icons.js";
import { renderChart } from "./chart.js";
import { renderMetric } from "./metric.js";
import { renderTable } from "./table.js";

/**
 * The subset of the ext-apps `App` the dashboard needs. All optional + invoked
 * with `?.` so non-interactive hosts (and test fakes) degrade gracefully rather
 * than throwing (mirrors the text-editor's `EditorHostBridge` pattern).
 */
export interface DashboardHostBridge {
  getHostContext?(): McpUiHostContext | undefined;
  getHostCapabilities?(): McpUiHostCapabilities | undefined;
  callServerTool?(params: {
    name: string;
    arguments?: Record<string, unknown>;
  }): Promise<{
    isError?: boolean;
    structuredContent?: unknown;
    content?: Array<{ type?: string; text?: string }>;
    _meta?: Record<string, unknown>;
  }>;
  requestDisplayMode?(params: {
    mode: McpUiDisplayMode;
  }): Promise<{ mode: McpUiDisplayMode }>;
  updateModelContext?(params: {
    content: Array<{ type: "text"; text: string }>;
  }): Promise<unknown>;
}

interface DashboardSession {
  root: HTMLElement;
  bridge: DashboardHostBridge;
  displayMode: McpUiDisplayMode | undefined;
  /** Pin metadata from the replayed `open_dashboard` result (skeleton source). */
  pins: PinnedQueryMeta[];
  /** Resolved cards (rows) from the latest `load_dashboard`, keyed by pin_id. */
  cards: Map<string, PinnedQueryCard>;
  /** Mounted card wrappers, keyed by pin_id, so we update bodies incrementally. */
  cardEls: Map<string, { wrapper: HTMLElement; signature: string }>;
  usage: QuotaUsage | undefined;
  namespace: string | undefined;
  /** Guards against overlapping load_dashboard calls (focus + mount race). */
  loading: boolean;
  /** Effect/cleanup scope for chrome mounted this paint; disposed on re-paint/teardown. */
  scope?: MountScope;
  /** Push a fresh usage snapshot into the quota chrome's bar (set by its effect host). */
  quotaUpdate?: (usage: QuotaUsage | undefined) => void;
}

let session: DashboardSession | null = null;

/**
 * chart_type → the render tool that produced it (for pinning a single result).
 * Exported so a unit test can assert it stays in sync with `PIN_RENDER_TOOLS` —
 * a new pinnable chart that's missing here would silently lose its Pin button.
 */
export const CHART_TYPE_TO_RENDER_TOOL: Record<string, string> = {
  bar: "render_bar_chart",
  line: "render_line_chart",
  area: "render_area_chart",
  scatter: "render_scatter_chart",
  histogram: "render_histogram_chart",
  box: "render_box_chart",
  heatmap: "render_heatmap_chart",
  pie: "render_pie_chart",
  donut: "render_donut_chart",
  waterfall: "render_waterfall_chart",
  funnel: "render_funnel_chart",
  gauge: "render_gauge_chart",
  state_timeline: "render_state_timeline_chart",
  table: "render_table",
  metric: "render_metric",
  meter: "render_meter",
};

/** Edit/manage affordances only in fullscreen; inline is a compact read-only glance. */
function isInteractive(displayMode: McpUiDisplayMode | undefined): boolean {
  return displayMode === "fullscreen";
}

/**
 * Inject a "Pin" button into a freshly-rendered single result so the user can
 * keep it on the dashboard. A pin forwards `{title, query_id, render_tool,
 * render_options}` (plus the resolved namespace) — the backend re-sources
 * SQL/database/namespace from the `query_id`, so the model can't hallucinate
 * them. No-ops when the host can't call server tools, the chart type isn't
 * pinnable, or the result isn't a facade-backed query carrying a `query_id`
 * (not inline `direct` data, nor any other provider's rows).
 */
export function maybeAddPinAffordance(
  root: HTMLElement,
  payload: {
    chart_type: string;
    data_source?: string;
    sql?: string;
    query_id?: string;
    title?: string;
    options?: Record<string, unknown>;
    namespace?: string;
  },
  bridge: DashboardHostBridge | undefined,
): void {
  const actions = root.querySelector<HTMLElement>(".renderer-header-actions");
  if (!actions) {
    return;
  }

  // Eligibility + payload-forwarding are now declared on the `pin` chrome; the
  // host's ability to call tools maps to the `canManagePins` permission, and
  // `resolve` is the single presence choke point. Behavior (the tool call) lives
  // in the binder; this glue only renders the button and reflects the result.
  const ctx = buildChromeContext({
    container: "standalone",
    renderType: payload.chart_type,
    dataSource: payload.data_source,
    sql: payload.sql,
    queryId: payload.query_id,
    title: payload.title,
    options: payload.options,
    renderTool: CHART_TYPE_TO_RENDER_TOOL[payload.chart_type],
    permissions: { canManagePins: Boolean(bridge?.callServerTool) },
  });
  // Mount only the header-region chrome here (the pin). Footer notes are mounted
  // by mountShell; nothing else is eligible in a standalone result. (Resolving
  // the whole registry keeps placement data-driven.)
  const resolved = resolve(CHROMES, ctx);
  const entry = resolved["header-start"][0] ?? resolved["header-end"][0];
  if (!entry || !bridge?.callServerTool) {
    return;
  }

  const slice = entry.slice as PinSlice;
  const intent = entry.chrome.intent?.(slice);
  const action = intent ? createDashboardBinder(bridge)[intent.type] : undefined;
  if (!intent || !action) {
    return;
  }
  const title = slice.title;
  // AFS queries are namespace-scoped and a standalone result can't recover the
  // namespace from a `query_id`, so forward the one the render output carried
  // (the facade provider requires it, so it's present on any pinnable result).
  // Without it `pin_query` falls back to the server's default namespace, which
  // only exists on the `/mcp/:namespace` route.
  const pinPayload =
    typeof payload.namespace === "string"
      ? { ...intent.payload, namespace: payload.namespace }
      : intent.payload;

  // The chrome renders an icon button; status rides on the title/aria-label
  // (tooltip) PLUS a visible state class (spinner / success / error) and the
  // icon, so a pin that succeeds or fails is obvious without hovering. We never
  // clobber the SVG with textContent — only swap the whole icon.
  const button = entry.chrome.render(slice) as HTMLButtonElement;
  const setStatus = (label: string): void => {
    button.title = label;
    button.setAttribute("aria-label", label);
  };
  const setState = (
    state: "is-pinning" | "is-pinned" | "is-error" | null,
  ): void => {
    button.classList.remove("is-pinning", "is-pinned", "is-error");
    if (state) {
      void button.offsetWidth; // restart the animation if the state repeats
      button.classList.add(state);
    }
  };
  // Failure is surfaced three ways: the red+shake state, the tooltip label, and
  // (so the reason isn't hover-gated) a note pushed to the model's context.
  const reportFailure = (label: string, reason: string): void => {
    button.disabled = false; // allow a retry
    button.replaceChildren(ICONS.pin());
    setStatus(label);
    setState("is-error");
    void bridge.updateModelContext?.({
      content: [{ type: "text", text: `Pinning "${title}" failed: ${reason}` }],
    });
  };
  button.addEventListener("click", () => {
    button.disabled = true;
    button.replaceChildren(ICONS.refresh()); // spun by the is-pinning class
    setStatus("Pinning…");
    setState("is-pinning");
    void action(pinPayload)
      .then((result) => {
        if (result.isError) {
          const code = resultCode(result);
          const detail = result.content?.find((c) => c.text)?.text;
          reportFailure(
            code === "PINNED_QUERIES_UNAVAILABLE"
              ? "Pinning not enabled yet"
              : "Pin failed",
            detail || code || "unknown error",
          );
          return;
        }
        button.replaceChildren(ICONS.check());
        setStatus("Pinned");
        setState("is-pinned");
        void bridge.updateModelContext?.({
          content: [
            {
              type: "text",
              text: `The user pinned "${title}" to the dashboard.`,
            },
          ],
        });
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        console.warn("Pin request failed", error);
        reportFailure("Pin failed", message);
      });
  });
  actions.prepend(button);
}

/**
 * Render the dashboard from a (replayed) `open_dashboard` metadata payload, then
 * self-load row data. Resets the session each time a fresh result arrives.
 */
export function renderDashboard(
  root: HTMLElement,
  payload: DashboardOutput,
  bridge: DashboardHostBridge,
  displayMode: McpUiDisplayMode | undefined,
): void {
  // Re-rendering a dashboard over an existing one (dashboard→dashboard bypasses
  // clearDashboardMode in app-shell) must release the prior chrome scope here;
  // otherwise its sync `visibilitychange` listener and quota hook leak and stack,
  // re-firing loadData() once per leaked listener on the next focus.
  session?.scope?.dispose();
  session = {
    root,
    bridge,
    displayMode,
    pins: [...payload.pins].sort(byPosition),
    cards: new Map(),
    cardEls: new Map(),
    usage: payload.usage,
    namespace: payload.namespace,
    loading: false,
  };
  enterDashboardMode();
  applySizing(bridge.getHostContext?.(), displayMode);
  paint();
  void loadData();
}

/** Re-apply layout after a display-mode toggle, preserving loaded card data. */
export function refreshDashboardMode(
  displayMode: McpUiDisplayMode | undefined,
): boolean {
  if (!session) {
    return false;
  }
  // host-context-changed delivers only changed fields; a missing displayMode
  // means "unchanged", so keep the current mode (don't drop to inline).
  const wasInteractive = isInteractive(session.displayMode);
  if (displayMode !== undefined) {
    session.displayMode = displayMode;
  }
  applySizing(session.bridge.getHostContext?.(), session.displayMode);
  paint();
  // Entering fullscreen is a natural "I'm looking now" moment — freshen the
  // spend header (cheap; no pin re-resolve, no SQL re-run).
  if (!wasInteractive && isInteractive(session.displayMode)) {
    void refreshUsage();
  }
  return true;
}

/** Tear down dashboard-specific document styling (e.g. switching to another view). */
export function clearDashboardMode(): void {
  resetMenus();
  session?.scope?.dispose();
  if (typeof document !== "undefined") {
    document.body.classList.remove("renderer-dashboard-mode");
    document.documentElement.style.removeProperty("height");
    document.body.style.removeProperty("height");
    // The cost-confirm modal mounts on <body>, so drop it on teardown too.
    document.querySelector(".renderer-dashboard-confirm")?.remove();
  }
  session = null;
}

function byPosition(
  a: { position?: number },
  b: { position?: number },
): number {
  return (a.position ?? 0) - (b.position ?? 0);
}

function enterDashboardMode(): void {
  if (typeof document !== "undefined") {
    document.body.classList.add("renderer-dashboard-mode");
  }
}

/** Inline (compact) ceiling so the dashboard stays a glance, not a wall, when the
 *  host doesn't hand us a fixed height. Fullscreen always fills its container. */
const INLINE_MAX_HEIGHT = 560;

/**
 * Size the iframe to the host container, not to content: set <html>/
 * <body> to a definite height and let the grid scroll *inside*. Never report
 * scrollHeight — that creates a "more cards → taller → reflow" loop. In inline
 * mode, bound the height (host maxHeight, else INLINE_MAX_HEIGHT) so the embed
 * doesn't grow unbounded down the chat.
 */
function applySizing(
  context: McpUiHostContext | undefined,
  displayMode: McpUiDisplayMode | undefined,
): void {
  if (typeof document === "undefined") {
    return;
  }
  // containerDimensions is a union (fixed height | maxHeight); read either.
  const dims = context?.containerDimensions as
    | { height?: number; maxHeight?: number }
    | undefined;
  const fixed = typeof dims?.height === "number" ? dims.height : undefined;
  const bounded =
    typeof dims?.maxHeight === "number" ? dims.maxHeight : undefined;

  let height = fixed ?? bounded;
  if (!isInteractive(displayMode)) {
    // Inline: cap to the host bound or our default ceiling (scrolls inside).
    height = Math.min(height ?? INLINE_MAX_HEIGHT, INLINE_MAX_HEIGHT);
  }

  if (height !== undefined) {
    document.documentElement.style.height = `${height}px`;
    document.body.style.height = `${height}px`;
  } else {
    document.documentElement.style.removeProperty("height");
    document.body.style.removeProperty("height");
  }
}

// Re-fetch on focus so pinning from a single-result widget isn't missed. This is
// now the `sync` chrome's effect (mounted per paint, torn down by the scope) — it
// dispatches `reload` → `containerBind` → loadData. No module-level listener.

function paint(): void {
  if (!session) {
    return;
  }
  const { root } = session;
  resetMenus();
  // Tear down the prior paint's chrome effects (e.g. the quota update hook) and
  // start a fresh scope for the chrome mounted below.
  session.scope?.dispose();
  session.scope = createMountScope();
  session.quotaUpdate = undefined;
  root.replaceChildren();
  session.cardEls.clear();

  const shell = document.createElement("section");
  shell.className = "renderer-shell renderer-dashboard";
  shell.dataset.mode = isInteractive(session.displayMode)
    ? "interactive"
    : "compact";

  shell.append(buildHeader());

  const grid = document.createElement("div");
  grid.className = "renderer-dashboard-grid";
  if (session.pins.length === 0) {
    grid.append(buildEmptyState());
  } else {
    for (const pin of session.pins) {
      const wrapper = buildCard(pin);
      session.cardEls.set(pin.pin_id, {
        wrapper,
        signature: cardSignature(session.cards.get(pin.pin_id)),
      });
      grid.append(wrapper);
    }
  }
  shell.append(grid);
  root.append(shell);
}

function buildEmptyState(): HTMLElement {
  const empty = document.createElement("div");
  empty.className = "renderer-dashboard-empty";
  const title = document.createElement("p");
  title.className = "renderer-dashboard-empty-title";
  title.textContent = "No pinned queries yet";
  const hint = document.createElement("p");
  hint.className = "renderer-dashboard-empty-hint";
  hint.textContent =
    "Pin a chart from an analytics result to keep it here and refresh it on demand.";
  empty.append(title, hint);
  return empty;
}

// ---------- Usage header ----------

function buildHeader(): HTMLElement {
  const session_ = session!;
  const container = document.createElement("div");
  container.className = "renderer-dashboard-headerblock";

  // Single bar: title on the left, a right-hand aside holding the action icons
  // and the stacked spend/usage readout (last third of the header).
  const bar = document.createElement("div");
  bar.className = "renderer-dashboard-headerbar";

  const headerText = document.createElement("div");
  headerText.className = "renderer-header-text";
  const eyebrow = document.createElement("span");
  eyebrow.className = "renderer-eyebrow";
  eyebrow.textContent = "dashboard";
  const title = document.createElement("h1");
  title.className = "renderer-title";
  title.textContent = "Pinned analytics";
  headerText.append(eyebrow, title);

  const aside = document.createElement("div");
  aside.className = "renderer-dashboard-headeraside";

  const actions = document.createElement("div");
  actions.className = "renderer-header-actions";

  // Container-scoped chrome (refresh-all today) flows through resolve → binder;
  // eligibility (dashboard + interactive + has pins) is declared in its `select`.
  const containerCtx = buildChromeContext({
    container: "dashboard",
    interactive: isInteractive(session_.displayMode),
    pinCount: session_.pins.length,
    usage: session_.usage,
    namespace: session_.namespace,
  });
  // The container dispatcher: an intent type → local orchestration. Used both for
  // click intents (refresh-all) and effect dispatches (sync's `reload`).
  const containerBind: BindFn = (type) => {
    if (type === "reload") {
      void loadData();
    } else if (type === "refresh-all") {
      void refreshAll();
    }
    return Promise.resolve({});
  };
  // One resolve for the whole container. Actionable/behavior header chrome
  // (refresh-all, sync) mounts into the actions row; `quota` (the spend bar) is
  // mounted into the aside below. Effects run via attachEffect on the scope.
  const resolvedHeader = resolve(CHROMES, containerCtx);
  for (const region of ["header-start", "header-end"] as const) {
    for (const { chrome, slice } of resolvedHeader[region]) {
      if (chrome.id === "quota") {
        continue; // the spend bar is mounted into the aside below
      }
      const view = chrome.render(slice);
      const intent = chrome.intent?.(slice);
      const onActivate = intent
        ? () => {
            void containerBind(intent.type, intent.payload);
          }
        : undefined;
      if (onActivate) {
        view.addEventListener("click", onActivate);
      }
      actions.append(view);
      if (session_.scope) {
        attachEffect(chrome, slice, view, session_.scope, containerBind, onActivate);
      }
    }
  }
  actions.append(buildModeToggle());

  // The spend/usage bar is the `quota` container chrome. It owns its DOM via the
  // effect host returned by attachEffect; the dashboard drives in-place updates
  // through `session.quotaUpdate` (called from reconcile when `usage` changes).
  // The scope's cleanup clears the hook so a stale host can't be updated.
  const quotaEntry = resolvedHeader["header-end"].find(
    (entry) => entry.chrome.id === "quota",
  );
  const usageBar = quotaEntry
    ? quotaEntry.chrome.render(quotaEntry.slice)
    : buildUsageBar(session_.usage);
  aside.append(actions, usageBar);
  if (quotaEntry && session_.scope) {
    const quotaSlice = quotaEntry.slice as QuotaSlice;
    const host = attachEffect(
      quotaEntry.chrome,
      quotaSlice,
      usageBar,
      session_.scope,
    );
    session_.quotaUpdate = (usage) => host.update({ ...quotaSlice, usage });
    session_.scope.addDispose(() => {
      if (session) {
        session.quotaUpdate = undefined;
      }
    });
  }

  bar.append(headerText, aside);
  container.append(bar);
  return container;
}

// ---------- Cards ----------

function cardSignature(card: PinnedQueryCard | undefined): string {
  if (!card) {
    return "skeleton";
  }
  const kind = card.error
    ? "error"
    : card.stale
      ? "stale"
      : card.render_output
        ? "data"
        : "skeleton";
  return `${kind}|${card.refreshed_at ?? ""}|${card.query_id ?? ""}`;
}

function buildCard(pin: PinnedQueryMeta): HTMLElement {
  const wrapper = document.createElement("article");
  wrapper.className = "renderer-dashboard-card";
  wrapper.dataset.pinId = pin.pin_id;

  const staticPin = isStaticPin(pin);
  const interactive = isInteractive(session?.displayMode);

  // Width applies only on the fullscreen 12-col grid; compact is single-column.
  if (interactive) {
    wrapper.style.gridColumn = `span ${clampSpan(pin.span)}`;
  }

  const header = document.createElement("div");
  header.className = "renderer-dashboard-card-header";

  const title = document.createElement("h2");
  title.className = "renderer-dashboard-card-title";
  title.textContent = pin.title; // textContent only — never innerHTML
  // Live pins get an inline click-to-edit title (rename → PATCH). Static/snapshot
  // titles stay read-only (no durable row to persist to) — same gating as resize.
  // A sandboxed webview blocks window.prompt, so the editor is an in-DOM input.
  if (interactive && !staticPin && Boolean(session?.bridge.callServerTool)) {
    title.classList.add("renderer-dashboard-card-title-editable");
    title.title = "Click to rename";
    // Expose the same rename affordance to keyboard/AT users the pointer gets:
    // make the <h2> a focusable button and open the editor on Enter/Space (the
    // resize items are native <button>s and already keyboard-operable).
    title.tabIndex = 0;
    title.setAttribute("role", "button");
    title.addEventListener("click", () => beginTitleEdit(pin, title));
    title.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault(); // Space would otherwise scroll the page
        beginTitleEdit(pin, title);
      }
    });
  }
  header.append(title);

  // Static pins are snapshots — flag them with a badge.
  if (staticPin) {
    const badge = document.createElement("span");
    badge.className = "renderer-dashboard-card-snapshot";
    badge.textContent = "Snapshot";
    header.append(badge);
  }

  // Manage affordances live in fullscreen only. Refresh is a primary icon
  // (static pins re-render their inline snapshot in place; live pins re-run
  // server-side); destructive/secondary actions hide behind a kebab menu so a
  // stray click can't remove a pin, and so it can host a future Configure.
  if (interactive) {
    const tools = document.createElement("div");
    tools.className = "renderer-dashboard-card-tools";
    // ONE resolve for the whole card. Primary chrome (refresh) mounts into the
    // tool row; overflow chrome (Remove) is hosted by the kebab. Eligibility and
    // placement live on each chrome's `select`/`region` — not hardcoded here.
    // Refresh is dual-mode: live → refreshOne (server), static → rerenderCard.
    const resolved = resolve(CHROMES, cardChromeContext(pin));
    // Only the header (tool-row) regions mount here; overflow goes to the kebab
    // below, and FOOTER notes (e.g. "source: inline" for a static/direct pin)
    // belong to the card *body* — mountShell renders them there, not in the tools.
    for (const region of ["header-start", "header-end"] as const) {
      for (const { chrome, slice } of resolved[region]) {
        const view = chrome.render(slice);
        if (chrome.id === "refresh") {
          const canRefresh = (slice as RefreshSlice).canRefresh;
          view.addEventListener("click", () => {
            if (canRefresh) {
              void refreshOne(pin);
            } else {
              rerenderCard(pin);
            }
          });
        }
        tools.append(view);
      }
    }
    const kebab = buildOverflowMenu(resolved.overflow, (entry) => {
      if (entry.chrome.id === "remove") {
        void removeOne(pin);
        return;
      }
      // grow/shrink: the chrome's `update` intent carries the clamped target span
      // — the single source of truth for the ±1 step + bound math; resizeOne just
      // applies it optimistically. (Dispatching by intent, not by id, keeps that
      // math in one place instead of re-deriving the delta here.)
      const intent = entry.chrome.intent?.(entry.slice);
      const targetSpan =
        intent?.type === "update" ? intent.payload?.span : undefined;
      if (typeof targetSpan === "number") {
        void resizeOne(pin, targetSpan);
      }
    });
    if (kebab) {
      tools.append(kebab);
    }
    header.append(tools);
  }
  wrapper.append(header);

  if (pin.moving_window) {
    const note = document.createElement("p");
    note.className = "renderer-dashboard-card-note";
    note.textContent =
      "Moving-window query — re-scans a sliding range on every refresh.";
    wrapper.append(note);
  }

  const body = document.createElement("div");
  body.className = "renderer-dashboard-card-body";
  renderCardBody(body, session?.cards.get(pin.pin_id));
  wrapper.append(body);

  if (pin.sql) {
    wrapper.append(buildSqlPeek(pin.sql));
  }
  return wrapper;
}

/** Render the body for one card — every branch isolated; a poison pill never blanks the grid. */
function renderCardBody(
  body: HTMLElement,
  card: PinnedQueryCard | undefined,
): void {
  body.replaceChildren();
  // data-kind lets the CSS fit charts/metrics to the tile while letting tables
  // scroll inside it (set per render below; "status" for loading/stale/error).
  body.dataset.kind = "status";

  if (!card) {
    body.append(buildCardStatus("Loading…", "loading"));
    return;
  }
  if (card.error) {
    body.append(buildCardStatus(card.error, "error"));
    return;
  }
  if (card.stale || !card.render_output) {
    body.append(
      buildCardStatus(
        isInteractive(session?.displayMode)
          ? "No cached result — click Refresh to run this query."
          : "No cached result — open fullscreen and refresh.",
        "stale",
      ),
    );
    return;
  }

  try {
    // Defense in depth: re-validate the opaque render_output in the bundle
    // before handing it to a view. A failure is contained to this card.
    const output = RenderOutputSchema.parse(card.render_output);
    body.dataset.kind = output.chart_type;
    renderResolvedOutput(body, output);
  } catch (error) {
    // A view that threw mid-render may have already mounted a partial shell —
    // clear it so the error reads as the card's whole (centered) content.
    body.dataset.kind = "status";
    body.replaceChildren(
      buildCardStatus(
        `Could not render this pin: ${error instanceof Error ? error.message : String(error)}`,
        "error",
      ),
    );
  }
}

/**
 * Dispatch a resolved single-result RenderOutput into its matching view. Shared
 * by the dashboard (pinned card body) and the app-shell (top-level result) so
 * the table/metric/chart routing lives in one place. Container types
 * (text_editor, dashboard) are handled by callers before this is reached.
 */
export function renderResolvedOutput(
  container: HTMLElement,
  output: RenderOutput,
): void {
  if (output.chart_type === "table") {
    renderTable(container, output);
    return;
  }
  if (output.chart_type === "metric") {
    renderMetric(container, output);
    return;
  }
  if (
    output.chart_type === "text_editor" ||
    output.chart_type === "dashboard"
  ) {
    throw new Error(
      `Unsupported single-result render type: ${output.chart_type}`,
    );
  }
  renderChart(container, output);
}

function buildCardStatus(message: string, state: string): HTMLElement {
  const el = document.createElement("p");
  el.className = "renderer-dashboard-card-status";
  el.dataset.state = state;
  el.textContent = message;
  return el;
}

function buildSqlPeek(sql: string): HTMLElement {
  const details = document.createElement("details");
  details.className = "renderer-dashboard-card-sql";
  const summary = document.createElement("summary");
  summary.textContent = "SQL";
  details.append(summary);
  const pre = document.createElement("pre");
  const code = document.createElement("code");
  code.textContent = sql; // textContent — never interpret stored SQL as markup
  pre.append(code);
  details.append(pre);
  return details;
}

/** Re-draw a card body in place from the rows already held — a static "refresh". */
function rerenderCard(pin: PinnedQueryMeta): void {
  const body = cardBody(pin.pin_id);
  if (body) {
    renderCardBody(body, session?.cards.get(pin.pin_id));
  }
}

// Only one card menu is open at a time; outside-click / Escape close it.
let openMenuEl: HTMLElement | null = null;

function onDocClickClose(event: Event): void {
  if (openMenuEl && !openMenuEl.contains(event.target as Node)) {
    closeMenu(openMenuEl);
  }
}

function onMenuKey(event: KeyboardEvent): void {
  if (event.key === "Escape" && openMenuEl) {
    closeMenu(openMenuEl);
  }
}

function openMenu(container: HTMLElement): void {
  if (openMenuEl && openMenuEl !== container) {
    closeMenu(openMenuEl);
  }
  container.classList.add("open");
  container
    .querySelector(".renderer-dashboard-card-menu-btn")
    ?.setAttribute("aria-expanded", "true");
  openMenuEl = container;
  // Defer so the click that opened the menu doesn't immediately close it.
  setTimeout(() => {
    document.addEventListener("click", onDocClickClose);
    document.addEventListener("keydown", onMenuKey);
  }, 0);
}

function closeMenu(container: HTMLElement): void {
  container.classList.remove("open");
  container
    .querySelector(".renderer-dashboard-card-menu-btn")
    ?.setAttribute("aria-expanded", "false");
  if (openMenuEl === container) {
    openMenuEl = null;
  }
  document.removeEventListener("click", onDocClickClose);
  document.removeEventListener("keydown", onMenuKey);
}

/** Drop any open menu + its listeners (called before a repaint rebuilds cards). */
function resetMenus(): void {
  if (openMenuEl) {
    closeMenu(openMenuEl);
  }
}

/**
 * The chrome context for one dashboard card — shared by all card-scoped chrome.
 * The provider fragment is derived from the pin: a static (snapshot) pin maps to
 * `direct` (not refreshable), a live pin to `facade` (refreshable, carries SQL).
 */
function cardChromeContext(pin: PinnedQueryMeta): ChromeContext {
  return buildChromeContext({
    container: "dashboard-card",
    pin: { pinId: pin.pin_id, span: pin.span },
    dataSource: isStaticPin(pin) ? DIRECT_DATA_SOURCE : "facade",
    sql: pin.sql,
    interactive: isInteractive(session?.displayMode),
    permissions: { canManagePins: Boolean(session?.bridge.callServerTool) },
  });
}

/**
 * A kebab (⋮) dropdown that HOSTS the `overflow` region — the generic collapse
 * target. The mount layer (buildCard) passes the resolved overflow entries; this
 * renders each into the menu and wires `onActivate` (the menu closes on activation).
 * Returns null when nothing overflows, so an empty kebab never shows. The open/
 * close machinery (single-open, outside-click, Escape) lives in this module.
 */
function buildOverflowMenu(
  entries: ResolvedChrome[],
  onActivate: (entry: ResolvedChrome) => void,
): HTMLElement | null {
  if (entries.length === 0) {
    return null;
  }
  const container = document.createElement("div");
  container.className = "renderer-dashboard-card-menu";

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className =
    "renderer-dashboard-iconbtn renderer-dashboard-card-menu-btn";
  toggle.title = "More actions";
  toggle.setAttribute("aria-label", "More actions");
  toggle.setAttribute("aria-haspopup", "true");
  toggle.setAttribute("aria-expanded", "false");
  toggle.appendChild(ICONS.kebab());
  toggle.addEventListener("click", (event) => {
    event.stopPropagation();
    if (container.classList.contains("open")) {
      closeMenu(container);
    } else {
      openMenu(container);
    }
  });

  const menu = document.createElement("div");
  menu.className = "renderer-dashboard-card-menu-list";
  menu.setAttribute("role", "menu");

  for (const entry of entries) {
    const item = entry.chrome.render(entry.slice);
    item.addEventListener("click", () => {
      closeMenu(container);
      onActivate(entry);
    });
    menu.append(item);
  }

  container.append(toggle, menu);
  return container;
}

function buildModeToggle(): HTMLElement | Text {
  const session_ = session!;
  const available = session_.bridge.getHostContext?.()?.availableDisplayModes;
  if (!session_.bridge.requestDisplayMode || !available) {
    return document.createTextNode("");
  }
  const interactive = isInteractive(session_.displayMode);
  const target: McpUiDisplayMode = interactive ? "inline" : "fullscreen";
  if (!available.includes(target)) {
    return document.createTextNode("");
  }
  return iconButton(
    interactive ? "Exit fullscreen" : "Fullscreen",
    "renderer-dashboard-mode-toggle",
    interactive ? ICONS.minimize() : ICONS.maximize(),
    async () => {
      try {
        const result = await session_.bridge.requestDisplayMode?.({
          mode: target,
        });
        refreshDashboardMode(
          result?.mode ??
            session_.bridge.getHostContext?.()?.displayMode ??
            target,
        );
      } catch (error) {
        // The host rejected the display-mode change (or can't honor it) — leave
        // the current mode as-is, but log so a genuine bridge fault isn't hidden.
        console.warn("dashboard: requestDisplayMode failed", error);
      }
    },
  );
}

// ---------- Data flow (callServerTool) ----------

/** Self-load via the app-only `load_dashboard` tool. Offline-tolerant. */
async function loadData(): Promise<void> {
  const session_ = session;
  if (!session_ || session_.loading || !session_.bridge.callServerTool) {
    return;
  }
  session_.loading = true;
  try {
    const result = await session_.bridge.callServerTool({
      name: "load_dashboard",
      arguments: {
        pins: pinsToInput(session_.pins),
        namespace: session_.namespace,
      },
    });
    if (result.isError) {
      handleLoadError(result);
      return;
    }
    const data = DashboardDataSchema.parse(result.structuredContent);
    applyLoadedData(data);
    // A non-fatal server-side degradation (e.g. the pin store errored and the
    // board fell back to model-held pins) rides along as a notice — surface it
    // without blanking the freshly-loaded cards.
    if (data.notice) {
      showReconnectHint(data.notice);
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      // A parse failure is a server↔widget contract bug, not a network blip —
      // log it so it's diagnosable instead of masquerading as "unreachable".
      console.error("load_dashboard returned an unexpected shape", error);
      showReconnectHint(
        "Got an unexpected response from the server — showing the last known layout.",
      );
    } else {
      // Server unreachable: keep the metadata paint, surface a non-destructive
      // reconnect hint rather than a blank or error wall.
      showReconnectHint(
        "Couldn't reach the server — showing the last known layout.",
      );
    }
  } finally {
    if (session) {
      session.loading = false;
    }
  }
}

/** Re-fetch only the spend/usage snapshot (cheap; no pin re-resolve, no SQL re-run). */
async function refreshUsage(): Promise<void> {
  const session_ = session;
  if (!session_?.bridge.callServerTool) {
    return;
  }
  try {
    const result = await createDashboardBinder(session_.bridge).quotaRefresh({
      namespace: session_.namespace,
    });
    if (result.isError || !session) {
      return;
    }
    session.usage = QuotaUsageSchema.parse(result.structuredContent);
    reconcile();
  } catch (error) {
    // Usage is best-effort — keep the last-known header in place. Log either way
    // so a silently frozen header stays diagnosable: a ZodError means the upstream
    // usage shape drifted; anything else is a transport/host failure.
    if (error instanceof z.ZodError) {
      console.error("get_quota_usage returned an unexpected shape", error);
    } else {
      console.warn("get_quota_usage refresh failed", error);
    }
  }
}

function applyLoadedData(data: {
  usage?: QuotaUsage;
  pins: PinnedQueryCard[];
}): void {
  if (!session) {
    return;
  }
  session.usage = data.usage ?? session.usage;
  session.cards = new Map(data.pins.map((card) => [card.pin_id, card]));

  // Always re-sync the metadata list to the loaded set so cards render in the
  // right order/titles — and so an authoritative empty result (everything
  // unpinned elsewhere) clears to the empty state instead of stranding
  // never-resolving skeletons. A failed load throws before reaching here, so
  // this never wipes pins on a transient error.
  session.pins = data.pins.map((card) => cardToMeta(card)).sort(byPosition);
  reconcile();
}

/** Incrementally update only changed card bodies + the usage bar. */
function reconcile(): void {
  const s = session;
  if (!s) {
    return;
  }
  const scroller = s.root.querySelector<HTMLElement>(
    ".renderer-dashboard-grid",
  );
  const scrollTop = scroller?.scrollTop ?? 0;

  // Usage bar: the quota chrome owns its DOM — push the latest snapshot through
  // its effect host (re-renders in place). Fall back to a direct swap if the
  // chrome isn't mounted (e.g. transient pre-paint reconcile).
  if (s.quotaUpdate) {
    s.quotaUpdate(s.usage);
  } else {
    const oldBar = s.root.querySelector(".renderer-usage-bar");
    oldBar?.replaceWith(buildUsageBar(s.usage));
  }

  // Cards: if the set/order changed materially, repaint; else update bodies.
  const sameSet =
    s.pins.length === s.cardEls.size &&
    s.pins.every((pin) => s.cardEls.has(pin.pin_id));
  if (!sameSet) {
    paint();
  } else {
    for (const pin of s.pins) {
      const entry = s.cardEls.get(pin.pin_id);
      if (!entry) {
        continue;
      }
      const nextSig = cardSignature(s.cards.get(pin.pin_id));
      if (nextSig !== entry.signature) {
        const body = entry.wrapper.querySelector<HTMLElement>(
          ".renderer-dashboard-card-body",
        );
        if (body) {
          renderCardBody(body, s.cards.get(pin.pin_id));
        }
        entry.signature = nextSig;
      }
    }
  }

  // Re-query: a !sameSet repaint replaces the grid node, detaching the
  // `scroller` captured above — restore scroll on whatever node is live now.
  const liveScroller = s.root.querySelector<HTMLElement>(
    ".renderer-dashboard-grid",
  );
  if (liveScroller) {
    liveScroller.scrollTop = scrollTop;
  }
}

async function refreshOne(pin: PinnedQueryMeta): Promise<void> {
  const session_ = session;
  if (!session_?.bridge.callServerTool) {
    return;
  }
  // Hold the shared load guard so a focus-triggered self-reload can't race this
  // refresh and reconcile against a half-updated card set.
  session_.loading = true;
  setCardLoading(pin.pin_id);
  try {
    const result = await createDashboardBinder(session_.bridge).refresh({
      pin_id: pin.pin_id,
      render_tool: pin.render_tool,
      render_options: pin.render_options,
      title: pin.title,
      sql: pin.sql,
      namespace: session_.namespace,
    });
    if (result.isError) {
      setCardError(pin.pin_id, errorText(result));
      return;
    }
    const data = DashboardDataSchema.parse(result.structuredContent);
    mergeCards(data);
  } catch (error) {
    setCardError(
      pin.pin_id,
      error instanceof Error ? error.message : String(error),
    );
  } finally {
    if (session) {
      session.loading = false;
    }
  }
}

/** Rebuild one card's wrapper in place — fresh gridColumn + kebab bound-state + body. */
function rebuildCardEl(pin: PinnedQueryMeta): void {
  const s = session;
  if (!s) {
    return;
  }
  const entry = s.cardEls.get(pin.pin_id);
  if (!entry) {
    return;
  }
  resetMenus(); // drop any open menu + its listeners before detaching the node
  const next = buildCard(pin);
  entry.wrapper.replaceWith(next);
  s.cardEls.set(pin.pin_id, {
    wrapper: next,
    signature: cardSignature(s.cards.get(pin.pin_id)),
  });
}

/**
 * Step a pin's grid width to `nextSpan` and persist it (`update_pinned_query` →
 * PATCH). Optimistic: apply locally + rebuild the card (new width, refreshed
 * "Wider"/"Narrower" bound-state) before the round-trip. On failure roll back and
 * surface a non-destructive header hint — NOT `setCardError`: a metadata write
 * must not blank the chart (unlike a data refresh). On success reconcile to the
 * server's authoritative width. Only reachable for live pins (the resize chromes
 * gate off static pins).
 */
async function resizeOne(pin: PinnedQueryMeta, nextSpan: number): Promise<void> {
  const session_ = session;
  if (!session_?.bridge.callServerTool) {
    return;
  }
  const prev = clampSpan(pin.span);
  const next = clampSpan(nextSpan);
  if (next === prev) {
    return; // at a bound / no change — no-op (also defends a stale-enabled item)
  }
  // Entry-gate: `refreshOne` only sets `loading`, it doesn't gate its own entry,
  // so our edits must bail while any load/refresh/edit is in flight — otherwise a
  // resize can interleave with a focus-reload or a concurrent refresh. Tell the
  // user instead of dropping the click silently.
  if (session_.loading) {
    showReconnectHint("Dashboard is busy — try resizing again in a moment.");
    return;
  }
  session_.loading = true;
  pin.span = next;
  rebuildCardEl(pin);
  try {
    const result = await createDashboardBinder(session_.bridge).update({
      pin_id: pin.pin_id,
      span: next,
      namespace: session_.namespace,
    });
    if (result.isError) {
      pin.span = prev;
      rebuildCardEl(pin);
      showReconnectHint(
        `Couldn't resize "${pin.title}" — reverted. ${errorText(result)}`,
      );
      return;
    }
    // Reconcile to the server's authoritative width (it clamps too, so this is a
    // no-op today — but don't trust the optimistic guess over the response).
    const serverSpan = spanFromResult(result);
    if (serverSpan !== null && serverSpan !== pin.span) {
      pin.span = serverSpan;
      rebuildCardEl(pin);
    }
  } catch (error) {
    pin.span = prev;
    rebuildCardEl(pin);
    showReconnectHint(
      `Couldn't resize "${pin.title}" — reverted. ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  } finally {
    if (session) {
      session.loading = false;
    }
  }
}

/** Set a pin's title on the session model + its card label (textContent — never innerHTML). */
function applyTitle(pin: PinnedQueryMeta, title: string): void {
  pin.title = title;
  const el = session?.cardEls
    .get(pin.pin_id)
    ?.wrapper.querySelector<HTMLElement>(".renderer-dashboard-card-title");
  if (el) {
    el.textContent = title;
  }
}

/**
 * Rename a pin and persist it (`update_pinned_query` → PATCH). Trims; a blank or
 * unchanged title is a no-op. Optimistic; on failure roll back and surface a
 * non-destructive header hint (the chart body is untouched). On success reconcile
 * to the server's authoritative title. Live pins only. The `session.loading`
 * check here is a backstop — `beginTitleEdit`'s commit gates first so a busy
 * commit keeps the editor open instead of dropping the typed text.
 */
async function renameOne(pin: PinnedQueryMeta, rawTitle: string): Promise<void> {
  const session_ = session;
  if (!session_?.bridge.callServerTool) {
    return;
  }
  const next = rawTitle.trim();
  const prev = pin.title;
  if (!next || next === prev) {
    return;
  }
  if (session_.loading) {
    return; // backstop; beginTitleEdit's commit is the user-facing gate
  }
  session_.loading = true;
  applyTitle(pin, next);
  try {
    const result = await createDashboardBinder(session_.bridge).update({
      pin_id: pin.pin_id,
      title: next,
      namespace: session_.namespace,
    });
    if (result.isError) {
      applyTitle(pin, prev);
      showReconnectHint(
        `Couldn't rename "${prev}" — reverted. ${errorText(result)}`,
      );
      return;
    }
    // Reconcile to the server's authoritative (trimmed) title.
    const serverTitle = titleFromResult(result);
    if (serverTitle !== null && serverTitle !== pin.title) {
      applyTitle(pin, serverTitle);
    }
  } catch (error) {
    applyTitle(pin, prev);
    showReconnectHint(
      `Couldn't rename "${prev}" — reverted. ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  } finally {
    if (session) {
      session.loading = false;
    }
  }
}

/**
 * Swap a card's title <h2> for a text input seeded with the current title; commit
 * on Enter/blur, cancel on Escape. A blank/unchanged value just restores the label
 * (no write). Commit runs `renameOne` (optimistic + PATCH). The input value is read
 * back via `textContent`, never `innerHTML` (stored-XSS defense — see
 * ARCHITECTURE.md "Abuse resistance").
 */
function beginTitleEdit(pin: PinnedQueryMeta, titleEl: HTMLElement): void {
  const input = document.createElement("input");
  input.type = "text";
  input.className = "renderer-dashboard-card-title-input";
  input.value = pin.title;
  input.setAttribute("aria-label", "Card title");

  let settled = false;
  const restore = (): void => {
    titleEl.textContent = pin.title; // reflect current (committed or unchanged) title
    if (input.parentNode) {
      input.replaceWith(titleEl);
    }
  };
  const commit = (): void => {
    if (settled) {
      return; // Enter commits, then blur fires — act once
    }
    // A load/refresh in flight would make renameOne's entry-gate drop the edit
    // and lose the typed text. Keep the editor open (text preserved) and tell the
    // user to retry, rather than silently reverting the label.
    if (session?.loading) {
      showReconnectHint("Dashboard is busy — press Enter again in a moment.");
      return;
    }
    settled = true;
    const next = input.value;
    restore();
    void renameOne(pin, next);
  };
  const cancel = (): void => {
    if (settled) {
      return;
    }
    settled = true;
    restore();
  };

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commit();
    } else if (event.key === "Escape") {
      event.preventDefault();
      cancel();
    }
  });
  input.addEventListener("blur", commit);

  titleEl.replaceWith(input);
  input.focus();
  input.select();
}

async function refreshAll(): Promise<void> {
  const session_ = session;
  if (!session_?.bridge.callServerTool || session_.pins.length === 0) {
    return;
  }
  // Cost confirmation is binder middleware, not a button property (plan §2): the
  // wrapped action — hold the load guard, mark cards loading, then re-run — runs
  // only if the budget gate is confirmed; declining short-circuits to Cancelled.
  let started = false;
  const run = withCostConfirm(
    () => confirmRefreshAll(session_.pins, session_.cards),
    (payload) => {
      started = true;
      // Hold the shared load guard so a focus self-reload can't race the refresh.
      session_.loading = true;
      for (const pin of session_.pins) {
        setCardLoading(pin.pin_id);
      }
      return createDashboardBinder(session_.bridge).refreshAll(payload);
    },
  );
  try {
    const result = await run({
      pins: pinsToInput(session_.pins),
      namespace: session_.namespace,
    });
    if (isCancelled(result)) {
      return;
    }
    if (result.isError) {
      showReconnectHint(errorText(result));
      return;
    }
    mergeCards(DashboardDataSchema.parse(result.structuredContent));
  } catch (error) {
    showReconnectHint(error instanceof Error ? error.message : String(error));
  } finally {
    if (started && session) {
      session.loading = false;
    }
  }
}

async function removeOne(pin: PinnedQueryMeta): Promise<void> {
  const session_ = session;
  if (!session_) {
    return;
  }
  // Persist the removal when a store is available; for model-held pins (or when
  // the store is unavailable) just drop locally and tell the model.
  if (session_.bridge.callServerTool && !pin.pin_id.startsWith("mh-")) {
    try {
      const result = await createDashboardBinder(session_.bridge).remove({
        pin_id: pin.pin_id,
        namespace: session_.namespace,
      });
      const code = resultCode(result);
      // NOT_FOUND is idempotent success (the pin is already gone). Anything else
      // — including PINNED_QUERIES_UNAVAILABLE — means the removal did NOT happen
      // server-side: don't drop the card and tell the model it's gone, or it
      // would reappear on the next store-backed load (a phantom delete).
      if (result.isError && code !== "NOT_FOUND") {
        setCardError(
          pin.pin_id,
          code === "PINNED_QUERIES_UNAVAILABLE"
            ? "Removing pins isn't enabled in this deployment yet."
            : errorText(result),
        );
        return;
      }
    } catch (error) {
      setCardError(
        pin.pin_id,
        error instanceof Error ? error.message : String(error),
      );
      return;
    }
  }
  dropPinLocally(pin.pin_id);
  void session_.bridge.updateModelContext?.({
    content: [
      {
        type: "text",
        text: `The user removed the pinned query "${pin.title}" from the dashboard.`,
      },
    ],
  });
}

// ---------- Card-state mutators ----------

function setCardLoading(pinId: string): void {
  const body = cardBody(pinId);
  if (body) {
    body.replaceChildren(buildCardStatus("Refreshing…", "loading"));
  }
  // Invalidate the cached signature so the next reconcile() always re-renders
  // this card once data arrives. Otherwise a pin whose card object is unchanged
  // (e.g. a quota-stopped refresh-all that returns only a subset) would match
  // its old signature and stay stuck on "Refreshing…".
  const entry = session?.cardEls.get(pinId);
  if (entry) {
    entry.signature = `loading|${pinId}`;
  }
}

function setCardError(pinId: string, message: string): void {
  const body = cardBody(pinId);
  if (body) {
    body.replaceChildren(buildCardStatus(message, "error"));
  }
  const entry = session?.cardEls.get(pinId);
  if (entry) {
    entry.signature = `error|${message}`;
  }
}

function mergeCards(data: {
  usage?: QuotaUsage;
  pins: PinnedQueryCard[];
}): void {
  if (!session) {
    return;
  }
  if (data.usage) {
    session.usage = data.usage;
  }
  for (const card of data.pins) {
    session.cards.set(card.pin_id, card);
  }
  reconcile();
}

function dropPinLocally(pinId: string): void {
  if (!session) {
    return;
  }
  session.pins = session.pins.filter((pin) => pin.pin_id !== pinId);
  session.cards.delete(pinId);
  paint();
}

function cardBody(pinId: string): HTMLElement | null {
  return (
    session?.cardEls
      .get(pinId)
      ?.wrapper.querySelector<HTMLElement>(".renderer-dashboard-card-body") ??
    null
  );
}

/** Read the `code` string from a tool result's `_meta`, or "" when absent. */
function resultCode(result: { _meta?: Record<string, unknown> }): string {
  return result._meta && typeof result._meta === "object"
    ? String((result._meta as { code?: string }).code ?? "")
    : "";
}

/** Authoritative span from an `update_pinned_query` result's record (clamped), or null. */
function spanFromResult(result: { structuredContent?: unknown }): number | null {
  const sc = result.structuredContent as { span?: unknown } | undefined;
  return typeof sc?.span === "number" ? clampSpan(sc.span) : null;
}

/** Authoritative (non-empty) title from an `update_pinned_query` result's record, or null. */
function titleFromResult(result: { structuredContent?: unknown }): string | null {
  const sc = result.structuredContent as { title?: unknown } | undefined;
  return typeof sc?.title === "string" && sc.title.length > 0 ? sc.title : null;
}

function handleLoadError(result: {
  _meta?: Record<string, unknown>;
  content?: Array<{ type?: string; text?: string }>;
}): void {
  const code = resultCode(result);
  const isAuth =
    /401|unauthor|HTTP_401/i.test(code) ||
    /401|unauthor/i.test(errorText(result));
  // A bad-request error (e.g. no namespace in the request context) is
  // deterministic — retrying on the next focus can't fix it, so surface the
  // reason instead of the misleading "it will retry" hint.
  const isConfig = /INVALID_ARGUMENT|HTTP_400/i.test(code);
  showReconnectHint(
    isAuth
      ? "Your session expired — re-authenticate to load the dashboard."
      : isConfig
        ? `Dashboard can't load: ${errorText(result)}`
        : "Couldn't load dashboard data. It will retry when you return to this view.",
  );
}

function showReconnectHint(message: string): void {
  if (!session) {
    return;
  }
  const headerblock = session.root.querySelector(
    ".renderer-dashboard-headerblock",
  );
  if (!headerblock) {
    return;
  }
  let hint = headerblock.querySelector<HTMLElement>(".renderer-dashboard-hint");
  if (!hint) {
    hint = document.createElement("p");
    hint.className = "renderer-dashboard-hint";
    headerblock.append(hint);
  }
  hint.textContent = message;
}

function errorText(result: {
  content?: Array<{ type?: string; text?: string }>;
}): string {
  const text = result.content?.find(
    (item) => item.type === "text" && typeof item.text === "string",
  );
  return text?.text ?? "Something went wrong.";
}

/** Confirm a refresh-all, surfacing the last-known scan estimate (denial-of-wallet gate). */
function confirmRefreshAll(
  pins: PinnedQueryMeta[],
  cards: Map<string, PinnedQueryCard>,
): Promise<boolean> {
  let totalBytes = 0;
  for (const pin of pins) {
    const output = cards.get(pin.pin_id)?.render_output as
      | { stats?: { data_scanned_bytes?: number } }
      | undefined;
    totalBytes += output?.stats?.data_scanned_bytes ?? 0;
  }
  const estimate =
    totalBytes > 0 ? ` (last run scanned ~${formatBytes(totalBytes)})` : "";
  return confirmInDom(
    `Re-run all ${pins.length} pinned ${pins.length === 1 ? "query" : "queries"}? This scans billable bytes${estimate}.`,
  );
}

/**
 * In-DOM confirmation that resolves on an explicit user click. Replaces
 * `window.confirm`: sandboxed webview hosts (VS Code, MCP-UI iframes) block
 * native modals, so `confirm()` returns false and is ignored — a native dialog
 * would silently deny every refresh-all. Mounted on `document.body` so a focus
 * repaint of the dashboard can't orphan it mid-prompt. Only the Re-run button
 * resolves true; Cancel, Escape, and a backdrop click resolve false. Denies
 * (resolves false) when there's no DOM to prompt in (SSR/test) — a billable
 * gate fails safe rather than auto-confirming; the server quota cap is a
 * backstop, not a reason to skip the gate.
 */
function confirmInDom(message: string): Promise<boolean> {
  if (typeof document === "undefined") {
    return Promise.resolve(false);
  }
  // One gate at a time — drop any stale dialog before opening a new one.
  document.querySelector(".renderer-dashboard-confirm")?.remove();

  return new Promise<boolean>((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "renderer-dashboard-confirm";

    const box = document.createElement("div");
    box.className = "renderer-dashboard-confirm-box";
    box.setAttribute("role", "alertdialog");
    box.setAttribute("aria-modal", "true");
    box.setAttribute("aria-describedby", "renderer-dashboard-confirm-text");

    const text = document.createElement("p");
    text.id = "renderer-dashboard-confirm-text";
    text.className = "renderer-dashboard-confirm-text";
    text.textContent = message;

    const actions = document.createElement("div");
    actions.className = "renderer-dashboard-confirm-actions";

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "renderer-dashboard-confirm-cancel";
    cancelBtn.textContent = "Cancel";

    const okBtn = document.createElement("button");
    okBtn.type = "button";
    okBtn.className = "renderer-dashboard-confirm-ok";
    okBtn.textContent = "Re-run";

    let settled = false;
    function onKey(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        close(false);
      }
    }
    function close(result: boolean): void {
      if (settled) {
        return;
      }
      settled = true;
      document.removeEventListener("keydown", onKey);
      overlay.remove();
      resolve(result);
    }

    cancelBtn.addEventListener("click", () => close(false));
    okBtn.addEventListener("click", () => close(true));
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) {
        close(false);
      }
    });
    document.addEventListener("keydown", onKey);

    actions.append(cancelBtn, okBtn);
    box.append(text, actions);
    overlay.append(box);
    document.body.append(overlay);
    // Default focus on Cancel — the safe choice for a billable action.
    cancelBtn.focus();
  });
}

function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(value >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

// ---------- Pin <-> input/meta mapping ----------

function pinsToInput(pins: PinnedQueryMeta[]): Array<Record<string, unknown>> {
  return pins.map((pin) => ({
    pin_id: pin.pin_id,
    title: pin.title,
    sql: pin.sql,
    query_id: pin.query_id ?? undefined,
    render_tool: pin.render_tool,
    render_options: pin.render_options,
    position: pin.position,
    refreshed_at: pin.refreshed_at ?? undefined,
    // Carry static-pin rows + width so a self-load round-trips the snapshot.
    data_columns: pin.data_columns,
    data_rows: pin.data_rows,
    span: pin.span,
  }));
}

function cardToMeta(card: PinnedQueryCard): PinnedQueryMeta {
  return {
    pin_id: card.pin_id,
    title: card.title,
    sql: card.sql,
    query_id: card.query_id ?? undefined,
    render_tool: card.render_tool,
    render_options: card.render_options,
    position: card.position,
    refreshed_at: card.refreshed_at ?? undefined,
    moving_window: card.moving_window,
    stale: card.stale,
    // Preserve the snapshot rows + width across reloads (don't drop to stale).
    data_columns: card.data_columns,
    data_rows: card.data_rows,
    span: card.span,
  };
}
