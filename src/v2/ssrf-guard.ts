// Copyright (c) 2025 AccelByte Inc. All Rights Reserved.
// This is licensed software from AccelByte Inc, for limitations
// and restrictions contact your company contract manager.

/**
 * Shared SSRF hostname/IP blocklist used by both JWKS discovery
 * (middleware) and OpenAPI request execution (openapi-tools).
 *
 * Maintaining a single source of truth prevents gaps where one code
 * path blocks an address but another does not.
 */

/** IPv4 private/reserved ranges. Patterns test against bare dotted-decimal strings. */
export const PRIVATE_IPV4_PATTERNS: readonly RegExp[] = [
  /^127\./, // loopback (127.0.0.0/8)
  /^10\./, // RFC 1918 Class A
  /^172\.(1[6-9]|2\d|3[01])\./, // RFC 1918 Class B
  /^192\.168\./, // RFC 1918 Class C
  /^169\.254\./, // link-local (AWS/Azure metadata, ECS)
  /^100\.(6[4-9]|[7-9]\d|1[0-1]\d|12[0-7])\./, // CGNAT (100.64.0.0/10)
  /^198\.1[8-9]\./, // benchmarking (198.18.0.0/15)
  /^0\.0\.0\.0$/, // unspecified
  /^255\.255\.255\.255$/, // broadcast
];

/** IPv6 and hostname patterns. Patterns test against URL-style hostnames (bracketed IPv6). */
export const PRIVATE_OTHER_PATTERNS: readonly RegExp[] = [
  // IPv6 private/reserved ranges
  /^\[::1\]$/, // IPv6 loopback
  /^\[fe[89ab][0-9a-f]:/i, // IPv6 link-local (fe80::/10)
  /^\[fc[0-9a-f]{2}:/i, // IPv6 unique local (fc00::/7)
  /^\[fd[0-9a-f]{2}:/i, // IPv6 unique local (fd00::/8) — covers AWS EC2 metadata IPv6 [fd00:ec2::254]

  // Hostnames
  /^localhost$/i, // localhost
  /^.*\.localhost$/i, // *.localhost subdomains
  /^metadata\.google\.internal$/i, // GCP metadata service
  /^metadata\.azure\.com$/i, // Azure metadata service
];

/** Returns true if the bare IPv4 string matches any private range. */
export function isPrivateIPv4(ip: string): boolean {
  return PRIVATE_IPV4_PATTERNS.some((p) => p.test(ip));
}

/**
 * Throws if the URL hostname is a known private/internal address.
 * Checks both IPv4 and IPv6/hostname patterns.
 */
export function assertNotPrivateHostname(url: URL): void {
  const h = url.hostname;

  if (
    PRIVATE_IPV4_PATTERNS.some((p) => p.test(h)) ||
    PRIVATE_OTHER_PATTERNS.some((p) => p.test(h))
  ) {
    throw new Error(`Refusing to fetch from private/internal address: ${h}`);
  }
}
