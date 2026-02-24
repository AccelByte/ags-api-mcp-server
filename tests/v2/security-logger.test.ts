import { test, describe } from "node:test";
import assert from "node:assert/strict";
import securityLog from "../../src/v2/security-logger.js";

/**
 * security-logger wraps pino with structured event helpers.
 * pino writes asynchronously via sonic-boom, so instead of capturing output
 * we verify the API surface and that each method executes without throwing.
 */

describe("securityLog", () => {
  test("exports all expected event methods", () => {
    assert.equal(typeof securityLog.authFailure, "function");
    assert.equal(typeof securityLog.authSuccess, "function");
    assert.equal(typeof securityLog.suspiciousRequest, "function");
    assert.equal(typeof securityLog.rateLimitExceeded, "function");
  });

  test("authFailure does not throw with full details", () => {
    assert.doesNotThrow(() => {
      securityLog.authFailure({
        ip: "1.2.3.4",
        reason: "invalid_signature",
        agsBaseUrl: "https://test.accelbyte.io",
        path: "/mcp",
      });
    });
  });

  test("authFailure does not throw with undefined ip", () => {
    assert.doesNotThrow(() => {
      securityLog.authFailure({
        ip: undefined,
        reason: "missing_token",
      });
    });
  });

  test("authSuccess does not throw", () => {
    assert.doesNotThrow(() => {
      securityLog.authSuccess({
        ip: "5.6.7.8",
        clientId: "my-client",
        scopeCount: 3,
      });
    });
  });

  test("suspiciousRequest does not throw", () => {
    assert.doesNotThrow(() => {
      securityLog.suspiciousRequest({
        ip: "9.8.7.6",
        reason: "ssrf_attempt_blocked",
        host: "evil.example.com",
      });
    });
  });

  test("rateLimitExceeded does not throw", () => {
    assert.doesNotThrow(() => {
      securityLog.rateLimitExceeded({ ip: "10.0.0.1" });
    });
  });

  test("rateLimitExceeded does not throw with undefined ip", () => {
    assert.doesNotThrow(() => {
      securityLog.rateLimitExceeded({ ip: undefined });
    });
  });
});
