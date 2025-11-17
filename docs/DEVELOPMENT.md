# Development Guide

This guide covers the development workflow, project structure, and how to add new features to the AGS API MCP Server.

## Project Structure

```
src/
├── index.ts              # Main server entry point
├── mcp-server.ts         # MCP protocol implementation
├── stdio-server.ts       # Stdio transport implementation
├── streamable-http.ts   # Streamable HTTP transport implementation
├── oauth-middleware.ts  # OAuth authentication middleware
├── session-manager.ts   # User session and token management
├── otp-manager.ts       # One-time password token management
├── config.ts            # Configuration management
├── logger.ts            # Logging utilities
└── tools/
    ├── static-tools.ts  # Static MCP tools (get_token_info, start_oauth_login)
    └── openapi-tools.ts # Dynamic OpenAPI-based tools (search-apis, describe-apis, run-apis)
```

## Development Setup

### Prerequisites

- Node.js 20+
- pnpm (install with: `npm install -g pnpm`)

### Initial Setup

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd ags-api-mcp-server
   ```

2. Install dependencies:
   ```bash
   pnpm install
   ```

3. Set up environment:
   ```bash
   pnpm run setup
   ```

4. Configure `.env` file with your AccelByte environment settings

### Development Commands

**Run in development mode (stdio)**:
```bash
pnpm run dev
```

**Run in development mode (HTTP)**:
```bash
pnpm run dev:http
```

**Watch mode (auto-rebuild on changes)**:
```bash
pnpm run watch
```

**Build for production**:
```bash
pnpm run build
```

**Run tests**:
```bash
pnpm test
```

## Adding New Tools

MCP tools are functions that can be called by MCP clients. The server supports two types of tools:

1. **Static Tools**: Hand-coded tools in `src/tools/static-tools.ts`
2. **Dynamic Tools**: Auto-generated from OpenAPI specs in `src/tools/openapi-tools.ts`

### Creating a Static Tool

1. **Add a method to `StaticTools` class** in `src/tools/static-tools.ts`:

```typescript
export class StaticTools {
  // ... existing methods ...

  async myNewTool(params: { input: string }): Promise<{ result: string }> {
    // Your tool logic here
    return { result: `Processed: ${params.input}` };
  }
}
```

2. **Register the tool** in `src/index.ts`:

```typescript
import { StaticTools } from './tools/static-tools';

// ... existing code ...

const staticTools = new StaticTools();

// Register the tool
mcpServer.registerTool('my_new_tool', staticTools.myNewTool.bind(staticTools), {
  name: 'my_new_tool',
  description: 'Description of what this tool does',
  inputSchema: {
    type: 'object',
    properties: {
      input: {
        type: 'string',
        description: 'Input parameter description'
      }
    },
    required: ['input']
  }
});
```

3. **Access authenticated user context** (if needed):

Tools receive the authenticated user context automatically. Access it through the MCP server's context:

```typescript
async myNewTool(params: { input: string }, context?: any): Promise<{ result: string }> {
  // Access user context if available
  const userId = context?.userId;
  const token = context?.token;
  
  // Your tool logic here
  return { result: `Processed for user ${userId}: ${params.input}` };
}
```

### Tool Schema

When registering a tool, provide a schema for better tool discovery and validation:

```typescript
mcpServer.registerTool('tool_name', handler, {
  name: 'tool_name',
  description: 'Clear description of what the tool does',
  inputSchema: {
    type: 'object',
    properties: {
      param1: {
        type: 'string',
        description: 'Parameter description'
      },
      param2: {
        type: 'number',
        description: 'Another parameter'
      },
      optionalParam: {
        type: 'boolean',
        description: 'Optional parameter'
      }
    },
    required: ['param1', 'param2']
  }
});
```

### Best Practices for Tools

1. **Error Handling**: Always handle errors gracefully and return meaningful error messages
2. **Input Validation**: Validate inputs before processing
3. **Type Safety**: Use TypeScript types for parameters and return values
4. **Documentation**: Provide clear descriptions in tool schemas
5. **Authentication**: Tools automatically receive user context - use it for authorization
6. **Logging**: Use the logger for important operations:
   ```typescript
   import { logger } from './logger';
   
   logger.info({ param: params.input }, 'Processing tool request');
   ```

## Working with OpenAPI Tools

The server automatically generates tools from OpenAPI specifications. These are managed in `src/tools/openapi-tools.ts`.

### Adding OpenAPI Specs

1. Place OpenAPI JSON files in the `openapi-specs/` directory
2. The server automatically loads them on startup
3. Tools are generated automatically: `search-apis`, `describe-apis`, `run-apis`

### Processing OpenAPI Specs

Use the processing script to clean up OpenAPI specs:

```bash
# Process all specs in openapi-specs/
pnpm run process-specs

# With custom input folder
pnpm run process-specs -- /path/to/input/folder

# With custom input and output folders
pnpm run process-specs -- /path/to/input/folder /path/to/output/folder
```

The processing script:
- Filters out deprecated APIs
- Removes documentation fields (`host`, `externalDocs`, `x-docs`)
- Removes environment-specific data (`realm` field from `x-version`)
- Ignores specified services (buildinfo, challenge, differ, eventlog, matchmaking, sessionbrowser, ugc)
- Prettifies JSON output

## Code Style and Standards

### TypeScript

- Use strict TypeScript settings (enforced by `tsconfig.json`)
- Prefer explicit types over `any`
- Use interfaces for object shapes
- Use enums for constants

### Logging

Use the structured logger from `src/logger.ts`:

```typescript
import { logger } from './logger';

// Info level
logger.info({ key: 'value' }, 'Informational message');

// Debug level
logger.debug({ data }, 'Debug information');

// Error level
logger.error({ error }, 'Error occurred');

// Fatal level (exits process)
logger.fatal({ error }, 'Fatal error');
```

### Error Handling

Always handle errors appropriately:

```typescript
try {
  // Operation
} catch (error) {
  logger.error({ error }, 'Operation failed');
  throw new Error('User-friendly error message');
}
```

## Testing

### Running Tests

```bash
# Run all tests
pnpm test

# Run tests in watch mode
pnpm test -- --watch

# Run specific test file
pnpm test tests/my-test.test.ts
```

### Writing Tests

Tests use Node.js built-in test framework. Example:

```typescript
import { test } from 'node:test';
import assert from 'node:assert';

test('my tool test', async () => {
  const result = await myTool({ input: 'test' });
  assert.strictEqual(result.output, 'expected');
});
```

See existing tests in the `tests/` directory for examples.

## Debugging

### Debug Mode

Enable debug logging:
```bash
LOG_LEVEL=debug pnpm run dev
```

### VS Code Debugging

Create a `.vscode/launch.json`:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "request": "launch",
      "name": "Debug MCP Server (stdio)",
      "runtimeExecutable": "pnpm",
      "runtimeArgs": ["run", "dev"],
      "env": {
        "TRANSPORT": "stdio",
        "LOG_LEVEL": "debug"
      },
      "console": "integratedTerminal"
    }
  ]
}
```

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Make your changes
4. Add tests if applicable
5. Ensure all tests pass: `pnpm test`
6. Commit your changes: `git commit -m "Add my feature"`
7. Push to the branch: `git push origin feature/my-feature`
8. Submit a pull request

### Commit Messages

Follow conventional commit format:
- `feat: Add new tool`
- `fix: Fix authentication bug`
- `docs: Update README`
- `test: Add tests for new feature`
- `refactor: Simplify tool registration`

## Common Development Tasks

### Adding a New Environment Variable

1. Add to `src/config.ts`:
   ```typescript
   export const myConfig = {
     myVar: process.env.MY_VAR || 'default-value'
   };
   ```

2. Document in `docs/ENVIRONMENT_VARIABLES.md`
3. Add to `env.example` if needed

### Modifying OAuth Flow

OAuth logic is in `src/oauth-middleware.ts`. Key components:
- `OAuthMiddleware` class handles OAuth flow
- Session management in `src/session-manager.ts`
- OTP tokens in `src/otp-manager.ts`

### Modifying Transport

- Stdio transport: `src/stdio-server.ts`
- HTTP transport: `src/streamable-http.ts`
- Main server logic: `src/mcp-server.ts`

## Troubleshooting

### Build Errors

1. Clear node_modules and reinstall:
   ```bash
   rm -rf node_modules pnpm-lock.yaml
   pnpm install
   ```

2. Clear TypeScript cache:
   ```bash
   rm -rf dist
   pnpm run build
   ```

### Runtime Errors

1. Check logs with `LOG_LEVEL=debug`
2. Verify environment variables are set correctly
3. Check that all dependencies are installed

### Test Failures

1. Ensure test environment is set up correctly
2. Check that mock data matches expected format
3. Verify test isolation (no shared state)

