# V1 Documentation (Legacy)

This directory contains documentation for the **V1 architecture** of the AGS API MCP Server.

> ⚠️ **Note:** V1 is legacy. For current documentation, see the main [docs/](../) directory.

---

## What is V1?

V1 is the **original stateful architecture** with:
- ✅ Server-managed OAuth flow
- ✅ Stdio + HTTP transports
- ✅ SSE streams for server-to-client messages
- ✅ Server-side session management
- ✅ Automatic token refresh

---

## V1 vs V2

| Feature | V1 (Legacy) | V2 (Current) |
|---------|------------|--------------|
| **Architecture** | Stateful | Stateless |
| **Transport** | stdio + HTTP | HTTP only |
| **Authentication** | Server-managed OAuth | Client-managed tokens |
| **Sessions** | Server-side | None |
| **SSE Streams** | Full support | POST-only (405 for GET) |
| **Complexity** | Higher | Lower |
| **Scaling** | Requires sticky sessions | Horizontal scaling |

See [V2_ARCHITECTURE.md](../V2_ARCHITECTURE.md) for detailed comparison.

---

## V1 Documentation Index

### Core Documentation
- [API_REFERENCE.md](API_REFERENCE.md) - V1 API endpoints (OAuth, SSE, sessions)
- [DEVELOPMENT.md](DEVELOPMENT.md) - V1 development guide
- [OAUTH_FLOW.md](OAUTH_FLOW.md) - Server-managed OAuth flow details
- [STREAMABLE_HTTP.md](STREAMABLE_HTTP.md) - Full Streamable HTTP with SSE

### Setup & Configuration
- [QUICK_START.md](QUICK_START.md) - V1 setup instructions
- [ENVIRONMENT_VARIABLES.md](ENVIRONMENT_VARIABLES.md) - V1 configuration options

---

## When to Use V1

Consider V1 if you need:
- Server-managed OAuth flow (no client OAuth implementation)
- Stdio transport for desktop applications
- SSE streams for real-time server notifications
- Automatic token refresh

**Most users should use V2** for simpler deployment and better scaling.

---

## Running V1

### Stdio Mode

```bash
# Build
pnpm run build

# Run V1 stdio
pnpm run start:v1-stdio
```

### HTTP Mode

```bash
# Build
pnpm run build

# Run V1 HTTP
pnpm run start:v1-http
```

### Configuration

V1 requires OAuth credentials:

```bash
# Required
AB_BASE_URL=https://yourgame.accelbyte.io
OAUTH_CLIENT_ID=your-client-id
OAUTH_CLIENT_SECRET=your-client-secret

# Optional
TRANSPORT=stdio  # or 'http'
PORT=3000
```

See [ENVIRONMENT_VARIABLES.md](ENVIRONMENT_VARIABLES.md) for complete V1 configuration.

---

## Migration to V2

To migrate from V1 to V2:

1. **Update client authentication** - Implement OAuth flow in client
2. **Remove server-side OAuth** - No more `OAUTH_CLIENT_ID`/`OAUTH_CLIENT_SECRET`
3. **Update transport** - V2 is HTTP-only
4. **Pass tokens via header** - `Authorization: Bearer <token>`
5. **Handle token refresh** - Client responsibility

See [V2_ARCHITECTURE.md](../V2_ARCHITECTURE.md) migration guide.

---

## Support

V1 is **legacy** and receives limited updates. New features are V2-only.

For current documentation, see:
- [docs/](../) - V2 documentation
- [V2_ARCHITECTURE.md](../V2_ARCHITECTURE.md) - V2 architecture guide
- [QUICK_START.md](../QUICK_START.md) - V2 quick start

---

## References

- [V2 Architecture Guide](../V2_ARCHITECTURE.md) - Detailed V1 vs V2 comparison
- [V2 Quick Start](../QUICK_START.md) - Get started with V2
- [MCP Specification](https://modelcontextprotocol.io/specification/2025-11-25/)

