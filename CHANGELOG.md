# Changelog

## v2026.4.2 (2026-07-27)

### Fixed

- **Namespaced issuers are accepted at their tenant-subdomain host.** IAM's namespaced OAuth discovery document identifies each namespace as its own authorization server with `issuer = {baseUri}/{namespace}`, and since the MCP 2026-07-28 RC authorization hardening the tokens from those grant chains carry that value in `iss`. A client connecting to the documented Shared Cloud URL (`https://{studio}-{game}.{env}/mcp/{studio}-{game}`) therefore presented an issuer naming the parent host with the namespace as a path — matching neither the exact-host rule, the sub-path rule, nor the `ALLOW_PARENT_DOMAIN_ISSUER` opt-in (which excludes issuers carrying a path). `resolveAgsHost` rejected it with `403`; with that pre-check disabled the same token was rejected with `401` by `setAuthFromToken`. MCP clients report either as credentials rejected on reconnect immediately after a successful browser login.

  `validateUrlMatchesIssuer` now also matches when the issuer's single path segment is exactly the derived host's leading label. The match is not gated on `ALLOW_PARENT_DOMAIN_ISSUER` because the label equality is self-verifying — a token minted for one namespace cannot be presented on another tenant's host. Host halves are compared case-insensitively; the issuer path segment must already be lowercase and free of `_`, since JWT `iss` is not case-normalized (RFC 7519 §2) and IAM namespaces are alphanumeric with hyphens.

  **This is a structural host↔issuer check, not authentication.** Completing a login on a tenant-subdomain host additionally requires `ALLOW_CROSS_DOMAIN_JWKS=true`: discovery against `{namespace}.{baseHost}` returns a `jwks_uri` on the parent host, and the default same-host check rejects it — so a deployment missing that flag still 401s at signature verification after this change. As of this release the namespaced issuer is live on internal environments only; production IAM has not picked up the hardening yet, so tokens there still carry the bare `{baseUri}` issuer and continue to rely on `ALLOW_PARENT_DOMAIN_ISSUER`.

## v2026.4.1 (2026-07-17)

### Fixed

- **OAuth discovery advertises path-aware protected-resource metadata.** The `WWW-Authenticate` challenge and the RFC 9728 well-known documents now preserve the full MCP resource path (e.g. `/mcp/{namespace}` → `/.well-known/oauth-protected-resource/mcp/{namespace}`), so MCP clients discover the namespace-specific authorization server instead of falling back to the root issuer. The shorter backend routes remain for reverse proxies that strip the MCP path.
- **Forwarded-origin trust tightened.** `deriveBaseUrl` honors `X-Forwarded-*` headers only when Express's compiled `trust proxy` check confirms the connecting peer is trusted (`TRUST_PROXY`); direct and untrusted hosted requests keep the configured public MCP / authorization-server URLs, so a spoofed `X-Forwarded-Host` cannot steer the URLs OAuth clients fetch.
- **`MCP_PATH="/"` no longer produces double-slash discovery URLs.** A root-mounted MCP path contributes no path segment when building the namespaced route (`/:namespace`, previously the unreachable `//:namespace`) and the advertised `resource_metadata` / `resource` URLs, so namespace routing and OAuth discovery work when the server is mounted at the web root.
- **Forwarded-port omission is now scheme-aware.** `deriveBaseUrl` drops `x-forwarded-port` only when it matches the resolved protocol's default (443 for `https`, 80 for `http`) instead of unconditionally dropping both, so a proxy chain that terminates TLS on port 80 (or plain HTTP on 443) still publishes a reachable URL.

## v2026.4.0 (2026-07-13)

### Added

- **Registered with the MCP registry.** A `server.json` manifest (`io.github.AccelByte/ags-api-mcp-server`) declares the hosted Shared Cloud and Private Cloud streamable-http remotes, so the server is discoverable via `registry.modelcontextprotocol.io`.
- **`server.json` version auto-syncs from `package.json`.** A `sync-server-version.js` step at the front of `pnpm build` rewrites the manifest version to match, and fails the build if `server.json`'s description is empty or exceeds the registry schema's 100-character cap — a version bump can no longer ship a stale or invalid manifest.

### Changed

- **OpenAPI specs refreshed from `justice-codegen-sdk-spec` (`095a09a127`).** All 21 bundled specs under `openapi-specs/` (including `iam`, `platform`, `social`, `inventory`, `session`, `csm`, `gdpr`) re-synced from the upstream codegen spec.
- **Relicensed under Apache-2.0.** Added top-level `LICENSE` and `NOTICE`, plus SPDX headers across the source tree.

## v2026.3.9 (2026-07-03)

### Changed

- **`afs.json` OpenAPI spec synced to athena-facade-api `0.7.0`** (build `7201785`), from `0.5.0`. This is what makes the v2026.3.8 pin-edit feature actually work: the bundled spec now defines `PATCH /afs/v1/admin/namespaces/{namespace}/pinned-queries/{id}` (`AdminUpdatePinnedQuery`) plus its `pinnedQueryUpdateBody`/`pinnedQueryResponse` schemas, so `update_pinned_query` → `updatePin` resolves via `runApi`/`findOperation` and issues a real `PATCH`. Previously the shipped bundle predated this op, so every resize/rename failed and rolled back with `PINNED_QUERIES_UNAVAILABLE` — the resize items and click-to-edit title rendered but could never succeed.

### Added

- **Spec-resolution guard test.** A new `pinned-queries.spec-resolution.test.ts` builds a real `OpenApiTools` over the actual bundled `openapi-specs/` and asserts every operation the pinned-queries provider issues — `GET`/`POST` list-create, `PATCH`/`DELETE` `{id}`, and `POST {id}/refresh` — resolves via `describeApi`/`findOperation` (and pins the PATCH `operationId` to `AdminUpdatePinnedQuery`). Every other pinned-queries test mocks at the `runApi` boundary and so can't catch provider↔spec drift; this test would have failed CI on the missing PATCH op instead of shipping a broken feature.

### Fixed

- **Click-to-edit pin title is now keyboard-accessible.** The editable `<h2>` gains `role="button"`, `tabindex="0"`, and an Enter/Space `keydown` handler that opens the same inline editor a click does (Space's default page-scroll is prevented) — previously rename was pointer-only, unreachable for keyboard/AT users, unlike the natively-operable Wider/Narrower `<button>`s.
- **A pin edit no longer fabricates `position: 0`.** `update_pinned_query` fell back to a hardcoded `0` when a facade `PATCH` response omitted `position`, which could silently reorder a renamed pin to the front of the grid. It now falls back to the caller-requested `position` (undefined for a title/span-only edit) and leaves `position` unset otherwise, so an unrelated edit can't assert a position the pin never had. `recordToMeta`'s position argument is now an optional fallback rather than a required index. (The `0.7.0` facade does echo `position` on the happy path; this hardens the omitted-field case.)
- **`position` on `update_pinned_query` documented as forward-looking.** The input field is accepted by the backend but wired to no renderer chrome yet (only title/span have UI affordances); a schema comment now flags it model-facing-only and notes a future reorder UI must give it the same optimistic-apply + rollback + server-reconcile handling span/title have.

## v2026.3.8 (2026-07-01)

### Added

- **Edit pinned queries from the dashboard (resize + rename).** A live pin's layout width is now user-editable via **Wider**/**Narrower** items in the card's kebab menu (a `+`/`−` step on the fullscreen 12-column grid, disabled at the 1/12 bounds), and its title via **inline click-to-edit** (a sandboxed webview blocks `window.prompt`, so the editor is an in-DOM input — Enter/blur commit, Escape cancels). Both persist to the facade through a new app-only `update_pinned_query` tool (→ `PATCH .../pinned-queries/{id}`), are applied **optimistically** and rolled back on failure, and are gated on the shared load guard so an edit can't interleave with a refresh/reload. Two new overflow chromes (`grow`/`shrink`), a `resize.ts` chrome module, and an `update` binder entry (`IntentType` gains `"update"`). **Static/snapshot pins are read-only** — they have no durable downstream row, so a snapshot's width/title is changed by re-prompting the model to re-open the dashboard (consistent with production being live-only).
- **Pinned-query provider gains `updatePin`** (`tools/providers/pinned-queries.ts`) — a partial `PATCH` proxy (`title`/`span`/`position`, only supplied fields sent). Requires facade **≥ 0.7.0** (`AdminUpdatePinnedQuery`); a build whose bundled `afs.json` predates it degrades with the usual `PINNED_QUERIES_UNAVAILABLE` error.

### Changed

- **`BUNDLE_VERSION` bumped to `1.7.0`** for the new edit affordances (cache-bust convention on a renderer change; no render-payload schema field changed). `PinMeta` gains a `span` field so the resize chromes can read the current width for the step + bound state.

## v2026.3.7 (2026-06-26)

### Changed

- **Pins now source by `query_id` instead of client-supplied SQL.** The whole save path — the standalone **Pin** button, the pin chrome, and the `pin_query` tool — forwards the facade `query_id` as the pin's source key; the backend re-sources `sql`, `database`, and `namespace` from the durable query row, so the model can't hallucinate them and refresh runs against the right Athena database (fixes a refresh-DB bug where a pin could re-run against the wrong database). `sql` is dropped as a trusted client input on create (still returned read-only for display), and a result is pinnable only when it carries a `query_id` — `direct` snapshots already had none, so the pinnable set is unchanged.
- **`afs.json` OpenAPI spec refreshed** for the above. `sql` is dropped from the required pin fields, `query_id` is documented as the preferred cache pointer (the facade sources `sql`/`database`/`namespace`/`moving_window`/`reasoning` from it), and a display-only `moving_window` field is added to the query, pin, and result schemas.

### Added

- **Rolling-window pins carry an authoritative `moving_window` flag.** The model declares `moving_window` at submit; it persists on the durable query row, travels with the `query_id`, and drives the dashboard's "re-scans a sliding range" caption. The old SQL regex heuristic is demoted to a fallback that fires only when the stored flag is absent (a legacy pin, or one whose durable row aged out), and the flag survives a refresh even when the refresh response omits it.
- **AFS playbook documents rolling vs snapshot windows.** `afs.md` adds a rolling-vs-snapshot decision to the pre-submit checklist — confirm with the user whether a relative time bound ("last 30 days") should be a frozen snapshot or a rolling window before writing the SQL, since the two behave differently once pinned — and documents the new `reasoning` and `moving_window` submit-body fields.

### Fixed

- **`moving_window` flag now survives every refresh path.** The single-pin `refresh_pinned_query` tool and the stale/error cards built by `refresh_all_pinned` now carry the stored `moving_window` flag, matching the batch-refresh and load paths. Previously these two paths dropped it, so a rolling-window pin's caption could silently revert to the SQL-heuristic fallback after a single refresh or a partial (quota-stopped) refresh-all.
- **`BUNDLE_VERSION` bumped to `1.6.0`** for the `query_id` field added to every render output schema (via `CommonEnvelopeFields`) — the app-shell asserts host-advertised version == bundle version, so a new payload field requires the bump. The `open_dashboard` tool description no longer lists `sql` as a pin field, since it's re-sourced from `query_id` rather than trusted as client input.

## v2026.3.6 (2026-06-25)

### Added

- **Dashboard home surface for the analytics MCP App.** The renderer resource gains a second mode (`chart_type:"dashboard"`) alongside single-result rendering: a usage header (monthly + lifetime Athena spend) plus a grid of **pinned queries**. A pin stores **SQL (source of truth) + last `query_id` (cache pointer) + render spec (`render_tool` + opaque `render_options`)** — never rows. New tools: `open_dashboard` (model-facing, returns a metadata-only `dashboard` payload bound to `ui://renderer/index.html`) and app-only `load_dashboard` / `get_quota_usage` / `pin_query` / `unpin_query` / `refresh_pinned_query` / `refresh_all_pinned`. A **Pin** button is injected into single-result charts so the user can keep one on the dashboard. `define.ts` now exposes a render-tool registry (`buildPinRenderOutput`) so any of the 16 charts rebuilds from a stored pin. `BUNDLE_VERSION` bumped to `1.4.0`. See `docs/ARCHITECTURE.md` (Analytics & Visualization → Dashboard).
  - **Column-span layout.** Each pin takes an optional `span` (integer 1–12, clamped; default 4) on a fixed **12-column** fullscreen grid (fixed-height cards, body scrolls inside); compact/inline and containers under 720px collapse to a single column.
  - **Open never re-runs SQL** — `load_dashboard` resolves cached results only (existing `GET .../queries/{id}` path); an expired/absent `query_id` shows a _stale_ card ("click Refresh"), so a dashboard of moving-window queries can't bill on every open. **Refresh is the only re-run path** and is always an explicit user click; refresh-all is budget-gated and stops on `429`.
  - **Restart-survivable & abuse-resistant** — the widget self-loads via `load_dashboard` on mount and on focus (reconstructs even if the host evicted the result via compaction); sizing reads `containerDimensions.height` (fixed body, scroll inside); all card text is set via `textContent`, `render_options` is re-validated against the chart schema in both server and bundle, and each card renders in its own `try/catch` so a hostile pin can't execute or blank the grid.
  - Pin persistence lives downstream in athena-facade-api (a `.../pinned-queries` resource owning create/list/delete/refresh, submit→poll, and auto-heal); the MCP server stays a stateless proxy (`tools/providers/pinned-queries.ts`). Until that ships, open/load/usage work against existing endpoints (model-held pins) and the save/refresh tools degrade with a clear `PINNED_QUERIES_UNAVAILABLE` error.
- **AFS playbook gains a pre-submit cost estimate.** `afs.md` step 4 now documents `POST /afs/v1/admin/namespaces/{namespace}/queries/estimate` (`AdminEstimateQuery`) — a side-effect-free dry run that returns `estimated_cost_usd`, `estimated_bytes_scanned`, `pricing_rate_usd_per_tb`, and a `would_exceed_quota` flag without executing the query or reserving quota. Guidance steers the model to estimate before large or open-ended queries, to read the byte figure as a full-scan _ceiling_ (it ignores partition pruning and column projection, so the actual bill is usually far lower) rather than quote it as the price, and to confirm with the user — or narrow the query — when the estimate is non-trivial or `would_exceed_quota` is set.
- **AFS playbook documents pinning & the dashboard.** `afs.md` gains a _Pinning & the dashboard_ section and folds pinnability into the provider choice (steps 5/7): only `facade` results carry a **Pin** button — `direct` snapshots can't be pinned (no `query_id`, never refresh) — so dashboard-worthy results (a recurring KPI, a chart the user will revisit) should be rendered via `facade` even when small. Clarifies that pinning is the user's UI action while `open_dashboard` is the model's, and that open/reload only resolve cached results (refresh is the sole billable re-run).

### Changed

- **`afs.json` OpenAPI spec refreshed** from athena-facade-api `0.5.0` (build `bb3b0bb`). Adds the pinned-queries resource (`AdminListPinnedQueries` / `AdminCreatePinnedQuery` / `AdminDeletePinnedQuery` / `AdminRefreshPinnedQuery`) and the query cost-estimate endpoint (`AdminEstimateQuery`); no operations removed. The dashboard's pin save/refresh tools, written against these endpoints, now resolve and call them directly instead of degrading at `runApi` lookup time.
- **Pinned-query availability docs corrected** now that the endpoints ship in the bundled spec. `docs/ARCHITECTURE.md` and `tools/providers/pinned-queries.ts` no longer describe `runApi` rejecting these at lookup; `PINNED_QUERIES_UNAVAILABLE` now denotes only a server build whose bundled spec predates the endpoints, while a deployed-but-erroring facade returns an HTTP error that `load_dashboard` degrades on (inline pins + notice).

## v2026.3.5 (2026-06-04)

### Changed

- **AFS playbook gains table-discovery and SQL hints.** `afs.md` now documents the `/tables` filter interface (`query` substring match, `offset`/`limit` paging) and steers the model to probe the table family the context names rather than guessing event names. Adds a sibling-table caution (check success/failure and direct vs. third-party/platform splits, and `UNION` when a metric like DAU spans them, to avoid silently undercounting platform logins), a timestamp-casting nudge (reach for `from_iso8601_timestamp()` when a `CAST(... AS DATE)` errors on ISO-8601 string columns), the average-over-window vs. average-over-active-days ambiguity for metrics like DAU, and a note that `get_token_info` resolves the caller's namespace as a default while still deferring to an explicit sub-namespace.
- **`afs.json` OpenAPI spec refreshed** from athena-facade-api `0.4.0` (build `c1146ae`). The `/tables` `database` query param is now optional — the facade backfills the configured default when omitted, so `run-apis` no longer blocks valid calls that leave it off. Context update/delete permission scopes relaxed from `QUERY [UPDATE]` to `QUERY [READ]`, and `body` dropped from the required fields on context create/update.

## v2026.3.4 (2026-06-03)

### Changed

- **AFS spend-budget rendering rules expanded.** The budget check now reads `quota/usage` alone (it already reports `null`-vs-set caps for both the monthly and lifetime dimensions, so the separate `quota/monthly-limit` GET was redundant), and `afs.md` gains a cap matrix plus `render_meter`/`render_metric` label conventions. Added guidance on 2-decimal USD rounding, the `direct` provider (quota returns plain JSON, not a pollable `query_id`), over-limit visualization (omit `color` so the meter auto-recolors to the danger token), and zero-projection handling. The cap-mutation (`PUT`) reference was removed.
- **AFS query submission and provider guidance clarified.** `afs.md` now states the `POST /queries` body fields (`sql`, `database`, `max_rows`, `wait_ms`) up front, and reframes the `direct`/`facade` provider choice as a data-fidelity decision: `direct` routes the result set through the model and is reproduced verbatim (reserve for small results), while `facade` is source-fetched by `query_id` (prefer for substantial sets). Notes that fast-path `query_id`s may `404` when polled, so the provider path must be chosen before submitting.

## v2026.3.3 (2026-06-02)

### Added

- **AFS Analytics Context playbook.** New `assets/playbooks/afs-context.md` for authoring/editing the analytics context catalog via `render_text_editor` — covers merge order (`order` relative to the embedded base), optimistic concurrency (`If-Match`), field constraints (`name` pattern, `kind` enum, `table_refs`, `order`), and `CONTEXT_*`/backend error handling. `afs.md` gains a spend-budget section (read the quota and show it with `render_meter`), the `namespacez` partition-predicate requirement, and a cross-reference to the context playbook.

### Changed

- **`render_text_editor` round-trips edits back to the model.** As an input tool its value originates in the webview, so user edits now travel back through two stateless channels: silent auto-sync (debounced ~1.5s push into the model's context via `ui/update-model-context`, read back through the host's widget context — `read_widget_context` on Claude Desktop, surfaced automatically elsewhere) and an explicit **Send to chat** button (`ui/message`). Pending edits flush on fullscreen-exit/teardown and on `pagehide`/`visibilitychange` so the last keystrokes aren't lost. The server stays stateless — nothing is stored. See `docs/ARCHITECTURE.md#render-tools`.
- **Render tool descriptions are now domain-agnostic.** The generic `render_*` tools no longer hard-code AFS/Athena specifics — dropped "Athena Facade", "query_id+namespace", "ideal for usage limits", and the context-API example; `provider="facade"` is described generically as re-fetching server-side results by reference. Provider enum names and the AFS-specific facade provider implementation are unchanged (prose only); AFS specifics now live solely in the playbooks.
- **`afs.json` OpenAPI spec refreshed** from `development_main`, adding the contexts and quota operations.

### Fixed

- **Docker image builds natively instead of under QEMU.** The builder stage is pinned to `$BUILDPLATFORM` so `pnpm run build` runs on the native platform; emulated builds crashed esbuild (vite) with "The service was stopped" on `render-schemas.ts`. Build output and production deps are pure JS, so artifacts remain valid for the target-platform runtime stage.
- **AFS playbook correctness.** Context update is `PUT` (`AdminUpdateContext`), corrected from `PATCH`; the pre-submit checklist now requires the `namespacez` partition filter (omitting it returns `400 MISSING_PARTITION_PREDICATE`, and the column spelling is distinct from the URL `{namespace}`); `afs.md` now states the `athena-facade-poc` spec identifier up front so `run-apis` calls don't guess it from the URL; added a "when a call fails unexpectedly" note steering to `describe-apis`/`search-apis` before assuming a backend bug.

## v2026.3.2 (2026-05-29)

### Added

- **Playbooks: markdown prose loaded as MCP prompts.** Drop `*.md` files into `assets/playbooks/` and each is registered as its own MCP prompt (no arguments) plus a fetchable resource, so it appears directly in the host's slash-command menu under a derived title — no indirection or typed name argument. Title precedence: YAML frontmatter `title:` at the top of the file → first H1 (with a trailing " Playbook" stripped) → filename. The final menu entry reads `Run <topic> Playbook`. Use them to ship persona, guidance, or instructions the user can invoke by name.
- **New `render_text_editor` tool.** The first _input_ render tool — not provider-backed. Loads an editable document into the webview (CodeMirror 6) with syntax highlighting and a language picker (`markdown`/`json`/`yaml`/`javascript`/`text`), plus a markdown preview. Fullscreen shows the editor; inline/pip shows a preview (rendered markdown, or read-only highlighted code with folding), driven by `hostContext.displayMode` with a `requestDisplayMode` toggle. The edited bytes leave the webview _verbatim_ (never regenerated by the model) via two stateless exits: `updateModelContext` (embedded resource — assistant reads it this turn) and `downloadFile` (embedded resource — a durable file that survives chat compaction), with clipboard copy as the universal fallback. Actions are capability-gated via `getHostCapabilities()`. The server stores nothing; persistence to an API (e.g. AFS `…/context`) stays downstream and model-driven. Inputs: `content` (required), optional `language` and `title`. See `docs/ARCHITECTURE.md#render-tools`.
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
