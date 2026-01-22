# V2 Architecture Guide

This document describes the V2 implementation of the AGS API MCP Server, its architectural decisions, and how it differs from V1.

## Table of Contents

- [Overview](#overview)
- [Key Architectural Changes](#key-architectural-changes)
- [Feature Comparison Matrix](#feature-comparison-matrix)
- [Migration Guide](#migration-guide)
- [Design Rationale](#design-rationale)

---

## Overview

**V2 is a complete rewrite** focused on:
- ✅ **Stateless architecture** - No server-side sessions or token storage
- ✅ **Simplicity** - Fewer moving parts, easier to deploy
- ✅ **Standards compliance** - Full MCP specification compliance
- ✅ **Type safety** - Zod validation throughout
- ✅ **Better DX** - Clearer error messages, structured responses

**Status:** V2 is production-ready and feature-complete for its intended design.

---

## Key Architectural Changes

### 1. **Stateless Design**

**V1 (Stateful):**
```
┌─────────────────────────────────────┐
│  Session Manager (in-memory)        │
│  - Stores access tokens             │
│  - Stores refresh tokens            │
│  - Manages token expiration         │
│  - Auto-refreshes tokens            │
└─────────────────────────────────────┘
```

**V2 (Stateless):**
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
- ✅ Simpler deployment (no state to manage)
- ✅ Horizontal scaling (no session affinity)
- ✅ No memory leaks from session accumulation
- ⚠️ Client must handle token refresh
- ⚠️ No automatic fallback to client credentials

### 2. **HTTP-Only Transport**

**V1:** Supports both `stdio` and `http` transports
**V2:** HTTP-only

**Rationale:**
- Focus on production HTTP deployments
- Simpler codebase with single transport
- stdio adds complexity for session management
- Most production use cases are HTTP-based

### 3. **Minimal Streamable HTTP**

**V1:** Full Streamable HTTP with SSE streams
**V2:** POST-only (returns 405 for GET/DELETE)

Per [MCP Specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports):
> "The server **MAY** respond with HTTP 405 Method Not Allowed"

**Trade-offs:**
- ✅ Simpler implementation
- ✅ No long-lived connections
- ✅ Easier to debug
- ⚠️ No SSE streams for server notifications
- ⚠️ No session management features

### 4. **Authentication Model**

**V1:** Server-managed OAuth flow
**V2:** Client-provided bearer tokens

| Aspect | V1 | V2 |
|--------|----|----|
| OAuth flow | Server handles | Client handles |
| Token storage | Server-side | Client-side |
| Token refresh | Automatic | Client responsibility |
| JWKS verification | Yes | No (trusts client) |
| Client credentials fallback | Yes | No |

### 5. **Validation & Error Handling**

**V2 Improvements:**
- ✅ Zod schema validation for all inputs/outputs
- ✅ McpError with proper ErrorCode enums
- ✅ Structured error responses
- ✅ Output schema definitions for tools

---

## Feature Comparison Matrix

### MCP Tools

| Tool | V1 | V2 | Status | Notes |
|------|----|----|--------|-------|
| `get_token_info` | ✅ | ✅ | ✅ **Improved** | Better structure, hints section |
| `start_oauth_login` | ✅ | ❌ | ⚠️ **Removed** | Stateless - no OAuth flow |
| `logout` | ✅ | ❌ | ⚠️ **Removed** | No sessions to logout |
| `search-apis` | ✅ | ✅ | ✅ **Improved** | Zod validation, output schema |
| `describe-apis` | ✅ | ✅ | ✅ **Improved** | Zod validation, output schema |
| `run-apis` | ✅ | ✅ | ✅ **Improved** | User consent via elicitation |

### MCP Prompts

| Prompt | V1 | V2 | Status |
|--------|----|----|--------|
| `run-workflow` | ✅ | ✅ | ✅ **Improved** (autocomplete, better caching) |

### MCP Resources

| Resource | V1 | V2 | Status |
|----------|----|----|--------|
| `resource://workflows/schema` | ✅ | ✅ | ✅ **Ported** |
| `resource://workflows/technical-specification` | ✅ | ✅ | ✅ **Ported** |
| `resource://workflows` | ✅ | ✅ | ✅ **Ported** |

### HTTP Endpoints

| Endpoint | Method | V1 | V2 | Notes |
|----------|--------|----|----|-------|
| `/mcp` | POST | ✅ | ✅ | JSON-RPC messages |
| `/mcp` | GET | ✅ | ⛔ | V2 returns 405 (allowed by spec) |
| `/mcp` | DELETE | ✅ | ⛔ | V2 returns 405 (allowed by spec) |
| `/auth/login` | GET | ✅ | ❌ | OAuth removed |
| `/oauth/callback` | GET | ✅ | ❌ | OAuth removed |
| `/.well-known/oauth-authorization-server` | GET | ✅ | ❌ | OAuth removed |
| `/.well-known/openid-configuration` | GET | ✅ | ❌ | OAuth removed |
| `/.well-known/oauth-protected-resource` | GET | ✅ | ✅ | Resource metadata |
| `/` | GET | ✅ | ✅ | Root info |
| `/health` | GET | ✅ | ✅ | Health check |

### Express Middleware

| Middleware | V1 | V2 | Notes |
|------------|----|----|-------|
| helmet | ✅ | ✅ | Same |
| cors | ✅ | ✅ | Same |
| Rate limiting | ❌ | ✅ | **V2 Addition** |
| cookieParser | ✅ | ✅ | Same |
| express.json | ✅ | ✅ | V2 has 10mb limit |
| express.urlencoded | ❌ | ✅ | **V2 Addition** |
| Request logging | ✅ | ✅ | Same |
| Error handling | ✅ | ✅ | Same |
| OAuth middleware | ✅ | ❌ | Replaced with simple token extraction |
| Token extraction | ❌ | ✅ | **V2 Addition** (simple JWT extraction) |

### Configuration

| Config | V1 Env Var | V2 Env Var | Notes |
|--------|-----------|-----------|-------|
| **Server** |
| Port | `PORT` | `MCP_PORT` or `PORT` | V2 prefers MCP_PORT |
| Base URL | Multiple vars | `MCP_SERVER_URL` | V2 more explicit |
| Transport | `TRANSPORT` | N/A | V2 HTTP-only |
| **OpenAPI** |
| Specs dir | `OPENAPI_SPECS_DIR` | `OPENAPI_SPECS_DIR` | Same |
| Search limit | `OPENAPI_DEFAULT_SEARCH_LIMIT` | `OPENAPI_DEFAULT_SEARCH_LIMIT` | Same |
| Max search limit | ❌ | `OPENAPI_MAX_SEARCH_LIMIT` | **V2 Addition** |
| Run timeout | ❌ | `OPENAPI_DEFAULT_RUN_TIMEOUT_MS` | **V2 Addition** |
| Max run timeout | ❌ | `OPENAPI_MAX_RUN_TIMEOUT_MS` | **V2 Addition** |
| Server URL | `AB_BASE_URL` | `AB_BASE_URL` | Same |
| **V2-Specific** |
| MCP path | ❌ | `MCP_PATH` | Default `/mcp` |
| Auth enabled | ❌ | `MCP_AUTH` | Toggle authentication |

### V2 Improvements

| Feature | Description |
|---------|-------------|
| **Elicitation Support** | User consent for write operations (POST/PUT/PATCH/DELETE) |
| **Output Schemas** | All tools define output schemas for better client integration |
| **Zod Validation** | Runtime type safety and validation |
| **Instance Caching** | OpenApiTools cached across requests |
| **Workflow Caching** | Smart file-based caching |
| **Configurable Limits** | Max search results, timeouts enforced |
| **Error Codes** | Proper McpError with ErrorCode enums |
| **Structured Responses** | Both text content and structuredContent |
| **Request ID Support** | Ready for distributed tracing (TODO) |
| **Rate Limiting** | 1000 req/15min by default |

---

## Migration Guide

### For Clients

**Authentication:**
```typescript
// V1: Server manages OAuth
// Client just needs to call start_oauth_login
await mcpClient.callTool("start_oauth_login", {});

// V2: Client manages OAuth
// Client must obtain token externally and pass it
const token = await getTokenFromOAuthProvider();
await fetch('/mcp', {
  headers: { 'Authorization': `Bearer ${token}` }
});
```

**Token Refresh:**
```typescript
// V1: Automatic (server handles)
// No client action needed

// V2: Manual (client handles)
if (tokenExpired) {
  const newToken = await refreshToken(refreshToken);
  // Update Authorization header
}
```

**Tool Changes:**
```typescript
// V1: start_oauth_login and logout available
await mcpClient.callTool("start_oauth_login", {});
await mcpClient.callTool("logout", {});

// V2: These tools don't exist
// Client must handle OAuth externally
```

### For Server Operators

**Deployment:**
- No session state to persist
- No need for sticky sessions
- Can scale horizontally freely
- Simpler health checks

**Configuration:**
- Remove OAuth-related env vars
- Add V2-specific env vars (MCP_PORT, MCP_PATH, etc.)
- Configure rate limits if needed
- Set max search/timeout limits

**Monitoring:**
- `/health` endpoint for health checks
- Request logging for debugging
- No session metrics to track

---

## Design Rationale

### Why Stateless?

1. **Simpler Deployment:** No need to manage session state, memory, cleanup
2. **Better Scaling:** Can add/remove instances freely
3. **Clearer Separation:** MCP server focuses on protocol, not auth
4. **Standard Pattern:** Aligns with modern API design (JWT bearer tokens)
5. **Less State Bugs:** No session leaks, expiration issues, or race conditions

### Why HTTP-Only?

1. **Production Focus:** Most deployments are HTTP-based
2. **Simpler Code:** Single transport to maintain
3. **Better Tooling:** HTTP is easier to debug, monitor, test
4. **Container-Friendly:** Works well in Docker/Kubernetes
5. **Load Balancing:** Standard HTTP load balancers work out of box

### Why No SSE Streams?

1. **Minimal Spec:** MCP allows 405 for GET/DELETE
2. **Simpler Model:** Request-response is easier to reason about
3. **No State Needed:** SSE requires persistent connections/sessions
4. **Client Polling:** Clients can poll if needed
5. **Future Option:** Can add later if demand exists

### Why Remove OAuth Tools?

1. **Separation of Concerns:** Auth is client responsibility
2. **Stateless Requirement:** OAuth flow requires session state
3. **Security:** Client should control token lifecycle
4. **Flexibility:** Clients can use any auth method
5. **Standard Pattern:** Bearer token auth is industry standard

---

## Performance Characteristics

### V1
- **Memory:** Session state scales with active users
- **Connections:** Long-lived SSE streams consume resources
- **Cleanup:** Requires periodic session cleanup
- **Scaling:** Requires sticky sessions or shared state

### V2
- **Memory:** Constant per request (no accumulation)
- **Connections:** Short-lived HTTP requests
- **Cleanup:** Automatic per-request cleanup
- **Scaling:** Stateless, scales horizontally freely

---

## Security Considerations

### V1
- ✅ Server verifies tokens with JWKS
- ✅ Automatic token refresh
- ⚠️ Server stores sensitive tokens
- ⚠️ Session hijacking risk
- ⚠️ Session fixation attacks

### V2
- ✅ No token storage on server
- ✅ No session vulnerabilities
- ✅ Client controls token lifecycle
- ⚠️ Trusts client-provided tokens
- ⚠️ Client must verify tokens

**Recommendation:** V2 expects clients to validate tokens before sending them. For production use, consider adding token verification middleware if needed.

---

## Future Enhancements

Potential V2 additions (not roadmapped):
- [ ] Optional SSE support (GET endpoint)
- [ ] Optional session management
- [ ] Token verification middleware
- [ ] Request ID middleware (tracing)
- [ ] Configurable CORS
- [ ] Custom rate limiting per endpoint
- [ ] Metrics/monitoring endpoints

---

## Conclusion

**V2 is not V1 with features removed** - it's a **different architecture** optimized for:
- Stateless operation
- Simple deployment
- Horizontal scaling
- Standards compliance
- Type safety

Both versions are production-ready. Choose based on your needs:
- **Use V1** if you need server-managed OAuth, stdio transport, or SSE streams
- **Use V2** if you want stateless operation, simple deployment, or better type safety

---

## References

- [MCP Specification (2025-11-25)](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)
- [V2 Implementation: src/v2/](../src/v2/)
- [V1 Implementation: src/](../src/)

