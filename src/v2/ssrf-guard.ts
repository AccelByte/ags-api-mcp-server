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

import { resolve4, resolve6 } from "node:dns/promises";

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
 * Extracts the embedded IPv4 address from an IPv4-mapped IPv6 hostname.
 * The URL constructor normalises `::ffff:a.b.c.d` into hex form
 * `[::ffff:XXYY:ZZWW]`, so we convert the two hex groups back to
 * dotted-decimal.  Returns `null` if the hostname is not an IPv4-mapped
 * IPv6 address.
 */
export function extractIPv4FromMappedIPv6(hostname: string): string | null {
  // Match hex-form: [::ffff:HHHH:HHHH]  (Node.js URL normalised form)
  const hexMatch = hostname.match(
    /^\[::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})\]$/i,
  );
  if (hexMatch) {
    const hi = parseInt(hexMatch[1], 16);
    const lo = parseInt(hexMatch[2], 16);
    return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
  }

  // Defensive: match dotted-decimal form [::ffff:A.B.C.D] in case the URL
  // parser does not normalise to hex.
  const dotMatch = hostname.match(
    /^\[::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\]$/i,
  );
  if (dotMatch) {
    return dotMatch[1];
  }

  return null;
}

/**
 * Throws if the URL hostname is a known private/internal address.
 * Checks both IPv4 and IPv6/hostname patterns.
 */
export function assertNotPrivateHostname(url: URL): void {
  const h = url.hostname;

  // Also check for IPv4-mapped IPv6 addresses (e.g. [::ffff:127.0.0.1])
  const mapped = extractIPv4FromMappedIPv6(h);
  if (mapped && isPrivateIPv4(mapped)) {
    throw new Error(`Refusing to fetch from private/internal address: ${h}`);
  }

  if (
    PRIVATE_IPV4_PATTERNS.some((p) => p.test(h)) ||
    PRIVATE_OTHER_PATTERNS.some((p) => p.test(h))
  ) {
    throw new Error(`Refusing to fetch from private/internal address: ${h}`);
  }
}

const DNS_TIMEOUT_MS = 5_000;

/**
 * Async SSRF guard that performs both static hostname checks and DNS
 * resolution to mitigate DNS rebinding attacks.
 *
 * 1. Runs the fast synchronous hostname/IP pattern check.
 * 2. For non-IP hostnames, resolves DNS and verifies all resolved
 *    addresses are public. Fails closed on DNS errors.
 */
export async function assertNotPrivateUrl(url: URL): Promise<void> {
  // Fast path: static hostname/IP pattern check
  assertNotPrivateHostname(url);

  const hostname = url.hostname;
  const isIP =
    /^\d+\.\d+\.\d+\.\d+$/.test(hostname) || hostname.startsWith("[");

  if (isIP) {
    return; // Already validated by pattern check above
  }

  // DNS resolution + private-range check to mitigate DNS rebinding
  let dnsTimeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    const dnsPromise = Promise.all([
      resolve4(hostname).catch(() => [] as string[]),
      resolve6(hostname).catch(() => [] as string[]),
    ]);
    const timeoutPromise = new Promise<never>((_, reject) => {
      dnsTimeoutId = setTimeout(
        () => reject(new Error(`DNS resolution timeout after ${DNS_TIMEOUT_MS}ms`)),
        DNS_TIMEOUT_MS,
      );
    });
    const [v4Addrs, v6Addrs] = await Promise.race([dnsPromise, timeoutPromise]);
    clearTimeout(dnsTimeoutId);

    for (const addr of v4Addrs) {
      if (isPrivateIPv4(addr)) {
        throw new Error(
          `Refusing to fetch from private/internal address: '${hostname}' resolves to ${addr}`,
        );
      }
    }

    for (const addr of v6Addrs) {
      const bracketed = `[${addr}]`;
      const mapped = extractIPv4FromMappedIPv6(bracketed);
      if (mapped && isPrivateIPv4(mapped)) {
        throw new Error(
          `Refusing to fetch from private/internal address: '${hostname}' resolves to ${addr}`,
        );
      }
      if (PRIVATE_OTHER_PATTERNS.some((p) => p.test(bracketed))) {
        throw new Error(
          `Refusing to fetch from private/internal address: '${hostname}' resolves to ${addr}`,
        );
      }
    }
  } catch (err) {
    clearTimeout(dnsTimeoutId);
    // Re-throw SSRF errors
    if (err instanceof Error && err.message.includes("Refusing to fetch")) {
      throw err;
    }
    // DNS timeout or resolution failure — fail closed
    throw new Error(
      `Refusing to fetch: DNS resolution failed for '${hostname}'. ` +
        `Unable to verify the target is not a private/internal address.`,
    );
  }
}
