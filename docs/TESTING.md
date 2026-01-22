# Testing Guide (V2)

This guide covers testing strategies and practices for the AGS API MCP Server V2.

> **Note:** This is the V2 testing guide. V1 tests are located in `tests/v1/`.

---

## V2 Testing Philosophy

V2 emphasizes:
- ✅ **Stateless testing** - No session management needed
- ✅ **HTTP-focused** - Test REST endpoints
- ✅ **Type-safe mocks** - Zod validation in tests
- ✅ **Fast unit tests** - No external dependencies

---

## Running Tests

### All Tests

```bash
pnpm test
```

### Watch Mode

```bash
pnpm test -- --watch
```

### Specific Test File

```bash
pnpm test tests/config.test.ts
```

### With Coverage

```bash
pnpm test -- --coverage
```

---

## Test Structure

Tests are in `tests/` directory:

```
tests/
├── config.test.ts                   # Configuration tests
├── openapi-tools.test.ts            # OpenAPI tools tests
├── fixtures/                        # Test fixtures
├── helpers/
│   └── mock-express.ts              # Express mocking utilities
└── v1/                              # V1-specific tests
    ├── mcp-server.test.ts           # MCP server tests
    ├── http-server-error-handling.test.ts
    ├── otp-manager.test.ts          # OTP manager tests
    ├── session-manager.test.ts      # Session manager tests
    └── static-tools.test.ts         # Static tools tests
```

---

## Writing Tests

V2 uses Node.js built-in test framework.

### Basic Test Structure

```typescript
import { test, describe } from 'node:test';
import assert from 'node:assert';

describe('MyFeature', () => {
  test('should do something', async () => {
    const result = await myFunction();
    assert.strictEqual(result, 'expected');
  });
  
  test('should handle errors', async () => {
    await assert.rejects(
      async () => await myFunction({ invalid: true }),
      { message: /expected error/ }
    );
  });
});
```

### Testing with Zod Validation

```typescript
import { z } from 'zod';
import { test } from 'node:test';
import assert from 'node:assert';

test('validates config with Zod', () => {
  const ConfigSchema = z.object({
    port: z.coerce.number().min(1).max(65535),
    auth: z.boolean(),
  });
  
  // Valid config
  const valid = ConfigSchema.parse({ port: '3000', auth: true });
  assert.strictEqual(valid.port, 3000);
  
  // Invalid config
  assert.throws(() => {
    ConfigSchema.parse({ port: 'invalid', auth: true });
  });
});
```

---

## Testing MCP Tools

### Test Tool Handler

```typescript
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { getTokenInfo } from '../../src/v2/mcp/tools/auth.js';

describe('getTokenInfo tool', () => {
  test('returns token info with valid token', async () => {
    const mockToken = 'valid-jwt-token';
    const mockConfig = {
      openapi: { serverUrl: 'https://test.accelbyte.io' },
    };
    
    const tool = getTokenInfo(mockConfig, mockToken);
    const result = await tool.handler({});
    
    assert.ok(result.namespace);
    assert.ok(result.user_id);
  });
  
  test('throws error with invalid token', async () => {
    const mockToken = null;
    const mockConfig = {
      openapi: { serverUrl: 'https://test.accelbyte.io' },
    };
    
    const tool = getTokenInfo(mockConfig, mockToken);
    
    await assert.rejects(
      async () => await tool.handler({}),
      { message: /not authenticated/i }
    );
  });
});
```

### Test Tool Schema Validation

```typescript
test('validates tool input with Zod', () => {
  const tool = searchApis(mockOpenApiTools, mockConfig);
  
  // Valid input
  const validParams = tool.inputSchema.parse({
    query: 'user',
    limit: 10,
  });
  assert.strictEqual(validParams.limit, 10);
  
  // Invalid input (limit too high)
  assert.throws(() => {
    tool.inputSchema.parse({ query: 'user', limit: 100 });
  });
});
```

---

## Testing HTTP Endpoints

### Test Health Endpoint

```typescript
import { test } from 'node:test';
import assert from 'node:assert';

test('GET /health returns ok', async () => {
  const response = await fetch('http://localhost:3000/health');
  const data = await response.json();
  
  assert.strictEqual(response.status, 200);
  assert.strictEqual(data.status, 'ok');
  assert.ok(data.timestamp);
});
```

### Test MCP Endpoint

```typescript
test('POST /mcp with valid token', async () => {
  const token = 'valid-jwt-token';
  
  const response = await fetch('http://localhost:3000/mcp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: {},
    }),
  });
  
  assert.strictEqual(response.status, 200);
  
  const data = await response.json();
  assert.strictEqual(data.jsonrpc, '2.0');
  assert.ok(data.result);
});
```

### Test Authentication

```typescript
test('POST /mcp without token returns 401', async () => {
  const response = await fetch('http://localhost:3000/mcp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
    }),
  });
  
  assert.strictEqual(response.status, 401);
});
```

### Test Method Not Allowed

```typescript
test('GET /mcp returns 405', async () => {
  const response = await fetch('http://localhost:3000/mcp', {
    method: 'GET',
  });
  
  assert.strictEqual(response.status, 405);
});
```

---

## Testing Configuration

### Test Config Loading

```typescript
import { test, describe } from 'node:test';
import assert from 'node:assert';

describe('Config', () => {
  test('loads from environment variables', () => {
    process.env.AB_BASE_URL = 'https://test.accelbyte.io';
    process.env.MCP_PORT = '3001';
    process.env.MCP_AUTH = 'false';
    
    const config = loadConfig();
    
    assert.strictEqual(config.openapi.serverUrl, 'https://test.accelbyte.io');
    assert.strictEqual(config.mcp.port, 3001);
    assert.strictEqual(config.mcp.enableAuth, false);
  });
  
  test('applies defaults', () => {
    process.env.AB_BASE_URL = 'https://test.accelbyte.io';
    delete process.env.MCP_PORT;
    delete process.env.MCP_AUTH;
    
    const config = loadConfig();
    
    assert.strictEqual(config.mcp.port, 3000); // default
    assert.strictEqual(config.mcp.enableAuth, true); // default
  });
  
  test('validates required variables', () => {
    delete process.env.AB_BASE_URL;
    
    assert.throws(() => {
      loadConfig();
    }, /AB_BASE_URL/);
  });
});
```

---

## Testing Middleware

### Test Auth Middleware

The `setAuthFromToken()` middleware is an Express middleware that extracts auth info from the Authorization header and attaches it to `req.auth`.

```typescript
import { test, describe, mock } from 'node:test';
import assert from 'node:assert';
import setAuthFromToken from '../src/v2/auth/middleware.js';

describe('setAuthFromToken middleware', () => {
  test('extracts token and sets req.auth for valid JWT', async () => {
    // Create a valid JWT structure (header.payload.signature)
    const mockToken = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJjbGllbnRfaWQiOiJ0ZXN0LWNsaWVudCJ9.signature';
    const mockReq = {
      headers: { authorization: `Bearer ${mockToken}` },
    };
    const mockRes = {};
    const mockNext = mock.fn();

    const middleware = setAuthFromToken();
    await middleware(mockReq, mockRes, mockNext);

    assert.ok(mockReq.auth, 'req.auth should be set');
    assert.strictEqual(mockReq.auth.token, mockToken);
    assert.ok(mockNext.mock.calls.length === 1, 'next() should be called');
  });

  test('does not set req.auth when no Authorization header', async () => {
    const mockReq = { headers: {} };
    const mockRes = {};
    const mockNext = mock.fn();

    const middleware = setAuthFromToken();
    await middleware(mockReq, mockRes, mockNext);

    assert.strictEqual(mockReq.auth, undefined);
    assert.ok(mockNext.mock.calls.length === 1, 'next() should be called');
  });

  test('does not set req.auth for non-Bearer auth', async () => {
    const mockReq = {
      headers: { authorization: 'Basic dXNlcjpwYXNz' },
    };
    const mockRes = {};
    const mockNext = mock.fn();

    const middleware = setAuthFromToken();
    await middleware(mockReq, mockRes, mockNext);

    assert.strictEqual(mockReq.auth, undefined);
    assert.ok(mockNext.mock.calls.length === 1, 'next() should be called');
  });
});
```

---

## Integration Testing

### Manual Integration Testing

**1. Start server**:
```bash
pnpm run dev
```

**2. Test with curl**:
```bash
# Health check
curl http://localhost:3000/health

# Get server info
curl http://localhost:3000/

# List tools (with token)
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/list",
    "params": {}
  }'
```

**3. Test with MCP Inspector**:
```bash
pnpm run inspect
```

---

## Mocking

### Mock OpenAPI Tools

```typescript
class MockOpenApiTools {
  async searchOperations(query: string) {
    return [
      {
        operationId: 'getUserProfile',
        method: 'GET',
        path: '/users/{userId}',
        summary: 'Get user profile',
      },
    ];
  }
  
  async describeOperation(apiId: string) {
    return {
      operationId: 'getUserProfile',
      method: 'GET',
      path: '/users/{userId}',
      parameters: [],
      responses: {},
    };
  }
}
```

### Mock Express Request/Response

```typescript
function mockRequest(overrides = {}) {
  return {
    headers: {},
    body: {},
    params: {},
    query: {},
    ...overrides,
  };
}

function mockResponse() {
  const res: any = {};
  res.status = (code: number) => {
    res.statusCode = code;
    return res;
  };
  res.json = (data: any) => {
    res.body = data;
    return res;
  };
  res.send = (data: any) => {
    res.body = data;
    return res;
  };
  return res;
}
```

---

## Test Fixtures

Create test data in `tests/fixtures/`:

```typescript
// tests/fixtures/tokens.ts
export const validToken = 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...';
export const expiredToken = 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...';

// tests/fixtures/openapi-specs.ts
export const sampleApiSpec = {
  openapi: '3.0.0',
  info: { title: 'Test API', version: '1.0.0' },
  paths: {
    '/users/{userId}': {
      get: {
        operationId: 'getUserProfile',
        summary: 'Get user profile',
        parameters: [
          {
            name: 'userId',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
      },
    },
  },
};
```

---

## Testing Best Practices

### 1. Test Isolation

Each test should be independent:

```typescript
test('independent test 1', async () => {
  const config = { /* test-specific config */ };
  const result = await myFunction(config);
  assert.ok(result);
});

test('independent test 2', async () => {
  const config = { /* different config */ };
  const result = await myFunction(config);
  assert.ok(result);
});
```

### 2. Clear Test Names

```typescript
// Good
test('returns user info when token is valid', async () => {});
test('throws error when token is expired', async () => {});

// Bad
test('test1', async () => {});
test('user test', async () => {});
```

### 3. Arrange-Act-Assert

```typescript
test('structured test', async () => {
  // Arrange
  const mockToken = 'test-token';
  const mockConfig = { /* config */ };
  
  // Act
  const result = await myFunction(mockToken, mockConfig);
  
  // Assert
  assert.strictEqual(result.status, 'success');
});
```

### 4. Test Edge Cases

```typescript
describe('Edge cases', () => {
  test('handles empty input', async () => {});
  test('handles null values', async () => {});
  test('handles very long strings', async () => {});
  test('handles special characters', async () => {});
});
```

### 5. Don't Test Implementation Details

```typescript
// Good - test behavior
test('returns correct result', async () => {
  const result = await myFunction('input');
  assert.strictEqual(result, 'expected');
});

// Bad - test implementation
test('calls internal method', async () => {
  // Don't test private methods or internal state
});
```

---

## Continuous Integration

### GitHub Actions Example

```yaml
name: Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '20'
      
      - name: Install pnpm
        run: npm install -g pnpm
      
      - name: Install dependencies
        run: pnpm install
      
      - name: Build
        run: pnpm run build
      
      - name: Run tests
        run: pnpm test
        env:
          AB_BASE_URL: https://test.accelbyte.io
      
      - name: Run linter
        run: pnpm run lint
```

---

## Troubleshooting Tests

### Tests Failing Intermittently

**Possible causes**:
- Race conditions in async code
- Shared state between tests
- External dependencies

**Solutions**:
```typescript
// Use proper async/await
test('async test', async () => {
  await doSomething();  // Don't forget await
  assert.ok(true);
});

// Clean up after tests
test('cleanup', async () => {
  const resource = await createResource();
  try {
    // Test logic
  } finally {
    await resource.cleanup();
  }
});
```

### Mock Not Working

```typescript
// Ensure mock is set up before use
test('with mock', async () => {
  const mockFn = () => 'mocked';
  const result = myFunction(mockFn);
  assert.strictEqual(result, 'mocked');
});
```

### Environment Variable Issues

```typescript
test('with env vars', () => {
  // Save original
  const originalValue = process.env.MY_VAR;
  
  try {
    // Set test value
    process.env.MY_VAR = 'test-value';
    
    // Test logic
    const result = getConfig();
    assert.strictEqual(result.myVar, 'test-value');
  } finally {
    // Restore original
    if (originalValue !== undefined) {
      process.env.MY_VAR = originalValue;
    } else {
      delete process.env.MY_VAR;
    }
  }
});
```

---

## References

- [Node.js Test Runner](https://nodejs.org/api/test.html)
- [Zod Documentation](https://zod.dev/)
- [V2 Architecture](V2_ARCHITECTURE.md)
- [Development Guide](DEVELOPMENT.md)
