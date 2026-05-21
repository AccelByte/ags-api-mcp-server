# Self-Hosting & Development

This guide covers running the AGS API MCP Server locally, self-hosting it, and extending it with new tools or configuration.

---

## Prerequisites

- **Node.js 20+** — install from [nodejs.org](https://nodejs.org/)
- **pnpm** — `npm install -g pnpm`
- **Git**

---

## Setup

```bash
git clone <repository-url>
cd ags-api-mcp-server
pnpm install
pnpm run setup
```

Edit `.env` and set at minimum:

```bash
AB_BASE_URL=https://yourgame.accelbyte.io
```

Then build:

```bash
pnpm run build
```

See [ENVIRONMENT_VARIABLES.md](ENVIRONMENT_VARIABLES.md) for the full list of options.

---

## Run

```bash
pnpm start          # production (node dist/v2/index.js)
pnpm dev            # TypeScript watch mode (recompiles on change; start server separately)
pnpm run inspect    # start server + MCP Inspector
```

---

## Verify

```bash
curl http://localhost:3000/health
# {"status":"ok","timestamp":"..."}
```

---

## Project Structure

```
src/v2/
├── index.ts                 # Main entry point
├── express.ts               # Express server setup
├── config.ts                # Configuration (Zod)
├── logger.ts                # Pino logger
├── utils.ts
├── auth/
│   ├── host-resolver.ts
│   ├── middleware.ts        # Token extraction
│   └── routes.ts
└── mcp/
    ├── server.ts            # MCP server factory
    ├── routes.ts            # MCP endpoint handlers
    ├── elicitations.ts
    ├── tools/
    │   ├── api.ts           # OpenAPI-based tools
    │   └── auth.ts
    └── prompts/
        └── workflows.ts
```

---

## Adding a Config Option

Edit `src/v2/config.ts`:

```typescript
const MyConfigSchema = z.object({
  myOption: z.string().default("default-value"),
});

const ConfigSchema = z.object({
  // ...existing fields
  myFeature: MyConfigSchema,
});

// In the raw config object:
myFeature: {
  myOption: process.env.MY_OPTION,
},
```

Document the new variable in [ENVIRONMENT_VARIABLES.md](ENVIRONMENT_VARIABLES.md) and add it to `env.example`.

---

## Adding an MCP Tool

Register the tool in `src/v2/mcp/tools/` (or a new file) and wire it into the server:

```typescript
// src/v2/mcp/tools/my-tool.ts
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const InputSchema = z.object({
  param: z.string().describe("Parameter description"),
});

const OutputSchema = z.object({
  result: z.string(),
});

export default async function setupMyTools(server: McpServer) {
  server.registerTool(
    "my-tool",
    {
      description: "What this tool does.",
      inputSchema: InputSchema.shape,
      outputSchema: OutputSchema.shape,
    },
    async (params) => {
      const result = await doSomething(params);
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        structuredContent: result,
      };
    },
  );
}
```

Then call `setupMyTools(server)` from `src/v2/mcp/server.ts`.

Tools receive the caller's bearer token via the MCP `extra.authInfo` context — use it for outbound API calls.

---

## OpenAPI Specs

Drop `.json` specs into `openapi-specs/` and run:

```bash
pnpm run process-specs
```

This cleans the specs (removes deprecated APIs, strips docs fields, prettifies). The server auto-loads everything in `openapi-specs/` on start.

---

## Logging

The server uses [Pino](https://getpino.io/) for structured logging. Set `LOG_LEVEL=debug` for verbose output. Never log tokens or other secrets.

---

## Linting & Formatting

```bash
pnpm lint            # check
pnpm run lint:fix    # auto-fix
pnpm format          # prettier
```

---

## Testing

```bash
pnpm test            # all unit tests
pnpm test:smoke      # built-server smoke test (requires pnpm build first)
pnpm test -- --watch # watch mode
```

Specific file:

```bash
NODE_ENV=test node --import tsx --test tests/config.test.ts
```

### Analytics E2E

Hits real Athena Facade — skipped unless `RUN_E2E=1`.

```bash
RUN_E2E=1 \
E2E_BEARER_TOKEN=your_token \
E2E_NAMESPACE=your_namespace \
E2E_DATABASE=default \
pnpm test:analytics-e2e
```

- `RUN_E2E=1` enables the test; otherwise it skips
- `E2E_BEARER_TOKEN` and `E2E_NAMESPACE` are required
- `E2E_DATABASE` defaults to `default`
- `AB_BASE_URL` should point at the environment that issued the token

### Test layout

```
tests/
├── config.test.ts
├── openapi-tools.test.ts
├── fixtures/
├── helpers/
└── v2/
    ├── smoke.test.ts            # built-server smoke test
    ├── analytics-e2e.test.ts    # real Athena Facade E2E (gated)
    ├── mcp/                     # unit tests for tools & handlers
    └── renderer/                # renderer / view-helper tests
```

V1-specific tests live under `tests/v1/`.

### Analytics test layers

The analytics work adds three layers:

1. Unit tests for providers and render-tool handlers in `tests/v2/mcp/tools/**`
2. Renderer helper and chart-view tests in `tests/v2/renderer/**`
3. The built-server smoke test in `tests/v2/smoke.test.ts`, plus the optional real-environment E2E in `tests/v2/analytics-e2e.test.ts`

The smoke test verifies the 15 render tools, the `ui://renderer/index.html` resource, renderer metadata, and one direct-provider render call. The E2E test exercises Athena Facade through `run-apis` and the `facade` render-provider path.

### Writing a test

The project uses Node's built-in test runner:

```typescript
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { myFunction } from '../src/v2/my-module.js';

describe('myFunction', () => {
  test('returns the expected result', async () => {
    const result = await myFunction('input');
    assert.strictEqual(result, 'expected');
  });

  test('rejects invalid input', async () => {
    await assert.rejects(
      () => myFunction({ invalid: true }),
      { message: /expected error/ },
    );
  });
});
```

---

## Docker

### Build

```bash
docker build -t ags-api-mcp-server:v2 .
```

The Dockerfile uses a multi-stage build on a Node.js Alpine base, runs as a non-root user, and includes a `/health` health check.

### Run a container

```bash
docker run -d \
  --name ags-api-mcp-server \
  -e AB_BASE_URL=https://yourgame.accelbyte.io \
  -e MCP_AUTH=true \
  -p 3000:3000 \
  ags-api-mcp-server:v2
```

With an env file:

```bash
docker run -d \
  --name ags-api-mcp-server \
  --env-file docker.env \
  -p 3000:3000 \
  ags-api-mcp-server:v2
```

See [ENVIRONMENT_VARIABLES.md](ENVIRONMENT_VARIABLES.md) for the full list of options.

### docker-compose

```yaml
version: '3.8'

services:
  ags-api-mcp-server:
    build: .
    container_name: ags-api-mcp-server
    ports:
      - "3000:3000"
    environment:
      - AB_BASE_URL=https://yourgame.accelbyte.io
      - MCP_AUTH=true
      - NODE_ENV=production
      - LOG_LEVEL=info
    healthcheck:
      test: ["CMD", "wget", "--quiet", "--tries=1", "--spider", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
    restart: unless-stopped
```

### Health check

```bash
curl http://localhost:3000/health
# {"status":"ok","timestamp":"..."}

docker inspect --format='{{.State.Health.Status}}' ags-api-mcp-server
```

### Production notes

- **Resource limits** — set `--memory` and `--cpus` (or the compose `deploy.resources` block) to prevent runaway containers.
- **Restart policy** — use `--restart=unless-stopped` so the container survives daemon restarts.
- **Non-root user** — already configured in the Dockerfile; don't override.
