# API Reference (V2)

This document describes all available API endpoints for the AGS API MCP Server V2.

> **Note:** This is the V2 API reference. For V1 documentation, see [docs/v1/API_REFERENCE.md](v1/API_REFERENCE.md).

## Architecture Overview

V2 is **stateless** and uses **HTTP-only** transport with:
- POST-only MCP endpoint
- Bearer token authentication (client-managed)
- No server-side sessions
- No SSE streams

See [V2_ARCHITECTURE.md](V2_ARCHITECTURE.md) for detailed architectural information.

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
  "version": "2025.9.0",
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

V2 provides 4 core tools:

### 1. `get_token_info`

Get information about the authenticated token and user.

**Input**: None required

**Output**:
```json
{
  "namespace": "mygame",
  "user_id": "user-uuid",
  "display_name": "PlayerName",
  "roles": ["User"],
  "permissions": [...],
  "expires_at": 1234567890,
  "hints": {
    "namespace_usage": "This namespace should be used as the default...",
    "token_validity": "Token is valid and active"
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
  "status": 200,
  "data": { ... },
  "headers": { ... }
}
```

**User Consent**: For write operations (POST/PUT/PATCH/DELETE), the tool uses **elicitation** to request user approval before execution.

---

## Rate Limiting

V2 includes built-in rate limiting:

- **Default**: 100 requests per 15 minutes per IP
- **Response**: `429 Too Many Requests` when exceeded
- **Headers**: Rate limit info in response headers

---

## Error Responses

All endpoints return errors in this format:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "error": {
    "code": -32600,
    "message": "Invalid Request",
    "data": {
      "details": "Additional error information"
    }
  }
}
```

### Common Error Codes

| HTTP Status | JSON-RPC Code | Meaning |
|------------|---------------|---------|
| 400 | -32600 | Invalid Request |
| 401 | -32000 | Unauthorized (missing/invalid token) |
| 405 | - | Method Not Allowed (GET/DELETE on /mcp) |
| 429 | -32000 | Rate Limit Exceeded |
| 500 | -32603 | Internal Server Error |

---

## CORS

V2 includes CORS support with sensible defaults:
- Allows common origins for development
- Configurable via middleware

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

