# Environment Variables Reference (V2)

This document describes environment variables for the AGS API MCP Server V2.

> **Note:** This is the V2 configuration reference. For V1 documentation, see [docs/v1/ENVIRONMENT_VARIABLES.md](v1/ENVIRONMENT_VARIABLES.md).

## V2 Architecture

See [V2_ARCHITECTURE.md](V2_ARCHITECTURE.md) for the V2 stateless, HTTP-only architecture.

---

## AccelByte Configuration

### `AB_BASE_URL`
- **Description**: Base URL for AccelByte environment
- **Example**: `https://yourgame.accelbyte.io`
- **Default**: `https://development.accelbyte.io`
- **Required**: No (but strongly recommended for non-development environments)
- **Note**: Used for API calls to AccelByte services. If not set, defaults to the AccelByte development environment. Always set this explicitly in staging and production to avoid unintended API calls to the wrong environment.

---

## Server Configuration

### `MCP_PORT` or `PORT`
- **Description**: HTTP server port
- **Default**: `3000`
- **Required**: No
- **Note**: V2 prefers `MCP_PORT`, falls back to `PORT`

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

**Example**:
```bash
# Enable hosted mode with issuer validation
export MCP_HOSTED=true
export MCP_VALIDATE_TOKEN_ISSUER=true
```

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
  ags-api-mcp-server:v2
```

---

## Setting Environment Variables

### Using .env file

1. Run setup script:
```bash
pnpm run setup
```

2. Edit `.env` file:
```bash
AB_BASE_URL=https://yourgame.accelbyte.io
MCP_PORT=3000
MCP_AUTH=true
```

3. Start server:
```bash
pnpm start
```

### Using command line

```bash
AB_BASE_URL=https://yourgame.accelbyte.io MCP_AUTH=true pnpm start
```

### Using export

```bash
export AB_BASE_URL=https://yourgame.accelbyte.io
export MCP_AUTH=true
pnpm start
```

---

## V2 vs V1 Configuration

V2 has **significantly simpler** configuration compared to V1:

### Removed in V2

These V1 variables are **not used** in V2:

- `OAUTH_CLIENT_ID` - No server-side OAuth
- `OAUTH_CLIENT_SECRET` - No server-side OAuth
- `OAUTH_AUTHORIZATION_URL` - No OAuth flow
- `OAUTH_TOKEN_URL` - No OAuth flow
- `OAUTH_REDIRECT_URI` - No OAuth flow
- `JWKS_URI` - No token verification
- `JWT_ISSUER` - No token verification
- `JWT_AUDIENCE` - No token verification
- `JWT_ALGORITHMS` - No token verification
- `TRANSPORT` - HTTP-only (no stdio)
- `ENABLE_CLIENT_CREDENTIALS_FALLBACK` - No server-side auth
- `ADVERTISED_PROTOCOL` - Simplified
- `ADVERTISED_HOSTNAME` - Simplified
- `ADVERTISED_PORT` - Simplified

### V2 Additions

New in V2:

- `MCP_PORT` - Preferred over `PORT`
- `MCP_PATH` - Configurable endpoint path
- `MCP_SERVER_URL` - Explicit server URL
- `MCP_PROTOCOL` - Server protocol
- `MCP_HOSTNAME` - Server hostname
- `MCP_AUTH` - Toggle authentication
- `MCP_AUTH_SERVER_DISCOVERY_MODE` - OAuth discovery workaround
- `MCP_HOSTED` - Multi-tenant hosted mode
- `MCP_VALIDATE_TOKEN_ISSUER` - Token issuer validation
- `RATE_LIMIT_ENABLED` - Toggle rate limiting
- `RATE_LIMIT_WINDOW_MINS` - Rate limit window
- `RATE_LIMIT_MAX` - Max requests per window
- `OPENAPI_MAX_SEARCH_LIMIT` - Enforced max
- `OPENAPI_DEFAULT_RUN_TIMEOUT_MS` - Request timeout
- `OPENAPI_MAX_RUN_TIMEOUT_MS` - Max timeout
- `INCLUDE_WRITE_REQUESTS` - Control write ops

---

## Validation

V2 uses **Zod** for runtime validation of all configuration:

- Type checking at startup
- Clear error messages for invalid config
- Automatic type coercion (e.g., string to number)
- Default values applied consistently

**Example error**:
```
FATAL: Failed to load configuration
  error: "MCP_PORT must be a number between 1 and 65535"
```

---

## Environment-Specific Configuration

### Local Development

```bash
AB_BASE_URL=https://dev.yourgame.accelbyte.io
MCP_PORT=3000
NODE_ENV=development
LOG_LEVEL=debug
```

### Staging

```bash
AB_BASE_URL=https://staging.yourgame.accelbyte.io
MCP_PORT=3000
NODE_ENV=production
LOG_LEVEL=info
```

### Production

```bash
AB_BASE_URL=https://prod.yourgame.accelbyte.io
MCP_PORT=3000
NODE_ENV=production
LOG_LEVEL=warn
```

---

## Troubleshooting

### Server won't start

Check configuration:
```bash
# Recommended (defaults to development.accelbyte.io if unset)
echo $AB_BASE_URL
```

### Authentication fails

Check auth is enabled:
```bash
echo $MCP_AUTH  # Should be "true" or unset
```

### API timeouts

Increase timeout:
```bash
export OPENAPI_DEFAULT_RUN_TIMEOUT_MS=30000
```

### Port conflicts

Change port:
```bash
export MCP_PORT=3001
```

---

## References

- [V2 Architecture Guide](V2_ARCHITECTURE.md)
- [Quick Start Guide](QUICK_START.md)
- [API Reference](API_REFERENCE.md)
- [V1 Environment Variables](v1/ENVIRONMENT_VARIABLES.md) (legacy)

