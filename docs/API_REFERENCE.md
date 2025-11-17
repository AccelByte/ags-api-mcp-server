# API Reference

This document describes all available API endpoints for the AGS API MCP Server.

## MCP Protocol (Streamable HTTP)

The server implements the MCP (Model Context Protocol) using Streamable HTTP transport, compliant with [MCP Specification 2025-06-18](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports#streamable-http).

### `POST /mcp`
Send JSON-RPC messages from client to server.

**Authentication**: Required (Bearer token, MCP session ID, or auto-generated session token)

**Request Headers**:
- `Content-Type: application/json`
- `Accept: application/json` or `Accept: text/event-stream`
- `MCP-Protocol-Version: 2025-06-18` (optional)
- `Mcp-Session-Id: <session-id>` (required for non-initialize requests)
- `Authorization: Bearer <token>` (optional, if using bearer token)

**Request Body**:
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/list",
  "params": {}
}
```

**Response**: JSON-RPC response or Server-Sent Events stream (depending on Accept header)

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

### `GET /mcp`
Open Server-Sent Events (SSE) stream for server-to-client messages.

**Authentication**: Required (Bearer token, MCP session ID, or auto-generated session token)

**Request Headers**:
- `Accept: text/event-stream`
- `MCP-Protocol-Version: 2025-06-18` (optional)
- `Mcp-Session-Id: <session-id>` (optional, for resuming existing session)
- `Last-Event-Id: <event-id>` (optional, for stream resumption)
- `Authorization: Bearer <token>` (optional, if using bearer token)

**Response**: Server-Sent Events stream

**Example**:
```bash
curl -N http://localhost:3000/mcp \
  -H "Accept: text/event-stream" \
  -H "Authorization: Bearer your_jwt_token"
```

For detailed Streamable HTTP documentation, see [docs/STREAMABLE_HTTP.md](STREAMABLE_HTTP.md).

## OAuth & Authentication

### `GET /auth/login?otp_token=<uuid>`
Initiate OAuth login flow using a secure one-time password token.

**Authentication**: OTP token (required in query parameter)

**Query Parameters**:
- `otp_token` (required): One-time password token obtained from `start_oauth_login` tool response

**Security Features**:
- OTP tokens expire in 10 minutes
- OTP tokens can only be used once
- Returns 400 Bad Request if OTP token is missing or invalid

**Response**: Redirects to OAuth authorization server

**Example**:
```
http://localhost:3000/auth/login?otp_token=550e8400-e29b-41d4-a716-446655440000
```

**Note**: Get the OTP token from the `start_oauth_login` MCP tool response before calling this endpoint.

### `GET /oauth/callback`
OAuth callback handler for receiving authorization codes.

**Authentication**: Not required (handled by OAuth flow)

**Query Parameters**: Standard OAuth callback parameters (code, state, etc.)

**Response**: Redirects to success page or error page

**Note**: This endpoint is automatically called by the OAuth provider after user authorization. It should be configured as the redirect URI in your OAuth client settings.

## Health Check

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

## Discovery Endpoints

These endpoints provide metadata about the OAuth/OIDC configuration, following standard discovery protocols.

### `GET /.well-known/oauth-authorization-server`
OAuth server metadata (RFC 8414).

**Authentication**: Not required

**Response**: JSON object containing OAuth server metadata

**Example**:
```bash
curl http://localhost:3000/.well-known/oauth-authorization-server
```

### `GET /.well-known/openid-configuration`
OpenID Connect discovery document.

**Authentication**: Not required

**Response**: JSON object containing OpenID Connect configuration

**Example**:
```bash
curl http://localhost:3000/.well-known/openid-configuration
```

### `GET /.well-known/oauth-protected-resource`
Protected resource metadata (RFC 9728).

**Authentication**: Not required

**Response**: JSON object containing protected resource metadata

**Example**:
```bash
curl http://localhost:3000/.well-known/oauth-protected-resource
```

## Authentication Methods

The server supports multiple authentication methods:

### Bearer Token
Standard OAuth bearer token authentication.

**Usage**:
- Set `Authorization: Bearer <token>` header
- Or set `auth_token` cookie

**Supported for**: All endpoints requiring authentication

### MCP Session ID Header
For Streamable HTTP transport sessions.

**Usage**:
- Set `Mcp-Session-Id: <session-id>` header
- Session ID is returned after initializing a session

**Supported for**: MCP protocol endpoints (`/mcp`)

### Auto-Generated Session Token
For stdio mode (automatically generated, no configuration needed).

**Usage**:
- Automatically handled by the server in stdio mode
- No manual configuration required

**Supported for**: Stdio mode only

### OTP Token
For OAuth login URLs only (single-use, 10-minute expiry).

**Usage**:
- Include `otp_token` query parameter in `/auth/login` endpoint
- Get OTP token from `start_oauth_login` tool response

**Supported for**: `/auth/login` endpoint only

## Error Responses

All endpoints may return standard HTTP error codes:

- `400 Bad Request`: Invalid request parameters or missing required parameters
- `401 Unauthorized`: Authentication required or authentication failed
- `403 Forbidden`: Insufficient permissions
- `404 Not Found`: Endpoint not found
- `500 Internal Server Error`: Server error

Error responses follow this format:
```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable error message"
  }
}
```

## Rate Limiting

Currently, the server does not implement rate limiting. However, it's recommended to:
- Use appropriate request intervals
- Implement client-side rate limiting for production use
- Monitor server resources

## CORS

For HTTP mode, the server validates the `Origin` header to prevent DNS rebinding attacks. Ensure your client sends the correct `Origin` header when making requests.

