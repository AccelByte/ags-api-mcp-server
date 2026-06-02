// Copyright (c) 2025 AccelByte Inc. All Rights Reserved.
// This is licensed software from AccelByte Inc, for limitations
// and restrictions contact your company contract manager.

import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v3";

import { TextEditorOutputSchema } from "../../../shared/render-schemas.js";
import { RENDERER_RESOURCE_URI } from "../../renderer-resource.js";

const LANGUAGES = ["markdown", "json", "yaml", "javascript", "text"] as const;
type Language = (typeof LANGUAGES)[number];

const EXTENSIONS: Record<Language, string> = {
  markdown: "md",
  json: "json",
  yaml: "yaml",
  javascript: "js",
  text: "txt",
};

function suggestFilename(language: Language, title?: string): string {
  const base =
    (title ?? "context")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "context";
  return `${base}.${EXTENSIONS[language]}`;
}

/**
 * Opens an editable document in the webview (the first input render tool).
 *
 * Unlike the chart tools, this is not provider-backed: its value originates in
 * the webview. As the user edits, the webview continuously syncs the current
 * document into the model's context (ui/update-model-context, debounced); the
 * user can also save it to a file (ui/download-file). The server stays
 * stateless — nothing is stored here; the live content lives in the host's
 * widget context, which the model reads back on demand.
 */
export function setupRenderTextEditor(server: McpServer): void {
  registerAppTool(
    server,
    "render_text_editor",
    {
      title: "Render Text Editor",
      description:
        "Open an editable text document in the webview with syntax highlighting and a language picker. " +
        "Inline shows a read-only preview; the user must open fullscreen to edit. " +
        "Use this to let the user author or revise free text, JSON, YAML, Markdown, or JavaScript — for " +
        "example custom context to send to an API. As the user edits, the current document is continuously " +
        "synced into your context; to fetch it, read the widget/app context (in Claude Desktop, the " +
        "read_widget_context tool; other hosts surface it automatically). IMPORTANT: do not reconstruct the " +
        "edited content from memory and do not reuse the initial text you passed in — always read the latest " +
        "widget context to get what the user actually has. If you need it and nothing has synced yet, ask the " +
        "user to make their edits. The editor also has a 'Send to chat' button that posts the document to the " +
        "conversation as a message, and the user can save it as a file.",
      inputSchema: {
        content: z
          .string()
          .describe("Initial document text to load into the editor."),
        language: z
          .enum(LANGUAGES)
          .optional()
          .describe(
            "Initial syntax/highlighting mode (markdown, json, yaml, javascript, text). The user can change it via the in-editor dropdown. Defaults to markdown.",
          ),
        title: z
          .string()
          .optional()
          .describe(
            "Optional document title, shown in the editor header and used to derive the suggested filename.",
          ),
      },
      outputSchema: TextEditorOutputSchema.shape,
      _meta: { ui: { resourceUri: RENDERER_RESOURCE_URI } },
    },
    async (input: Record<string, unknown>) => {
      const content = String(input.content ?? "");
      const language = (input.language as Language | undefined) ?? "markdown";
      const title = typeof input.title === "string" ? input.title : undefined;
      const filename = suggestFilename(language, title);

      const view = TextEditorOutputSchema.parse({
        chart_type: "text_editor",
        title,
        content,
        language,
        filename,
      });

      return {
        content: [
          {
            type: "text" as const,
            text:
              `Opened a ${language} editor for the user (preview inline; they open fullscreen to edit). ` +
              `Their edits sync to your context automatically as they type. To use the result, read the ` +
              `widget/app context (Claude Desktop: read_widget_context; other hosts surface it for you) — ` +
              `do not reuse this initial text or reconstruct from memory. They can also save it as "${filename}", ` +
              `or use the editor's "Send to chat" button to post the document as a message. If nothing has ` +
              `synced yet, ask them to make their edits.`,
          },
        ],
        structuredContent: view,
      };
    },
  );
}

export default setupRenderTextEditor;
