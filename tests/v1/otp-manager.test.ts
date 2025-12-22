import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OTPManager } from '../src/otp-manager';

test('OTPManager - generateOTP creates valid OTP token', () => {
  const manager = new OTPManager();
  const sessionToken = 'session-123';

  const otpToken = manager.generateOTP(sessionToken);

  assert.ok(otpToken);
  assert.equal(typeof otpToken, 'string');
  assert.ok(otpToken.length > 0);

  // Verify stats
  const stats = manager.getStats();
  assert.equal(stats.total, 1);

  manager.stop();
});

test('OTPManager - exchangeOTP returns session token on first use', () => {
  const manager = new OTPManager();
  const sessionToken = 'session-456';

  const otpToken = manager.generateOTP(sessionToken);
  const exchanged = manager.exchangeOTP(otpToken);

  assert.equal(exchanged, sessionToken);

  manager.stop();
});

test('OTPManager - exchangeOTP deletes token after use (single-use)', () => {
  const manager = new OTPManager();
  const sessionToken = 'session-789';

  const otpToken = manager.generateOTP(sessionToken);

  // First exchange should work
  const first = manager.exchangeOTP(otpToken);
  assert.equal(first, sessionToken);

  // Second exchange should fail (already used and deleted)
  const second = manager.exchangeOTP(otpToken);
  assert.equal(second, null);

  manager.stop();
});

test('OTPManager - exchangeOTP returns null for non-existent token', () => {
  const manager = new OTPManager();

  const result = manager.exchangeOTP('non-existent-otp');

  assert.equal(result, null);

  manager.stop();
});

test('OTPManager - exchangeOTP handles expired tokens', async () => {
  const manager = new OTPManager();
  const sessionToken = 'session-expired';

  // Create OTP
  const otpToken = manager.generateOTP(sessionToken);

  // Manually manipulate the expiry by accessing the private mapping
  // In a real scenario, we'd wait for actual expiry, but that takes 10 minutes
  // For testing, we can directly modify the mapping
  const mappings = (manager as any).otpMappings;
  const mapping = mappings.get(otpToken);
  mapping.expiresAt = Date.now() - 1000; // Set to expired (1 second ago)

  const result = manager.exchangeOTP(otpToken);

  assert.equal(result, null);

  // Verify it was deleted
  const stats = manager.getStats();
  assert.equal(stats.total, 0);

  manager.stop();
});

test('OTPManager - getStats returns correct counts', () => {
  const manager = new OTPManager();

  // Initially empty
  let stats = manager.getStats();
  assert.equal(stats.total, 0);
  assert.equal(stats.used, 0);
  assert.equal(stats.expired, 0);

  // Create some OTPs
  manager.generateOTP('session-1');
  manager.generateOTP('session-2');
  manager.generateOTP('session-3');

  stats = manager.getStats();
  assert.equal(stats.total, 3);
  assert.equal(stats.used, 0);

  // Exchange one
  const otp1 = manager.generateOTP('session-4');
  manager.exchangeOTP(otp1);

  stats = manager.getStats();
  assert.equal(stats.total, 3); // One was deleted after use

  manager.stop();
});

test('OTPManager - multiple OTPs can exist for different sessions', () => {
  const manager = new OTPManager();

  const otp1 = manager.generateOTP('session-A');
  const otp2 = manager.generateOTP('session-B');
  const otp3 = manager.generateOTP('session-C');

  assert.notEqual(otp1, otp2);
  assert.notEqual(otp2, otp3);
  assert.notEqual(otp1, otp3);

  const stats = manager.getStats();
  assert.equal(stats.total, 3);

  // Exchange them in different order
  assert.equal(manager.exchangeOTP(otp2), 'session-B');
  assert.equal(manager.exchangeOTP(otp1), 'session-A');
  assert.equal(manager.exchangeOTP(otp3), 'session-C');

  manager.stop();
});

test('OTPManager - same session can have multiple OTPs', () => {
  const manager = new OTPManager();
  const sessionToken = 'same-session';

  const otp1 = manager.generateOTP(sessionToken);
  const otp2 = manager.generateOTP(sessionToken);

  // Different OTP tokens
  assert.notEqual(otp1, otp2);

  // Both map to the same session
  assert.equal(manager.exchangeOTP(otp1), sessionToken);
  assert.equal(manager.exchangeOTP(otp2), sessionToken);

  manager.stop();
});

test('OTPManager - stop clears cleanup interval', () => {
  const manager = new OTPManager();

  // Manually start cleanup to test stop
  if (process.env.NODE_ENV === 'test') {
    // In test mode, cleanup isn't auto-started, so manually start it
    (manager as any).startCleanup();
  }

  // Verify interval exists
  assert.ok((manager as any).cleanupInterval !== null);

  manager.stop();

  // Verify interval is cleared
  assert.equal((manager as any).cleanupInterval, null);
});
