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

## Authoring with `render_text_editor`

Context bodies are free-form prose (typically Markdown). **Never hand-assemble the body from memory** — open `render_text_editor` and let the user own the text. The editor opens as a read-only inline preview; the user clicks **fullscreen** to edit.

**Getting the edited text back.** As the user edits, the editor continuously syncs the current document into your context. To read it, pull the **widget/app context**:

- **Claude Desktop:** call the `read_widget_context` tool (pass the editor tool's name) to get the latest content.
- **Other hosts:** the synced content is surfaced to you automatically — just use the most recent version.

Your `content` argument is only a *starting* value — always build the write from the latest synced widget context, never from your own draft. If nothing has synced yet (the user hasn't edited), ask them to edit before proceeding. (The editor's **Send to chat** button posts the document to the conversation; if the user uses it, that posted text is the body.)

### Create flow

1. Call `render_text_editor` with `language="markdown"`, a `title`, and `content` set to either a blank starter or a template/draft to get the user going.
2. The user opens fullscreen and edits; their text syncs to your context automatically.
3. **Read the latest widget context** to get the final body (see above) — don't reuse your starter text.
4. **Confirm conversationally** before writing: summarize what you're about to create (name, kind, where it sits in `order`) and ask the user to go ahead. Keep it to one check — the write itself also triggers a host consent prompt, so don't nag twice.
5. On agreement, call `run-apis` for `POST /afs/v1/admin/namespaces/{namespace}/contexts` with that body and the metadata. Approve the consent prompt that the POST raises.

### Update flow

1. First pull the current document: `run-apis` → `GET /afs/v1/admin/namespaces/{namespace}/contexts/{id}` (the list endpoint omits `body`, so fetch the single row). Keep its `updated_at` — you need it for the `If-Match` header.
2. Seed `render_text_editor` with the fetched `body` so the user edits from the real current text, not a guess.
3. Same as the create flow from here: read the latest widget context for the edited body, confirm conversationally, then `run-apis` → `PUT .../contexts/{id}` with `If-Match: <prior updated_at>`. Remember `name` and `kind` are immutable — only `body`, `order`, and `table_refs` can change.

## Field constraints

Validate these before you `POST` — the API rejects each with a `400` rather than coercing, and getting them wrong costs a round-trip:

- **`name`** — must match `^[a-z][a-z0-9_]{0,63}$`: starts with a lowercase letter, then lowercase letters / digits / underscores, max 64 chars. **No hyphens, no spaces, no uppercase.** Set at create and immutable after.
- **`kind`** — exactly `custom_table` or `ags_extension`, also immutable after create:
  - **`custom_table`** — a free-standing document (glossary, conventions, business definitions) not bound to any table. This is the **default choice** when there's no specific table to attach to; `table_refs` is optional.
  - **`ags_extension`** — annotates specific AGS-managed tables, and therefore **requires at least one `table_refs` entry**.
- **`table_refs`** — each entry must be `<database>.<table>`, and the database must be one the namespace allows. Required (≥1) for `ags_extension`; omit for `custom_table`.
- **`order`** — a 32-bit signed integer (default `100`); see [How contexts merge](#how-contexts-merge) for what the value controls.

## When a call fails unexpectedly

This playbook can drift from the live spec. If a `run-apis` call fails in a way that looks structural — `operation not found`, a method mismatch, or an unexpected `400` on parameters — verify against the spec *before* assuming a backend bug:

- **Run `describe-apis` first.** It confirms the operation's exact method, path params, and request shape — the fastest way to tell a client-side mistake from a real backend error.
- **Use `search-apis` with `spec=athena-facade-poc`** to discover the correct operation (method, path, `apiId`) if the playbook and spec have diverged — trust the spec over the playbook.
- **If `describe-apis` confirms your parameters were correct and the call still fails** (e.g. a `500`), treat it as a genuine backend issue: surface the error message and the `trace_id` to the user rather than retrying blindly.

## Operations

### List — `GET /afs/v1/admin/namespaces/{namespace}/contexts`

Returns `data` (array) and `total`. The `body` field is **omitted** from list items to keep payloads small — list to find an `id`, then `GET .../contexts/{id}` for the full row including `body`.

### Get one — `GET /afs/v1/admin/namespaces/{namespace}/contexts/{id}`

Returns the full row: `context_id`, `name`, `kind`, `body`, `order`, `table_refs`, plus `authored_by`/`created_at`/`updated_by`/`updated_at`. Returns `404 CONTEXT_NOT_FOUND` for an unknown id. The `id` is a KSUID.

### Create — `POST /afs/v1/admin/namespaces/{namespace}/contexts`

Body: `name`, `kind`, `body`, `table_refs`, optional `order` — see [Field constraints](#field-constraints) for the rules on each. On success the next `GET .../context` reflects the merge. Surface these errors plainly rather than retrying blindly:

- `CONTEXT_NAME_TAKEN` — that name is already used; pick a different one. (A malformed name fails earlier as `BAD_REQUEST` — see Field constraints.)
- `CONTEXT_COUNT_EXCEEDED` — the tenant is at its context limit; suggest deleting or consolidating.
- `CONTEXT_BODY_TOO_LARGE` — trim the body.
- Validation: `INVALID_KIND`, `INVALID_TABLE_REFS`, `INVALID_ORDER`.

### Update — `PUT /afs/v1/admin/namespaces/{namespace}/contexts/{id}`

Use **`PUT`** (`apiId: athena-facade-poc:PUT:/afs/v1/admin/namespaces/{namespace}/contexts/{id}`, operation `AdminUpdateContext`). You can change `body`, `order`, and `table_refs`. **`name` and `kind` are immutable** — don't offer to edit them. Updates use **optimistic concurrency**: send `If-Match: <the row's prior updated_at, RFC3339>`. So fetch the row first (or reuse its `updated_at`), and if the `If-Match` is rejected, re-fetch and let the user reconcile rather than overwriting blindly.

### Delete — `DELETE /afs/v1/admin/namespaces/{namespace}/contexts/{id}`

**Idempotent** — deleting an unknown id still returns `204`. Confirm with the user before deleting (context is editorial work that's annoying to lose), but don't treat a `204` on a missing id as an error.

## After any write

Create, update, and delete invalidate the merge cache, so the next `GET .../context` returns the updated catalog. If the user wants to verify their change landed, re-fetch the merged context and show them where their document sits in the order — or hand off to the **Analytics** playbook to actually query with the new context in effect.
