# Security

This document describes the security mechanisms implemented in the AGS API MCP Server.

---

## Authentication

### JWT Signature Verification

All Bearer tokens are cryptographically verified using JWKS (JSON Web Key Set):

1. **Discovery**: The JWKS URI is fetched from `{agsBaseUrl}/.well-known/oauth-authorization-server`
2. **Verification**: Token signatures are validated against the public keys from the JWKS endpoint
3. **Algorithm**: Only RS256 is accepted (prevents algorithm confusion attacks)
4. **Issuer Validation**: The token's `iss` claim is verified against the expected AGS base URL
5. **Expiration**: Tokens must be within their `exp` window (30s clock tolerance)
6. **Audience**: Optional `aud` claim validation (configurable via middleware options)

Invalid or forged tokens receive a `401 Unauthorized` response.

### JWKS Caching

To minimize latency and reduce load on the authorization server:

- **JWKS URI discovery** is cached for 10 minutes (configurable via `JWKS_CACHE_TTL_MS`)
- **Signing keys** are cached for 10 minutes (configurable via `JWKS_CACHE_MAX_AGE`)
- **Rate limiting**: Maximum 10 JWKS requests per minute (configurable via `JWKS_RATE_LIMIT`)
- **Cache size**: Limited to 50 entries to prevent unbounded memory growth
- **Pre-warming**: JWKS cache is pre-warmed on server startup when auth is enabled

### Hosted Mode

In hosted (multi-tenant) mode, the AGS base URL is derived from the request's `Host` header. Additional protections include:

- Token issuer is validated against the derived host URL
- Mismatched issuers return `403 Forbidden`

---

## SSRF Protection

### User-Controlled URLs Removed

The `serverUrl` parameter has been removed from the `run-apis` tool across all implementations (V1 HTTP, V1 stdio, V2 MCP). Server URLs now come from:

1. OpenAPI specification `servers` definitions
2. `AB_BASE_URL` environment variable (fallback)

### Private IP Blocking

As defense-in-depth, all outbound requests are checked against private/internal IP ranges:

**IPv4:**
- `127.0.0.0/8` (loopback)
- `10.0.0.0/8` (RFC 1918 Class A)
- `172.16.0.0/12` (RFC 1918 Class B)
- `192.168.0.0/16` (RFC 1918 Class C)
- `169.254.0.0/16` (link-local / cloud metadata)
- `100.64.0.0/10` (CGNAT)
- `198.18.0.0/15` (benchmarking)
- `0.0.0.0` (unspecified)
- `255.255.255.255` (broadcast)

**IPv6:**
- `::1` (loopback)
- `fe80::/10` (link-local)
- `fc00::/7` (unique local)
- `fd00::/8` (unique local)
- IPv4-mapped IPv6 (`::ffff:x.x.x.x`) — normalized and checked against IPv4 patterns

**Hostnames:**
- `localhost` and `*.localhost`
- `metadata.google.internal` (GCP metadata service)

Blocked requests are logged with `event: "ssrf_blocked"` for security monitoring.

### DNS Rebinding Mitigation

Hostnames are resolved via `dns.resolve4`/`dns.resolve6` and all resolved IP addresses are validated against the private IP patterns before the HTTP request is made. This prevents attackers from returning a public IP during initial validation and a private IP when the actual connection is established.

---

## Security Logging

Structured security events are logged for monitoring and incident response:

| Event | Level | Description |
|-------|-------|-------------|
| `auth_failure` | WARN | Authentication failure (invalid token, expired, wrong issuer) |
| `auth_success` | DEBUG | Successful authentication |
| `suspicious_request` | WARN | Suspicious activity (issuer mismatch, missing claims) |
| `rate_limit_exceeded` | WARN | Rate limit threshold exceeded |
| `ssrf_blocked` | WARN | Outbound request to private/internal address blocked |

All security events include the client IP address. Configure `TRUST_PROXY` when behind a reverse proxy to ensure accurate IP logging.

### Monitoring and Alerting

Security events are emitted as structured JSON logs. Forward them to your log aggregation/SIEM system and configure alerts for the following conditions:

| Alert | Filter | Threshold | Action |
|-------|--------|-----------|--------|
| High auth failure rate | `event = "auth_failure"` | > 10% of total auth requests over 5 min | Investigate for credential stuffing or misconfigured clients |
| SSRF attempts detected | `event = "ssrf_blocked"` | Any occurrence (should be rare) | Review source IP, inspect request patterns |
| Suspicious requests | `event = "suspicious_request"` | > 5 events from single IP in 1 min | Review auth logs, consider IP blocking |
| Rate limit exceeded | `event = "rate_limit_exceeded"` | Frequent from legitimate users | Review rate limit configuration |

**Log aggregation filter:**
```
event IN ("auth_failure", "ssrf_blocked", "suspicious_request", "rate_limit_exceeded")
```

**Dashboard suggestions:**
- Event counts by type over time
- Top source IPs by auth failure count
- Auth failure reasons breakdown (expired, wrong issuer, invalid signature)

---

## Rate Limiting

- Configurable via `RATE_LIMIT_ENABLED`, `RATE_LIMIT_WINDOW_MINS`, and `RATE_LIMIT_MAX`
- Defaults: 1000 requests per 15-minute window per IP
- Rate limit violations are logged as security events

---

## Security Headers

Helmet middleware provides:

- `Content-Security-Policy`
- `Strict-Transport-Security` (HSTS)
- `X-Frame-Options`
- `X-Content-Type-Options`
- And other standard security headers

---

## Migration Notes

### Breaking Changes (VAPT Fixes)

1. **`serverUrl` parameter removed**: Configure `AB_BASE_URL` environment variable instead
2. **JWT verification enforced**: Only AGS-signed tokens are accepted; forged/unsigned tokens now return 401
3. **Auth failures block requests**: Previously, invalid tokens were silently ignored; now they return 401

### Migration Guide

#### 1. Removing `serverUrl` parameter

**Before:**
```typescript
await tools.runApi({
  spec: 'iam',
  method: 'get',
  path: '/users',
  serverUrl: 'https://dev.accelbyte.io'  // User-specified
});
```

**After:**
```bash
# Set via environment variable
AB_BASE_URL=https://dev.accelbyte.io
```
```typescript
await tools.runApi({
  spec: 'iam',
  method: 'get',
  path: '/users'
  // serverUrl parameter removed — uses AB_BASE_URL
});
```

#### 2. JWT verification

Ensure your client sends valid AGS-issued Bearer tokens. Tokens must:
- Be signed with RS256
- Have a valid `iss` claim matching your `AB_BASE_URL` environment
- Not be expired (30s clock tolerance is allowed)

#### 3. Testing the migration

1. Set `AB_BASE_URL` in your environment
2. Remove all `serverUrl` parameters from API calls
3. Verify API calls succeed with a valid Bearer token
4. Confirm `401 Unauthorized` is returned for invalid/missing tokens

See [ENVIRONMENT_VARIABLES.md](ENVIRONMENT_VARIABLES.md) for configuration details.
