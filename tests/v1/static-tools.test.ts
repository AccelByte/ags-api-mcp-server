import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { StaticTools } from '../src/tools/static-tools';

const tools = new StaticTools();

test('getTokenInfo throws when user context is missing', async () => {
  await assert.rejects((tools as any).getTokenInfo(), {
    message: 'User context not available - authentication required'
  });
});

test('getTokenInfo returns derived token details from user context', async () => {
  const userContext = {
    accessToken: 'token-abc',
    sub: 'user-99',
    client_id: 'client-42',
    scope: 'read:all',
    namespace: 'catalog',
    user: {
      display_name: 'Pet Lover',
      country: 'US',
      is_comply: true,
      iss: 'issuer',
      exp: 1700000000,
      iat: 1690000000,
      jti: 'jwt-id-123'
    }
  };

  const result: any = await tools.getTokenInfo({}, userContext as any);
  assert.equal(result.message, 'Token information from authenticated token');
  assert.equal(typeof result.tokenMetadata, 'object');
  assert.equal(result.tokenMetadata.length, userContext.accessToken.length);
  assert.equal(result.tokenMetadata.type, 'unknown');
  assert.equal(result.tokenMetadata.isExpired, false);
  assert.equal(result.tokenMetadata.isFromCache, false);
});

// Note: These tests would require complex mocking of ES module dynamic imports
// which is not well supported in Node.js test runner. The functionality is
// tested via integration tests instead. The HTTP server error handling is
// tested in http-server-error-handling.test.ts

test('startOAuthLogin requires session token', async () => {
  const originalTransport = process.env.TRANSPORT;
  process.env.TRANSPORT = 'http';

  try {
    const userContext = {
      // No stdioSessionToken or mcpSessionId
      accessToken: 'test-token',
      sub: 'user-1',
      client_id: 'client-1',
      scope: 'read',
      namespace: 'test'
    };

    const result: any = await tools.startOAuthLogin({}, userContext as any);

    // Should fail due to missing session token
    assert.equal(result.success, false);
    assert.ok(result.error);
    assert.ok(result.message.includes('Session token'));
  } finally {
    if (originalTransport !== undefined) {
      process.env.TRANSPORT = originalTransport;
    } else {
      delete process.env.TRANSPORT;
    }
  }
});

test('logout clears session tokens successfully', async () => {
  const tools = new StaticTools();
  
  // Import session manager to set up a test session
  const { sessionManager } = await import('../src/session-manager');
  
  const sessionToken = 'test-logout-token-123';
  sessionManager.createSessionWithToken(sessionToken, 'http://localhost:3000');
  
  // Authenticate the session
  sessionManager.setAuthenticated(
    sessionToken,
    'access-token',
    'refresh-token',
    3600,
    'user-id',
    'user@test.com',
    'Test User'
  );
  
  const userContext = {
    stdioSessionToken: sessionToken,
    accessToken: 'access-token',
    sub: 'user-id',
    client_id: 'client-1',
    scope: 'read',
    namespace: 'test'
  };
  
  const result: any = await tools.logout({}, userContext as any);
  
  assert.equal(result.success, true);
  assert.ok(result.message.includes('Successfully logged out'));
  assert.equal(result.session_status, 'expired');
  
  // Verify session tokens are cleared
  const session = sessionManager.getSession(sessionToken);
  assert.equal(session?.status, 'expired');
  assert.equal(session?.access_token, undefined);
  assert.equal(session?.refresh_token, undefined);
});

test('logout returns error when no session token available', async () => {
  const tools = new StaticTools();

  const userContext = {
    // No stdioSessionToken or mcpSessionId
    accessToken: 'test-token',
    sub: 'user-1',
    client_id: 'client-1',
    scope: 'read',
    namespace: 'test'
  };

  const result: any = await tools.logout({}, userContext as any);

  assert.equal(result.success, false);
  assert.ok(result.error);
  assert.ok(result.message.includes('No active session') || result.message.includes('No session token'));
});

test('logout returns error for non-existent session', async () => {
  const tools = new StaticTools();
  
  const userContext = {
    stdioSessionToken: 'non-existent-session-token',
    accessToken: 'test-token',
    sub: 'user-1',
    client_id: 'client-1',
    scope: 'read',
    namespace: 'test'
  };
  
  const result: any = await tools.logout({}, userContext as any);
  
  assert.equal(result.success, false);
  assert.equal(result.error, 'Session not found');
  assert.ok(result.message.includes('No active session'));
});
