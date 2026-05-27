# Dev Plan — `render_text_editor`

> Status: **implemented** (server tool, schema, webview view, app-shell wiring, deps, docs, tests).
> Branch: `feat/render-text-editor`. Not yet committed.

## Goal

Add a render tool that opens an **editable** text document in the webview with
syntax highlighting and a language picker, plus a markdown preview. Driven by the
need to let users author **custom context** (e.g. `POST /afs/v1/admin/namespaces/{namespace}/context`)
but deliberately built **generic** — any free text / JSON / YAML / markdown — so it
is not locked to AFS.

This is the **first input tool** in the renderer. Every existing `render_*` tool is
output-only (model → provider → tabular `columns`/`rows` → display). The editor inverts
that: its value originates in the webview and must leave it.

## Converged decisions

| Decision | Choice | Rationale |
|---|---|---|
| Return path | Webview → host (no model retyping) | The webview holds the only verbatim copy; routing edited bytes through the model loses fidelity. |
| Exits | `updateModelContext` (immediate) **+** `downloadFile` (durable) | Complementary, both verbatim (EmbeddedResource by value), both stateless. |
| Primary concern solved | **Context durability across compaction** | Chat history can be summarized/dropped; a downloaded file lives outside the conversation. |
| Genericity | Free text + language dropdown | `updateModelContext` accepts any text; AFS persistence stays downstream + model-driven. |
| One tool, two modes | `fullscreen` = editor, `inline` = preview | Via `hostContext.displayMode` (already proven in POC). |
| Library | CodeMirror 6 | Small, modular, runtime-reconfigurable language via `Compartment`; fold support; brand-themeable. |
| Server state | **None** | Preserves the locked-in V2 stateless invariant. |

### Why not the alternatives (so we don't relitigate)

- **Webview → `run-apis` direct send** — the only path giving byte-perfect delivery *into AFS*,
  but descoped: we don't need the bytes in AFS immediately, and it couples the bundle to endpoints.
- **Temporary server resource + `resources/read`** — protocol-legal (ResourceTemplate / resource_link),
  but resources flow server→client and V2 has no per-request store. Would require breaking statelessness
  (TTL store, tenant isolation in hosted mode).
- **Roots** — client→server *location boundaries* (usually `file://`), no payload, assume shared
  filesystem. Not a content channel; irrelevant to a remote stateless server.
- **Nudge AI to write a local file** — the model retypes the bytes (fidelity loss), host may lack file
  tools, and a remote server can't read the agent's disk. Only closes the loop in local/stdio topology.

### Fidelity note (accepted)

When the model later reads the downloaded file and POSTs it, it still *transcribes* file → tool-arg —
but from an exact source present in context, not from compacted memory. That clears the stated bar
("read is closer to the write"). It is not a hard 100% guarantee; only webview→`run-apis` or a
server-dereferenced handle would be, and both are out of scope.

### `downloadFile` is best-effort (accepted)

Host support varies (Claude.ai / Desktop Chat / Cowork / Code, Codex CLI/App, …). Detect via
`app.getHostCapabilities()` and degrade gracefully (hide/disable the Save action, keep
`updateModelContext` + copy-to-clipboard). If the host supports neither, that is the user's problem —
no fallback beyond surfacing the limitation.

## Architecture impact

1. **Views become interactive.** Today views receive `(element, parsed)` only
   (`renderTable`, `renderMetric`, `renderChart`). The editor view also needs the `App` handle
   (for `updateModelContext` / `downloadFile` / `requestDisplayMode`) and the host context
   (`displayMode`). `bootstrapRenderer` must pass these through for the editor branch.
2. **New output discriminator.** `renderToolResult` dispatches on `parsed.chart_type`. Add a
   `text_editor` member so the editor renders through the same path without disturbing chart parsing.
3. **Sibling registration.** Do **not** route through `defineRenderTool`/`shared-input` (they inject
   provider/`query_id`/`data_rows` fields). Register directly with `registerAppTool`, same
   `_meta.ui.resourceUri`.

## File-by-file steps

### Server

- **`src/v2/shared/render-schemas.ts`**
  - Add `TextEditorOutputSchema` (`chart_type: "text_editor"`, `title?`, `content: string`,
    `language?: enum`, suggested `filename?`). Add it to the `RenderOutputSchema` union.
  - Bump `BUNDLE_VERSION`.
- **`src/v2/mcp/tools/renderers/text-editor.ts`** (new)
  - `setupRenderTextEditor(server)` calling `registerAppTool` directly (no registry).
  - `inputSchema`: `content` (string, required), `language?` (enum), `title?`.
  - Handler returns `structuredContent` = `{ chart_type: "text_editor", content, language, title, filename }`
    and a `content[].text` **breadcrumb** telling the model the suggested filename and that it should
    read that file back when ready to POST.
  - `_meta: { ui: { resourceUri: RENDERER_RESOURCE_URI } }`.
- **`src/v2/mcp/tools/renderers/index.ts`**
  - Import + call `setupRenderTextEditor(server)` (no `registry` arg). Update the "16 tools" comment.

### Webview

- **`package.json`** — add deps: `codemirror`, `@codemirror/lang-markdown`, `@codemirror/lang-json`,
  `@codemirror/lang-yaml`, `@codemirror/lang-javascript`, `@codemirror/language` (folding), `marked`,
  `dompurify`. (No `@codemirror/lint` — no validation.)
- **`src/v2/renderer/views/text-editor.ts`** (new) — `renderTextEditor(element, parsed, app, hostContext)`:
  - **Fullscreen:** CM6 editor; toolbar with language `<select>` that swaps language via a `Compartment`
    `reconfigure`; actions: "Add to context" (`updateModelContext` w/ embedded `resource`), "Save"
    (`downloadFile` w/ embedded `resource`, suggested `file:///<filename>`), capability-gated.
  - **Inline:** read-only preview — markdown → `marked` + `DOMPurify`; code → read-only CM6 +
    `foldGutter()` / `codeFolding()` (JSON foldable); `max-height` + `overflow:auto`.
  - Capability detection: `app.getHostCapabilities()` → hide/disable Save if `downloadFile` unsupported.
  - Theme via existing host style variables (brand palette) for CM6 theme.
- **`src/v2/renderer/app-shell.ts`**
  - In `renderToolResult`, branch `parsed.chart_type === "text_editor"` → `renderTextEditor(...)`,
    passing the `app` + current `getHostContext()`.
  - Re-render on `onhostcontextchanged` when `displayMode` flips (editor ⇄ preview).
  - Thread the `app` handle into `renderToolResult` (signature change) so the editor view can call back.

### Docs

- **`docs/ARCHITECTURE.md`** — add `render_text_editor` to the render-tools table; note it is the first
  input tool, its two exits, and stateless/no-provider nature.
- **`CHANGELOG.md`** — entry.

## Risks / open questions

- **Signature churn in `bootstrapRenderer`/`renderToolResult`** to pass `app` + host context — keep the
  change minimal; only the editor branch needs them.
- **Display-mode re-render** must preserve unsaved edits when toggling inline⇄fullscreen (keep editor
  state in module scope, or read current doc before re-render).
- **Bundle size** — CM6 + marked + dompurify; verify the self-contained Vite bundle stays acceptable.
- **`marked`/`DOMPurify` sanitization** — preview renders user content; sanitize before inserting HTML.

## Testing

- Unit: `TextEditorOutputSchema` parse/round-trip; tool handler returns expected `structuredContent`
  + breadcrumb.
- Renderer: `renderToolResult` dispatches `text_editor`; capability-gating hides Save when unsupported;
  language `Compartment` swap; inline vs fullscreen branch.
- Manual: MCP Inspector (`pnpm inspect`) across an agentic host to confirm `downloadFile` +
  `updateModelContext` round-trip.

## Out of scope

Webview→`run-apis` direct send; any server-side store/handle; schema validation/linting; AFS coupling;
`downloadFile` fallback beyond capability detection + clipboard.
