# Architecture Guide

This document describes how the AGS API MCP Server is designed and why, including the security mechanisms it relies on.

## Table of Contents

- [Overview](#overview)
- [Stateless Design](#stateless-design)
- [Analytics & Visualization Architecture](#analytics--visualization-architecture)
- [Performance Characteristics](#performance-characteristics)
- [Security](#security)
- [Design Rationale](#design-rationale)

---

## Overview

The server is built around:
- **Stateless architecture** — no server-side sessions or token storage
- **HTTP-only transport** — single POST endpoint for MCP messages
- **Zod validation** — runtime type safety throughout
- **MCP specification compliance** — full spec adherence
- **Structured responses** — both text content and `structuredContent`

---

## Stateless Design

```
┌─────────────────────────────────────┐
│  No Server-Side State               │
│  - Token in Authorization header    │
│  - Client manages refresh           │
│  - Per-request validation           │
│  - Factory pattern for MCP servers  │
└─────────────────────────────────────┘
```

**Trade-offs:**
- Simpler deployment (no state to manage)
- Horizontal scaling (no session affinity)
- No memory leaks from session accumulation
- Client must handle token refresh

### Authentication Model

The server uses **client-provided bearer tokens**. Clients obtain a JWT externally from AccelByte IAM and pass it on each request:

```
Authorization: Bearer <jwt>
```

The server extracts and uses the token per request. No tokens are stored.

### Validation & Error Handling

- Zod schema validation for all tool inputs and outputs
- `McpError` with proper `ErrorCode` enums
- Structured error responses
- Output schemas defined for all tools

---

## Analytics & Visualization Architecture

The server has two tool families alongside the core OpenAPI tools:
- `run-apis` exposes raw HTTP access to all loaded specs, including `afs.json`
- 16 provider-backed `render_*` tools resolve tabular data through a provider registry and emit strict `structuredContent` payloads for the browser bundle
- `render_text_editor` is the one **input** tool: it is not provider-backed — its value originates in the webview (see below)

### Provider Routing

Each request-scoped server instance builds its own provider registry:
- `facade` resolves `query_id` + `namespace` against the Athena Facade using the per-request effective AGS base URL
- `direct` accepts inline `data_columns` + `data_rows` for small datasets and tests

Because a fresh `McpServer` is created per HTTP POST, provider registration stays request-scoped and hosted-mode tenant routing is preserved.

### Renderer Resource

The analytics UI is shipped as `ui://renderer/index.html`:
- Registered via `@modelcontextprotocol/ext-apps`
- Built by Vite into `dist/v2/renderer/index.html`
- Loaded once and memoized on the server
- Advertises `_meta["ags/bundleVersion"]`
- Validated by the browser bundle against the shared `BUNDLE_VERSION`

The renderer source lives under `src/v2/renderer/**`, while `tsconfig.renderer.json` isolates DOM/browser typing from the server `tsconfig.json`.

### Render Tools

The 16 provider-backed render tools share the same input model: a data source (`provider="facade"` with `query_id` + `namespace`, or `provider="direct"` with inline `data_columns` + `data_rows`), optional `title` / `description` / `column_hints` / `filters`, and tool-specific `options`. Every render tool returns strict structured content keyed by `chart_type`.

| Tool | `chart_type` | Required options | Optional options |
|------|--------------|------------------|------------------|
| `render_bar_chart` | `bar` | `x`, `y` | `color`, `bar_mode`, `orientation`, `label`, `facet_col`, `facet_row`, `x_label`, `y_label`, `tooltip` |
| `render_line_chart` | `line` | `x`, `y` | `color`, `show_points`, `curve`, `facet_col`, `facet_row`, `x_label`, `y_label`, `tooltip` |
| `render_area_chart` | `area` | `x`, `y` | `color`, `stack_mode`, `curve`, `facet_col`, `facet_row`, `x_label`, `y_label`, `tooltip` |
| `render_scatter_chart` | `scatter` | `x`, `y` | `color`, `size`, `trend_line`, `facet_col`, `facet_row`, `x_label`, `y_label`, `tooltip` |
| `render_histogram_chart` | `histogram` | `column` | `bin_count`, `normalize`, `color`, `facet_col`, `facet_row`, `x_label`, `y_label` |
| `render_box_chart` | `box` | `x`, `y` | `color`, `facet_col`, `facet_row`, `x_label`, `y_label` |
| `render_heatmap_chart` | `heatmap` | `x`, `y`, `value` | `color_scheme`, `show_values`, `x_label`, `y_label` |
| `render_pie_chart` | `pie` | `category`, `value` | `show_labels`, `other_threshold` |
| `render_donut_chart` | `donut` | `category`, `value` | `show_labels`, `other_threshold`, `center_label`, `hole` |
| `render_waterfall_chart` | `waterfall` | `category`, `value` | `is_total`, `x_label`, `y_label` |
| `render_funnel_chart` | `funnel` | `stage`, `value` | `orientation`, `show_conversion` |
| `render_gauge_chart` | `gauge` | `value`, `max` | `min`, `thresholds`, `unit` |
| `render_state_timeline_chart` | `state_timeline` | `entity`, `start`, `end`, `state` | — |
| `render_table` | `table` | — | `columns_order`, `page_size` |
| `render_metric` | `metric` | `value` | `compare`, `label`, `unit`, `format` |
| `render_meter` | `meter` | `value` | `max`, `label`, `color`, `unit`, `format` |

#### Text editor (input tool)

`render_text_editor` does not use a provider. It loads an editable document into the webview
(CodeMirror 6) with syntax highlighting and a language picker, plus a markdown preview.

| Tool | `chart_type` | Required input | Optional input |
|------|--------------|----------------|----------------|
| `render_text_editor` | `text_editor` | `content` | `language` (`markdown`\|`json`\|`yaml`\|`javascript`\|`text`), `title` |

- **Display mode:** fullscreen → editor; inline/pip → preview (rendered markdown, or read-only
  highlighted code with folding). The webview reads `hostContext.displayMode` and can toggle via
  `requestDisplayMode`.
- **Exits (both verbatim, both stateless):** the edited bytes leave the webview by value, never
  regenerated by the model —
  `updateModelContext` (embedded resource → assistant reads it this turn) and `downloadFile`
  (embedded resource → durable file that survives chat compaction). A clipboard copy is the
  universal fallback. Each action is capability-gated via `getHostCapabilities()`.
- The server stores nothing; persistence to an API (e.g. AFS `…/context`) stays downstream and
  model-driven.

For write-side API calls (POST/PUT/PATCH/DELETE through `run-apis`), the tool uses MCP elicitation to request user approval before execution.

#### Dashboard (home surface)

The renderer resource has **two modes, one bundle**: the default single-result mode (each tool call `replaceChildren`) and a **dashboard** mode (`chart_type:"dashboard"`) that accumulates pinned queries. The app-shell dispatches the dashboard branch before the chart fallthrough; the dashboard view (`src/v2/renderer/views/dashboard.ts`) owns a usage header plus a pinned-query grid and rebuilds each card body with the same `renderChart`/`renderTable`/`renderMetric` views.

| Tool | Visibility | Purpose |
|------|------------|---------|
| `open_dashboard` | model-facing | Returns a **metadata-only** `dashboard` payload (pins + `quota/usage`, **no rows**) bound to the renderer resource. Small and safe to persist in chat history. |
| `load_dashboard` | app-only | The widget's self-load: resolves each pin's **cached** rows via the existing `GET .../queries/{id}` path and the usage header, returning full `RenderOutput`s. Rows reach the widget here, never the transcript. |
| `get_quota_usage` | app-only | Proxies `GET .../quota/usage` for the header. |
| `pin_query` / `unpin_query` | app-only | Create/delete a pin in the downstream `.../pinned-queries` store. |
| `refresh_pinned_query` / `refresh_all_pinned` | app-only | Force a SQL re-run (the only billing path); refresh-all is budget-gated and stops on `429`. |

A pin stores **SQL (source of truth) + last `query_id` (cache pointer) + render spec (`render_tool` + opaque `render_options`)** — never rows. Card bodies are rebuilt from the stored `render_tool` via a registry in `renderers/define.ts` (`buildPinRenderOutput`), so any of the 16 charts re-renders with no bespoke code.

**Live vs. static pins.** A pin's source is inferred per pin (no `provider` field): a **live** pin carries a `query_id` and resolves rows from the facade (refreshable, durable downstream); a **static** pin carries inline `data_columns`/`data_rows` — those rows *are* the data (a snapshot, built via `buildPinRenderOutput(..., dataSource:"direct")`, capped at `MAX_ROWS_DEFAULT`). Static pins are **transient** (model-held, never persisted, never billed): `resolvePinCard` builds them without touching the facade, the refresh tools return them unchanged, and the view shows a "Snapshot" badge with no Refresh. The inline rows ride along on both `PinnedQueryMeta` and `PinnedQueryCard` so a self-load/focus reload round-trips them instead of dropping to stale.

**Layout.** Each pin has an optional `span` (integer 1–12, clamped; default 4) placing it on a fixed **12-column** grid in fullscreen; cards are a fixed height (`--dashboard-card-height`) with the body scrolling inside. Compact/inline and containers narrower than 720px collapse to a single column (spans ignored). `span` is layout-only.

Lifecycle invariants:
- **Open never re-runs SQL.** `load_dashboard` resolves cached results only; an expired/absent `query_id` yields a *stale* card ("click Refresh"), so a dashboard of moving-window queries can't bill on every open (denial-of-wallet defense).
- **Refresh is the only re-run path** and is always an explicit user click.
- **Restart survival without trusting replay:** the widget self-calls `load_dashboard` on mount and on `visibilitychange`, reconstructing from the stateless server even if the host evicted the original result (context compaction). Sizing reads `hostContext.containerDimensions.height` (fixed body, scroll inside — never report content height); display modes are read from the merged `getHostContext()`.
- **Abuse resistance:** all card text is set via `textContent` (never `innerHTML`); `render_options` is re-validated against the chart schema in both the server and the bundle, and each card renders inside its own `try/catch` so a hostile pin shows an inline error instead of executing or blanking the grid.

Pin persistence lives downstream in athena-facade-api (`.../pinned-queries`); the MCP server stays a stateless proxy (`src/v2/mcp/tools/providers/pinned-queries.ts`). Until that resource ships, `open_dashboard`/`load_dashboard`/`get_quota_usage` work against existing endpoints (model-held pins), and the save/refresh tools degrade with a clear `PINNED_QUERIES_UNAVAILABLE` error.

### Chrome System (UI Affordances)

The renderer's buttons, badges, and footer notes — Pin, Refresh, Remove, the spend header, the "source: inline" and scanned-bytes notes — are not hand-wired per view. They are **chrome**: small declarative affordances resolved from one catalog and placed by data-driven eligibility, so the standalone result view and the dashboard (header + cards) stay consistent and adding an affordance is a one-file change. The system is **client-owned** and lives entirely in the webview bundle (`src/v2/renderer/chrome/**`): the server emits only pure context (provider data, stats, capabilities, `data_source`) as JSON on the render output, and the bundle owns the registry, the resolver (placement), and the binder (behavior). Nothing here touches the stateless server contract.

#### Context model

`buildChromeContext()` (`chrome/context.ts`) assembles a `ChromeContext` for the surface being rendered, split into four namespaces so unrelated concerns can't bleed together (`shared/chrome-context.ts`):

- **`core`** — a **sealed** `CoreCtx` (`container`, `renderType`, `permissions`, optional `pin`): the only general-purpose context every chrome may read. It is held shut by a compile-time witness (`Record<keyof CoreCtx, true>`) plus a runtime allowlist and a guardrail test, so growing it is a deliberate, reviewed change rather than a casual diff.
- **`provider`** — a discriminated `ContextFragment` union: `facade` (`canRefresh: true`, carries `sql`/`stats`) or `direct` (`canRefresh: false`, an inline snapshot). Refreshability is a consequence of the discriminant, not an independent flag; a new provider adds a union member, never a field on `core`.
- **`render`** — the on-screen payload a chrome forwards when it acts (title, opaque `options`, `renderTool`).
- **`surface`** — live state of the surrounding surface (interactive/fullscreen, pin count, usage snapshot, namespace) read for eligibility.

#### The chrome contract

Each chrome is declared once via `defineChrome<Slice>` (`chrome/types.ts`):

- **`select(ctx) → Slice | null`** fuses "does this apply here?" with "do I have my data?" — `null` means not shown; a non-null slice is exactly what `render`/`intent` read. Eligibility therefore can't drift out of sync with the data a chrome needs.
- **`render(slice) → HTMLElement`** is pure presentation.
- **`intent?(slice) → Intent`** emits one of a closed `IntentType` union (`pin` \| `remove` \| `refresh-all` \| `reload`); a chrome never calls a server tool itself. Presentational chrome (footer notes) omits it.
- **`effect?(slice, host) → Dispose`** is lifecycle/event behavior (e.g. the focus-reload subscription), driven through the binder via an `EffectHost` and torn down by the surface's `MountScope`.
- **`region`** (`header-start` \| `header-end` \| `overflow` \| `footer-start` \| `footer-end`), **`scope`** (`item` \| `container`), and **`priority`** govern placement.

#### Pipeline: registry → resolve → frame / binder

`CHROMES` (`chrome/registry.ts`) is **the** single catalog; every surface resolves from it and no surface keeps its own hardcoded list. `resolve(CHROMES, ctx)` (`chrome/resolve.ts`) is the single placement/presence choke point: it runs each chrome's `select`, groups the survivors by region in a fixed `REGION_ORDER`, and is the seam where a future persisted reorder/hide layer would apply (a documented no-op today). The frame (`chrome/frame.ts`) mounts the resolved chrome into the surface's DOM and opens a `MountScope` that owns every effect disposer, so a repaint or teardown removes listeners deterministically. Behavior is mapped in the **binder** (`chrome/binder.ts`): `createDashboardBinder` translates an action to a single `callServerTool` — `pin → pin_query`, `refresh → refresh_pinned_query`, `remove → unpin_query`, `refreshAll → refresh_all_pinned`, `quotaRefresh → get_quota_usage` — and cross-cutting guards (the refresh-all cost confirmation) wrap an entry as middleware (`withCostConfirm`), short-circuiting to a `Cancelled` sentinel when declined. Because the binder is the one place an intent becomes a tool call, the same `pin`/`refresh` intent can map to different tools on different surfaces.

#### Catalog

The eight chromes registered today (`chrome/chromes/*`):

| Chrome | Scope | Region | Shown when | Acts via |
|--------|-------|--------|------------|----------|
| `source-note` | item | footer-start | provider is `direct` (inline snapshot) | — (presentational) |
| `stats-note` | item | footer-end | facade returned scan/timing stats | — (presentational) |
| `pin` | item | header-end | standalone result, pinnable, `canManagePins` | `pin` intent → `pin_query` |
| `sync` | container | header-start | dashboard surface | `reload` on `visibilitychange` (effect) |
| `refresh-all` | container | header-end | dashboard, fullscreen, ≥ 1 pin | `refresh-all` intent → `refresh_all_pinned` (budget-gated) |
| `quota` | container | header-end | dashboard with a usage snapshot | spend bar; effect refreshes it via `get_quota_usage` |
| `refresh` | item | header-end | dashboard card, fullscreen | → `refresh_pinned_query` |
| `remove` | item | overflow (kebab) | dashboard card, fullscreen | `remove` intent → `unpin_query` |

#### Invariants

- **One catalog, data-driven placement** — adding an affordance is one registry entry + one chrome file; it then appears wherever its `select` matches, with no per-surface list to keep in sync.
- **Sealed shared context** — uncontrolled growth of `CoreCtx` is a build break (witness) and a test failure (allowlist), not a silent diff.
- **Chrome never calls tools** — it emits a typed `Intent`; the binder is the only place an action becomes a `callServerTool`.
- **Deterministic effect lifecycle** — every subscription a chrome opens is owned by the `MountScope` and disposed on repaint/teardown; re-rendering a dashboard over an existing one disposes the prior scope first, so exactly one focus listener is ever live.
- **XSS-safe** — all chrome DOM is built with `textContent`/`createElement`; no `innerHTML`.

### AFS Spec Integration

The Athena Facade spec is loaded like any other OpenAPI spec and exposed through `search-apis`, `describe-apis`, and `run-apis`. The relevant operations:

| Operation | Purpose |
|-----------|---------|
| `POST /afs/v1/admin/namespaces/{namespace}/queries` | Submit an Athena SQL query |
| `GET /afs/v1/admin/namespaces/{namespace}/queries/{id}` | Poll status; fetch rows when terminal |
| `GET /afs/v1/admin/namespaces/{namespace}/tables` | List/search tables in a database |
| `GET /afs/v1/admin/namespaces/{namespace}/tables/{database}/{table}` | Fetch full table metadata |

If you intend to render via `provider="facade"`, submit with `wait_ms=0` and poll the GET endpoint until `status="SUCCEEDED"`. If the submit returns `200` with inline rows on the fast path, render those `columns` and `rows` directly with `provider="direct"` instead of reusing the returned `query_id`.

`openapi-specs/afs.json` joins the existing spec set, so Athena Facade access stays on the same contract as the rest of the OpenAPI-backed API surface.

---

## Performance Characteristics

- **Memory:** constant per request (no accumulation)
- **Connections:** short-lived HTTP requests
- **Cleanup:** automatic per-request cleanup
- **Scaling:** stateless, scales horizontally freely

---

## Security

The server stores no tokens, has no sessions, and trusts client-provided JWTs after verifying their signatures.

### JWT Signature Verification

All Bearer tokens are cryptographically verified using JWKS (JSON Web Key Set):

1. **Discovery**: The JWKS URI is fetched from `{agsBaseUrl}/.well-known/oauth-authorization-server`
2. **Verification**: Token signatures are validated against the public keys from the JWKS endpoint
3. **Algorithm**: Only RS256 is accepted (prevents algorithm confusion attacks)
4. **Issuer Validation**: The token's `iss` claim is verified against the expected AGS base URL
5. **Expiration**: Tokens must be within their `exp` window (30s clock tolerance)
6. **Audience**: Optional `aud` claim validation (configurable via middleware options)

Invalid or forged tokens receive a `401 Unauthorized` response.

### JWKS Caching

To minimize latency and reduce load on the authorization server:

- **JWKS URI discovery** is cached for 10 minutes (configurable via `JWKS_CACHE_TTL_MS`)
- **Signing keys** are cached for 10 minutes (configurable via `JWKS_CACHE_MAX_AGE`)
- **Rate limiting**: Maximum 10 JWKS requests per minute (configurable via `JWKS_RATE_LIMIT`)
- **Cache size**: Limited to 50 entries to prevent unbounded memory growth
- **Pre-warming**: JWKS cache is pre-warmed on server startup when auth is enabled

### Hosted Mode

In hosted (multi-tenant) mode, the AGS base URL is derived from the request's `Host` header. Additional protections include:

- Token issuer is validated against the derived host URL
- Mismatched issuers return `403 Forbidden`

### SSRF Protection

The `serverUrl` parameter has been removed from the `run-apis` tool across all implementations (V1 HTTP, V1 stdio, V2 MCP). Server URLs now come from:

1. `AB_BASE_URL` environment variable (or hosted-mode per-request AGS base URL)
2. OpenAPI specification `servers` / Swagger 2 `host` metadata when no environment base URL is configured

As defense-in-depth, all outbound requests are checked against private/internal IP ranges:

**IPv4:**
- `127.0.0.0/8` (loopback)
- `10.0.0.0/8` (RFC 1918 Class A)
- `172.16.0.0/12` (RFC 1918 Class B)
- `192.168.0.0/16` (RFC 1918 Class C)
- `169.254.0.0/16` (link-local / cloud metadata)
- `100.64.0.0/10` (CGNAT)
- `198.18.0.0/15` (benchmarking)
- `0.0.0.0` (unspecified)
- `255.255.255.255` (broadcast)

**IPv6:**
- `::1` (loopback)
- `fe80::/10` (link-local)
- `fc00::/7` (unique local)
- `fd00::/8` (unique local)
- IPv4-mapped IPv6 (`::ffff:x.x.x.x`) — normalized and checked against IPv4 patterns

**Hostnames:**
- `localhost` and `*.localhost`
- `metadata.google.internal` (GCP metadata service)
- `metadata.azure.com` (Azure metadata service)

Blocked requests are logged with `event: "ssrf_blocked"` for security monitoring.

#### DNS Rebinding Mitigation

Hostnames are resolved via `dns.resolve4`/`dns.resolve6` and all resolved IP addresses are validated against the private IP patterns before the HTTP request is made. This prevents attackers from returning a public IP during initial validation and a private IP when the actual connection is established.

### Security Logging

Structured security events are logged for monitoring and incident response:

| Event | Level | Description |
|-------|-------|-------------|
| `auth_failure` | WARN | Authentication failure (invalid token, expired, wrong issuer) |
| `auth_success` | DEBUG | Successful authentication |
| `suspicious_request` | WARN | Suspicious activity (issuer mismatch, missing claims) |
| `rate_limit_exceeded` | WARN | Rate limit threshold exceeded |
| `ssrf_blocked` | WARN | Outbound request to private/internal address blocked |

All security events include the client IP address. Configure `TRUST_PROXY` when behind a reverse proxy to ensure accurate IP logging.

#### Monitoring and Alerting

Security events are emitted as structured JSON logs. Forward them to your log aggregation/SIEM system and configure alerts for the following conditions:

| Alert | Filter | Threshold | Action |
|-------|--------|-----------|--------|
| High auth failure rate | `event = "auth_failure"` | > 10% of total auth requests over 5 min | Investigate for credential stuffing or misconfigured clients |
| SSRF attempts detected | `event = "ssrf_blocked"` | Any occurrence (should be rare) | Review source IP, inspect request patterns |
| Suspicious requests | `event = "suspicious_request"` | > 5 events from single IP in 1 min | Review auth logs, consider IP blocking |
| Rate limit exceeded | `event = "rate_limit_exceeded"` | Frequent from legitimate users | Review rate limit configuration |

**Log aggregation filter:**
```
event IN ("auth_failure", "ssrf_blocked", "suspicious_request", "rate_limit_exceeded")
```

**Dashboard suggestions:**
- Event counts by type over time
- Top source IPs by auth failure count
- Auth failure reasons breakdown (expired, wrong issuer, invalid signature)

### Rate Limiting

- Configurable via `RATE_LIMIT_ENABLED`, `RATE_LIMIT_WINDOW_MINS`, and `RATE_LIMIT_MAX`
- Defaults: 1000 requests per 15-minute window per IP
- Rate limit violations are logged as security events

### Security Headers

Helmet middleware provides:

- `Content-Security-Policy`
- `Strict-Transport-Security` (HSTS)
- `X-Frame-Options`
- `X-Content-Type-Options`
- And other standard security headers

See [ENVIRONMENT_VARIABLES.md](ENVIRONMENT_VARIABLES.md) for configuration of the security-related env vars.

---

## Design Rationale

- **Stateless** — aligns with modern API design (JWT bearer tokens); no session bugs, leaks, or race conditions.
- **HTTP POST-only** — most deployments are HTTP-based; MCP spec permits `405` for `GET`/`DELETE`; simpler to debug, monitor, and load-balance.
- **No server-managed OAuth** — clients control token lifecycle and can use any auth method; keeps the server stateless.

---

## References

- [MCP Specification (2025-11-25)](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)
- [Implementation: src/v2/](../src/v2/)
