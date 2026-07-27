# Environment Variables Reference

This document describes environment variables for the AGS API MCP Server.

## AccelByte Configuration

### `AB_BASE_URL`
- **Description**: Base URL for AccelByte environment
- **Example**: `https://yourgame.accelbyte.io`
- **Default**: `https://development.accelbyte.io`
- **Required**: No (but strongly recommended for non-development environments)
- **Note**: Used for API calls to AccelByte services, including Athena Facade requests when render tools use `provider="facade"`. If not set, defaults to the AccelByte development environment. Always set this explicitly in staging and production to avoid unintended API calls to the wrong environment.

---

## Server Configuration

### `MCP_PORT` or `PORT`
- **Description**: HTTP server port
- **Default**: `3000`
- **Required**: No
- **Note**: `MCP_PORT` is preferred; `PORT` is supported as a fallback

### `MCP_PATH`
- **Description**: MCP endpoint path
- **Default**: `/mcp`
- **Required**: No
- **Example**: `/api/mcp`

### `MCP_SERVER_URL`
- **Description**: Full server URL (for metadata responses)
- **Default**: Auto-derived from `MCP_PROTOCOL`, `MCP_HOSTNAME`, and `MCP_PORT`
- **Required**: No
- **Example**: `http://localhost:3000`

### `MCP_PROTOCOL`
- **Description**: Server protocol
- **Default**: `http`
- **Required**: No
- **Options**: `http`, `https`

### `MCP_HOSTNAME`
- **Description**: Server hostname
- **Default**: `localhost`
- **Required**: No

### `MCP_AUTH`
- **Description**: Enable authentication
- **Default**: `true`
- **Required**: No
- **Options**: `true`, `false`
- **Note**: Set to `false` only for development/testing

**Example**:
```bash
# Disable auth for local testing (not recommended for production)
export MCP_AUTH=false
```

### `MCP_RENDER_TOOLS`
- **Description**: Enable analytics render tools and the renderer app resource
- **Default**: `true`
- **Required**: No
- **Options**: `true`, `false`
- **Note**: This is the only new analytics-related server environment variable. Set to `false` as an operational rollback switch to suppress all 15 `render_*` tools and `ui://renderer/index.html`.

### `MCP_AUTH_SERVER_DISCOVERY_MODE`
- **Description**: OAuth authorization server discovery workaround mode for MCP clients that don't support cross-host discovery (e.g., VS Code)
- **Default**: `none`
- **Required**: No
- **Options**: `none`, `redirect`, `proxy`, `proxyRegister`
- **Note**: Cannot be used with `MCP_HOSTED=true`. This is a temporary workaround; see [README troubleshooting](../README.md) for details.

---

## OpenAPI Configuration

### `OPENAPI_SPECS_DIR`
- **Description**: Directory containing OpenAPI specification files
- **Default**: `openapi-specs`
- **Required**: No
- **Note**: Can be absolute or relative to project root

### `OPENAPI_DEFAULT_SEARCH_LIMIT`
- **Description**: Default number of search results
- **Default**: `10`
- **Required**: No
- **Range**: 1-50

### `OPENAPI_MAX_SEARCH_LIMIT`
- **Description**: Maximum allowed search results
- **Default**: `50`
- **Required**: No
- **Range**: 1-50

### `OPENAPI_DEFAULT_RUN_TIMEOUT_MS`
- **Description**: Default timeout for API requests (milliseconds)
- **Default**: `15000` (15 seconds)
- **Required**: No
- **Range**: 1-60000

### `OPENAPI_MAX_RUN_TIMEOUT_MS`
- **Description**: Maximum allowed timeout for API requests (milliseconds)
- **Default**: `60000` (60 seconds)
- **Required**: No
- **Range**: 1-60000

### `INCLUDE_WRITE_REQUESTS`
- **Description**: Include write operations (POST/PUT/PATCH/DELETE) in tools
- **Default**: `true`
- **Required**: No
- **Options**: `true`, `false`
- **Note**: When `true`, write operations require user consent via elicitation

---

## Runtime Configuration

### `NODE_ENV`
- **Description**: Node.js environment
- **Default**: `development`
- **Required**: No
- **Options**: `development`, `production`

### `LOG_LEVEL`
- **Description**: Logging level
- **Default**: `info`
- **Required**: No
- **Options**: `fatal`, `error`, `warn`, `info`, `debug`, `trace`

---

## Security Configuration

### `TRUST_PROXY`
- **Description**: Configure Express trust proxy for accurate `req.ip` behind reverse proxies
- **Default**: Not set (disabled)
- **Required**: No (but recommended in Docker/Kubernetes deployments)

| Deployment | Setting | Explanation |
|------------|---------|-------------|
| Single proxy (nginx, ALB) | `TRUST_PROXY=1` | Trust the first proxy's `X-Forwarded-For` header |
| Multiple proxies | `TRUST_PROXY=2` | Trust the first 2 proxies in the chain |
| Localhost proxy | `TRUST_PROXY=loopback` | Trust proxies on 127.0.0.1, ::1 |
| Docker internal network | `TRUST_PROXY=172.17.0.0/16` | Trust proxies in Docker's default network |
| Kubernetes | `TRUST_PROXY=uniquelocal,loopback` | Trust local and unique local addresses |

**Security Warning:** Never set `TRUST_PROXY=true` (trusts all proxies), as this allows client-controlled IP spoofing via `X-Forwarded-For`.

**How to verify:**
1. Make a request and check `req.ip` in logs
2. If it shows the proxy IP (e.g., `172.17.0.1`), enable trust proxy
3. Verify `req.ip` now shows the real client IP

### `JWKS_CACHE_TTL_MS`
- **Description**: TTL for the JWKS URI discovery cache (milliseconds)
- **Default**: `600000` (10 minutes)
- **Required**: No

### `JWKS_CACHE_MAX_AGE`
- **Description**: TTL for the JWKS signing key cache
- **Default**: `10m`
- **Required**: No
- **Note**: Accepts both string duration (`"10m"`) and milliseconds (`600000`)

### `JWKS_DISCOVERY_TIMEOUT_MS`
- **Description**: Timeout for JWKS URI discovery endpoint fetches (milliseconds)
- **Default**: `10000` (10 seconds)
- **Required**: No
- **Recommended range**: `3000`–`30000`
- **Note**: Lower values improve responsiveness during discovery outages; higher values accommodate slow network environments (VPN, airgapped)

### `JWKS_RATE_LIMIT`
- **Description**: Maximum JWKS key retrieval requests per minute
- **Default**: `10`
- **Required**: No

### `ALLOW_CROSS_DOMAIN_JWKS`
- **Description**: Allow JWKS URI hostname to differ from the authorization server hostname
- **Default**: `false`
- **Required**: No
- **Options**: `true`, `false`
- **Note**: By default, JWKS discovery rejects responses where the `jwks_uri` hostname doesn't match the authorization server. Set to `true` only if your JWKS is intentionally hosted on a different domain (e.g., CDN-backed key distribution).
- **Required for tenant-subdomain hosted deployments.** When clients reach this server at `{namespace}.{baseHost}`, discovery fetches `https://{namespace}.{baseHost}/.well-known/oauth-authorization-server` and AGS answers with a `jwks_uri` on the *parent* host (`https://{baseHost}/iam/v3/oauth/jwks`), because IAM builds that URL from its configured base URI rather than the request host. Without this flag the hostname check throws and every request 401s at signature verification — including tokens that already passed the issuer check. Note the trade-off: the `jwks_uri` returned by discovery is not re-validated against the private-address guard once cross-domain fetches are permitted.

### `ALLOW_JWKS_COLD_START`
- **Description**: Allow server to start even if JWKS cache pre-warming fails
- **Default**: `false`
- **Required**: No
- **Options**: `true`, `false`
- **Note**: By default, the server exits on startup if it cannot reach the JWKS discovery endpoint (indicates misconfiguration). Set to `true` to allow degraded startup where JWKS will be fetched on the first request instead.

---

## Rate Limiting

### `RATE_LIMIT_ENABLED`
- **Description**: Enable or disable rate limiting
- **Default**: `true`
- **Required**: No
- **Options**: `true`, `false`
- **Note**: Set to `false` to disable rate limiting entirely

### `RATE_LIMIT_WINDOW_MINS`
- **Description**: Rate limit window duration in minutes
- **Default**: `15`
- **Required**: No
- **Example**: `30` (30-minute window)

### `RATE_LIMIT_MAX`
- **Description**: Maximum number of requests per IP within the rate limit window
- **Default**: `1000`
- **Required**: No
- **Example**: `100` (stricter limit for production)

**Example**:
```bash
# Stricter rate limiting for production
export RATE_LIMIT_WINDOW_MINS=15
export RATE_LIMIT_MAX=100
```

---

## Hosted Mode

Hosted mode enables multi-tenant deployment where the AGS base URL is derived from the request's Host header.

### `MCP_HOSTED`
- **Description**: Enable hosted mode for multi-tenant environments
- **Default**: `false`
- **Required**: No
- **Options**: `true`, `false`
- **Note**: When enabled, the AGS base URL is derived from the request's Host header

### `MCP_VALIDATE_TOKEN_ISSUER`
- **Description**: Validate that the JWT token issuer matches the derived AGS URL
- **Default**: `true`
- **Required**: No
- **Options**: `true`, `false`
- **Note**: Only applicable when `MCP_HOSTED=true`. Provides additional security by ensuring tokens were issued for the correct environment.

### `ALLOW_PARENT_DOMAIN_ISSUER`
- **Description**: Allow the JWT `iss` claim to be a parent domain of the request's derived host
- **Default**: `false`
- **Required**: No
- **Options**: `true`, `false`
- **Note**: Some AGS deployments share a single OAuth authorization server across subdomain environments — for example, issuer `internal.gamingservices.accelbyte.io` signs tokens for `<env>.internal.gamingservices.accelbyte.io`. Without this flag the issuer check rejects such tokens. Enabling the flag accepts a token only when the derived host is a *strict* subdomain of the issuer host (`endsWith(".${issuerHost}")`); bare suffix matches like `evil-internal.foo` versus `internal.foo` are still rejected, and an issuer that includes a path component is never matched against a parent-domain rule. The JWT signature itself is still verified against the issuer's JWKS. Has no effect when `MCP_VALIDATE_TOKEN_ISSUER=false`, since the issuer check is then skipped entirely.

**Example**:
```bash
# Enable hosted mode with issuer validation
export MCP_HOSTED=true
export MCP_VALIDATE_TOKEN_ISSUER=true

# Hosted mode against an AGS environment whose tokens use a parent-domain issuer
export MCP_HOSTED=true
export MCP_VALIDATE_TOKEN_ISSUER=true
export ALLOW_PARENT_DOMAIN_ISSUER=true
```

> **Hosted mode and `MCP_SERVER_URL`:** When `MCP_HOSTED=true` you should set `MCP_SERVER_URL` to a safe public fallback URL for the MCP server (e.g. `http://localhost:3030` for a local Docker container, or `https://mcp.example.com` behind a public reverse proxy). When trusted proxy headers identify the client-facing origin, OAuth discovery uses that origin and inserts `/.well-known/oauth-protected-resource` before the full MCP resource path. Untrusted hosted request headers cannot override `MCP_SERVER_URL`. For example, `/mcp/foundations` advertises `/.well-known/oauth-protected-resource/mcp/foundations` as required by RFC 9728.

---

## Configuration Examples

### Minimal Configuration

For most users, only `AB_BASE_URL` needs to be set:

```bash
# Recommended (defaults to development.accelbyte.io if omitted)
AB_BASE_URL=https://yourgame.accelbyte.io
```

All other settings use sensible defaults.

### Development Configuration

```bash
# Recommended
AB_BASE_URL=https://yourgame.accelbyte.io

# Optional - Development settings
MCP_PORT=3000
MCP_AUTH=true
NODE_ENV=development
LOG_LEVEL=debug
```

### Production Configuration

```bash
# Recommended
AB_BASE_URL=https://yourgame.accelbyte.io

# Optional - Production settings
MCP_PORT=3000
MCP_AUTH=true
NODE_ENV=production
LOG_LEVEL=info

# Optional - Custom limits
OPENAPI_MAX_SEARCH_LIMIT=50
OPENAPI_MAX_RUN_TIMEOUT_MS=60000
```

### Docker Configuration

```bash
docker run -d \
  --name ags-api-mcp-server \
  -e AB_BASE_URL=https://yourgame.accelbyte.io \
  -e MCP_AUTH=true \
  -e NODE_ENV=production \
  -e LOG_LEVEL=info \
  -p 3000:3000 \
  ags-api-mcp-server
```

---

## Validation

The server uses **Zod** for runtime validation of all configuration: type checking at startup, clear error messages, automatic type coercion, and consistent default application. Invalid configuration aborts startup with a `FATAL: Failed to load configuration` log line that names the offending variable.

---

## References

- [Architecture Guide](ARCHITECTURE.md)
