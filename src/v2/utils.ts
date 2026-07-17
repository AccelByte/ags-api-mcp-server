// Copyright (c) 2025 AccelByte Inc.
// SPDX-License-Identifier: Apache-2.0

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
 *  1. Reverse-proxy headers (`x-forwarded-host` + optional port/proto) —
 *     **only honored when Express `trust proxy` is configured**, so an
 *     untrusted client cannot spoof them.
 *  2. Plain `host` header **only** when accompanied by `x-forwarded-port`
 *     and the connecting proxy is trusted.
 *  3. `req.ags.baseUrl` (hosted mode, when explicitly allowed)
 *  4. `fallbackUrl`
 *
 * Without this guard, any client could send a crafted `X-Forwarded-Host`
 * header and steer URLs that this server publishes (e.g. the
 * `WWW-Authenticate: Bearer resource_metadata=...` URL OAuth-discovering
 * clients fetch). See OWASP "Host Header Injection". Operators opt in to
 * forwarded-header trust by setting `TRUST_PROXY` (wired in `express.ts`).
 */
function deriveBaseUrl(
  req: {
    get: (name: string) => string | undefined;
    protocol: string;
    ags?: { baseUrl: string };
    app?: { get: (setting: string) => unknown };
    socket?: { remoteAddress?: string };
  },
  fallbackUrl?: string,
  options: { allowHostedContext?: boolean } = {},
): string {
  const { allowHostedContext = true } = options;
  const forwardedHost = req.get("x-forwarded-host");
  const forwardedPort = req.get("x-forwarded-port");
  const host = req.get("host");
  const forwardedProto = req.get("x-forwarded-proto");

  // Express compiles the configured `trust proxy` value into a function.
  // Check the immediate peer with that function instead of treating any
  // non-empty setting as permission to trust every caller.
  const trustProxy = req.app?.get?.("trust proxy fn");
  const remoteAddress = req.socket?.remoteAddress;
  const proxyTrusted =
    typeof trustProxy === "function" &&
    typeof remoteAddress === "string" &&
    (trustProxy as (address: string, hop: number) => boolean)(remoteAddress, 0);

  if (proxyTrusted && (forwardedHost || (host && forwardedPort))) {
    const protocol = forwardedProto || req.protocol || "http";
    let requestHost = forwardedHost || host || "";

    // Omit the port only when it is the default for the resolved scheme —
    // https on 80 (or http on 443) is non-default and must stay explicit for
    // the published URL to be reachable.
    if (requestHost && !requestHost.includes(":") && forwardedPort) {
      const defaultPort = protocol === "https" ? "443" : "80";
      if (forwardedPort !== defaultPort) {
        requestHost = `${requestHost}:${forwardedPort}`;
      }
    }

    if (requestHost) {
      return `${protocol}://${requestHost}`;
    }
  }

  // `req.ags.baseUrl` can be derived from raw Host / X-Forwarded-Host values.
  // Resource-server URLs disable this fallback so untrusted hosted requests
  // cannot steer OAuth clients to an attacker-controlled origin.
  if (allowHostedContext && req.ags?.baseUrl) {
    return req.ags.baseUrl;
  }

  return fallbackUrl || "https://development.accelbyte.io";
}

export { maskToken, jsonRPCError, logError, deriveBaseUrl };
