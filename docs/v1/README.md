# V1 Archive (Legacy)

> ⚠️ **Deprecated.** V1 receives only limited fixes. New work targets V2 — start at the [main README](../../README.md) instead.

V1 is the original stateful architecture: server-managed OAuth flow (Authorization Code + PKCE), stdio and HTTP transports, full SSE streams for server-to-client messages, and server-side session/token management. Existing V1 deployments can keep running; this page is the single reference for them.

---

## Run V1

V1 is still wired into the repo. After `pnpm install && pnpm build`:

```bash
# stdio (for desktop MCP clients)
pnpm run start:v1-stdio

# HTTP
pnpm run start:v1-http
```

Minimum `.env`:

```env
AB_BASE_URL=https://yourgame.accelbyte.io
OAUTH_CLIENT_ID=your-client-id
OAUTH_CLIENT_SECRET=your-client-secret
OAUTH_REDIRECT_URI=http://localhost:3000/oauth/callback   # only for user-token flow
TRANSPORT=stdio                                            # or http
```

---

## OAuth Setup

V1 implements OAuth 2.1 Authorization Code with PKCE against AccelByte IAM. The server owns the OAuth client; clients trigger the flow through an MCP tool.

1. Client calls the `start_oauth_login` MCP tool. Server returns `{ session_token, otp_token, login_url }`.
2. Client opens `login_url` (`/auth/login?otp_token=<uuid>`) in a browser.
3. Server exchanges the OTP for the session, generates PKCE parameters, redirects to AccelByte IAM for user consent.
4. AccelByte redirects to `/oauth/callback` with an authorization code; server exchanges the code (with `code_verifier`) for tokens and stores them against the session.
5. Subsequent MCP requests carrying that session use the stored token; the server refreshes it as needed.

**Redirect URI must match the value registered in AccelByte IAM** (Game Setup → Games and Apps → IAM Clients → Your Client → Redirect URI). Mismatches are rejected by IAM.

OTP tokens are single-use and expire in 10 minutes.

For protocol-level OAuth details, see the [MCP authorization spec](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization).

---

## Endpoints

| Endpoint | Purpose |
|----------|---------|
| `POST /mcp` | JSON-RPC requests (client → server) |
| `GET /mcp` | SSE stream (server → client messages) |
| `DELETE /mcp` | Terminate an MCP session |
| `GET /auth/login?otp_token=<uuid>` | Begin OAuth login (OTP from `start_oauth_login`) |
| `GET /oauth/callback` | OAuth authorization-code callback |
| `GET /health` | Liveness probe |
| `GET /.well-known/oauth-authorization-server` | OAuth server metadata (RFC 8414) |
| `GET /.well-known/openid-configuration` | OIDC discovery |
| `GET /.well-known/oauth-protected-resource` | Protected resource metadata (RFC 9728) |

Authentication accepts `Authorization: Bearer <token>`, `Mcp-Session-Id: <id>`, or (stdio only) an auto-generated session token.

---

## V1-Specific Environment Variables

These exist in V1 but are not used by V2.

| Variable | Default | Notes |
|----------|---------|-------|
| `OAUTH_CLIENT_ID` | — | Server-side OAuth client (V1 owns the flow) |
| `OAUTH_CLIENT_SECRET` | — | Paired secret; never commit |
| `OAUTH_AUTHORIZATION_URL` | `{AB_BASE_URL}/iam/v3/oauth/authorize` | Override only for non-standard IAM |
| `OAUTH_TOKEN_URL` | `{AB_BASE_URL}/iam/v3/oauth/token` | Override only for non-standard IAM |
| `OAUTH_REDIRECT_URI` | `{advertised-base}/oauth/callback` | Must match IAM registration |
| `ENABLE_CLIENT_CREDENTIALS_FALLBACK` | `true` (HTTP); always on (stdio) | Falls back to client-credentials when no user token |
| `JWKS_URI` | `{AB_BASE_URL}/iam/v3/oauth/jwks` | Token signature verification |
| `JWT_ISSUER` | `{AB_BASE_URL}` | May differ on shared cloud |
| `JWT_AUDIENCE` | `0f8b2a3ecb63466994d5e4631d3b9fe7` | |
| `JWT_ALGORITHMS` | `RS256` | |
| `TRANSPORT` | `stdio` | Or `http` |
| `ADVERTISED_PROTOCOL` | `http` | For OAuth callback URLs behind a proxy |
| `ADVERTISED_HOSTNAME` | `localhost` | |
| `ADVERTISED_PORT` | `80` | Omitted from URL when 80/443 |

Shared variables (`AB_BASE_URL`, `PORT`, `NODE_ENV`, `LOG_LEVEL`) behave the same in V1 and V2 — see [../ENVIRONMENT_VARIABLES.md](../ENVIRONMENT_VARIABLES.md).

---

For V2 (recommended), go back to the [main README](../../README.md).
