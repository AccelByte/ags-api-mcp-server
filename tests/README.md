# Tests

This directory contains tests for the AGS API MCP Server.

## Test Structure

```
tests/
├── README.md                    # This file
│
├── [Shared Tests]
├── config.test.ts               # Configuration validation (shared)
├── openapi-tools.test.ts        # OpenAPI tools (shared)
│
├── [Test Utilities]
├── fixtures/                    # Test fixtures (sample specs)
├── helpers/                     # Test helpers (mocks)
│
└── v1/                          # V1-specific tests (legacy)
    ├── session-manager.test.ts
    ├── otp-manager.test.ts
    ├── mcp-server.test.ts
    ├── static-tools.test.ts
    ├── http-server-error-handling.test.ts
    ├── test-server.js
    └── test-streamable-http.js
```

---

## Running Tests

### All Tests (V1 + Shared)

```bash
pnpm test
```

### V1 Tests Only

```bash
pnpm test tests/v1/
```

### Shared Tests Only

```bash
pnpm test tests/config.test.ts tests/openapi-tools.test.ts
```

### Specific Test File

```bash
pnpm test tests/config.test.ts
```

### Watch Mode

```bash
pnpm test -- --watch
```

---

## Test Categories

### Shared Tests

Tests that apply to both V1 and V2:

| Test File | Description |
|-----------|-------------|
| `config.test.ts` | Configuration validation logic |
| `openapi-tools.test.ts` | OpenAPI spec loading and tools |

### V1 Tests (Legacy)

Tests for V1-specific features:

| Test File | Description |
|-----------|-------------|
| `v1/session-manager.test.ts` | Server-side session management |
| `v1/otp-manager.test.ts` | One-time password tokens |
| `v1/mcp-server.test.ts` | V1 MCP server implementation |
| `v1/static-tools.test.ts` | V1 static tools (OAuth login) |
| `v1/http-server-error-handling.test.ts` | V1 HTTP error handling |
| `v1/test-server.js` | V1 integration test server |
| `v1/test-streamable-http.js` | V1 SSE/Streamable HTTP tests |

### V2 Tests

**Status**: V2 tests should be added in `tests/v2/` directory.

**Needed**:
- `v2/config.test.ts` - V2 Zod configuration
- `v2/tools.test.ts` - V2 MCP tools
- `v2/middleware.test.ts` - V2 auth middleware
- `v2/server.test.ts` - V2 MCP server factory

---

## Test Utilities

### Fixtures

Location: `tests/fixtures/`

- `sample-api.yaml` - Sample OpenAPI spec for testing

### Helpers

Location: `tests/helpers/`

- `mock-express.ts` - Express request/response mocks

---

## Writing Tests

### Unit Tests

Use Node.js built-in test framework:

```typescript
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

describe('MyFeature', () => {
  test('should do something', async () => {
    const result = await myFunction();
    assert.strictEqual(result, 'expected');
  });
});
```

### Integration Tests

V1 integration tests use the test server:

```bash
# Start test server
node tests/v1/test-server.js

# Run integration tests
node tests/v1/test-streamable-http.js
```

---

## Test Coverage

### Current Coverage

- ✅ V1 session management
- ✅ V1 OTP tokens
- ✅ V1 OAuth tools
- ✅ V1 Streamable HTTP
- ✅ Configuration validation
- ✅ OpenAPI tools

### Needed Coverage

- ⚠️ V2 configuration (Zod)
- ⚠️ V2 MCP tools
- ⚠️ V2 auth middleware
- ⚠️ V2 server factory
- ⚠️ V2 integration tests

---

## V1 vs V2 Testing

### V1 Testing Focus

- Server-side session management
- OAuth flow (server-managed)
- SSE streams
- OTP tokens
- Session expiration

### V2 Testing Focus (TODO)

- Stateless operation
- Bearer token extraction
- Zod validation
- Factory pattern
- HTTP POST-only

---

## CI/CD

Tests run automatically in CI/CD pipelines:

```yaml
- name: Run tests
  run: pnpm test
```

---

## References

- [Testing Guide](../docs/TESTING.md) - V2 testing guide
- [V1 Testing Guide](../docs/v1/TESTING.md) - V1 testing guide (if exists)
- [Node.js Test Runner](https://nodejs.org/api/test.html)

