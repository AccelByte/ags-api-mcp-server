# Changelog

## Unreleased

### Added
- **New `render_meter` tool.** Renders one or more horizontal meters (progress / fill bars), one meter per row — designed for usage limits but general-purpose. `value` names the current-value column; optional `max` gives a per-row maximum (fill = `value/max`), and when omitted `value` is treated as a 0–100 percentage. Over-limit meters clamp the bar to 100% and recolor to the danger token. Optional `label`, `color` (per-meter override; defaults to the brand series palette), and `unit` columns are supported — `unit` is per-meter (shown once after the max value) so meters can carry different units. Optional `format` (`number`/`compact`/`integer`/`percent`) formats displayed values via `Intl.NumberFormat`. SVG/DOM-rendered, like the other non–Chart.js views. See `docs/ARCHITECTURE.md#render-tools`.

## v2026.3.1 (2026-05-26)

### Changed
- **Renderer charts switched from Observable Plot to Chart.js.** The seven Plot-using renderers (`render_line_chart`, `render_area_chart`, `render_bar_chart`, `render_scatter_chart`, `render_histogram_chart`, `render_box_chart`, `render_waterfall_chart`) and the `render_table` view (previously on `@observablehq/inputs`) are now backed by `chart.js` + `@sgratzl/chartjs-chart-boxplot` + `chartjs-plugin-trendline` + `chartjs-plugin-datalabels` + `chartjs-adapter-date-fns`. Net gains: responsive resize, hover tooltips with full series values, and auto-rotation/auto-skip on crowded x-axis ticks. The six SVG-rendered charts (`render_pie_chart`, `render_donut_chart`, `render_heatmap_chart`, `render_funnel_chart`, `render_gauge_chart`, `render_state_timeline_chart`) are unchanged.
- **Renderer adopts the AccelByte brand palette.** Surfaces, accents, series colors, radii (4 / 8 / 12 / pill), and elevation now match `assets/brand-guidelines/`. Dual-mode via `light-dark()` — Porcelain/White light, Vulcan/Navy dark; AccelByte Blue as the accent. Flat (radial-gradient backdrop removed).

### Removed
- **Breaking: faceting (`facet_col` / `facet_row`) removed.** No longer accepted by `render_bar_chart`, `render_line_chart`, `render_area_chart`, `render_scatter_chart`, `render_histogram_chart`, or `render_box_chart`; calls passing these fields will fail Zod validation. Chart.js has no native small-multiples support.

### Fixed
- **Renderer iframe shrinks when a foldout collapses.** The previous `html, body { min-height: 100% }` pinned the document height to the iframe's last reported size, defeating the MCP SDK's auto-resize. Removed; the iframe now correctly tracks content height in both directions.
- **Canvas color resolution.** `var()` and `light-dark()` tokens now resolve via a hidden probe element rather than `getComputedStyle().getPropertyValue()` (which returned the literal `light-dark(...)` string). Affected chart elements that handed colors to canvas `fillStyle` indirectly — alpha-suffixed area fills and the scatter trend line both rendered black under the old path.
- **`colorWithAlpha` now overrides alpha on `rgba(...)` inputs** instead of returning them unchanged, so multi-series overlap-mode area fills can't accidentally render at full opacity.
- **`render_histogram_chart` no longer throws `RangeError` on large datasets.** Manual min/max loop replaces `Math.min(...values)` / `Math.max(...values)` spread, which fails above ~65K values in V8.
- **`render_bar_chart` no longer flags the index axis as `stacked: true` on vertical bars** (was a tautology, harmless today but a latent regression risk).
- **`render_waterfall_chart` legend restored** with explicit positive/negative/total tone keys (lost in the Plot→Chart.js migration), and small steps now render with a 3px minimum height so they remain visible at any scale.
- **Pie chart in-slice labels.** White text with a thin dark outline + 16-character truncation; previously used `--color-text-on-accent` which resolved to a near-black tone in dark mode and was unreadable on most series colors.
- **Heatmap row labels.** Fixed-width label column (14rem) with `overflow-wrap: anywhere`; long URL paths previously overflowed into the first data cell.
- **README quick-install raw URL** points at the `master` branch (was `main`, which doesn't exist).

## v2026.3.0 (2026-05-25)

### Fixed
- **OAuth discovery in hosted mode**: the `WWW-Authenticate` header on `401` responses now advertises `resource_metadata` at the configured `MCP_SERVER_URL` instead of the upstream AGS host carried in `X-Forwarded-Host`. Spec-compliant MCP clients (e.g. `mcp-remote`) running on a different hostname than the AGS environment can now discover the protected-resource document and complete OAuth.
- **OpenAPI base URL resolution**: `run-apis` now prefers `AB_BASE_URL` (or the hosted-mode per-request base URL) over the OpenAPI spec's `servers` / Swagger 2 `host` metadata. Self-hosters who relied on spec-host fallback should set `AB_BASE_URL` explicitly.
- **Athena Facade fast-path rendering**: when the submit endpoint returns inline rows on the fast path, the guidance now steers callers to render with `provider="direct"` instead of polling the returned `query_id`, avoiding a guaranteed-empty facade fetch.

### Added
- **`ALLOW_PARENT_DOMAIN_ISSUER`** env var (default `false`): opt-in for AGS deployments where a single OAuth authorization server signs tokens for multiple subdomain environments (e.g. issuer `internal.gamingservices.accelbyte.io` issuing for `<env>.internal.gamingservices.accelbyte.io`). Only loosens the host-equality check; signature verification against the issuer's JWKS is unchanged. Strict-subdomain match required — bare suffix matches and issuers with paths are still rejected. See `docs/ENVIRONMENT_VARIABLES.md`.
- **Analytics and visualization MCP surface**: a new tool family for turning tabular data into charts, tables, and metrics inside MCP hosts that render app resources.
  - **15 `render_*` tools**: `render_bar_chart`, `render_line_chart`, `render_area_chart`, `render_scatter_chart`, `render_histogram_chart`, `render_box_chart`, `render_heatmap_chart`, `render_pie_chart`, `render_donut_chart`, `render_waterfall_chart`, `render_funnel_chart`, `render_gauge_chart`, `render_state_timeline_chart`, `render_table`, `render_metric`. See `docs/ARCHITECTURE.md#render-tools` for the input matrix.
  - **Two data-source providers**: `provider="facade"` reads Athena Facade query results by `query_id` + `namespace`; `provider="direct"` renders inline `data_columns` + `data_rows` (handy for the fast path and small datasets).
  - **Athena Facade (`afs`) integration**: `openapi-specs/afs.json` is loaded like any other spec and exposed through `search-apis`, `describe-apis`, and `run-apis` — no separate tool surface.
  - **`ui://renderer/index.html` MCP app resource**: single-file renderer bundle (Vite-built, memoized server-side), validated by the browser against a shared `BUNDLE_VERSION` and tagged with `_meta["ags/bundleVersion"]`.
  - **Write-op elicitation**: POST/PUT/PATCH/DELETE through `run-apis` requests user consent via MCP elicitation before executing.
  - **Operational rollback**: `MCP_RENDER_TOOLS=false` hides the entire surface without redeploying.

### Changed
- **Renderer UI polish.** Unified chart shell with shared design tokens; chart renders now expose foldout panels for the underlying SQL and result table; the footer surfaces query execution stats (duration, row count, scanned bytes); inline data sources are flagged in the chart header.
- **Hosted-server framing.** `README.md` rewritten to lead with the hosted server URL + AI-assistant install. New `INSTALL.md` is the AI-assistant-consumable install workflow (paste-and-go from `README.md`'s Quick Install).
- **Breaking: `render_scatter_chart` `label` option removed.** Use `tooltip` to surface per-point text; calls that pass `label` will fail Zod validation.
- **Documentation consolidated.** `docs/` now contains three load-bearing files plus the V1 archive: `ARCHITECTURE.md` (design, security, render tools, AFS), `DEVELOPMENT.md` (self-host, test, Docker), `ENVIRONMENT_VARIABLES.md`. README is the hosted-service entry point; `INSTALL.md` is the AI-assistant install guide. The seven `docs/v1/` files collapsed into a single archive at `docs/v1/README.md`.
- **Breaking link changes.** External bookmarks to the following paths now 404 — update them to the destinations listed:
  - `docs/V2_ARCHITECTURE.md` → `docs/ARCHITECTURE.md`
  - `docs/SECURITY.md` → `docs/ARCHITECTURE.md#security`
  - `docs/API_REFERENCE.md` → `docs/ARCHITECTURE.md#render-tools` (render-tool matrix) or MCP `tools/list` introspection (everything else)
  - `docs/DOCKER.md` → `docs/DEVELOPMENT.md#docker`
  - `docs/TESTING.md` → `docs/DEVELOPMENT.md#testing`
  - `docs/QUICK_START.md`, `docs/DOCUMENTATION_GUIDE.md` → removed (content folded into `README.md` + `docs/DEVELOPMENT.md`)
  - `docs/v1/API_REFERENCE.md`, `docs/v1/DEVELOPMENT.md`, `docs/v1/ENVIRONMENT_VARIABLES.md`, `docs/v1/OAUTH_FLOW.md`, `docs/v1/QUICK_START.md`, `docs/v1/STREAMABLE_HTTP.md` → `docs/v1/README.md`

---

## v2026.1.1 (2026-02-24) — Security VAPT Fixes

### Security
- **[CRITICAL]** JWT tokens are now cryptographically verified using JWKS instead of just decoded (AGS-MCP-001)
  - Signature verification via `jwks-client` with RS256
  - JWKS URI discovery from `.well-known/oauth-authorization-server`
  - Issuer (`iss`) claim validated against expected AGS environment
  - Caching for JWKS URIs and signing keys (10 min, configurable)
  - Pre-warming of JWKS cache on server startup
  - Returns 401 on invalid/forged tokens
- **[HIGH]** Removed user-controlled `serverUrl` parameter to prevent SSRF (AGS-MCP-002)
  - Removed from `run-apis` tool in all implementations (V1 HTTP, V1 stdio, V2 MCP)
  - Defense-in-depth private IP blocking (IPv4, IPv6, IPv4-mapped IPv6, hostnames)
  - Covers RFC 1918, CGNAT, link-local, cloud metadata, and more
- **[MEDIUM]** Structured security logging for auth failures and suspicious requests (AGS-MCP-003)
- Added configurable `TRUST_PROXY` for accurate client IP logging behind proxies
- Added `clockTolerance` (30s) to JWT verification for clock skew resilience
- Added cache size limits (max 50 entries) to prevent unbounded memory growth

### Changed
- **BREAKING:** `serverUrl` parameter removed from `run-apis` tool — use `AB_BASE_URL` env var
- Auth success logs lowered from INFO to DEBUG to reduce volume
- Auth failure logs now include request path for correlation

### Added
- `TRUST_PROXY`, `JWKS_CACHE_TTL_MS`, `JWKS_CACHE_MAX_AGE`, `JWKS_RATE_LIMIT` env vars
- `docs/SECURITY.md` — security architecture documentation
- Unit tests for JWT verification (10 tests), SSRF protection (33 tests), security logger (7 tests)

---

## v2026.1 (V2 Architecture)

### 🎉 V2 Release - Complete Rewrite

**Major architectural changes** for simpler, stateless operation:

**New Features:**
- ✨ Stateless architecture - no server-side sessions or token storage
- ✨ HTTP-only transport (stdio removed for simplicity)
- ✨ User consent via elicitation for write operations (POST/PUT/PATCH/DELETE)
- ✨ Zod schema validation for all tool inputs/outputs
- ✨ Output schemas defined for all tools
- ✨ Rate limiting middleware (1000 req/15min default, configurable via `RATE_LIMIT_MAX`)
- ✨ Instance caching for OpenApiTools and workflows
- ✨ Configurable max limits (search results, timeouts)
- ✨ Structured MCP responses (content + structuredContent)
- ✨ Better error handling with McpError and ErrorCode enums

**Infrastructure:**
- ✅ `/health` endpoint for monitoring
- ✅ `/` root informational endpoint
- ✅ SIGTERM signal handling for containers
- ✅ Graceful shutdown with timeout (10s)
- ✅ Request logging middleware
- ✅ Error handling middleware
- ✅ `express.urlencoded` support

**Removed Features (Intentional):**
- ⚠️ OAuth flow tools (`start_oauth_login`, `logout`) - client manages auth
- ⚠️ Server-side session management - fully stateless
- ⚠️ stdio transport - HTTP-only
- ⚠️ SSE streams (GET/DELETE endpoints return 405) - minimal Streamable HTTP
- ⚠️ JWKS token verification - trusts client-provided tokens
- ⚠️ Automatic token refresh - client responsibility
- ⚠️ Client credentials fallback - explicit auth only

**MCP Tools:**
- ✅ `get_token_info` - Improved with hints section, better structure
- ✅ `search-apis` - Added Zod validation, output schema
- ✅ `describe-apis` - Added Zod validation, output schema
- ✅ `run-apis` - Added user consent via elicitation

**Configuration Changes:**
- New: `MCP_PORT`, `MCP_PATH`, `MCP_AUTH`, `MCP_SERVER_URL`
- New: `OPENAPI_MAX_SEARCH_LIMIT`, `OPENAPI_DEFAULT_RUN_TIMEOUT_MS`, `OPENAPI_MAX_RUN_TIMEOUT_MS`
- Removed: All OAuth/OIDC environment variables

**Documentation:**
- 📚 New `docs/V2_ARCHITECTURE.md` - comprehensive V1 vs V2 comparison
- 📚 Updated all endpoint documentation for V2

**Migration:** See `docs/V2_ARCHITECTURE.md` for detailed migration guide.

**Why V2?** Stateless design enables simpler deployment, horizontal scaling, and eliminates session-related bugs. Perfect for containerized production environments.

---

## v2025.9

- Update OpenAPI specs.

## v2025.8.1

- Added richer token/session surfaces across `MCPServer`, `StaticTools`, and OAuth middleware, including OTP/session manager ports, refresh token reporting, and new OAuth login/logout tools on STDIO transports.
- Introduced streamable HTTP transport support with server‐mode detection, OAuth route wiring, base URL + `ADVERTISED_*` config, and exposed HTTP server status helpers.
- Expanded docs, test utilities, and example servers; reorganized docs into `docs/`, updated `env.example`, and added `tests/` with coverage for static/OpenAPI tools.
- Migrated the toolchain to pnpm, added ESLint + updated `tsconfig`, refreshed `package.json` scripts/version, and removed legacy `package-lock.json`.
- Improved logging (OpenAPI tools debug output), refactored core structure, and reordered `UserContext` fields to align with the new protocol version.
- Fixed test server env var usage and guarded streamable server startup with mode checks.
