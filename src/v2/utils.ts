// Copyright (c) 2025 AccelByte Inc. All Rights Reserved.
// This is licensed software from AccelByte Inc, for limitations
// and restrictions contact your company contract manager.

function jsonRPCError(code: number, message: string, data?: unknown): object {
  return {
    jsonrpc: "2.0",
    error: { code, message, data },
    id: null,
  };
}

/**
 * Masks a sensitive string by showing only the first and last few characters.
 * Useful for masking JWTs, tokens, and other sensitive identifiers in logs.
 *
 * @param value - The string to mask
 * @param visibleChars - Number of characters to show at the start and end (default: 3)
 * @param maskChar - Character to use for masking (default: "*")
 * @returns Masked string. If the string is too short (length <= 2 * visibleChars),
 *          returns a fully masked string with asterisks equal to the original length.
 *
 * @example
 * // Normal masking: shows first and last N characters with fixed 3-char mask
 * maskToken('eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9', 3) // 'eyJ***CJ9'
 * maskToken('eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9', 5) // 'eyJhb***XVCJ9'
 *
 * // Threshold behavior: fully masked when length <= 2 * visibleChars
 * maskToken('short', 3) // '*****' (length 5 <= 2*3=6, so fully masked)
 * maskToken('token', 2) // 'to***en' (length 5 > 2*2=4, shows prefix/suffix)
 *
 * // Edge cases: very short strings are always fully masked
 * maskToken('abc', 3) // '***' (length 3 <= 2*3=6, fully masked)
 * maskToken('ab', 1) // '**' (length 2 <= 2*1=2, fully masked)
 * maskToken('a', 1) // '*' (length 1 <= 2*1=2, fully masked)
 *
 * @security
 * - This function reveals the original string length, which may disclose information
 *   about token structure (e.g., JWT length patterns)
 * - The visible prefix/suffix may help identify tokens if they have predictable patterns
 * - For production logs with strict security requirements, consider using full redaction
 *   (e.g., "***REDACTED***") instead of partial masking
 * - Only use this for debugging/logging purposes, never in error messages exposed to users
 */
function maskToken(
  value: string,
  visibleChars: number = 3,
  maskChar: string = "*",
): string {
  if (!value || value.length === 0) {
    return value;
  }

  // If string is too short to show both prefix and suffix, mask everything
  if (value.length <= 2 * visibleChars) {
    return maskChar.repeat(value.length);
  }

  const prefix = value.substring(0, visibleChars);
  const suffix = value.substring(value.length - visibleChars);
  const mask = maskChar.repeat(3); // Fixed 3-character mask for consistency

  return `${prefix}${mask}${suffix}`;
}

/**
 * Safely logs an unknown error with proper type narrowing.
 * Handles both Error instances and other error types (strings, objects, etc.).
 *
 * @param error - The error to log (typed as unknown for catch blocks)
 * @param logger - The logger instance to use
 * @param context - Additional context to include in the log
 *
 * @example
 * try {
 *   // some code
 * } catch (error: unknown) {
 *   logError(error, log, { context: "MCP handler" });
 *   res.status(500).json(jsonRPCError(ErrorCode.InternalError, "Internal error"));
 * }
 */
function logError(
  error: unknown,
  logger: { error: (meta: unknown, message: string) => void },
  context?: Record<string, unknown>,
): void {
  if (error instanceof Error) {
    logger.error(
      {
        ...context,
        error: error.message,
        stack: error.stack,
        name: error.name,
      },
      "Error occurred",
    );
  } else if (typeof error === "string") {
    logger.error({ ...context, error }, "Error occurred (string)");
  } else {
    logger.error({ ...context, error }, "Error occurred (unknown type)");
  }
}

/**
 * Derives a base URL from the incoming request, handling reverse proxy
 * headers, hosted-mode `req.ags.baseUrl`, and a static fallback.
 *
 * Priority:
 *  1. Reverse-proxy headers (`x-forwarded-host` + optional port/proto)
 *  2. Plain `host` header **only** when accompanied by `x-forwarded-port`
 *     (indicates the request came through a proxy that set the port)
 *  3. `req.ags.baseUrl` (hosted mode)
 *  4. `fallbackUrl`
 *
 * TODO: In production, the Host / X-Forwarded-* headers should be validated
 * against an allowlist of trusted proxies to prevent host-header injection.
 * Without that, an attacker can control the returned URL by sending a
 * crafted Host header. See OWASP "Host Header Injection".
 */
function deriveBaseUrl(
  req: {
    get: (name: string) => string | undefined;
    protocol: string;
    ags?: { baseUrl: string };
  },
  fallbackUrl?: string,
): string {
  const forwardedHost = req.get("x-forwarded-host");
  const forwardedPort = req.get("x-forwarded-port");
  const host = req.get("host");
  const forwardedProto = req.get("x-forwarded-proto");

  // Only trust the plain Host header when a forwarded-port header is also
  // present, which signals the request came through a known reverse proxy.
  if (forwardedHost || (host && forwardedPort)) {
    const protocol = forwardedProto || req.protocol || "http";
    let requestHost = forwardedHost || host || "";

    if (requestHost && !requestHost.includes(":")) {
      if (forwardedPort && forwardedPort !== "80" && forwardedPort !== "443") {
        requestHost = `${requestHost}:${forwardedPort}`;
      }
    }

    if (requestHost) {
      return `${protocol}://${requestHost}`;
    }
  }

  // Hosted mode
  if (req.ags?.baseUrl) {
    return req.ags.baseUrl;
  }

  return fallbackUrl || "https://development.accelbyte.io";
}

export { maskToken, jsonRPCError, logError, deriveBaseUrl };
