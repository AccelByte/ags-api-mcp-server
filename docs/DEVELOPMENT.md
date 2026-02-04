# Development Guide (V2)

This guide covers the development workflow, project structure, and how to extend the AGS API MCP Server V2.

> **Note:** This is the V2 development guide. For V1 documentation, see [docs/v1/DEVELOPMENT.md](v1/DEVELOPMENT.md).

---

## V2 Architecture Overview

See [V2_ARCHITECTURE.md](V2_ARCHITECTURE.md) for the V2 stateless, HTTP-only architecture with factory pattern and Zod validation.

---

## Project Structure

```
src/v2/
├── index.ts                 # Main entry point
├── express.ts               # Express server setup
├── config.ts                # Configuration management (Zod)
├── logger.ts                # Logging utilities (Pino)
├── utils.ts                 # Utility functions
├── auth/
│   ├── host-resolver.ts     # Host resolution utilities
│   ├── middleware.ts        # Token extraction middleware
│   └── routes.ts            # Auth-related routes (minimal)
└── mcp/
    ├── server.ts            # MCP server factory
    ├── routes.ts            # MCP endpoint handlers
    ├── elicitations.ts      # User consent handling
    ├── tools/
    │   ├── api.ts           # OpenAPI-based tools
    │   └── auth.ts          # Authentication tools
    └── prompts/
        └── workflows.ts     # Workflow prompts
```

### Key Differences from V1

| Component | V1 | V2 |
|-----------|----|----|
| **Entry** | `src/index.ts` | `src/v2/index.ts` |
| **Server** | `src/mcp-server.ts` | `src/v2/mcp/server.ts` |
| **Config** | Plain JS | Zod validation |
| **Auth** | `oauth-middleware.ts` | `auth/middleware.ts` (simple) |
| **Sessions** | `session-manager.ts` | None (stateless) |
| **Transport** | stdio + HTTP | HTTP only |

---

## Development Setup

### Prerequisites

- Node.js 20+
- pnpm
- Git

### Initial Setup

```bash
# Clone and install
git clone <repository-url>
cd ags-api-mcp-server
pnpm install

# Setup environment
pnpm run setup

# Configure .env
echo "AB_BASE_URL=https://yourgame.accelbyte.io" > .env

# Build
pnpm run build
```

---

## Development Commands

### Run in Development Mode

```bash
# Watch mode (TypeScript recompilation only)
pnpm run dev
```

This runs `tsc --watch`, which recompiles TypeScript files on changes. It does not start the server. Run `pnpm start` in a separate terminal to start the server.

### Build

```bash
# Build for production
pnpm run build
```

### Run Tests

```bash
# All tests
pnpm test

# Watch mode
pnpm test -- --watch

# Specific test file
pnpm test tests/v2/config.test.ts
```

### Linting

```bash
# Check code
pnpm run lint

# Auto-fix
pnpm run lint:fix
```

### Formatting

```bash
# Check formatting
pnpm run format:check

# Auto-format
pnpm run format
```

---

## Configuration Management

V2 uses **Zod** for type-safe configuration.

### Adding a New Config Option

**1. Update Schema** in `src/v2/config.ts`:

```typescript
const MyConfigSchema = z.object({
  myOption: z.string().default("default-value"),
  myNumber: z.coerce.number().min(1).max(100).default(10),
});
```

**2. Add to Main Config**:

```typescript
const ConfigSchema = z.object({
  mcp: McpConfigSchema,
  openapi: OpenApiConfigSchema,
  myFeature: MyConfigSchema,  // Add here
  runtime: RuntimeConfigSchema,
});
```

**3. Load from Environment**:

```typescript
const raw = {
  // ... existing config
  myFeature: {
    myOption: process.env.MY_OPTION,
    myNumber: process.env.MY_NUMBER,
  },
};
```

**4. Use in Code**:

```typescript
import config from './config.js';

console.log(config.myFeature.myOption);
```

### Configuration Validation

Zod automatically:
- ✅ Validates types
- ✅ Applies defaults
- ✅ Coerces values (e.g., string → number)
- ✅ Provides clear error messages

---

## Adding New MCP Tools

V2 tools are defined in `src/v2/mcp/tools/`.

### Create a New Tool

**1. Define Tool in `tools/api.ts` (for API tools)**:

```typescript
export function myNewTool(openApiTools: OpenApiTools) {
  return {
    name: "my_new_tool",
    description: "Description of what this tool does",
    inputSchema: z.object({
      param1: z.string().describe("Parameter description"),
      param2: z.number().optional().describe("Optional parameter"),
    }),
    outputSchema: z.object({
      result: z.string(),
      status: z.string(),
    }),
    handler: async (params: z.infer<typeof inputSchema>) => {
      // Tool logic here
      const result = await doSomething(params);
      
      return {
        result: result.data,
        status: "success",
      };
    },
  };
}
```

**2. Register Tool** using `mcpServer.registerTool()`:

```typescript
// In your setup function (e.g., src/v2/mcp/tools/api.ts)
export default async function setupMyTools(mcpServer: McpServer, config: Config) {
  mcpServer.registerTool(
    "my-new-tool",
    {
      description: "Description of what this tool does.",
      inputSchema: MyInputSchema.shape,
      outputSchema: MyOutputSchema.shape,
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

Then call your setup function from `src/v2/mcp/server.ts`:

```typescript
await setupMyTools(server, effectiveConfig);
```

### Tool Best Practices

1. **Use Zod for validation**: Define `inputSchema` and `outputSchema`
2. **Clear descriptions**: Help LLMs understand when to use the tool
3. **Error handling**: Return meaningful errors
4. **Type safety**: Use TypeScript types from Zod schemas
5. **Logging**: Log important operations

```typescript
import log from "../../logger.js";

log.info({ params }, "Executing my_new_tool");
```

---

## Working with OpenAPI Tools

V2 auto-generates tools from OpenAPI specs.

### Adding OpenAPI Specs

1. Place `.json` files in `openapi-specs/` directory
2. Restart server (auto-loads specs)

### Processing Specs

```bash
# Clean and process specs
pnpm run process-specs

# Custom input folder
pnpm run process-specs -- /path/to/input

# Custom output folder
pnpm run process-specs -- /path/to/input /path/to/output
```

The script:
- Removes deprecated APIs
- Strips documentation fields
- Removes environment-specific data
- Prettifies JSON

---

## Authentication & Middleware

V2 uses simple token extraction (no JWKS verification).

### Token Extraction Middleware

**Location**: `src/v2/auth/middleware.ts`

The `setAuthFromToken()` middleware extracts the bearer token from the Authorization header and attaches auth info to the request:

```typescript
import setAuthFromToken from "../auth/middleware.js";

// Register middleware on protected routes
app.post(path, setAuthFromToken(), postHandler);
```

The middleware:
1. Extracts the token from `Authorization: Bearer <token>` header
2. Decodes the JWT (without verification)
3. Attaches `req.auth` with `AuthInfo`: `{ token, clientId, scopes, expiresAt }`

### Using Token in Tools

Tools access the token via the MCP `extra.authInfo` context:

```typescript
// In tool handler
async (params, extra: { authInfo?: { token?: string } }) => {
  const token = extra.authInfo?.token;

  if (!token) {
    throw new McpError(ErrorCode.InvalidRequest, "Authorization required");
  }

  // Use token for API calls
  await openApiTools.runApi(params, undefined, token);
}
```

---

## Testing

### Unit Tests

Create tests in `tests/`:

```typescript
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { myFunction } from '../src/v2/my-module.js';

describe('MyModule', () => {
  test('should do something', async () => {
    const result = await myFunction();
    assert.strictEqual(result, expected);
  });
});
```

### Integration Tests

Test HTTP endpoints:

```typescript
test('POST /mcp returns success', async () => {
  const response = await fetch('http://localhost:3000/mcp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${testToken}`,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
    }),
  });
  
  assert.strictEqual(response.status, 200);
});
```

### Test with Real Server

```bash
# Start server
pnpm run dev

# In another terminal, run integration tests
pnpm run test:integration
```

---

## Logging

V2 uses **Pino** for structured logging.

### Log Levels

```typescript
import log from './logger.js';

log.trace({ detail }, 'Trace message');
log.debug({ data }, 'Debug message');
log.info({ info }, 'Info message');
log.warn({ warning }, 'Warning message');
log.error({ error }, 'Error message');
log.fatal({ error }, 'Fatal error');  // Exits process
```

### Logging Best Practices

1. **Structured logging**: Include context objects
2. **Appropriate levels**: Use correct log level
3. **No secrets**: Never log tokens or secrets
4. **Performance**: Use debug level for verbose logs

```typescript
// Good
log.info({ userId, action: 'login' }, 'User logged in');

// Bad
log.info('User ' + userId + ' logged in');
```

---

## Error Handling

### MCP Errors

Use `McpError` for MCP protocol errors:

```typescript
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';

throw new McpError(
  ErrorCode.InvalidRequest,
  "Invalid parameter: userId is required"
);
```

### Express Errors

Express error handler catches all errors:

```typescript
// src/v2/express.ts
app.use((err, req, res, next) => {
  log.error({ err, path: req.path }, "Request error");
  res.status(500).json({
    error: {
      message: "Internal server error",
      code: "INTERNAL_ERROR",
    },
  });
});
```

---

## Code Style

### TypeScript

- Use strict mode (enforced by `tsconfig.json`)
- Prefer interfaces for object shapes
- Use `const` for immutable values
- Explicit return types for functions

```typescript
// Good
interface User {
  id: string;
  name: string;
}

function getUser(id: string): Promise<User> {
  // ...
}
```

### Imports

Use ES modules (`.js` extension):

```typescript
import config from './config.js';
import { myFunction } from '../utils.js';
```

### Zod Schemas

Define schemas for validation:

```typescript
const MySchema = z.object({
  name: z.string(),
  age: z.number().positive(),
});

type MyType = z.infer<typeof MySchema>;
```

---

## Debugging

### Debug Mode

```bash
LOG_LEVEL=debug pnpm run dev
```

### VS Code Debugging

Create `.vscode/launch.json`:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "request": "launch",
      "name": "Debug V2",
      "runtimeExecutable": "pnpm",
      "runtimeArgs": ["run", "dev"],
      "env": {
        "LOG_LEVEL": "debug",
        "AB_BASE_URL": "https://yourgame.accelbyte.io"
      },
      "console": "integratedTerminal"
    }
  ]
}
```

### Inspecting Requests

```bash
# Enable request logging
LOG_LEVEL=debug pnpm run dev

# Test with curl
curl -v -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer test-token" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

---

## Contributing

### Workflow

1. Fork repository
2. Create feature branch: `git checkout -b feature/my-feature`
3. Make changes
4. Add tests
5. Run tests: `pnpm test`
6. Run linter: `pnpm run lint`
7. Commit: `git commit -m "feat: add my feature"`
8. Push: `git push origin feature/my-feature`
9. Open pull request

### Commit Messages

Follow conventional commits:

```
feat: Add new tool for user management
fix: Fix token extraction bug
docs: Update API reference
test: Add tests for config module
refactor: Simplify tool registration
```

---

## Common Tasks

### Add Environment Variable

1. Update `src/v2/config.ts` schema
2. Document in `docs/ENVIRONMENT_VARIABLES.md`
3. Add to `env.example`

### Add Express Route

Routes are organized into dedicated modules. Follow the existing pattern:

```typescript
// src/v2/my-feature/routes.ts
import { Router, Request, Response } from "express";

export function registerMyRoutes(app: Router) {
  app.get("/my-route", (req: Request, res: Response) => {
    res.json({ message: "Hello" });
  });
}
```

Then register in `src/v2/index.ts`:

```typescript
import { registerMyRoutes } from "./my-feature/routes.js";

registerMyRoutes(app);
```

See `src/v2/auth/routes.ts` and `src/v2/mcp/routes.ts` for existing examples.

### Add Middleware

Add middleware directly in `src/v2/express.ts` or in a dedicated module under the relevant feature directory (e.g., `src/v2/auth/middleware.ts`):

```typescript
// src/v2/express.ts
app.use(myMiddleware);
```

---

## Troubleshooting

### Build Errors

```bash
# Clean and rebuild
rm -rf dist node_modules
pnpm install
pnpm run build
```

### Type Errors

```bash
# Check TypeScript
pnpm run build
```

### Runtime Errors

```bash
# Enable debug logging
LOG_LEVEL=debug pnpm run dev
```

---

## References

- [V2 Architecture](V2_ARCHITECTURE.md)
- [API Reference](API_REFERENCE.md)
- [Testing Guide](TESTING.md)
- [MCP SDK Documentation](https://github.com/modelcontextprotocol/typescript-sdk)
- [Zod Documentation](https://zod.dev/)
- [Pino Documentation](https://getpino.io/)

