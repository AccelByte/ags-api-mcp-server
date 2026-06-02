// Copyright (c) 2025 AccelByte Inc. All Rights Reserved.
// This is licensed software from AccelByte Inc, for limitations
// and restrictions contact your company contract manager.

/**
 * MCP v2 Playbooks: one prompt + one resource per playbook file.
 *
 * A "playbook" is just a markdown file containing prose — guidance, persona,
 * instructions, whatever you want available for the user to inject into a
 * conversation. Nothing more.
 *
 * Source files live in `assets/playbooks/*.md` and are copied to
 * `dist/assets/playbooks/` at build time. One file per playbook; the filename
 * minus `.md` is the playbook's stable id (used as the prompt name and the
 * resource URI segment).
 *
 * Each playbook is registered as its own MCP prompt with no arguments, so it
 * appears directly in the host's slash-command menu — no indirection that
 * would force the user to type the playbook name.
 *
 * The displayed title is derived from the file itself, in this order:
 *   1. YAML frontmatter `title:` at the top of the markdown (explicit override)
 *   2. First H1 in the markdown, with a trailing " Playbook" stripped
 *   3. Filename (lowercased)
 * The final menu entry reads `Run <topic> Playbook`.
 */

import { readFile, readdir } from "fs/promises";
import { join, dirname, resolve } from "path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import log from "../../logger.js";

// Resolve relative to this module so the path is CWD-independent (consistent
// with version.ts). The build copies `assets/` into `dist/`, and both `start`
// and `dev` run the compiled output, so from
// dist/v2/mcp/prompts/playbooks.js this lands on dist/assets/playbooks.
const here = dirname(fileURLToPath(import.meta.url));
const PLAYBOOK_DIR = resolve(here, "../../../assets/playbooks");

interface Playbook {
  /** Stable filename id, used as the prompt name and resource URI segment. */
  id: string;
  /** Human-readable topic (e.g. "Athena"). */
  topic: string;
  /** Final display title (e.g. "Run Athena Playbook"). */
  displayTitle: string;
  /** Markdown body with any frontmatter stripped. */
  body: string;
}

let cachedPlaybooks: Map<string, Playbook> | null = null;

/**
 * Pull a `title:` value out of the document's YAML frontmatter, if present.
 * Intentionally light-weight — no full YAML parser; the only field we read
 * is `title`, and we accept either bare strings or `"…"`/`'…'` quoting.
 */
export function parseFrontmatter(content: string): {
  title?: string;
  body: string;
} {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) {
    return { body: content };
  }
  const body = content.slice(match[0].length);
  const titleLine = match[1]
    .split(/\r?\n/)
    .find((line) => /^\s*title\s*:/.test(line));
  if (!titleLine) {
    return { body };
  }
  const raw = titleLine.replace(/^\s*title\s*:\s*/, "").trim();
  // Backreference enforces matched quotes so mismatched delimiters
  // (e.g. `"foo'`) are left intact rather than silently stripped.
  const title = raw.replace(/^(["'])(.*)\1$/, "$2").trim();
  return { title: title || undefined, body };
}

export function firstHeading(markdown: string): string | undefined {
  const match = markdown.match(/^\s*#\s+(.+?)\s*$/m);
  return match?.[1]?.trim() || undefined;
}

export function buildDisplayTitle(topic: string): string {
  // Avoid "Run … Playbook Playbook" if the topic already ends in "Playbook".
  return /playbook$/i.test(topic) ? `Run ${topic}` : `Run ${topic} Playbook`;
}

export function describePlaybook(id: string, content: string): Playbook {
  const { title: frontmatterTitle, body } = parseFrontmatter(content);
  const heading = firstHeading(body);
  const headingTopic = heading?.replace(/\s+Playbook\s*$/i, "");
  const topic = frontmatterTitle ?? headingTopic ?? id;
  return {
    id,
    topic,
    displayTitle: buildDisplayTitle(topic),
    body,
  };
}

/**
 * Read and describe every `*.md` file in `dir`. A missing or unreadable
 * directory is logged and yields an empty map rather than throwing, so the
 * server still starts (with no playbooks) instead of crashing.
 */
export async function loadPlaybooks(
  dir: string,
): Promise<Map<string, Playbook>> {
  const loaded = new Map<string, Playbook>();
  try {
    const entries = await readdir(dir);
    const markdownFiles = entries.filter((f) => f.endsWith(".md"));
    await Promise.all(
      markdownFiles.map(async (file) => {
        const id = file.slice(0, -".md".length);
        const content = await readFile(join(dir, file), "utf-8");
        loaded.set(id, describePlaybook(id, content));
      }),
    );
    log.info(
      {
        playbookCount: loaded.size,
        playbooks: [...loaded.values()].map((p) => ({
          id: p.id,
          title: p.displayTitle,
        })),
      },
      "Playbooks loaded and cached",
    );
  } catch (error) {
    log.error({ error }, "Failed to load playbooks");
  }
  return loaded;
}

async function getOrLoadPlaybooks(): Promise<Map<string, Playbook>> {
  if (cachedPlaybooks !== null) {
    return cachedPlaybooks;
  }
  cachedPlaybooks = await loadPlaybooks(PLAYBOOK_DIR);
  return cachedPlaybooks;
}

async function setupPlaybooks(mcpServer: McpServer): Promise<void> {
  const playbooks = await getOrLoadPlaybooks();

  playbooks.forEach((playbook) => {
    // Resource: lets clients pull the markdown directly without going through
    // the prompt envelope. Friendly label mirrors the prompt's display title.
    const uri = `resource://playbooks/${playbook.id}`;
    mcpServer.registerResource(
      `Playbook: ${playbook.topic}`,
      uri,
      {
        description: `AGS playbook: ${playbook.topic}`,
        mimeType: "text/markdown",
      },
      async () => ({
        contents: [{ uri, mimeType: "text/markdown", text: playbook.body }],
      }),
    );

    // Prompt: appears in the host's slash-command menu as its own entry —
    // no "Run a playbook" indirection, no argument to type.
    mcpServer.registerPrompt(
      playbook.id,
      {
        title: playbook.displayTitle,
        description: `Load the ${playbook.topic} playbook (prose guidance for handling a class of user questions).`,
      },
      async () => ({
        messages: [
          {
            role: "user" as const,
            content: { type: "text" as const, text: playbook.body },
          },
        ],
      }),
    );
  });
}

export default setupPlaybooks;
