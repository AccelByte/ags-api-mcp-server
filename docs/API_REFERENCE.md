# API Reference (V2)

This document describes all available API endpoints for the AGS API MCP Server V2.

> **Note:** This is the V2 API reference. For V1 documentation, see [docs/v1/API_REFERENCE.md](v1/API_REFERENCE.md).

## Architecture Overview

See [V2_ARCHITECTURE.md](V2_ARCHITECTURE.md) for the V2 stateless, HTTP-only architecture.

---

## MCP Protocol Endpoint

### `POST /mcp`

Send JSON-RPC messages from client to server.

**Authentication**: Required - Bearer token via `Authorization` header

**Request Headers**:
- `Content-Type: application/json` (required)
- `Authorization: Bearer <token>` (required)
- `Accept: application/json` (optional)

**Request Body**:
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/list",
  "params": {}
}
```

**Response**: JSON-RPC response
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "tools": [...]
  }
}
```

**Status Codes**:
- `200 OK`: Request processed successfully
- `400 Bad Request`: Invalid JSON-RPC request
- `401 Unauthorized`: Missing or invalid bearer token
- `405 Method Not Allowed`: Non-POST request (V2 is POST-only)
- `429 Too Many Requests`: Rate limit exceeded
- `500 Internal Server Error`: Server error

**Example**:
```bash
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your_jwt_token" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/list"
  }'
```

### `GET /mcp` and `DELETE /mcp`

**Status**: Returns `405 Method Not Allowed`

V2 implements minimal Streamable HTTP per MCP specification, which allows returning 405 for GET and DELETE methods. V2 focuses on stateless POST-only operation.

For V1 with full SSE support, see [docs/v1/STREAMABLE_HTTP.md](v1/STREAMABLE_HTTP.md).

---

## Health & Information Endpoints

### `GET /health`

Check server health status.

**Authentication**: Not required

**Response**:
```json
{
  "status": "ok",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

**Example**:
```bash
curl http://localhost:3000/health
```

### `GET /`

Server information and available endpoints.

**Authentication**: Not required

**Response**:
```json
{
  "name": "ags-api-mcp-server",
  "version": "2026.2.0",
  "description": "AccelByte Gaming Services API MCP Server",
  "endpoints": {
    "mcp": "http://localhost:3000/mcp",
    "health": "http://localhost:3000/health",
    "protectedResourceMetadata": "http://localhost:3000/.well-known/oauth-protected-resource"
  },
  "authentication": {
    "enabled": true,
    "type": "Bearer Token (JWT)",
    "authorizationServer": "https://yourgame.accelbyte.io"
  },
  "documentation": {
    "mcp": "https://modelcontextprotocol.io/",
    "accelbyte": "https://docs.accelbyte.io/"
  }
}
```

### `GET /.well-known/oauth-protected-resource`

Protected resource metadata per RFC 9728.

**Authentication**: Not required

**Response**: JSON object containing protected resource metadata

**Example**:
```bash
curl http://localhost:3000/.well-known/oauth-protected-resource
```

---

## Authentication

V2 uses **Bearer Token authentication** (client-managed).

### How It Works

1. **Client obtains token** externally (from OAuth provider)
2. **Client includes token** in Authorization header: `Bearer <token>`
3. **Server validates token** per request (stateless)

### Token Format

Standard JWT (JSON Web Token) from AccelByte IAM:
```
Authorization: Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...
```

### Authentication Flow

```
┌─────────────┐                    ┌──────────────┐
│   Client    │                    │  MCP Server  │
└──────┬──────┘                    └──────┬───────┘
       │                                  │
       │  1. Obtain JWT from OAuth        │
       │     provider externally          │
       │                                  │
       │  2. POST /mcp                    │
       │     Authorization: Bearer <JWT>  │
       ├─────────────────────────────────►│
       │                                  │
       │                   3. Extract JWT │
       │                      from header │
       │                                  │
       │                   4. Use token   │
       │                      for API     │
       │                      calls       │
       │                                  │
       │  5. Response                     │
       │◄─────────────────────────────────┤
       │                                  │
```

### Token Refresh

**Client responsibility** - V2 doesn't manage tokens server-side:
1. Monitor token expiration
2. Refresh token before it expires
3. Update Authorization header with new token

### Optional: Disable Authentication

Set `MCP_AUTH=false` for development/testing (not recommended for production):

```bash
export MCP_AUTH=false
pnpm start
```

---

## MCP Tools

V2 provides 4 core tools plus 15 analytics render tools.

### 1. `get_token_info`

Get information about the authenticated token and user.

**Input**: None required

**Output**:
```json
{
  "message": "Token information from authenticated token.",
  "claims": {
    "issuer": "https://yourgame.accelbyte.io",
    "subject": "user-uuid",
    "clientId": "my-client-id",
    "namespace": "mygame",
    "userId": "user-uuid",
    "displayName": "PlayerName",
    "roles": ["User"],
    "permissions": [...],
    "scope": "openid commerce",
    "expiresAt": 1234567890,
    "expiresAtISO": "2024-01-15T12:00:00.000Z"
  },
  "headers": {
    "algorithm": "RS256",
    "keyId": "key-id",
    "type": "JWT"
  },
  "hints": {
    "namespace": {
      "value": "mygame",
      "message": "Use namespace \"mygame\" as the implicit default..."
    }
  },
  "metadata": {
    "type": "user_token",
    "length": 1234,
    "masked": "eyJ0eXAi...***...signature",
    "isExpired": false,
    "timeUntilExpiry": "2 hour(s) 30 minute(s)"
  }
}
```

### 2. `search-apis`

Search across loaded OpenAPI operations.

**Input**:
```json
{
  "query": "user profile",
  "method": "GET",
  "tag": "Users",
  "spec": "iam",
  "limit": 10
}
```

**Output**:
```json
{
  "results": [
    {
      "apiId": "iam:GET:/iam/v3/public/users/me/profiles",
      "method": "GET",
      "path": "/iam/v3/public/users/me/profiles",
      "summary": "Get my user profile",
      "description": "...",
      "tags": ["Users"],
      "spec": "iam"
    }
  ],
  "total": 1,
  "limit": 10
}
```

### 3. `describe-apis`

Get detailed information about a specific API operation.

**Input**:
```json
{
  "apiId": "iam:GET:/iam/v3/public/users/me/profiles"
}
```

**Output**: Detailed API schema, parameters, responses, etc.

### 4. `run-apis`

Execute API requests against endpoints.

**Input**:
```json
{
  "apiId": "iam:GET:/iam/v3/public/users/me/profiles",
  "pathParams": {},
  "query": {},
  "headers": {},
  "timeoutMs": 15000
}
```

**Output**:
```json
{
  "request": {
    "method": "GET",
    "url": "https://yourgame.accelbyte.io/iam/v3/public/users/me/profiles",
    "headers": { ... },
    "body": null
  },
  "response": {
    "status": 200,
    "statusText": "OK",
    "headers": { ... },
    "data": { ... },
    "durationMs": 150
  },
  "error": null
}
```

**User Consent**: For write operations (POST/PUT/PATCH/DELETE), the tool uses **elicitation** to request user approval before execution.

#### Athena Facade Operations via `afs`

The Athena Facade spec is loaded like every other OpenAPI spec and can be executed through `run-apis`.

| Operation | Purpose |
|----------|---------|
| `POST /afs/v1/admin/namespaces/{namespace}/queries` | Submit an Athena SQL query |
| `GET /afs/v1/admin/namespaces/{namespace}/queries/{id}` | Poll query status and fetch rows when terminal |
| `GET /afs/v1/admin/namespaces/{namespace}/tables` | List/search tables within a database |
| `GET /afs/v1/admin/namespaces/{namespace}/tables/{database}/{table}` | Fetch full table metadata |

If you intend to render via `provider="facade"`, prefer submitting with `wait_ms=0` so you can reliably poll `GET /afs/v1/admin/namespaces/{namespace}/queries/{id}` until `status="SUCCEEDED"`. If the submit endpoint returns `200` with inline rows on the fast path, use those `columns` and `rows` with `provider="direct"` instead of reusing the returned `query_id`.

### 5. Analytics Render Tools

All render tools share the same data-source model.

**Common input fields**

```json
{
  "provider": "facade",
  "query_id": "required when provider=facade",
  "namespace": "required when provider=facade",
  "data_columns": "required when provider=direct",
  "data_rows": "required when provider=direct",
  "max_rows": 10000,
  "title": "optional",
  "description": "optional",
  "column_hints": {
    "my_column": {
      "type": "quantitative",
      "label": "My Column",
      "format": ".2f"
    }
  },
  "filters": [
    {
      "column": "status",
      "op": "eq",
      "value": "SUCCEEDED"
    }
  ]
}
```

**Providers**

- `provider="facade"`: fetches rows from Athena Facade using `query_id` and `namespace`
- `provider="direct"`: renders inline data from `data_columns` and `data_rows`

**Shared output shape**

Every render tool returns strict structured content with the shape below. The exact `chart_type` literal and `options` object vary by tool.

```json
{
  "chart_type": "tool-specific discriminator",
  "title": "optional",
  "description": "optional",
  "column_hints": {},
  "filters": [],
  "data": {
    "columns": [
      { "name": "column_name", "type": "string" }
    ],
    "rows": [["value"]]
  },
  "options": {}
}
```

| Tool | Required option fields | Optional option fields | Output `chart_type` |
|------|------------------------|------------------------|---------------------|
| `render_bar_chart` | `x`, `y` | `color`, `bar_mode`, `orientation`, `label`, `facet_col`, `facet_row`, `x_label`, `y_label`, `tooltip` | `bar` |
| `render_line_chart` | `x`, `y` | `color`, `show_points`, `curve`, `facet_col`, `facet_row`, `x_label`, `y_label`, `tooltip` | `line` |
| `render_area_chart` | `x`, `y` | `color`, `stack_mode`, `curve`, `facet_col`, `facet_row`, `x_label`, `y_label`, `tooltip` | `area` |
| `render_scatter_chart` | `x`, `y` | `color`, `size`, `trend_line`, `facet_col`, `facet_row`, `x_label`, `y_label`, `tooltip` | `scatter` |
| `render_histogram_chart` | `column` | `bin_count`, `normalize`, `color`, `facet_col`, `facet_row`, `x_label`, `y_label` | `histogram` |
| `render_box_chart` | `x`, `y` | `color`, `facet_col`, `facet_row`, `x_label`, `y_label` | `box` |
| `render_heatmap_chart` | `x`, `y`, `value` | `color_scheme`, `show_values`, `x_label`, `y_label` | `heatmap` |
| `render_pie_chart` | `category`, `value` | `show_labels`, `other_threshold` | `pie` |
| `render_donut_chart` | `category`, `value` | `show_labels`, `other_threshold`, `center_label`, `hole` | `donut` |
| `render_waterfall_chart` | `category`, `value` | `is_total`, `x_label`, `y_label` | `waterfall` |
| `render_funnel_chart` | `stage`, `value` | `orientation`, `show_conversion` | `funnel` |
| `render_gauge_chart` | `value`, `max` | `min`, `thresholds`, `unit` | `gauge` |
| `render_state_timeline_chart` | `entity`, `start`, `end`, `state` | none | `state_timeline` |
| `render_table` | none | `columns_order`, `page_size` | `table` |
| `render_metric` | `value` | `compare`, `label`, `unit`, `format` | `metric` |

## MCP Resources

V2 exposes four resources:

| Resource URI | Purpose |
|--------------|---------|
| `resource://workflows/schema` | Workflow schema |
| `resource://workflows/technical-specification` | Workflow technical specification |
| `resource://workflows` | Workflow catalog |
| `ui://renderer/index.html` | Single-file analytics renderer bundle with `_meta["ags/bundleVersion"]` |

---

## Rate Limiting

V2 includes built-in rate limiting:

- **Default**: 1000 requests per 15 minutes per IP
- **Response**: `429 Too Many Requests` when exceeded
- **Headers**: Rate limit info in response headers

---

## Error Responses

### MCP Protocol Errors (POST /mcp)

MCP endpoint errors follow the JSON-RPC 2.0 format:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "error": {
    "code": -32600,
    "message": "Invalid Request"
  }
}
```

### Express-Level Errors (Non-MCP Endpoints)

Non-MCP endpoint errors (e.g., health check, auth routes) return plain JSON:

```json
{
  "error": "Internal server error",
  "message": "Details (development mode only)"
}
```

### Common Error Codes

| HTTP Status | Context | Meaning |
|------------|---------|---------|
| 400 | MCP (JSON-RPC -32600) | Invalid Request |
| 401 | Express | Unauthorized (missing/invalid token) |
| 405 | Express | Method Not Allowed (GET/DELETE on /mcp) |
| 429 | Express | Rate Limit Exceeded |
| 500 | Express / MCP (JSON-RPC -32603) | Internal Server Error |

---

## CORS

V2 includes CORS support:
- Allows all origins by default (`cors({})`)
- Configure the `cors()` options in `src/v2/express.ts` to restrict origins for production

---

## Comparison with V1

| Feature | V1 | V2 |
|---------|----|----|
| **Transport** | stdio + HTTP with SSE | HTTP POST-only |
| **Authentication** | Server-managed OAuth | Client-managed Bearer token |
| **Session Management** | Server-side sessions | Stateless |
| **GET /mcp** | SSE stream | 405 Method Not Allowed |
| **DELETE /mcp** | Session termination | 405 Method Not Allowed |
| **OAuth Endpoints** | /auth/login, /oauth/callback | None |
| **Rate Limiting** | None | Built-in |

See [V2_ARCHITECTURE.md](V2_ARCHITECTURE.md) for detailed comparison.

---

## References

- [MCP Specification (2025-11-25)](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)
- [V2 Architecture Guide](V2_ARCHITECTURE.md)
- [V1 API Reference](v1/API_REFERENCE.md) (legacy)
