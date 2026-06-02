// Copyright (c) 2025 AccelByte Inc. All Rights Reserved.
// This is licensed software from AccelByte Inc, for limitations
// and restrictions contact your company contract manager.

import type {
  McpUiDisplayMode,
  McpUiDownloadFileRequest,
  McpUiHostCapabilities,
  McpUiHostContext,
  McpUiMessageRequest,
  McpUiRequestDisplayModeRequest,
  McpUiUpdateModelContextRequest,
} from "@modelcontextprotocol/ext-apps";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView, basicSetup } from "codemirror";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import { markdown } from "@codemirror/lang-markdown";
import { json } from "@codemirror/lang-json";
import { yaml } from "@codemirror/lang-yaml";
import { javascript } from "@codemirror/lang-javascript";
import { marked } from "marked";
import DOMPurify from "dompurify";

import type { z } from "zod/v3";
import type { TextEditorOutputSchema } from "../../shared/render-schemas.js";

type TextEditorPayload = z.infer<typeof TextEditorOutputSchema>;
type Language = NonNullable<TextEditorPayload["language"]>;

/**
 * The subset of the ext-apps `App` the editor needs to call back to the host.
 * Methods are optional + invoked with `?.` so non-interactive hosts (and test
 * fakes) degrade gracefully instead of throwing.
 */
export interface EditorHostBridge {
  getHostCapabilities?(): McpUiHostCapabilities | undefined;
  getHostContext?(): McpUiHostContext | undefined;
  downloadFile?(
    params: McpUiDownloadFileRequest["params"],
  ): Promise<{ isError?: boolean }>;
  sendMessage?(
    params: McpUiMessageRequest["params"],
  ): Promise<{ isError?: boolean }>;
  updateModelContext?(
    params: McpUiUpdateModelContextRequest["params"],
  ): Promise<unknown>;
  requestDisplayMode?(
    params: McpUiRequestDisplayModeRequest["params"],
  ): Promise<{ mode: McpUiDisplayMode }>;
}

const MIME_TYPES: Record<Language, string> = {
  markdown: "text/markdown",
  json: "application/json",
  yaml: "application/yaml",
  javascript: "text/javascript",
  text: "text/plain",
};

const LANGUAGE_LABELS: Record<Language, string> = {
  markdown: "Markdown",
  json: "JSON",
  yaml: "YAML",
  javascript: "JavaScript",
  text: "Plain text",
};

// Minimal inline icons (16×16, currentColor) so the bundle stays self-contained.
const ICONS = {
  copy: '<path fill="none" stroke="currentColor" stroke-width="1.5" d="M5.5 5.5V3.25A.75.75 0 0 1 6.25 2.5h6.5a.75.75 0 0 1 .75.75v6.5a.75.75 0 0 1-.75.75H10.5"/><rect x="2.5" y="5.5" width="8" height="8" rx="1" fill="none" stroke="currentColor" stroke-width="1.5"/>',
  save: '<path fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" d="M8 2.5v7.5m0 0L5 7m3 3 3-3M3 11.5v1A1.5 1.5 0 0 0 4.5 14h7a1.5 1.5 0 0 0 1.5-1.5v-1"/>',
  addContext:
    '<path fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" d="M2.5 4.25A1.75 1.75 0 0 1 4.25 2.5h7.5a1.75 1.75 0 0 1 1.75 1.75v5A1.75 1.75 0 0 1 11.75 11H6l-3 2.5V11H4.25A1.75 1.75 0 0 1 2.5 9.25z"/><path fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" d="M8 4.75v3.5M6.25 6h3.5"/>',
  expand:
    '<path fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" d="M9.5 2.5H13.5V6.5M13.5 2.5 9 7M6.5 13.5H2.5V9.5M2.5 13.5 7 9"/>',
  compress:
    '<path fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" d="M13 3 9.5 6.5M9.5 6.5V3M9.5 6.5H13M3 13l3.5-3.5M6.5 9.5V13M6.5 9.5H3"/>',
} as const;

function languageExtension(language: Language) {
  switch (language) {
    case "json":
      return json();
    case "yaml":
      return yaml();
    case "javascript":
      return javascript();
    case "markdown":
      return markdown();
    default:
      return [];
  }
}

/** Edit only in fullscreen; inline/pip (and unknown) are preview-only. */
function isEditMode(displayMode: McpUiDisplayMode | undefined): boolean {
  return displayMode === "fullscreen";
}

interface EditorSession {
  root: HTMLElement;
  bridge: EditorHostBridge;
  payload: TextEditorPayload;
  doc: string;
  language: Language;
  displayMode: McpUiDisplayMode | undefined;
  editorView: EditorView | null;
  /** Read-only CodeMirror mirrors (inline preview / fullscreen preview pane). */
  auxViews: EditorView[];
  /** Live preview container in fullscreen split view, if mounted. */
  previewEl: HTMLElement | null;
}

let session: EditorSession | null = null;
let previewRaf = 0;
const languageCompartment = new Compartment();

/**
 * Debounce window for syncing the live document into the model's context.
 * Matches the cadence excalidraw uses for the same updateModelContext channel.
 */
const SYNC_DEBOUNCE_MS = 1500;
let syncTimer: ReturnType<typeof setTimeout> | null = null;

/** Render a fresh tool result — resets the session from the payload. */
export function renderTextEditor(
  root: HTMLElement,
  payload: TextEditorPayload,
  bridge: EditorHostBridge,
  displayMode: McpUiDisplayMode | undefined,
): void {
  session = {
    root,
    bridge,
    payload,
    doc: payload.content,
    language: payload.language ?? "markdown",
    displayMode,
    editorView: null,
    auxViews: [],
    previewEl: null,
  };
  paint();
}

/**
 * Re-render the active editor after a display-mode toggle, preserving the
 * current (possibly edited) document. No-op when no editor is mounted.
 */
export function refreshTextEditorMode(
  displayMode: McpUiDisplayMode | undefined,
): boolean {
  if (!session) {
    return false;
  }
  // host-context-changed delivers only changed fields; a missing displayMode
  // means "unchanged", so keep the current mode rather than dropping to preview.
  if (displayMode !== undefined) {
    session.displayMode = displayMode;
  }
  paint();
  return true;
}

/** Whether the host can receive the editor's content as model context. */
function canSyncToContext(bridge: EditorHostBridge): boolean {
  const caps = bridge.getHostCapabilities?.();
  return (
    caps?.updateModelContext !== undefined &&
    bridge.updateModelContext !== undefined
  );
}

/**
 * Push the current document into the model's context (`ui/update-model-context`)
 * so the model can read it back (e.g. Claude Desktop's read_widget_context, or
 * automatically on hosts that surface it). The host treats each call as the
 * widget's *current* context — latest wins — so there is deliberately NO dedup:
 * a dedup here previously conflated "the call didn't throw" with "delivered" and
 * silently blocked re-syncs.
 */
async function pushToContext(): Promise<
  "synced" | "empty" | "unsupported" | "error"
> {
  const session_ = session;
  if (!session_) {
    return "error";
  }
  if (!canSyncToContext(session_.bridge)) {
    return "unsupported";
  }
  const doc = session_.doc;
  if (doc.trim() === "") {
    return "empty";
  }
  try {
    await session_.bridge.updateModelContext!({
      content: [{ type: "text", text: doc }],
    });
    return "synced";
  } catch {
    return "error";
  }
}

/** Whether the host can receive a posted message from the editor. */
function canSendMessage(bridge: EditorHostBridge): boolean {
  const caps = bridge.getHostCapabilities?.();
  return caps?.message !== undefined && bridge.sendMessage !== undefined;
}

/**
 * Post the current document to the conversation as a visible user message
 * (`ui/message`) — the explicit "Send to chat" action. Distinct from the silent
 * auto-sync above: this one the user sees land in the chat and it prompts the
 * model to act on it.
 */
async function sendDocAsMessage(): Promise<
  "sent" | "empty" | "unsupported" | "error"
> {
  const session_ = session;
  if (!session_) {
    return "error";
  }
  if (!canSendMessage(session_.bridge)) {
    return "unsupported";
  }
  const doc = session_.doc;
  if (doc.trim() === "") {
    return "empty";
  }
  try {
    const result = await session_.bridge.sendMessage!({
      role: "user",
      content: [{ type: "text", text: doc }],
    });
    return result?.isError ? "error" : "sent";
  } catch {
    return "error";
  }
}

/** Debounced auto-sync: fires after the user pauses typing. */
function scheduleSync(): void {
  if (syncTimer) {
    clearTimeout(syncTimer);
  }
  syncTimer = setTimeout(() => {
    syncTimer = null;
    void pushToContext().then((outcome) => {
      if (outcome === "synced") {
        setStatus("Synced to chat ✓");
      } else if (outcome === "error") {
        setStatus("Sync failed — will retry on your next edit.", true);
      }
    });
  }, SYNC_DEBOUNCE_MS);
}

/**
 * Flush any pending debounced sync immediately (fire-and-forget). Called before
 * the editor is torn down (mode change, navigation) so the last edits aren't
 * lost with the live editor instance.
 */
function flushSync(): void {
  if (!syncTimer) {
    return;
  }
  clearTimeout(syncTimer);
  syncTimer = null;
  void pushToContext();
}

// The host may tear down or hide the widget without a mode-change notification;
// flush pending edits on those signals too. Registered once at module load.
if (typeof window !== "undefined") {
  window.addEventListener("pagehide", flushSync);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      flushSync();
    }
  });
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Sandboxed iframe blocked the async Clipboard API — fall back below.
  }
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.top = "0";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const ok = document.execCommand("copy");
    textarea.remove();
    return ok;
  } catch {
    return false;
  }
}

function teardownViews(): void {
  if (!session) {
    return;
  }
  if (session.editorView) {
    session.doc = session.editorView.state.doc.toString();
    // Push any pending edits before we lose the live editor (e.g. mode change).
    flushSync();
    session.editorView.destroy();
    session.editorView = null;
  }
  destroyAuxViews();
  session.previewEl = null;
}

function destroyAuxViews(): void {
  if (!session) {
    return;
  }
  for (const view of session.auxViews) {
    view.destroy();
  }
  session.auxViews = [];
}

function filename(): string {
  return session?.payload.filename ?? "context.txt";
}

function paint(): void {
  if (!session) {
    return;
  }
  teardownViews();
  session.root.replaceChildren();

  const editing = isEditMode(session.displayMode);

  const shell = document.createElement("section");
  shell.className = "renderer-shell text-editor";
  shell.dataset.mode = editing ? "edit" : "preview";

  shell.append(buildHeader());

  const body = document.createElement("div");
  body.className = "renderer-chart-body text-editor-body";
  body.append(editing ? buildSplit() : buildPreviewOnly());

  const status = document.createElement("p");
  status.className = "text-editor-status";
  status.dataset.state = "ok";
  body.append(status);

  shell.append(body);
  session.root.append(shell);
}

function buildHeader(): HTMLElement {
  const session_ = session!;
  const header = document.createElement("div");
  header.className = "renderer-header";

  const headerText = document.createElement("div");
  headerText.className = "renderer-header-text";

  const eyebrow = document.createElement("span");
  eyebrow.className = "renderer-eyebrow";
  eyebrow.textContent = "text editor";

  const title = document.createElement("h1");
  title.className = "renderer-title";
  title.textContent = session_.payload.title ?? "Editor";
  headerText.append(eyebrow, title);

  const actions = document.createElement("div");
  actions.className = "renderer-header-actions text-editor-tools";
  if (isEditMode(session_.displayMode)) {
    actions.append(buildLanguageSelect());
  }
  actions.append(...buildActions());

  header.append(headerText, actions);
  return header;
}

function buildLanguageSelect(): HTMLElement {
  const select = document.createElement("select");
  select.className = "text-editor-language";
  select.setAttribute("aria-label", "Language");

  for (const language of Object.keys(LANGUAGE_LABELS) as Language[]) {
    const option = document.createElement("option");
    option.value = language;
    option.textContent = LANGUAGE_LABELS[language];
    option.selected = language === session!.language;
    select.append(option);
  }

  select.addEventListener("change", () => {
    if (!session) {
      return;
    }
    session.language = select.value as Language;
    session.editorView?.dispatch({
      effects: languageCompartment.reconfigure(
        languageExtension(session.language),
      ),
    });
    refreshPreview();
  });

  return select;
}

function setStatus(message: string, isError = false): void {
  const status = session?.root.querySelector(".text-editor-status");
  if (status instanceof HTMLElement) {
    status.textContent = message;
    status.dataset.state = isError ? "error" : "ok";
  }
}

function buildActions(): HTMLElement[] {
  const session_ = session!;
  const caps = session_.bridge.getHostCapabilities?.();
  const actions: HTMLElement[] = [];

  actions.push(
    iconButton("Copy", ICONS.copy, async () => {
      const ok = await copyToClipboard(session_.doc);
      setStatus(
        ok ? "Copied to clipboard." : "Copy failed — your host blocks copy.",
        !ok,
      );
    }),
  );

  // Edits auto-sync silently into the model's context (debounced) as the user
  // types. "Send to chat" is the explicit, visible action: it posts the current
  // document to the conversation as a message (ui/message), which the user sees
  // land and which prompts the model to act on it.
  if (canSendMessage(session_.bridge)) {
    actions.push(
      iconButton("Send to chat", ICONS.addContext, async () => {
        const outcome = await sendDocAsMessage();
        setStatus(
          outcome === "sent"
            ? "Sent to chat."
            : outcome === "empty"
              ? "Nothing to send — the editor is empty."
              : outcome === "unsupported"
                ? "This host can't receive messages from the editor."
                : "Couldn't send — the host rejected it.",
          outcome !== "sent",
        );
      }),
    );
  }

  if (caps?.downloadFile !== undefined) {
    actions.push(
      iconButton("Save file", ICONS.save, async () => {
        const result = await session_.bridge.downloadFile?.({
          contents: [
            {
              type: "resource",
              resource: {
                uri: `file:///${filename()}`,
                mimeType: MIME_TYPES[session_.language],
                text: session_.doc,
              },
            },
          ],
        });
        setStatus(
          result?.isError ? "Save was cancelled." : `Saved ${filename()}.`,
          result?.isError,
        );
      }),
    );
  }

  const modeToggle = buildModeToggle();
  if (modeToggle) {
    actions.push(modeToggle);
  }

  return actions;
}

function buildModeToggle(): HTMLElement | undefined {
  const session_ = session!;
  const available = session_.bridge.getHostContext?.()?.availableDisplayModes;
  if (!session_.bridge.requestDisplayMode || !available) {
    return undefined;
  }

  const editing = isEditMode(session_.displayMode);
  const target: McpUiDisplayMode = editing ? "inline" : "fullscreen";
  if (!available.includes(target)) {
    return undefined;
  }

  return iconButton(
    editing ? "Exit fullscreen" : "Fullscreen",
    editing ? ICONS.compress : ICONS.expand,
    async () => {
      try {
        const result = await session_.bridge.requestDisplayMode?.({
          mode: target,
        });
        const nextMode =
          result?.mode ??
          session_.bridge.getHostContext?.()?.displayMode ??
          target;
        refreshTextEditorMode(nextMode);
      } catch {
        setStatus("This host can't change the display mode.", true);
      }
    },
  );
}

function iconButton(
  label: string,
  svgInner: string,
  onClick: () => void | Promise<void>,
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "text-editor-icon";
  button.title = label;
  button.setAttribute("aria-label", label);
  button.innerHTML = `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">${svgInner}</svg>`;
  button.addEventListener("click", () => {
    void onClick();
  });
  return button;
}

const editorTheme = EditorView.theme({
  "&": {
    fontSize: "13px",
    color: "var(--color-text-primary)",
    backgroundColor: "transparent",
    height: "100%",
  },
  ".cm-scroller": { fontFamily: "var(--font-mono)", lineHeight: "1.6" },
  ".cm-gutters": {
    backgroundColor: "transparent",
    color: "var(--color-text-secondary)",
    border: "none",
  },
  ".cm-activeLine": {
    backgroundColor:
      "color-mix(in srgb, var(--color-text-primary) 6%, transparent)",
  },
  ".cm-activeLineGutter": {
    backgroundColor:
      "color-mix(in srgb, var(--color-text-primary) 6%, transparent)",
    color: "var(--color-text-primary)",
  },
  "&.cm-focused .cm-cursor": { borderLeftColor: "var(--color-text-primary)" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
    {
      backgroundColor:
        "color-mix(in srgb, var(--color-accent) 28%, transparent)",
    },
  ".cm-foldPlaceholder": {
    backgroundColor: "var(--color-panel-muted)",
    border: "none",
    color: "var(--color-text-secondary)",
  },
});

// Theme-adaptive syntax colors (light-dark switches with the host theme).
// Overrides CodeMirror's light-only default from basicSetup.
const highlightStyle = HighlightStyle.define([
  {
    tag: [t.keyword, t.moduleKeyword, t.controlKeyword, t.operatorKeyword],
    color: "light-dark(#8d3fd1, #c792ea)",
  },
  {
    tag: [t.string, t.special(t.string), t.regexp],
    color: "light-dark(#3f8f3f, #a5d6a7)",
  },
  {
    tag: [t.number, t.bool, t.null, t.atom],
    color: "light-dark(#b76b01, #f0b072)",
  },
  {
    tag: [t.comment, t.lineComment, t.blockComment, t.meta],
    color: "var(--color-text-secondary)",
    fontStyle: "italic",
  },
  {
    tag: [t.propertyName, t.definition(t.propertyName)],
    color: "light-dark(#2f6fdb, #82aaff)",
  },
  {
    tag: [t.typeName, t.className, t.tagName, t.namespace],
    color: "light-dark(#b58900, #ffcb6b)",
  },
  {
    tag: [t.function(t.variableName), t.function(t.propertyName)],
    color: "light-dark(#2f6fdb, #82aaff)",
  },
  {
    tag: [t.operator, t.punctuation, t.bracket, t.separator, t.derefOperator],
    color: "var(--color-text-secondary)",
  },
  { tag: t.invalid, color: "var(--color-danger)" },
  { tag: t.heading, color: "var(--color-text-primary)", fontWeight: "700" },
  { tag: t.strong, fontWeight: "700" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: [t.link, t.url], color: "var(--color-accent)" },
  { tag: t.monospace, color: "light-dark(#3f8f3f, #a5d6a7)" },
  { tag: t.contentSeparator, color: "var(--color-text-secondary)" },
]);

const syntaxTheme = [editorTheme, syntaxHighlighting(highlightStyle)];

/** Fullscreen: editable editor on the left, live preview on the right. */
function buildSplit(): HTMLElement {
  const session_ = session!;
  const split = document.createElement("div");
  split.className = "text-editor-split";

  const editorPane = document.createElement("div");
  editorPane.className = "text-editor-pane text-editor-pane--editor";
  session_.editorView = new EditorView({
    parent: editorPane,
    state: EditorState.create({
      doc: session_.doc,
      extensions: [
        basicSetup,
        languageCompartment.of(languageExtension(session_.language)),
        syntaxTheme,
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          if (update.docChanged && session) {
            session.doc = update.state.doc.toString();
            schedulePreviewRefresh();
            if (canSyncToContext(session.bridge)) {
              setStatus("Syncing…");
              scheduleSync();
            }
          }
        }),
      ],
    }),
  });

  const previewPane = document.createElement("div");
  previewPane.className = "text-editor-pane text-editor-pane--preview";
  session_.previewEl = previewPane;
  renderPreviewInto(previewPane);

  split.append(editorPane, previewPane);
  return split;
}

/** Inline / pip: preview only (read-only). */
function buildPreviewOnly(): HTMLElement {
  const session_ = session!;
  const container = document.createElement("div");
  container.className = "text-editor-preview";
  session_.previewEl = container;
  renderPreviewInto(container);
  return container;
}

function schedulePreviewRefresh(): void {
  if (previewRaf) {
    cancelAnimationFrame(previewRaf);
  }
  previewRaf = requestAnimationFrame(() => {
    previewRaf = 0;
    refreshPreview();
  });
}

function refreshPreview(): void {
  if (session?.previewEl) {
    renderPreviewInto(session.previewEl);
  }
}

function renderPreviewInto(container: HTMLElement): void {
  const session_ = session!;
  destroyAuxViews();
  container.replaceChildren();

  if (session_.language === "markdown") {
    const article = document.createElement("article");
    article.className = "text-editor-markdown";
    const html = marked.parse(session_.doc, { async: false }) as string;
    article.innerHTML = DOMPurify.sanitize(html);
    container.append(article);
    return;
  }

  const view = new EditorView({
    parent: container,
    state: EditorState.create({
      doc: session_.doc,
      extensions: [
        basicSetup,
        languageExtension(session_.language),
        syntaxTheme,
        EditorView.lineWrapping,
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
      ],
    }),
  });
  session_.auxViews.push(view);
}
