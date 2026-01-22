# Documentation Guide

This document explains the documentation structure for the AGS API MCP Server.

---

## Documentation Structure

The project maintains **two sets of documentation**:

### V2 Documentation (Current)
Location: `docs/` (root level)

V2 is the **current, recommended** architecture:
- ✅ Stateless design
- ✅ HTTP-only transport
- ✅ Client-managed authentication
- ✅ Simple deployment
- ✅ Horizontal scaling

### V1 Documentation (Legacy)
Location: `docs/v1/`

V1 is the **legacy** architecture maintained for backward compatibility:
- Server-managed OAuth flow
- Stdio + HTTP transports
- SSE streams
- Server-side sessions

---

## V2 Documentation Index

### Getting Started

| Document | Description |
|----------|-------------|
| [QUICK_START.md](QUICK_START.md) | Quick start guide - get running in minutes |
| [V2_ARCHITECTURE.md](V2_ARCHITECTURE.md) | Architecture overview and V1 comparison |

### Core Documentation

| Document | Description |
|----------|-------------|
| [API_REFERENCE.md](API_REFERENCE.md) | Complete API endpoints reference |
| [ENVIRONMENT_VARIABLES.md](ENVIRONMENT_VARIABLES.md) | Configuration options |

### Deployment & Operations

| Document | Description |
|----------|-------------|
| [DOCKER.md](DOCKER.md) | Docker deployment guide |

### Development

| Document | Description |
|----------|-------------|
| [DEVELOPMENT.md](DEVELOPMENT.md) | Development guide and contributing |
| [TESTING.md](TESTING.md) | Testing strategies and examples |

---

## V1 Documentation Index

Location: [docs/v1/](v1/)

See [docs/v1/README.md](v1/README.md) for the complete V1 documentation index.

### Key V1 Documents

| Document | Description |
|----------|-------------|
| [v1/OAUTH_FLOW.md](v1/OAUTH_FLOW.md) | Server-managed OAuth flow (V1 only) |
| [v1/STREAMABLE_HTTP.md](v1/STREAMABLE_HTTP.md) | Full SSE implementation (V1 only) |
| [v1/QUICK_START.md](v1/QUICK_START.md) | V1 setup with OAuth configuration |

---

## Choosing V1 or V2

### Use V2 If...

✅ You want **simple deployment**  
✅ You can **manage OAuth client-side**  
✅ You need **horizontal scaling**  
✅ You prefer **stateless architecture**  
✅ You're **starting a new project**

**Recommended for most users.**

### Use V1 If...

✅ You need **server-managed OAuth**  
✅ You need **stdio transport**  
✅ You need **SSE streams**  
✅ You have an **existing V1 deployment**

**Legacy - limited new features.**

---

## Documentation by Topic

### Authentication

**V2**: [API_REFERENCE.md#authentication](API_REFERENCE.md#authentication) - Bearer token (client-managed)  
**V1**: [v1/OAUTH_FLOW.md](v1/OAUTH_FLOW.md) - Server-managed OAuth flow

### Configuration

**V2**: [ENVIRONMENT_VARIABLES.md](ENVIRONMENT_VARIABLES.md) - Minimal configuration  
**V1**: [v1/ENVIRONMENT_VARIABLES.md](v1/ENVIRONMENT_VARIABLES.md) - OAuth configuration

### API Endpoints

**V2**: [API_REFERENCE.md](API_REFERENCE.md) - POST /mcp (405 for GET/DELETE)  
**V1**: [v1/API_REFERENCE.md](v1/API_REFERENCE.md) - Full SSE, OAuth endpoints

### Deployment

**V2**: [DOCKER.md](DOCKER.md) - Stateless containers

### Development

**V2**: [DEVELOPMENT.md](DEVELOPMENT.md) - Factory pattern, Zod validation  
**V1**: [v1/DEVELOPMENT.md](v1/DEVELOPMENT.md) - Session management, OAuth middleware

### Testing

**V2**: [TESTING.md](TESTING.md) - Stateless testing

---

## Quick Reference

### V2 Setup (Recommended)

```bash
# Minimal configuration
export AB_BASE_URL=https://yourgame.accelbyte.io

# Build and run
pnpm run build
pnpm start
```

**No OAuth configuration needed!** Clients provide Bearer tokens.

See [QUICK_START.md](QUICK_START.md) for details.

### V1 Setup (Legacy)

```bash
# OAuth configuration required
export AB_BASE_URL=https://yourgame.accelbyte.io
export OAUTH_CLIENT_ID=your-client-id
export OAUTH_CLIENT_SECRET=your-client-secret

# Build and run
pnpm run build
pnpm run start:v1-http  # or start:v1-stdio
```

See [v1/QUICK_START.md](v1/QUICK_START.md) for details.

---

## Migration from V1 to V2

See [V2_ARCHITECTURE.md#migration-guide](V2_ARCHITECTURE.md#migration-guide) for detailed migration instructions.

**Summary**:
1. Remove `OAUTH_CLIENT_ID` and `OAUTH_CLIENT_SECRET`
2. Implement OAuth flow in your client
3. Pass tokens via `Authorization: Bearer <token>` header
4. Remove stdio-specific configuration
5. Update to `pnpm start` (runs V2)

---

## Documentation Conventions

### File Names

- **Current docs**: `FILENAME.md` in `docs/`
- **Legacy docs**: `FILENAME.md` in `docs/v1/`

### Links Between Versions

V2 docs link to V1 when referencing legacy features:
```markdown
> **Note:** For V1 documentation, see [docs/v1/FILENAME.md](v1/FILENAME.md).
```

V1 docs link to V2 for current information:
```markdown
> ⚠️ **Note:** This is legacy V1 documentation. See [../FILENAME.md](../FILENAME.md) for V2.
```

### Version Indicators

Each document clearly indicates its version:

**V2 documents**:
```markdown
# Title (V2)
> **Note:** This is the V2 guide. For V1, see [docs/v1/...](v1/...).
```

**V1 documents**:
```markdown
# Title (V1 / Legacy)
> ⚠️ **Note:** This is legacy V1 documentation.
```

---

## Contributing to Documentation

### Adding V2 Documentation

1. Create file in `docs/` directory
2. Add version indicator at top
3. Link to V1 equivalent if exists
4. Update [README.md](../README.md) index

### Updating V1 Documentation

V1 receives **limited updates** (critical fixes only).

For new features, **update V2 documentation**.

### Documentation Style

- Use clear headings
- Include code examples
- Link to related documents
- Keep V2 as primary focus

---

## FAQ

### Where do I start?

**New users**: Start with [QUICK_START.md](QUICK_START.md) (V2)

### Which architecture should I use?

**V2 for most cases**. See [V2_ARCHITECTURE.md](V2_ARCHITECTURE.md) for comparison.

### Where is the OAuth flow documentation?

**V2**: OAuth is client-managed - see [API_REFERENCE.md#authentication](API_REFERENCE.md#authentication)  
**V1**: Server-managed - see [v1/OAUTH_FLOW.md](v1/OAUTH_FLOW.md)

### Where are the SSE stream docs?

**V2**: No SSE (POST-only) - see [API_REFERENCE.md](API_REFERENCE.md)  
**V1**: Full SSE - see [v1/STREAMABLE_HTTP.md](v1/STREAMABLE_HTTP.md)

### Can I use stdio transport?

**V2**: No (HTTP-only)  
**V1**: Yes - see [v1/QUICK_START.md](v1/QUICK_START.md)

### How do I migrate from V1 to V2?

See [V2_ARCHITECTURE.md#migration-guide](V2_ARCHITECTURE.md#migration-guide)

---

## Support

- **Documentation issues**: Open an issue in the repository
- **V2 questions**: See [V2_ARCHITECTURE.md](V2_ARCHITECTURE.md)
- **V1 questions**: See [v1/README.md](v1/README.md)

---

## Document History

| Date | Change |
|------|--------|
| 2025-01 | Documentation reorganized for V2 |
| 2024-12 | V2 architecture introduced |
| 2024-11 | V1 documentation created |

