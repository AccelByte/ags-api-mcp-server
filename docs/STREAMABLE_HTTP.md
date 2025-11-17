# Streamable HTTP Transport Implementation

This document describes the Streamable HTTP transport implementation for the MCP (Model Context Protocol) server, compliant with the [MCP Specification 2025-06-18](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports#streamable-http).

## Overview

The Streamable HTTP transport allows MCP clients to communicate with the server over HTTP using:
- **POST** requests for sending JSON-RPC messages from client to server
- **GET** requests for opening Server-Sent Events (SSE) streams for server-to-client messages
- **DELETE** requests for explicitly terminating sessions

## Features

### ✅ Implemented Features

1. **Protocol Version Header**: Supports `MCP-Protocol-Version` header (2025-06-18)
2. **Session Management**: Automatic session creation and tracking with `Mcp-Session-Id` header
3. **SSE Streaming**: Support for both JSON and SSE responses based on Accept header
4. **Security**: Origin header validation to prevent DNS rebinding attacks
5. **Resumability**: Event IDs for stream resumption using `Last-Event-Id` header
6. **Session Termination**: DELETE endpoint for explicit session cleanup
7. **Backwards Compatibility**: Falls back to protocol version 2025-03-26 when header not present

### 🔒 Security Features

- **Origin Validation**: Validates Origin header on all incoming requests
- **Localhost Binding**: Server binds to localhost (127.0.0.1) by default
- **Session ID Security**: Cryptographically secure session IDs using 32-byte random values
- **Authentication Required**: All MCP endpoints require OAuth authentication

## Endpoints

### POST /mcp

Sends a JSON-RPC message from client to server.

**Required Headers:**
- `Content-Type: application/json`
- `Accept: application/json` or `Accept: text/event-stream`
- `MCP-Protocol-Version: 2025-06-18` (optional, defaults to 2025-03-26)
- `Mcp-Session-Id: <session-id>` (required for non-initialize requests)

**Request Body:**
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": "2025-06-18",
    "capabilities": {},
    "clientInfo": {
      "name": "my-client",
      "version": "1.0.0"
    }
  }
}
```

**Response (JSON):**
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "protocolVersion": "2025-06-18",
    "capabilities": {
      "tools": {}
    },
    "serverInfo": {
      "name": "ags-api-mcp-server",
      "version": "1.0.0"
    }
  }
}
```

**Response Headers (for initialize):**
- `Mcp-Session-Id: <new-session-id>`

**Response (SSE when Accept: text/event-stream):**
```
Content-Type: text/event-stream

id: 1
data: {"jsonrpc":"2.0","id":1,"result":{...}}

```

**Status Codes:**
- `200 OK`: Request processed successfully (JSON response)
- `200 OK`: SSE stream opened (SSE response)
- `202 Accepted`: Notification or response accepted
- `400 Bad Request`: Invalid request, missing Accept header, or invalid protocol version
- `403 Forbidden`: Invalid origin
- `404 Not Found`: Session not found or expired

### GET /mcp

Opens an SSE stream for server-to-client messages (notifications and requests).

**Required Headers:**
- `Accept: text/event-stream`
- `MCP-Protocol-Version: 2025-06-18`
- `Mcp-Session-Id: <session-id>`
- `Last-Event-Id: <event-id>` (optional, for resuming)

**Response:**
```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive

id: 1
data: {"jsonrpc":"2.0","method":"notifications/message","params":{...}}

id: 2
data: {"jsonrpc":"2.0","id":100,"method":"tools/list","params":{}}

```

**Status Codes:**
- `200 OK`: SSE stream opened
- `404 Not Found`: Session not found
- `405 Method Not Allowed`: Accept header missing or invalid
- `403 Forbidden`: Invalid origin

### DELETE /mcp

Terminates an MCP session and cleans up all associated resources.

**Required Headers:**
- `Mcp-Session-Id: <session-id>`

**Response:**
```json
{
  "jsonrpc": "2.0",
  "result": {
    "success": true,
    "message": "Session terminated successfully"
  }
}
```

**Status Codes:**
- `200 OK`: Session terminated successfully
- `400 Bad Request`: Missing Mcp-Session-Id header
- `404 Not Found`: Session not found or already expired

## Session Management

### Session Lifecycle

1. **Creation**: Session is created automatically on first `initialize` request
2. **OAuth Integration**: The `Mcp-Session-Id` can be used directly for OAuth authentication
3. **Usage**: Client includes `Mcp-Session-Id` header in all subsequent requests
4. **Timeout**: Sessions expire automatically after 30 minutes of inactivity
5. **Termination**:
   - **Explicit**: Clients can send DELETE request to terminate sessions immediately
   - **Automatic**: Sessions expire after timeout if not explicitly deleted

### Using MCP Session ID for OAuth

When you initialize an MCP session, you receive an `Mcp-Session-Id`. This same ID is automatically used for OAuth authentication.

**How It Works:**
1. The MCP session ID is checked for stored OAuth tokens on every request
2. If OAuth tokens exist, they're used for authentication
3. If no OAuth tokens, falls back to client credentials (if enabled)
4. This happens automatically via the `Mcp-Session-Id` header

```bash
# 1. Initialize MCP session
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -H "MCP-Protocol-Version: 2025-06-18" \
  -d '{...initialize request...}'

# Response includes: Mcp-Session-Id: abc123def456...

# 2. Use that same ID for OAuth login
# Open in browser:
http://localhost:3000/auth/login?session_token=abc123def456...

# 3. After OAuth completes, your MCP session is authenticated
# All subsequent MCP requests with that Mcp-Session-Id will have OAuth tokens
```

This eliminates the need to pre-configure `SESSION_TOKEN` in your environment variables.

### Session ID Format

Session IDs are 64-character hexadecimal strings (32 bytes of cryptographically secure random data):
```
a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6a7b8c9d0e1f2
```

## Message Types

### Requests
JSON-RPC messages with `method` and `id` fields. Server responds with result or error.

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/list",
  "params": {}
}
```

### Notifications
JSON-RPC messages with `method` but no `id`. Server acknowledges with 202 Accepted.

```json
{
  "jsonrpc": "2.0",
  "method": "notifications/initialized"
}
```

### Responses
JSON-RPC messages with `id` and either `result` or `error`. Server acknowledges with 202 Accepted.

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {"status": "ok"}
}
```

## SSE Stream Format

### Event Format
```
id: <event-id>
data: <json-rpc-message>

```

### Event IDs
- Sequential integers starting from 1
- Unique per stream within a session
- Used for resumption via `Last-Event-Id` header

### Stream Closure
- Server closes stream after sending response to client request
- Client can close stream at any time
- Stream closed automatically on session expiration

## Protocol Version Negotiation

### Supported Versions
- `2025-06-18` (current)
- `2025-03-26` (fallback)

### Version Header
```
MCP-Protocol-Version: 2025-06-18
```

### Backwards Compatibility
- If header is missing, server assumes `2025-03-26`
- If version is invalid format, server returns 400 Bad Request
- If version is unsupported but valid format, server logs warning and attempts to handle

## Example Client Workflow

### Option A: With OAuth Authentication

### 1. Initialize MCP Session (Unauthenticated)
```bash
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -H "MCP-Protocol-Version: 2025-06-18" \
  -H "Authorization: Bearer <token>" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
      "protocolVersion": "2025-06-18",
      "capabilities": {},
      "clientInfo": {"name": "test-client", "version": "1.0.0"}
    }
  }'
```

Response includes `Mcp-Session-Id` header (e.g., `abc123def456...`).

### 2. Authenticate via OAuth

Open in browser:
```
http://localhost:3000/auth/login?session_token=abc123def456...
```

After successful OAuth login, your MCP session is authenticated.

### 3. List Available Tools (Now Authenticated)
```bash
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -H "MCP-Protocol-Version: 2025-06-18" \
  -H "Mcp-Session-Id: <session-id>" \
  -H "Authorization: Bearer <token>" \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/list",
    "params": {}
  }'
```

### 4. Call a Tool
```bash
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -H "MCP-Protocol-Version: 2025-06-18" \
  -H "Mcp-Session-Id: <session-id>" \
  -H "Authorization: Bearer <token>" \
  -d '{
    "jsonrpc": "2.0",
    "id": 3,
    "method": "tools/call",
    "params": {
      "name": "get_token_info",
      "arguments": {}
    }
  }'
```

### 5. Session Expiration

Sessions expire automatically after 30 minutes of inactivity. No explicit termination is needed or allowed.

~~Explicit DELETE has been disabled for security reasons - an attacker with a session ID could terminate legitimate sessions.~~

## Error Handling

### Common Error Codes

| HTTP Status | JSON-RPC Code | Meaning |
|------------|---------------|---------|
| 400 | -32600 | Invalid Request (malformed JSON-RPC or missing headers) |
| 403 | - | Invalid Origin |
| 404 | -32600 | Session not found or expired |
| 405 | - | Method not allowed or invalid Accept header |
| 500 | -32603 | Internal server error |

### Error Response Format
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "error": {
    "code": -32600,
    "message": "Session not found or expired"
  }
}
```

## Testing

Test the server using an MCP client (like Claude Desktop) or curl commands:

```bash
# Health check
curl http://localhost:3000/health

# Initialize MCP session
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -H "MCP-Protocol-Version: 2025-06-18" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}'
```

Note: Authentication is required for MCP endpoints. See the main README for authentication setup.
- Origin validation
- Invalid request handling

## Implementation Details

### File Structure
```
src/
├── streamable-http.ts     # Main Streamable HTTP transport implementation
├── index.ts               # Express server setup with /mcp endpoints
├── mcp-server.ts          # MCP JSON-RPC message handling
└── oauth-middleware.ts    # OAuth authentication
```

### Key Classes

#### `StreamableHTTPTransport`
Main transport handler with methods:
- `handlePost(req, res, userContext)` - Process POST requests
- `handleGet(req, res)` - Handle GET requests for SSE
- `handleDelete(req, res)` - Handle session deletion
- `getStats()` - Get session statistics

#### Session Storage
- In-memory session storage with Map
- Automatic cleanup of expired sessions (30 min timeout)
- Per-session event counters for SSE event IDs

## Compliance

This implementation complies with:
- [MCP Specification 2025-06-18](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports#streamable-http)
- [JSON-RPC 2.0 Specification](https://www.jsonrpc.org/specification)
- [Server-Sent Events (SSE) Specification](https://html.spec.whatwg.org/multipage/server-sent-events.html)

## Future Enhancements

- [ ] Persistent session storage (Redis/Database)
- [ ] Message replay from persistent storage for resumability
- [ ] Rate limiting per session
- [ ] WebSocket transport option
- [ ] Multi-server session sharing
- [ ] Metrics and monitoring

## Troubleshooting

### Session expires too quickly
Increase `SESSION_TIMEOUT_MS` in `src/streamable-http.ts` (default: 30 minutes)

### SSE stream disconnects
Check for reverse proxy timeouts. Configure nginx/ALB to support long-lived connections.

### Origin validation errors
Add your domain to the origin validation logic in `validateOrigin()` method.

### Protocol version errors
Ensure client sends `MCP-Protocol-Version: 2025-06-18` header.

## Support

For issues or questions:
1. Check the [MCP Specification](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports#streamable-http)
2. Enable debug logging: Set `LOG_LEVEL=debug` in environment
3. Review the authentication flow in AUTHENTICATION_FLOW.md

