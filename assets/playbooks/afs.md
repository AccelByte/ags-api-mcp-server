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

## Steps

### 1. Always start with `GET /afs/v1/admin/namespaces/{namespace}/context`

The context document is the catalog for this namespace's event tables: what tables exist, naming conventions, partition columns, common joins. Without it you will hallucinate table or column names. Don't skip it even if you think you remember the schema from a previous turn — it's namespace-specific.

### 2. Find candidate tables with `GET /afs/v1/admin/namespaces/{namespace}/tables`

Search/filter to identify which tables the user's question maps to. Narrow to **2–3 most likely candidates** — don't fan out further unless the first pass clearly doesn't fit.

### 3. Fetch schema with `GET /afs/v1/admin/namespaces/{namespace}/tables/{database}/{table}`

For each candidate table, get column-level metadata. Stop when you have enough to write the query.

### 4. Before submitting a query, check these

Athena bills per byte scanned, and bad queries get expensive fast. Before calling `POST /queries`:

- **Time bound:** include a partition predicate (typically a date/time range). If the user didn't give one, **ask** — don't assume "all time."
- **Explicit columns:** project the columns you need, not `SELECT *`.
- **`LIMIT`:** use it during exploration. Widen only after you've seen the shape of the results.
- **Other missing inputs:** if the user's question lacks a clear entity scope (player, region, etc.) or metric definition, ask before submitting.

### 5. Submit with `POST /afs/v1/admin/namespaces/{namespace}/queries`

Pass a small `wait_ms` (e.g. a few seconds) to take advantage of the fast path:

- **If the response is `200` with `columns` and `rows` inline,** the query finished synchronously. Skip step 6 and render the inline rows directly.
- **Otherwise,** you get a `query_id` and need to poll.

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

**A note on `provider`:** render tools accept `provider="facade"` (re-fetch results by `query_id` from the Athena Facade) or `provider="direct"` (render rows you already have inline). This playbook produces both — fast-path responses from step 5 give you inline rows; polled responses from step 6 typically use `query_id`. Use `direct` when you already hold the rows, `facade` when you're handing off the `query_id` and letting the renderer fetch.

### 8. Summarize and offer follow-up threads

Don't just dump the rendered output. Write:

- A **brief summary** of what the data shows (2–4 sentences).
- **2–3 follow-up suggestions** the user might pull on — related questions, drill-downs, anomalies worth checking, angles you didn't pursue. Call them "threads," "leads," "follow-ups," whatever fits — the point is to turn a one-shot answer into a conversation.
