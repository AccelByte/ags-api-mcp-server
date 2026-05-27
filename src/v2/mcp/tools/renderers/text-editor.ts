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
 * the webview. The user edits the content and, when ready, either adds it to the
 * model's context (ui/update-model-context) or saves it to a file
 * (ui/download-file) — both carry the bytes verbatim. The server stays stateless;
 * nothing is stored here.
 */
export function setupRenderTextEditor(server: McpServer): void {
  registerAppTool(
    server,
    "render_text_editor",
    {
      title: "Render Text Editor",
      description:
        "Open an editable text document in the webview with syntax highlighting and a language picker. " +
        "Fullscreen shows the editor; inline shows a preview (rendered markdown, or highlighted code). " +
        "Use this to let the user author or revise free text, JSON, YAML, Markdown, or JavaScript — for " +
        "example custom context to send to an API. The user can add the edited content to your context or " +
        "save it as a file. When you later need the edited content (e.g. to build a request body), read it " +
        "from the saved file or the added context rather than reconstructing it from memory.",
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
              `Opened a ${language} editor for the user. They can edit it, add it to your context, ` +
              `or save it as "${filename}". When you need the edited content, read it from that file ` +
              `or the added context — do not reconstruct it from memory.`,
          },
        ],
        structuredContent: view,
      };
    },
  );
}

export default setupRenderTextEditor;
