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

export { maskToken, jsonRPCError };
