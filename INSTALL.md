# Installation Guide — AGS API MCP Server

> **For AI coding assistants:** Follow the steps below to install the AGS API MCP server for the user. Ask clarifying questions only when needed. Use the templates verbatim.
>
> **For humans:** You normally don't need to read this directly. Paste the [Quick Install prompt](README.md#quick-install) into your AI assistant and it will follow these instructions for you.

---

## Instructions for the AI Assistant

You are helping the user install the **AGS API MCP server** into an AI coding assistant. Walk through the steps below in order. Be concise. Confirm critical inputs (the MCP URL) with the user before writing any files.

### Step 1 — Identify the host client

Detect which AI coding assistant you are running inside (or ask the user explicitly). Supported clients:

- Visual Studio Code (with GitHub Copilot)
- Cursor
- Claude Code (CLI)
- Claude Desktop (only via the **Code** tab — if the user is in the Chat or Cowork tab, instruct them to switch to **Code** before continuing)
- Antigravity
- Gemini CLI

If the user is using a client not in this list, tell them the MCP server requires HTTP transport and OAuth 2.0 with PKCE + DCR, and link them to their client's MCP documentation.

### Step 2 — Determine the MCP server URL

Ask the user which AccelByte Gaming Services (AGS) edition they use:

**Option A — Shared Cloud**

Ask for two values:
- `studio` — the studio namespace they were assigned at registration
- `game` — the game namespace they were assigned at registration

#### Critical: Do not guess namespaces

If the user doesn't know their namespaces, tell them to check their AccelByte Admin Portal (the namespace appears in the URL once they log in) or their AGS welcome email from registration. If neither works, they should contact their AccelByte administrator.

Assemble the URL as:
```
https://{studio}-{game}.prod.gamingservices.accelbyte.io/mcp/{studio}-{game}
```

Note that `{studio}-{game}` appears **twice** in the URL.

**Option B — Private Cloud**

Ask whether they use the default `accelbyte.io` domain or a custom domain.
- Default: ask for `environment-name`, assemble as `https://{environment-name}.accelbyte.io/mcp`
- Custom: ask the user to paste the full URL (typically ends in `/mcp`)

**Confirm the assembled URL with the user before continuing.** Show it back to them and ask "is this correct?"

### Step 3 — Choose transport mode

The deployed MCP server uses OAuth 2.0 with PKCE and Dynamic Client Registration (DCR). There are two ways to connect:

- **Native HTTP** — preferred; the client connects directly to the URL
- **`mcp-remote` bridge** — required for clients that don't support DCR yet, or that only support stdio transport

Use this decision table:

| Client | Default mode |
|---|---|
| Visual Studio Code | Native (fall back to `mcp-remote` if you see DCR errors) |
| Cursor | Native (fall back to `mcp-remote` if you see DCR errors) |
| Claude Code | Native |
| Claude Desktop | **Always `mcp-remote`** (Claude Desktop only allows Anthropic-approved connectors; the AccelByte connector submission is pending) |
| Antigravity | Native (fall back to `mcp-remote` if you see DCR errors) |
| Gemini CLI | Native |

`mcp-remote` runs via `npx`. The user needs **Node.js 18 or newer with `npx` available**. Most Node installers (the one from nodejs.org, Homebrew, `nvm`, official Windows installers) bundle `npx` automatically via `npm`, but minimal Linux distros and some container images ship Node without `npm`/`npx`. Have the user verify with `npx --version` before continuing — if it fails, they need to install `npm` from their package manager or use the official Node installer at https://nodejs.org/.

### Step 4 — Write the configuration

Use the template matching the host client. Replace `<URL>` with the URL confirmed in Step 2.

#### Critical: Merge, do not overwrite

If the client's config file already has an `mcpServers` (or `servers`) object with other entries, merge the new `ags-api` entry into it. Overwriting will destroy the user's other MCP server configurations, which they may not be able to recover.

#### Visual Studio Code

**File:** `.vscode/mcp.json` in the workspace (preferred) or the user `settings.json`. Create the file with `{}` if it doesn't exist.

Native:
```json
{
  "servers": {
    "ags-api": {
      "type": "http",
      "url": "<URL>"
    }
  }
}
```

`mcp-remote` fallback:
```json
{
  "servers": {
    "ags-api": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "<URL>"]
    }
  }
}
```

#### Cursor

**File:** `.cursor/mcp.json` in the workspace (preferred) or the user settings file. Create with `{}` if missing.

Native:
```json
{
  "mcpServers": {
    "ags-api": {
      "type": "http",
      "url": "<URL>"
    }
  }
}
```

`mcp-remote` fallback:
```json
{
  "mcpServers": {
    "ags-api": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "<URL>"]
    }
  }
}
```

#### Claude Code

Prefer the CLI command over editing files:

Native:
```bash
claude mcp add --transport http ags-api <URL>
```

`mcp-remote` fallback:
```bash
claude mcp add ags-api -- npx -y mcp-remote <URL>
```

Or edit `.mcp.json` in the project root with the same schema as Cursor.

#### Claude Desktop

**File:**
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

Create with `{}` if it doesn't exist.

Always use `mcp-remote`:
```json
{
  "mcpServers": {
    "ags-api": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "<URL>"]
    }
  }
}
```

#### Antigravity

**File:** `mcp_config.json` in the project root.

Native:
```json
{
  "mcpServers": {
    "ags-api": {
      "type": "http",
      "url": "<URL>"
    }
  }
}
```

`mcp-remote` fallback:
```json
{
  "mcpServers": {
    "ags-api": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "<URL>"]
    }
  }
}
```

#### Gemini CLI

Prefer the CLI command:

Native:
```bash
gemini mcp add --transport http ags-api <URL>
```

`mcp-remote` fallback:
```bash
gemini mcp add ags-api -- npx -y mcp-remote <URL>
```

Or edit `~/.gemini/settings.json` (user) or `.gemini/settings.json` (project) with the same schema as Cursor.

### Step 5 — Tell the user to restart and sign in

Give the user these final instructions:

1. Fully quit and reopen the client (for VS Code / Cursor / Antigravity, reloading the window is enough; for Claude Desktop, fully quit and relaunch).
2. On the first MCP tool call, a browser window will open for AccelByte sign-in. Approve the consent screen.
3. After that, subsequent calls use the cached token automatically.

### Step 6 — Verify before handing off

Do not assume the install worked. While you are still in the conversation, ask the user to trigger a real tool call — the simplest verification is the `get_token_info` tool, which is read-only and requires no parameters (the user can prompt this with "What's my current user information?"). Then:

- If the call succeeds and returns AccelByte data, the install is verified — proceed to Step 7.
- If the browser doesn't open, the sign-in fails, or the call errors, walk the user through the relevant fix from Step 7's recovery card *while you are still in the loop*. Common causes: client wasn't fully restarted, the user is on a client that doesn't support DCR (switch to the `mcp-remote` fallback config), or the config file wasn't saved.
- If the user can't or won't test now, proceed to Step 7 and make sure the handoff card makes the verification step explicit.

This is the only point where the user has live access to you. Use it.

### Step 7 — Hand off to the user

You are a one-shot installer — after this conversation ends, the user is on their own. They will not be able to reach you when sign-in fails three days from now, when their token expires, or when they hit a permission error mid-task. Give them a self-contained recovery card they can keep.

#### Verbatim: Print the card below exactly

Use the template below as your final message. Fill in every `{placeholder}` with the actual value you used. Do not paraphrase, shorten, or "clean up" the recovery steps — the user needs the exact commands when they read this card weeks from now without an AI in the loop.

````
✅ AGS API MCP server installed.

**What I configured**
- Client: {client name, e.g. Cursor}
- MCP URL: {URL confirmed in Step 2}
- Transport: {native HTTP | mcp-remote bridge}
- Config location: {absolute file path, or "via `claude mcp add` CLI"}

**Sign in (do this now)**
1. {Restart/reload instruction specific to this client}
2. Ask me (or any AGS-aware assistant): "What's my current user information?" — this calls the `get_token_info` tool.
3. A browser window opens for AccelByte sign-in. Approve the consent screen.

**Save this card.** If something breaks later, use the steps below — you won't need an AI assistant to recover.

---

**If sign-in doesn't trigger a browser**
Confirm the config at `{file path}` is saved and the client was fully restarted (not just reloaded).

**If you see an OAuth, DCR, or "registration failed" error**
Your client doesn't support Dynamic Client Registration yet. Edit `{file path}` and replace the `ags-api` entry with the `mcp-remote` fallback:
```json
"ags-api": {
  "command": "npx",
  "args": ["-y", "mcp-remote", "{URL}"]
}
```
This requires Node.js 18+ with `npx` available — check with `npx --version`. If `npx` is missing, install `npm` from your system package manager or grab the official Node installer at https://nodejs.org/. Restart the client after editing the config.

**If tool calls return 403 after sign-in**
Your AccelByte account is missing permissions for that operation. Contact your AGS administrator — this is not a config problem.

**If the browser opens for sign-in every single time**
`mcp-remote` caches tokens in `~/.mcp-auth/`. The cache may be stale. Try renaming it as a backup first (do **not** delete — it holds credentials for every MCP server you've signed into via `mcp-remote`):
```bash
mv ~/.mcp-auth ~/.mcp-auth.bak
```
Restart and sign in again. If the problem persists, restore the backup: `mv ~/.mcp-auth.bak ~/.mcp-auth`.

**More help:** https://github.com/AccelByte/ags-api-mcp-server#troubleshooting
````

After printing the card, stop. Do not add commentary unless the user asks a follow-up question.
