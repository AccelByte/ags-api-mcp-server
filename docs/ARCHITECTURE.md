# Architecture Guide

This document describes how the AGS API MCP Server is designed and why, including the security mechanisms it relies on.

## Table of Contents

- [Overview](#overview)
- [Stateless Design](#stateless-design)
- [Analytics & Visualization Architecture](#analytics--visualization-architecture)
- [Performance Characteristics](#performance-characteristics)
- [Security](#security)
- [Design Rationale](#design-rationale)

---

## Overview

The server is built around:
- **Stateless architecture** — no server-side sessions or token storage
- **HTTP-only transport** — single POST endpoint for MCP messages
- **Zod validation** — runtime type safety throughout
- **MCP specification compliance** — full spec adherence
- **Structured responses** — both text content and `structuredContent`

---

## Stateless Design

```
┌─────────────────────────────────────┐
│  No Server-Side State               │
│  - Token in Authorization header    │
│  - Client manages refresh           │
│  - Per-request validation           │
│  - Factory pattern for MCP servers  │
└─────────────────────────────────────┘
```

**Trade-offs:**
- Simpler deployment (no state to manage)
- Horizontal scaling (no session affinity)
- No memory leaks from session accumulation
- Client must handle token refresh

### Authentication Model

The server uses **client-provided bearer tokens**. Clients obtain a JWT externally from AccelByte IAM and pass it on each request:

```
Authorization: Bearer <jwt>
```

The server extracts and uses the token per request. No tokens are stored.

### Validation & Error Handling

- Zod schema validation for all tool inputs and outputs
- `McpError` with proper `ErrorCode` enums
- Structured error responses
- Output schemas defined for all tools

---

## Analytics & Visualization Architecture

The server has two tool families alongside the core OpenAPI tools:
- `run-apis` exposes raw HTTP access to all loaded specs, including `afs.json`
- 15 `render_*` tools resolve tabular data through a provider registry and emit strict `structuredContent` payloads for the browser bundle

### Provider Routing

Each request-scoped server instance builds its own provider registry:
- `facade` resolves `query_id` + `namespace` against the Athena Facade using the per-request effective AGS base URL
- `direct` accepts inline `data_columns` + `data_rows` for small datasets and tests

Because a fresh `McpServer` is created per HTTP POST, provider registration stays request-scoped and hosted-mode tenant routing is preserved.

### Renderer Resource

The analytics UI is shipped as `ui://renderer/index.html`:
- Registered via `@modelcontextprotocol/ext-apps`
- Built by Vite into `dist/v2/renderer/index.html`
- Loaded once and memoized on the server
- Advertises `_meta["ags/bundleVersion"]`
- Validated by the browser bundle against the shared `BUNDLE_VERSION`

The renderer source lives under `src/v2/renderer/**`, while `tsconfig.renderer.json` isolates DOM/browser typing from the server `tsconfig.json`.

### Render Tools

All 16 render tools share the same input model: a data source (`provider="facade"` with `query_id` + `namespace`, or `provider="direct"` with inline `data_columns` + `data_rows`), optional `title` / `description` / `column_hints` / `filters`, and tool-specific `options`. Every render tool returns strict structured content keyed by `chart_type`.

| Tool | `chart_type` | Required options | Optional options |
|------|--------------|------------------|------------------|
| `render_bar_chart` | `bar` | `x`, `y` | `color`, `bar_mode`, `orientation`, `label`, `facet_col`, `facet_row`, `x_label`, `y_label`, `tooltip` |
| `render_line_chart` | `line` | `x`, `y` | `color`, `show_points`, `curve`, `facet_col`, `facet_row`, `x_label`, `y_label`, `tooltip` |
| `render_area_chart` | `area` | `x`, `y` | `color`, `stack_mode`, `curve`, `facet_col`, `facet_row`, `x_label`, `y_label`, `tooltip` |
| `render_scatter_chart` | `scatter` | `x`, `y` | `color`, `size`, `trend_line`, `facet_col`, `facet_row`, `x_label`, `y_label`, `tooltip` |
| `render_histogram_chart` | `histogram` | `column` | `bin_count`, `normalize`, `color`, `facet_col`, `facet_row`, `x_label`, `y_label` |
| `render_box_chart` | `box` | `x`, `y` | `color`, `facet_col`, `facet_row`, `x_label`, `y_label` |
| `render_heatmap_chart` | `heatmap` | `x`, `y`, `value` | `color_scheme`, `show_values`, `x_label`, `y_label` |
| `render_pie_chart` | `pie` | `category`, `value` | `show_labels`, `other_threshold` |
| `render_donut_chart` | `donut` | `category`, `value` | `show_labels`, `other_threshold`, `center_label`, `hole` |
| `render_waterfall_chart` | `waterfall` | `category`, `value` | `is_total`, `x_label`, `y_label` |
| `render_funnel_chart` | `funnel` | `stage`, `value` | `orientation`, `show_conversion` |
| `render_gauge_chart` | `gauge` | `value`, `max` | `min`, `thresholds`, `unit` |
| `render_state_timeline_chart` | `state_timeline` | `entity`, `start`, `end`, `state` | — |
| `render_table` | `table` | — | `columns_order`, `page_size` |
| `render_metric` | `metric` | `value` | `compare`, `label`, `unit`, `format` |
| `render_meter` | `meter` | `value` | `max`, `label`, `color`, `unit`, `format` |

For write-side API calls (POST/PUT/PATCH/DELETE through `run-apis`), the tool uses MCP elicitation to request user approval before execution.

### AFS Spec Integration

The Athena Facade spec is loaded like any other OpenAPI spec and exposed through `search-apis`, `describe-apis`, and `run-apis`. The relevant operations:

| Operation | Purpose |
|-----------|---------|
| `POST /afs/v1/admin/namespaces/{namespace}/queries` | Submit an Athena SQL query |
| `GET /afs/v1/admin/namespaces/{namespace}/queries/{id}` | Poll status; fetch rows when terminal |
| `GET /afs/v1/admin/namespaces/{namespace}/tables` | List/search tables in a database |
| `GET /afs/v1/admin/namespaces/{namespace}/tables/{database}/{table}` | Fetch full table metadata |

If you intend to render via `provider="facade"`, submit with `wait_ms=0` and poll the GET endpoint until `status="SUCCEEDED"`. If the submit returns `200` with inline rows on the fast path, render those `columns` and `rows` directly with `provider="direct"` instead of reusing the returned `query_id`.

`openapi-specs/afs.json` joins the existing spec set, so Athena Facade access stays on the same contract as the rest of the OpenAPI-backed API surface.

---

## Performance Characteristics

- **Memory:** constant per request (no accumulation)
- **Connections:** short-lived HTTP requests
- **Cleanup:** automatic per-request cleanup
- **Scaling:** stateless, scales horizontally freely

---

## Security

The server stores no tokens, has no sessions, and trusts client-provided JWTs after verifying their signatures.

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

### SSRF Protection

The `serverUrl` parameter has been removed from the `run-apis` tool across all implementations (V1 HTTP, V1 stdio, V2 MCP). Server URLs now come from:

1. `AB_BASE_URL` environment variable (or hosted-mode per-request AGS base URL)
2. OpenAPI specification `servers` / Swagger 2 `host` metadata when no environment base URL is configured

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
- `metadata.azure.com` (Azure metadata service)

Blocked requests are logged with `event: "ssrf_blocked"` for security monitoring.

#### DNS Rebinding Mitigation

Hostnames are resolved via `dns.resolve4`/`dns.resolve6` and all resolved IP addresses are validated against the private IP patterns before the HTTP request is made. This prevents attackers from returning a public IP during initial validation and a private IP when the actual connection is established.

### Security Logging

Structured security events are logged for monitoring and incident response:

| Event | Level | Description |
|-------|-------|-------------|
| `auth_failure` | WARN | Authentication failure (invalid token, expired, wrong issuer) |
| `auth_success` | DEBUG | Successful authentication |
| `suspicious_request` | WARN | Suspicious activity (issuer mismatch, missing claims) |
| `rate_limit_exceeded` | WARN | Rate limit threshold exceeded |
| `ssrf_blocked` | WARN | Outbound request to private/internal address blocked |

All security events include the client IP address. Configure `TRUST_PROXY` when behind a reverse proxy to ensure accurate IP logging.

#### Monitoring and Alerting

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

### Rate Limiting

- Configurable via `RATE_LIMIT_ENABLED`, `RATE_LIMIT_WINDOW_MINS`, and `RATE_LIMIT_MAX`
- Defaults: 1000 requests per 15-minute window per IP
- Rate limit violations are logged as security events

### Security Headers

Helmet middleware provides:

- `Content-Security-Policy`
- `Strict-Transport-Security` (HSTS)
- `X-Frame-Options`
- `X-Content-Type-Options`
- And other standard security headers

See [ENVIRONMENT_VARIABLES.md](ENVIRONMENT_VARIABLES.md) for configuration of the security-related env vars.

---

## Design Rationale

- **Stateless** — aligns with modern API design (JWT bearer tokens); no session bugs, leaks, or race conditions.
- **HTTP POST-only** — most deployments are HTTP-based; MCP spec permits `405` for `GET`/`DELETE`; simpler to debug, monitor, and load-balance.
- **No server-managed OAuth** — clients control token lifecycle and can use any auth method; keeps the server stateless.

---

## References

- [MCP Specification (2025-11-25)](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)
- [Implementation: src/v2/](../src/v2/)
