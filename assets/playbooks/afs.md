---
title: Analytics
---

# AFS Analytics Playbook

You are running an Athena-backed analytics query against AGS event logs. Follow these directions carefully.

## When to use this playbook

This playbook is for questions that need to scan or aggregate **event log history** stored in Athena — things that scale with the number of players, events, or time periods involved.

Before you start, decide if Athena is even the right tool. Many questions look analytic but actually fit a direct API call:

| Use direct APIs when… | Use this playbook (Athena) when… |
|---|---|
| The question is about *one* player, *one* item, *one* order ("get entitlements for player X") | The question scales with N players or events ("get entitlements for every player") |
| You need the *current* state ("is this user banned?") | You need historical aggregation ("how many bans last quarter?") |
| The boundary is a single entity | The boundary is the whole game / namespace / time window |
| Cost grows linearly with the answer | Cost grows exponentially if done by direct calls |
| Time to answer is one quick call | Time to answer would be many serial calls (slow) or many parallel calls (hits rate limits / throttling) |

Think of it as ordering at a restaurant: one diner ordering off the menu is a direct API; a wholesale bulk order is Athena.

**If a direct API fits better:** tell the user which approach and roughly which endpoints would work (use `search-apis` if you need to look them up), then **stop**. Don't run an Athena query just because you can — the user can re-ask if they want the direct-API path.

## Scope

This playbook covers **read-only `SELECT` queries** against event log tables. The Athena Facade service enforces this at the API layer — non-`SELECT` statements (DDL, writes, table creation) are rejected on submission. Scope your intent accordingly: this is for analytics reads, not data manipulation.

## Spec identifier

Every endpoint below lives in the **`athena-facade-poc`** spec. Pass `spec="athena-facade-poc"` to `run-apis` (or use the full `apiId`, formatted `athena-facade-poc:METHOD:/path`, that `search-apis` returns) — don't guess the spec name from the URL or the AGS service it fronts.

## Steps

Every endpoint takes a `{namespace}` path param. When the user hasn't named one, `get_token_info` gives you the caller's own namespace from the token — a sensible default. If they've asked about a specific sub-namespace, use that instead.

### 1. Always start with `GET /afs/v1/admin/namespaces/{namespace}/context`

The context document is the catalog for this namespace's event tables: what tables exist, naming conventions, partition columns, common joins. Without it you will hallucinate table or column names. Don't skip it even if you think you remember the schema from a previous turn — it's namespace-specific.

The response is the *merged* catalog: the embedded base context plus any tenant-authored context documents, interleaved by `order`. To add or edit those tenant documents — not just read them — use the **Analytics Context** playbook instead; this playbook only consumes the merged result.

### 2. Find candidate tables with `GET /afs/v1/admin/namespaces/{namespace}/tables`

Search/filter to identify which tables the user's question maps to. Narrow to **2–3 most likely candidates** — don't fan out further unless the first pass clearly doesn't fit.

Filter with the **`query`** parameter (a substring match on the table name) and page with **`offset`** / **`limit`**. One substring probe beats guessing exact table names serially — physical table names often don't match the logical event names in the context doc, so when the context names a table family (e.g. `userauthentication`), probe with *that* rather than the event's English name (`login`, `oauth`).

When you find the table for an event, check for **sibling tables** that hold the same metric split a different way — success vs. failure, direct vs. third-party/platform. Decide whether the user's metric needs a `UNION` across them *before* querying: a "logins" or "DAU" count drawn only from the direct-login table silently undercounts platform (Steam/PSN/Epic) logins.

### 3. Fetch schema with `GET /afs/v1/admin/namespaces/{namespace}/tables/{database}/{table}`

For each candidate table, get column-level metadata. Stop when you have enough to write the query.

### 4. Before submitting a query, check these

Athena bills per byte scanned, and bad queries get expensive fast. Before calling `POST /queries`:

- **Tenant filter (`namespacez`):** every query against the analytics database must constrain the `namespacez` column to the caller's tenant — e.g. `WHERE namespacez = '<namespace>'`. The literal has to equal the caller's *studio* (the part before the first `-` in the namespace, so `studioalpha-game-a` → `studioalpha`) or a full `<studio>-<game>` value under it. Omit it and submission is rejected with `400 MISSING_PARTITION_PREDICATE`. Two gotchas: the column is spelled `namespacez` (with a **z**), and this is a *row filter inside the SQL* — separate from, and required in addition to, the `{namespace}` in the URL path.
- **Time bound:** include a partition predicate (typically a date/time range). If the user didn't give one, **ask** — don't assume "all time."
- **Explicit columns:** project the columns you need, not `SELECT *`.
- **`LIMIT`:** use it during exploration. Widen only after you've seen the shape of the results.
- **Mind the column types.** Event `timestamp` columns are often ISO-8601 *strings*, not SQL dates — so if a `CAST(... AS DATE)` or date comparison errors, reach for `from_iso8601_timestamp()` rather than assuming a bad column. Check the schema from step 3 when in doubt.
- **Other missing inputs:** if the user's question lacks a clear entity scope (player, region, etc.) or metric definition, ask before submitting. Watch for averages in particular — "average DAU over 30 days" can mean *over 30 calendar days* or *over the days with activity*, and they differ a lot when the window has gaps. Clarify, or show both and label them.

#### Checking the spend budget

When the user asks how much budget is left, or you want to sanity-check before running something potentially large, read the quota snapshot:

- `GET /afs/v1/admin/namespaces/{namespace}/quota/usage` → `monthly` (`used_usd`, `limit_usd`, `projected_run_rate_usd`, `period`) and `lifetime` (`used_usd`, `limit_usd`)

This one call is enough. A `limit_usd` of `null` means unlimited for that dimension — so the snapshot already tells you whether each cap is set; there's no separate lookup to do. `used_usd` reflects pre-execution *estimates*; actuals reconcile later. Every USD figure is a full-precision float — round to 2 decimals wherever you display it (e.g. `8.503217` → `$8.50`).

**Rendering rules:**

Use `render_meter` only for dimensions that have a real numeric limit (`limit_usd > 0`). Use `render_metric` for uncapped dimensions. Never pass `null` as a `max` column value — the renderer rejects it.

These widgets render with `provider="direct"` — the quota endpoint returns plain JSON, not a pollable `query_id`, so you supply the rows yourself (round USD to 2 decimals first).

To flag over-budget visually, **omit the `color` column** on the meter: when `used_usd` exceeds `limit_usd` the renderer auto-clamps the bar to full width and recolors it to the danger token (red). Passing a `color` suppresses that highlight.

When `projected_run_rate_usd` is 0 (fresh period, no usage yet), drop the `· projected: …` suffix rather than rendering `$0.00`.

Determine which widgets to render based on this matrix:

| Monthly cap | Lifetime cap | Widgets |
|---|---|---|
| null | set | `render_meter` (lifetime only) + `render_metric` (monthly) |
| set | set | `render_meter` (both rows) — no metric needed |
| null | null | `render_metric` (monthly) + `render_metric` (lifetime) |
| set | null | `render_meter` (monthly only) + `render_metric` (lifetime) |

**`render_meter` label conventions:**

- Monthly row (capped): `Monthly – {period} (USD) · projected: ${projected_run_rate_usd}` e.g. `Monthly – 2026-06 (USD) · projected: $8.50`
- Lifetime row (capped): `Lifetime (USD)`
- `title`: `Athena Quota`

**`render_metric` label conventions:**

- Monthly (uncapped):
  - `title`: `Monthly Spend`
  - `label`: `{period} (USD)` e.g. `2026-06 (USD)`
  - `description`: `Estimated · actuals reconcile later · projected: ${projected_run_rate_usd}`
- Lifetime (uncapped):
  - `title`: `Lifetime Spend`
  - `label`: `Lifetime (USD)`
  - `description`: `No lifetime cap set`

#### Estimating what a specific query will cost

The quota snapshot tells you how much budget is *left*; it doesn't tell you what *this* query will cost. For that, dry-run it before submitting:

- `POST /afs/v1/admin/namespaces/{namespace}/queries/estimate`, body `{ "sql": "…" }` (plus optional `database`) → returns `estimated_cost_usd`, `estimated_bytes_scanned`, `pricing_rate_usd_per_tb`, and a `would_exceed_quota` flag. It executes nothing and reserves no quota, so it's side-effect free and safe to repeat.

Reach for it before anything you expect to be **large or open-ended** — a wide or unbounded time range, several big tables, or a question where the user hasn't pinned down the scope. Skip it for an obviously small probe (a `LIMIT` over one narrow partition): the estimate costs a round-trip and can mislead (see below).

**Read the number honestly — it's a ceiling, not the bill.** `estimated_bytes_scanned` is the summed full-scan size of every referenced table; it *ignores* partition pruning and column projection. A query carrying the `namespacez` filter and a tight time partition (both already required above) routinely scans **orders of magnitude less** than the estimate. So:

- Present it as an upper bound — "at most ~$X, likely far less once the tenant and date partitions prune" — never as the definite price, or you'll talk the user out of a query that actually costs cents.
- If `would_exceed_quota` is `true`, stop: surface it, then either narrow the query or get the user's explicit go-ahead before submitting.
- If the ceiling is non-trivial and the user hasn't already signalled they're fine spending, **confirm before you submit.** That is the whole point of estimating.

### 5. Submit with `POST /afs/v1/admin/namespaces/{namespace}/queries`

Body fields: `sql` (the query text), optional `database`, optional `max_rows`, and `wait_ms` (milliseconds).

`wait_ms` controls the fast path, and the choice has a fidelity cost worth understanding:

- **Small result you're confident reproducing** (a headline number, a handful of rows): pass a small `wait_ms` (e.g. a few seconds). If the response is `200` with `columns` and `rows` inline, the query finished synchronously — skip step 6 and render those inline rows via `provider="direct"`.
- **Substantial result set destined for a table or chart:** pass `wait_ms=0`, skip the fast path on purpose, and poll (step 6). This guarantees you hold a pollable `query_id` so the renderer can fetch rows from source via `provider="facade"`. See the provider note in step 7 for why this matters.

Either way, if you don't get inline rows you get a `query_id` and need to poll.

> **Don't try to have it both ways.** A `query_id` returned alongside fast-path inline rows may **404** if you later `GET` it — fast-path results aren't guaranteed to be pollable. So once you've taken the fast path, render the inline rows with `direct`; don't hand that id to `facade`. If you need source-fetched rows, decide *before* submitting and use `wait_ms=0` (re-running a finished query costs latency and re-scans bytes).

### 6. Poll with `GET /afs/v1/admin/namespaces/{namespace}/queries/{id}`

Poll every few seconds until the status is terminal. Use judgment on how long to wait — a simple aggregation over a narrow time window should finish in seconds; a large multi-join can take minutes. Check in with the user periodically if it's taking longer than they'd reasonably expect.

Status values are uppercase as returned by the facade:

- **`SUCCEEDED`:** proceed to render.
- **`FAILED` or `CANCELLED`:** surface the error message to the user. Propose a narrower query (tighter time range, fewer columns, smaller scope) and offer to retry — don't silently re-submit the same broken query.
- **`RUNNING` / `QUEUED`:** keep polling.
- **User wants to stop a running query, or you've decided to abandon it:** call `DELETE /afs/v1/admin/namespaces/{namespace}/queries/{id}` to cancel. It's idempotent.

### 7. Render results

Pick the render tool that fits the *shape* of the answer, not just "results are a table." Some hints:

| If the answer is… | Use… |
|---|---|
| A small set of rows the user wants to inspect | `render_table` |
| A single headline number (count, average, ratio) | `render_metric` |
| Progress / capacity / "X of Y used" | `render_meter` or `render_gauge_chart` |
| A comparison across discrete categories | `render_bar_chart` |
| Parts of a whole (proportions, market share) | `render_pie_chart` or `render_donut_chart` |
| A trend over time | `render_line_chart` or `render_area_chart` |
| Distribution / spread of a single variable | `render_histogram_chart` or `render_box_chart` |
| Relationship between two numeric variables | `render_scatter_chart` |
| Step-by-step conversion or drop-off | `render_funnel_chart` |
| Cumulative buildup or net change across additions/subtractions | `render_waterfall_chart` |
| State changes of an entity over time | `render_state_timeline_chart` |
| Two-dimensional density (e.g. hour × day) | `render_heatmap_chart` |

**A note on `provider` — this is a fidelity decision, not just plumbing.** `provider="facade"` takes a `query_id` and re-fetches rows server-side from the Athena Facade, so the rendered bytes come straight from source. `provider="direct"` takes `data_columns`/`data_rows` that **you** supply — meaning the result set is routed through your context and reproduced as tool arguments, and the renderer trusts them verbatim. Reproducing tabular data by hand is error-prone (dropped rows, reordered values, coerced numbers, truncated strings), and nothing downstream catches a mismatch.

So:

- Use `provider="direct"` only for **small results you're confident reproducing exactly** — the fast-path case in step 5.
- Use `provider="facade"` for **anything substantial** — larger row counts, anything the user will scrutinize as a table or chart. Get a pollable `query_id` (submit with `wait_ms=0`, poll in step 6) so the renderer pulls from source rather than from your reproduction.

### 8. Summarize and offer follow-up threads

Don't just dump the rendered output. Write:

- A **brief summary** of what the data shows (2–4 sentences).
- **2–3 follow-up suggestions** the user might pull on — related questions, drill-downs, anomalies worth checking, angles you didn't pursue. Call them "threads," "leads," "follow-ups," whatever fits — the point is to turn a one-shot answer into a conversation.
