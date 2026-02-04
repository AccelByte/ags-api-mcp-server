# Changelog

## v2026.1 (V2 Architecture)

### 🎉 V2 Release - Complete Rewrite

**Major architectural changes** for simpler, stateless operation:

**New Features:**
- ✨ Stateless architecture - no server-side sessions or token storage
- ✨ HTTP-only transport (stdio removed for simplicity)
- ✨ User consent via elicitation for write operations (POST/PUT/PATCH/DELETE)
- ✨ Zod schema validation for all tool inputs/outputs
- ✨ Output schemas defined for all tools
- ✨ Rate limiting middleware (1000 req/15min default, configurable via `RATE_LIMIT_MAX`)
- ✨ Instance caching for OpenApiTools and workflows
- ✨ Configurable max limits (search results, timeouts)
- ✨ Structured MCP responses (content + structuredContent)
- ✨ Better error handling with McpError and ErrorCode enums

**Infrastructure:**
- ✅ `/health` endpoint for monitoring
- ✅ `/` root informational endpoint
- ✅ SIGTERM signal handling for containers
- ✅ Graceful shutdown with timeout (10s)
- ✅ Request logging middleware
- ✅ Error handling middleware
- ✅ `express.urlencoded` support

**Removed Features (Intentional):**
- ⚠️ OAuth flow tools (`start_oauth_login`, `logout`) - client manages auth
- ⚠️ Server-side session management - fully stateless
- ⚠️ stdio transport - HTTP-only
- ⚠️ SSE streams (GET/DELETE endpoints return 405) - minimal Streamable HTTP
- ⚠️ JWKS token verification - trusts client-provided tokens
- ⚠️ Automatic token refresh - client responsibility
- ⚠️ Client credentials fallback - explicit auth only

**MCP Tools:**
- ✅ `get_token_info` - Improved with hints section, better structure
- ✅ `search-apis` - Added Zod validation, output schema
- ✅ `describe-apis` - Added Zod validation, output schema
- ✅ `run-apis` - Added user consent via elicitation

**Configuration Changes:**
- New: `MCP_PORT`, `MCP_PATH`, `MCP_AUTH`, `MCP_SERVER_URL`
- New: `OPENAPI_MAX_SEARCH_LIMIT`, `OPENAPI_DEFAULT_RUN_TIMEOUT_MS`, `OPENAPI_MAX_RUN_TIMEOUT_MS`
- Removed: All OAuth/OIDC environment variables

**Documentation:**
- 📚 New `docs/V2_ARCHITECTURE.md` - comprehensive V1 vs V2 comparison
- 📚 Updated all endpoint documentation for V2

**Migration:** See `docs/V2_ARCHITECTURE.md` for detailed migration guide.

**Why V2?** Stateless design enables simpler deployment, horizontal scaling, and eliminates session-related bugs. Perfect for containerized production environments.

---

## v2025.9

- Update OpenAPI specs.

## v2025.8.1

- Added richer token/session surfaces across `MCPServer`, `StaticTools`, and OAuth middleware, including OTP/session manager ports, refresh token reporting, and new OAuth login/logout tools on STDIO transports.
- Introduced streamable HTTP transport support with server‐mode detection, OAuth route wiring, base URL + `ADVERTISED_*` config, and exposed HTTP server status helpers.
- Expanded docs, test utilities, and example servers; reorganized docs into `docs/`, updated `env.example`, and added `tests/` with coverage for static/OpenAPI tools.
- Migrated the toolchain to pnpm, added ESLint + updated `tsconfig`, refreshed `package.json` scripts/version, and removed legacy `package-lock.json`.
- Improved logging (OpenAPI tools debug output), refactored core structure, and reordered `UserContext` fields to align with the new protocol version.
- Fixed test server env var usage and guarded streamable server startup with mode checks.
