import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SessionManager } from '../src/session-manager';

test('SessionManager - createSession generates valid session', () => {
  const manager = new SessionManager();
  const baseUrl = 'http://localhost:3000';

  const sessionInfo = manager.createSession(baseUrl);

  assert.ok(sessionInfo.session_token);
  assert.ok(sessionInfo.url.includes(sessionInfo.session_token));
  assert.ok(sessionInfo.url.startsWith(baseUrl));
  assert.equal(sessionInfo.expires_in, 15 * 60); // 15 minutes in seconds
  assert.ok(sessionInfo.instructions);

  // Verify session exists and is pending
  const session = manager.getSession(sessionInfo.session_token);
  assert.ok(session);
  assert.equal(session.status, 'pending');

  manager.stop();
});

test('SessionManager - createSessionWithToken uses provided token', () => {
  const manager = new SessionManager();
  const customToken = 'my-custom-token-123';
  const baseUrl = 'http://localhost:3000';

  const sessionInfo = manager.createSessionWithToken(customToken, baseUrl);

  assert.equal(sessionInfo.session_token, customToken);
  assert.ok(sessionInfo.url.includes(customToken));

  const session = manager.getSession(customToken);
  assert.ok(session);
  assert.equal(session.status, 'pending');

  manager.stop();
});

test('SessionManager - setAuthenticated updates session correctly', () => {
  const manager = new SessionManager();
  const sessionInfo = manager.createSession('http://localhost:3000');

  const success = manager.setAuthenticated(
    sessionInfo.session_token,
    'access-token-123',
    'refresh-token-456',
    3600, // 1 hour
    'user-id-789',
    'user@example.com',
    'Test User',
    7200 // 2 hours for refresh token
  );

  assert.equal(success, true);

  const session = manager.getSession(sessionInfo.session_token);
  assert.ok(session);
  assert.equal(session.status, 'authenticated');
  assert.equal(session.access_token, 'access-token-123');
  assert.equal(session.refresh_token, 'refresh-token-456');
  assert.equal(session.user_id, 'user-id-789');
  assert.equal(session.user_email, 'user@example.com');
  assert.equal(session.user_name, 'Test User');
  assert.ok(session.expires_at);
  assert.ok(session.refresh_expires_at);

  manager.stop();
});

test('SessionManager - setAuthenticated returns false for non-existent session', () => {
  const manager = new SessionManager();

  const success = manager.setAuthenticated(
    'non-existent-token',
    'access-token',
    'refresh-token',
    3600,
    'user-id'
  );

  assert.equal(success, false);
  manager.stop();
});

test('SessionManager - getSession returns null for non-existent session', () => {
  const manager = new SessionManager();

  const session = manager.getSession('non-existent-token');

  assert.equal(session, null);
  manager.stop();
});

test('SessionManager - getSession updates last_accessed_at', async () => {
  const manager = new SessionManager();
  const sessionInfo = manager.createSession('http://localhost:3000');

  const session1 = manager.getSession(sessionInfo.session_token);
  const firstAccess = session1!.last_accessed_at;

  // Wait a bit
  await new Promise(resolve => setTimeout(resolve, 10));

  const session2 = manager.getSession(sessionInfo.session_token);
  const secondAccess = session2!.last_accessed_at;

  assert.ok(secondAccess >= firstAccess);
  manager.stop();
});

test('SessionManager - getAccessToken returns token for authenticated session', () => {
  const manager = new SessionManager();
  const sessionInfo = manager.createSession('http://localhost:3000');

  manager.setAuthenticated(
    sessionInfo.session_token,
    'access-token-123',
    'refresh-token-456',
    3600,
    'user-id-789'
  );

  const tokenInfo = manager.getAccessToken(sessionInfo.session_token);

  assert.ok(tokenInfo);
  assert.equal(tokenInfo.accessToken, 'access-token-123');
  assert.equal(tokenInfo.isExpired, false);

  manager.stop();
});

test('SessionManager - getAccessToken detects expired tokens', () => {
  const manager = new SessionManager();
  const sessionInfo = manager.createSession('http://localhost:3000');

  // Set token with -1 expiry (already expired)
  manager.setAuthenticated(
    sessionInfo.session_token,
    'access-token-123',
    'refresh-token-456',
    -1, // Negative means it expired 1 second ago
    'user-id-789'
  );

  const tokenInfo = manager.getAccessToken(sessionInfo.session_token);

  assert.ok(tokenInfo);
  assert.equal(tokenInfo.isExpired, true);

  manager.stop();
});

test('SessionManager - getAccessToken returns null for pending session', () => {
  const manager = new SessionManager();
  const sessionInfo = manager.createSession('http://localhost:3000');

  const tokenInfo = manager.getAccessToken(sessionInfo.session_token);

  assert.equal(tokenInfo, null);
  manager.stop();
});

test('SessionManager - deleteSession removes session', () => {
  const manager = new SessionManager();
  const sessionInfo = manager.createSession('http://localhost:3000');

  const deleted = manager.deleteSession(sessionInfo.session_token);

  assert.equal(deleted, true);

  const session = manager.getSession(sessionInfo.session_token);
  assert.equal(session, null);

  manager.stop();
});

test('SessionManager - deleteSession returns false for non-existent session', () => {
  const manager = new SessionManager();

  const deleted = manager.deleteSession('non-existent-token');

  assert.equal(deleted, false);
  manager.stop();
});

test('SessionManager - getStats returns correct counts', () => {
  const manager = new SessionManager();

  // Create multiple sessions with different statuses
  const session1 = manager.createSession('http://localhost:3000');
  const session2 = manager.createSession('http://localhost:3000');
  const session3 = manager.createSession('http://localhost:3000');

  manager.setAuthenticated(
    session1.session_token,
    'token1',
    'refresh1',
    3600,
    'user1'
  );

  manager.setAuthenticated(
    session2.session_token,
    'token2',
    'refresh2',
    3600,
    'user2'
  );

  const stats = manager.getStats();

  assert.equal(stats.total, 3);
  assert.equal(stats.authenticated, 2);
  assert.equal(stats.pending, 1);
  assert.equal(stats.expired, 0);

  manager.stop();
});

test('SessionManager - getAllSessions returns copy of sessions', () => {
  const manager = new SessionManager();

  const session1 = manager.createSession('http://localhost:3000');
  const session2 = manager.createSession('http://localhost:3000');

  const allSessions = manager.getAllSessions();

  assert.equal(allSessions.size, 2);
  assert.ok(allSessions.has(session1.session_token));
  assert.ok(allSessions.has(session2.session_token));

  // Verify it's a copy (modifying it doesn't affect the original)
  allSessions.clear();
  assert.equal(allSessions.size, 0);

  const statsAfter = manager.getStats();
  assert.equal(statsAfter.total, 2); // Original unchanged

  manager.stop();
});

test('SessionManager - logout clears tokens and marks session as expired', () => {
  const manager = new SessionManager();
  const sessionInfo = manager.createSession('http://localhost:3000');

  // Authenticate the session first
  manager.setAuthenticated(
    sessionInfo.session_token,
    'access-token-abc',
    'refresh-token-xyz',
    3600,
    'user-123',
    'user@example.com',
    'Test User'
  );

  // Verify session is authenticated
  let session = manager.getSession(sessionInfo.session_token);
  assert.equal(session?.status, 'authenticated');
  assert.equal(session?.access_token, 'access-token-abc');

  // Logout
  const success = manager.logout(sessionInfo.session_token);

  assert.equal(success, true);

  // Verify tokens are cleared and status is expired
  session = manager.getSession(sessionInfo.session_token);
  assert.equal(session?.status, 'expired');
  assert.equal(session?.access_token, undefined);
  assert.equal(session?.refresh_token, undefined);
  assert.equal(session?.expires_at, undefined);
  assert.equal(session?.refresh_expires_at, undefined);

  // User info should still be present
  assert.equal(session?.user_id, 'user-123');
  assert.equal(session?.user_email, 'user@example.com');

  manager.stop();
});

test('SessionManager - logout returns false for non-existent session', () => {
  const manager = new SessionManager();

  const success = manager.logout('non-existent-token');

  assert.equal(success, false);
  manager.stop();
});

test('SessionManager - logout can be called on already expired session', () => {
  const manager = new SessionManager();
  const sessionInfo = manager.createSession('http://localhost:3000');

  manager.setAuthenticated(
    sessionInfo.session_token,
    'token',
    'refresh',
    3600,
    'user-id'
  );

  // First logout
  const firstLogout = manager.logout(sessionInfo.session_token);
  assert.equal(firstLogout, true);

  // Second logout on already expired session
  const secondLogout = manager.logout(sessionInfo.session_token);
  assert.equal(secondLogout, true); // Should still succeed

  manager.stop();
});
