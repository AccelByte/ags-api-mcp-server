# Testing Guide

This guide covers testing strategies, running tests, and writing tests for the AGS API MCP Server.

## Running Tests

### Unit Tests

Run the TypeScript unit tests using Node.js built-in test framework:

```bash
# Run all tests
pnpm test

# Run tests in watch mode (auto-rerun on changes)
pnpm test -- --watch

# Run specific test file
pnpm test tests/config.test.ts

# Run tests with coverage
pnpm test -- --coverage
```

### Integration Tests

Run the legacy integration test harness (HTTP mode):

```bash
pnpm run test:integration
```

This starts the server in HTTP mode and runs integration tests against it.

### Environment Variable Tests

Test environment variable configuration:

```bash
pnpm run test:env
```

## Test Structure

Tests are located in the `tests/` directory:

```
tests/
├── config.test.ts                    # Configuration tests
├── mcp-server.test.ts                # MCP server tests
├── openapi-tools.test.ts             # OpenAPI tools tests
├── otp-manager.test.ts               # OTP manager tests
├── session-manager.test.ts           # Session manager tests
├── static-tools.test.ts              # Static tools tests
├── http-server-error-handling.test.ts # HTTP error handling tests
└── helpers/
    └── mock-express.ts               # Express mocking utilities
```

## Writing Tests

### Basic Test Structure

Tests use Node.js built-in test framework. Example:

```typescript
import { test, describe } from 'node:test';
import assert from 'node:assert';

describe('MyFeature', () => {
  test('should do something', async () => {
    const result = await myFunction();
    assert.strictEqual(result, expected);
  });
});
```

### Testing Async Functions

```typescript
test('async operation', async () => {
  const result = await asyncFunction();
  assert.ok(result);
});
```

### Testing Error Cases

```typescript
test('should throw error on invalid input', async () => {
  await assert.rejects(
    async () => {
      await myFunction({ invalid: 'input' });
    },
    {
      name: 'Error',
      message: 'Expected error message'
    }
  );
});
```

### Mocking

Use mocks for external dependencies:

```typescript
import { test } from 'node:test';
import assert from 'node:assert';

test('with mock', async () => {
  // Mock external dependency
  const mockFunction = () => Promise.resolve('mocked');
  
  const result = await myFunction(mockFunction);
  assert.strictEqual(result, 'expected');
});
```

## Testing MCP Tools

### Testing Static Tools

Example test for a static tool:

```typescript
import { test } from 'node:test';
import assert from 'node:assert';
import { StaticTools } from '../src/tools/static-tools';

test('get_token_info tool', async () => {
  const tools = new StaticTools();
  const mockContext = {
    userId: 'test-user',
    token: 'test-token'
  };
  
  const result = await tools.getTokenInfo({}, mockContext);
  assert.ok(result);
  assert.strictEqual(result.userId, 'test-user');
});
```

### Testing OpenAPI Tools

OpenAPI tools require OpenAPI spec files. Use fixtures:

```typescript
import { test } from 'node:test';
import assert from 'node:assert';
import { OpenApiTools } from '../src/tools/openapi-tools';
import fs from 'fs';
import path from 'path';

test('search-apis tool', async () => {
  const specPath = path.join(__dirname, 'fixtures', 'sample-api.yaml');
  const spec = JSON.parse(fs.readFileSync(specPath, 'utf-8'));
  
  const tools = new OpenApiTools([spec]);
  const result = await tools.searchApis({ query: 'user' });
  
  assert.ok(Array.isArray(result));
});
```

## Testing HTTP Endpoints

### Manual Testing with curl

Test the health endpoint:

```bash
curl http://localhost:3000/health
```

Expected response:
```json
{
  "status": "ok",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### Testing MCP Endpoints

Test MCP request (after authentication):

```bash
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Cookie: auth_token=your_jwt_token" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/list"
  }'
```

### Testing OAuth Flow

1. Start the server in HTTP mode:
   ```bash
   pnpm run dev:http
   ```

2. Get an OTP token from the `start_oauth_login` tool

3. Navigate to the login URL:
   ```
   http://localhost:3000/auth/login?otp_token=<otp_token>
   ```

4. Complete OAuth flow in browser

5. Verify authentication by checking session

## Testing Authentication

### Testing Bearer Token Authentication

```typescript
test('bearer token authentication', async () => {
  const token = 'valid-jwt-token';
  const response = await fetch('http://localhost:3000/mcp', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list'
    })
  });
  
  assert.strictEqual(response.status, 200);
});
```

### Testing Session Authentication

```typescript
test('session authentication', async () => {
  // Initialize session first
  const initResponse = await fetch('http://localhost:3000/mcp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'MCP-Protocol-Version': '2025-06-18'
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18' }
    })
  });
  
  const sessionId = initResponse.headers.get('Mcp-Session-Id');
  assert.ok(sessionId);
  
  // Use session ID for subsequent requests
  const response = await fetch('http://localhost:3000/mcp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Mcp-Session-Id': sessionId
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list'
    })
  });
  
  assert.strictEqual(response.status, 200);
});
```

## Testing Error Handling

### Testing Invalid Requests

```typescript
test('invalid request returns error', async () => {
  const response = await fetch('http://localhost:3000/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'invalid_method'
    })
  });
  
  assert.strictEqual(response.status, 200); // JSON-RPC always returns 200
  const data = await response.json();
  assert.ok(data.error);
});
```

### Testing Authentication Failures

```typescript
test('unauthenticated request fails', async () => {
  const response = await fetch('http://localhost:3000/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list'
    })
  });
  
  // Should return 401 or use client credentials fallback
  assert.ok([200, 401].includes(response.status));
});
```

## Test Fixtures

Use fixtures for consistent test data:

```typescript
// tests/fixtures/sample-token.json
{
  "access_token": "test-token",
  "token_type": "Bearer",
  "expires_in": 3600
}
```

Load fixtures in tests:

```typescript
import fs from 'fs';
import path from 'path';

const fixturePath = path.join(__dirname, 'fixtures', 'sample-token.json');
const tokenData = JSON.parse(fs.readFileSync(fixturePath, 'utf-8'));
```

## Continuous Integration

Tests should run automatically in CI/CD pipelines. Ensure:

1. All tests pass before merging
2. Test coverage is maintained
3. Environment variables are set in CI configuration
4. Mock external services appropriately

## Best Practices

1. **Test Isolation**: Each test should be independent and not rely on other tests
2. **Clear Test Names**: Use descriptive test names that explain what is being tested
3. **Arrange-Act-Assert**: Structure tests with clear setup, execution, and verification
4. **Mock External Dependencies**: Don't make real API calls in unit tests
5. **Test Edge Cases**: Include tests for error conditions and edge cases
6. **Keep Tests Fast**: Unit tests should run quickly
7. **Test Coverage**: Aim for good coverage but focus on critical paths

## Troubleshooting Tests

### Tests Failing Intermittently

- Check for race conditions
- Ensure proper async/await usage
- Verify test isolation

### Mock Issues

- Ensure mocks are reset between tests
- Verify mock implementations match real behavior
- Check mock return values

### Environment Issues

- Verify environment variables are set correctly
- Check that test fixtures exist and are valid
- Ensure test data is properly cleaned up

