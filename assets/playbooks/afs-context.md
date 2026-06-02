---
title: Analytics Context
---

# Analytics Context Playbook

You are curating the **analytics context catalog** for a namespace — the document the Athena query workflow reads before writing any SQL. Follow these directions carefully.

## When to use this playbook

Use this playbook when the user wants to **author, edit, or organize** the tenant's own context documents — descriptions of tables, naming conventions, business definitions, common joins — that get merged into the catalog the query workflow consumes.

This is the *setup* side, not the *query* side. If the user wants to **run a query** against the data, use the **Analytics** playbook instead. If they want to *read* the current merged catalog, that's a single `GET /afs/v1/admin/namespaces/{namespace}/context` — you don't need this playbook for that.

## How contexts merge

The catalog returned by `GET .../context` interleaves the embedded **base context** with every tenant-authored context, sorted by `(order ASC, created_at ASC)`. The base sits at `order = 0`, so:

- A context with **negative `order`** merges **before** the base.
- A context with **positive `order`** (the default is `100`) merges **after** it.

`order` is how the user controls precedence. Lower wins earlier placement. Mention this when they're deciding where new guidance should sit relative to the built-in catalog.

## Authoring & editing: use `render_text_editor`

Context bodies are free-form prose (typically Markdown). **Don't hand-assemble the body in a request from memory** — open it in the editor and let the user own the text:

- **Authoring a new context:** call `render_text_editor` with a starter `content` (a template or your draft), `language="markdown"`, and a `title`. The user revises in the webview and either adds the result to your context or saves it to a file.
- **Editing an existing context:** first `GET .../contexts/{id}` to fetch the current `body`, seed `render_text_editor` with it, and let the user edit from there.

When you later build the create/update request body, **read the edited content back** from the saved file or the added context — don't reconstruct it.

## Operations

### List — `GET /afs/v1/admin/namespaces/{namespace}/contexts`

Returns `data` (array) and `total`. The `body` field is **omitted** from list items to keep payloads small — list to find an `id`, then `GET .../contexts/{id}` for the full row including `body`.

### Get one — `GET /afs/v1/admin/namespaces/{namespace}/contexts/{id}`

Returns the full row: `context_id`, `name`, `kind`, `body`, `order`, `table_refs`, plus `authored_by`/`created_at`/`updated_by`/`updated_at`. Returns `404 CONTEXT_NOT_FOUND` for an unknown id. The `id` is a KSUID.

### Create — `POST /afs/v1/admin/namespaces/{namespace}/contexts`

Body: `name`, `kind`, `body`, `table_refs`, optional `order` (defaults to `100`). On success the next `GET .../context` reflects the merge. Surface these errors plainly rather than retrying blindly:

- `CONTEXT_NAME_TAKEN` — pick a different name.
- `CONTEXT_COUNT_EXCEEDED` — the tenant is at its context limit; suggest deleting or consolidating.
- `CONTEXT_BODY_TOO_LARGE` — trim the body.
- Validation: `INVALID_KIND`, `INVALID_TABLE_REFS`, `INVALID_ORDER`.

### Update — `PATCH /afs/v1/admin/namespaces/{namespace}/contexts/{id}`

You can change `body`, `order`, and `table_refs`. **`name` and `kind` are immutable** — don't offer to edit them. Updates use **optimistic concurrency**: send `If-Match: <the row's prior updated_at, RFC3339>`. So fetch the row first (or reuse its `updated_at`), and if the `If-Match` is rejected, re-fetch and let the user reconcile rather than overwriting blindly.

### Delete — `DELETE /afs/v1/admin/namespaces/{namespace}/contexts/{id}`

**Idempotent** — deleting an unknown id still returns `204`. Confirm with the user before deleting (context is editorial work that's annoying to lose), but don't treat a `204` on a missing id as an error.

## After any write

Create, update, and delete invalidate the merge cache, so the next `GET .../context` returns the updated catalog. If the user wants to verify their change landed, re-fetch the merged context and show them where their document sits in the order — or hand off to the **Analytics** playbook to actually query with the new context in effect.
