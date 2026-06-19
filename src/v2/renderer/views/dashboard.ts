// Copyright (c) 2025 AccelByte Inc. All Rights Reserved.
// This is licensed software from AccelByte Inc, for limitations
// and restrictions contact your company contract manager.

import { z } from "zod/v3";

import type {
  McpUiDisplayMode,
  McpUiHostCapabilities,
  McpUiHostContext,
} from "@modelcontextprotocol/ext-apps";

import {
  DashboardDataSchema,
  QuotaUsageSchema,
  RenderOutputSchema,
  type DashboardOutput,
  type PinnedQueryCard,
  type PinnedQueryMeta,
  type QuotaUsage,
  type RenderOutput,
} from "../../shared/render-schemas.js";
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

/** A pin is static (a snapshot) when it carries its rows inline. */
function isStaticPin(pin: PinnedQueryMeta): boolean {
  // Empty arrays are truthy — require columns so empty arrays don't read as a
  // snapshot (mirrors the server-side check).
  return (
    Array.isArray(pin.data_columns) &&
    pin.data_columns.length > 0 &&
    Array.isArray(pin.data_rows)
  );
}

/** Resolve a span to the 12-col grid: 1–12 honored, >12 → 12, invalid → 4. */
function clampSpan(span: number | undefined): number {
  if (typeof span !== "number" || !Number.isFinite(span) || span < 1) {
    return 4;
  }
  return Math.min(12, Math.floor(span));
}

const SVG_NS = "http://www.w3.org/2000/svg";

/** Build an inline (CSP-safe) stroke icon from one or more SVG path `d` values. */
function strokeIcon(paths: string[]): SVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  for (const d of paths) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    svg.appendChild(path);
  }
  return svg;
}

/** Feather-style icon set used by the dashboard chrome (stroke paths / filled dots). */
const ICONS = {
  refresh: (): SVGElement =>
    strokeIcon([
      "M23 4v6h-6",
      "M1 20v-6h6",
      "M3.51 9a9 9 0 0 1 14.85-3.36L23 10",
      "M20.49 15a9 9 0 0 1-14.85 3.36L1 14",
    ]),
  maximize: (): SVGElement =>
    strokeIcon([
      "M8 3H5a2 2 0 0 0-2 2v3",
      "M21 8V5a2 2 0 0 0-2-2h-3",
      "M3 16v3a2 2 0 0 0 2 2h3",
      "M16 21h3a2 2 0 0 0 2-2v-3",
    ]),
  minimize: (): SVGElement =>
    strokeIcon([
      "M8 3v3a2 2 0 0 1-2 2H3",
      "M21 8h-3a2 2 0 0 1-2-2V3",
      "M3 16h3a2 2 0 0 1 2 2v3",
      "M16 21v-3a2 2 0 0 1 2-2h3",
    ]),
  trash: (): SVGElement =>
    strokeIcon([
      "M3 6h18",
      "M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2",
      "M6 6l1 14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-14",
    ]),
  kebab: (): SVGElement => {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", "16");
    svg.setAttribute("height", "16");
    svg.setAttribute("fill", "currentColor");
    svg.setAttribute("aria-hidden", "true");
    for (const cy of [5, 12, 19]) {
      const dot = document.createElementNS(SVG_NS, "circle");
      dot.setAttribute("cx", "12");
      dot.setAttribute("cy", String(cy));
      dot.setAttribute("r", "1.8");
      svg.appendChild(dot);
    }
    return svg;
  },
};

/** An icon-only button with an accessible label (shown as a native tooltip). */
function iconButton(
  label: string,
  className: string,
  icon: SVGElement,
  onClick: () => void | Promise<void>,
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `renderer-dashboard-iconbtn ${className}`;
  button.title = label;
  button.setAttribute("aria-label", label);
  button.appendChild(icon);
  button.addEventListener("click", () => {
    void onClick();
  });
  return button;
}

/**
 * Inject a "Pin" button into a freshly-rendered single result so the user can
 * keep it on the dashboard. A pin needs only `{title, sql, render_tool,
 * render_options}` — `query_id` is nullable (the facade recomputes from SQL on
 * first open). No-ops when the host can't call server tools, the chart type
 * isn't pinnable, or the result isn't a facade-backed query — pinning persists
 * SQL to the Athena facade (`pin_query`), so it only applies to `facade` results
 * that carry SQL (not inline `direct` data, nor any other provider's rows).
 */
export function maybeAddPinAffordance(
  root: HTMLElement,
  payload: {
    chart_type: string;
    data_source?: string;
    sql?: string;
    title?: string;
    options?: Record<string, unknown>;
  },
  bridge: DashboardHostBridge | undefined,
): void {
  if (!bridge?.callServerTool || payload.data_source !== "facade" || !payload.sql) {
    return;
  }
  const renderTool = CHART_TYPE_TO_RENDER_TOOL[payload.chart_type];
  if (!renderTool) {
    return;
  }
  const actions = root.querySelector<HTMLElement>(".renderer-header-actions");
  if (!actions) {
    return;
  }

  const sql = payload.sql;
  const title = payload.title ?? "Pinned query";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "renderer-pin-btn";
  button.textContent = "Pin";
  button.title = "Keep this chart on the dashboard";
  button.addEventListener("click", () => {
    button.disabled = true;
    button.textContent = "Pinning…";
    void bridge.callServerTool!({
      name: "pin_query",
      arguments: {
        title,
        sql,
        render_tool: renderTool,
        render_options: payload.options ?? {},
      },
    })
      .then((result) => {
        const code =
          result._meta && typeof result._meta === "object"
            ? String((result._meta as { code?: string }).code ?? "")
            : "";
        if (result.isError) {
          button.textContent =
            code === "PINNED_QUERIES_UNAVAILABLE"
              ? "Pinning not enabled yet"
              : "Pin failed";
          return;
        }
        button.textContent = "Pinned ✓";
        void bridge.updateModelContext?.({
          content: [
            {
              type: "text",
              text: `The user pinned "${title}" to the dashboard.`,
            },
          ],
        });
      })
      .catch(() => {
        button.disabled = false;
        button.textContent = "Pin";
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
  if (typeof document !== "undefined") {
    document.body.classList.remove("renderer-dashboard-mode");
    document.documentElement.style.removeProperty("height");
    document.body.style.removeProperty("height");
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

/** Re-fetch on focus so pinning from a single-result widget isn't missed. */
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && session) {
      void loadData();
    }
  });
}

function paint(): void {
  if (!session) {
    return;
  }
  const { root } = session;
  resetMenus();
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
  if (isInteractive(session_.displayMode) && session_.pins.length > 0) {
    actions.append(
      iconButton(
        "Refresh all",
        "renderer-dashboard-refresh-all",
        ICONS.refresh(),
        () => {
          void refreshAll();
        },
      ),
    );
  }
  actions.append(buildModeToggle());

  aside.append(actions, buildUsageBar(session_.usage));
  bar.append(headerText, aside);
  container.append(bar);
  return container;
}

function round2(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "—";
  }
  return `$${value.toFixed(2)}`;
}

function buildUsageBar(usage: QuotaUsage | undefined): HTMLElement {
  const bar = document.createElement("div");
  bar.className = "renderer-usage-bar";

  if (!usage || (!usage.monthly && !usage.lifetime)) {
    const empty = document.createElement("span");
    empty.className = "renderer-usage-empty";
    empty.textContent = "Usage unavailable";
    bar.append(empty);
    return bar;
  }

  if (usage.monthly) {
    const m = usage.monthly;
    const label = m.period ? `Monthly · ${m.period}` : "Monthly";
    const suffix =
      typeof m.projected_run_rate_usd === "number" &&
      m.projected_run_rate_usd > 0
        ? ` · projected ${round2(m.projected_run_rate_usd)}`
        : "";
    bar.append(buildUsageMeter(label, m.used_usd, m.limit_usd ?? null, suffix));
  }
  if (usage.lifetime) {
    const l = usage.lifetime;
    bar.append(
      buildUsageMeter("Lifetime", l.used_usd, l.limit_usd ?? null, ""),
    );
  }
  return bar;
}

function buildUsageMeter(
  label: string,
  used: number | undefined,
  limit: number | null,
  suffix: string,
): HTMLElement {
  const cell = document.createElement("div");
  cell.className = "renderer-usage-cell";

  const head = document.createElement("div");
  head.className = "renderer-usage-head";
  const name = document.createElement("span");
  name.className = "renderer-usage-label";
  name.textContent = label;
  const value = document.createElement("span");
  value.className = "renderer-usage-value";
  value.textContent =
    limit !== null
      ? `${round2(used)} / ${round2(limit)}${suffix}`
      : `${round2(used)}${suffix}`;
  head.append(name, value);
  cell.append(head);

  if (limit !== null && limit > 0 && typeof used === "number") {
    const track = document.createElement("div");
    track.className = "renderer-usage-track";
    const fill = document.createElement("div");
    fill.className = "renderer-usage-fill";
    const ratio = Math.min(1, Math.max(0, used / limit));
    fill.style.width = `${(ratio * 100).toFixed(1)}%`;
    if (used >= limit) {
      fill.dataset.state = "over";
    }
    track.append(fill);
    cell.append(track);
  }
  return cell;
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
    tools.append(
      iconButton(
        "Refresh",
        "renderer-dashboard-card-refresh",
        ICONS.refresh(),
        () => {
          if (staticPin) {
            rerenderCard(pin);
          } else {
            void refreshOne(pin);
          }
        },
      ),
      buildCardMenu(pin),
    );
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

/** Dispatch a resolved RenderOutput into the matching single-result view. */
function renderResolvedOutput(
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
    throw new Error(`Unsupported pin render type: ${output.chart_type}`);
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

/** A kebab (⋮) menu hosting secondary/destructive per-card actions (Remove; future Configure). */
function buildCardMenu(pin: PinnedQueryMeta): HTMLElement {
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

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className =
    "renderer-dashboard-card-menu-item renderer-dashboard-card-remove";
  remove.setAttribute("role", "menuitem");
  remove.appendChild(ICONS.trash());
  const removeLabel = document.createElement("span");
  removeLabel.textContent = "Remove";
  remove.appendChild(removeLabel);
  remove.addEventListener("click", () => {
    closeMenu(container);
    void removeOne(pin);
  });
  menu.append(remove);

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
    const result = await session_.bridge.callServerTool({
      name: "get_quota_usage",
      arguments: { namespace: session_.namespace },
    });
    if (result.isError || !session) {
      return;
    }
    session.usage = QuotaUsageSchema.parse(result.structuredContent);
    reconcile();
  } catch (error) {
    // Usage is best-effort — keep the last-known header in place. A parse failure
    // here means the upstream usage shape drifted; log it so the header silently
    // freezing is diagnosable.
    if (error instanceof z.ZodError) {
      console.error("get_quota_usage returned an unexpected shape", error);
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

  // Usage bar: replace in place (it's nested in the header aside, so swap by node).
  const oldBar = s.root.querySelector(".renderer-usage-bar");
  oldBar?.replaceWith(buildUsageBar(s.usage));

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
    const result = await session_.bridge.callServerTool({
      name: "refresh_pinned_query",
      arguments: {
        pin_id: pin.pin_id,
        render_tool: pin.render_tool,
        render_options: pin.render_options,
        title: pin.title,
        sql: pin.sql,
        namespace: session_.namespace,
      },
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

async function refreshAll(): Promise<void> {
  const session_ = session;
  if (!session_?.bridge.callServerTool || session_.pins.length === 0) {
    return;
  }
  // Budget-gated: confirm with the last-known scan estimate before re-running.
  if (!confirmRefreshAll(session_.pins, session_.cards)) {
    return;
  }
  // Hold the shared load guard so a focus self-reload can't race the refresh.
  session_.loading = true;
  for (const pin of session_.pins) {
    setCardLoading(pin.pin_id);
  }
  try {
    const result = await session_.bridge.callServerTool({
      name: "refresh_all_pinned",
      arguments: {
        pins: pinsToInput(session_.pins),
        namespace: session_.namespace,
      },
    });
    if (result.isError) {
      showReconnectHint(errorText(result));
      return;
    }
    mergeCards(DashboardDataSchema.parse(result.structuredContent));
  } catch (error) {
    showReconnectHint(error instanceof Error ? error.message : String(error));
  } finally {
    if (session) {
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
      const result = await session_.bridge.callServerTool({
        name: "unpin_query",
        arguments: { pin_id: pin.pin_id, namespace: session_.namespace },
      });
      const code =
        result._meta && typeof result._meta === "object"
          ? String((result._meta as { code?: string }).code ?? "")
          : "";
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

function handleLoadError(result: {
  _meta?: Record<string, unknown>;
  content?: Array<{ type?: string; text?: string }>;
}): void {
  const code =
    result._meta && typeof result._meta === "object"
      ? String((result._meta as { code?: string }).code ?? "")
      : "";
  const isAuth =
    /401|unauthor|HTTP_401/i.test(code) ||
    /401|unauthor/i.test(errorText(result));
  showReconnectHint(
    isAuth
      ? "Your session expired — re-authenticate to load the dashboard."
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
): boolean {
  if (typeof window === "undefined" || typeof window.confirm !== "function") {
    return true;
  }
  let totalBytes = 0;
  for (const pin of pins) {
    const output = cards.get(pin.pin_id)?.render_output as
      | { stats?: { data_scanned_bytes?: number } }
      | undefined;
    totalBytes += output?.stats?.data_scanned_bytes ?? 0;
  }
  const estimate =
    totalBytes > 0 ? ` (last run scanned ~${formatBytes(totalBytes)})` : "";
  return window.confirm(
    `Re-run all ${pins.length} pinned ${pins.length === 1 ? "query" : "queries"}? This scans billable bytes${estimate}.`,
  );
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
