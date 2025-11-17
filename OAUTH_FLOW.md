# OAuth Flow Documentation

## Overview

This project implements OAuth 2.1 with PKCE (Proof Key for Code Exchange) for secure user authentication. The OAuth flow integrates with AccelByte's IAM service and supports both HTTP and stdio transport modes.

## Key Components

- **OAuth Middleware** (`oauth-middleware.ts`) - Handles OAuth flow and token verification
- **Session Manager** (`session-manager.ts`) - Manages user sessions and token storage
- **OTP Manager** (`otp-manager.ts`) - Generates one-time password tokens for secure OAuth URLs
- **Config** (`config.ts`) - OAuth and OIDC configuration

## OAuth Configuration

### Environment Variables

```bash
# Base URL for AccelByte environment
AB_BASE_URL=https://yourgame.accelbyte.io

# OAuth Client Configuration
OAUTH_CLIENT_ID=your-client-id
OAUTH_CLIENT_SECRET=your-client-secret

# Auto-derived URLs (optional overrides)
OAUTH_AUTHORIZATION_URL=${AB_BASE_URL}/iam/v3/oauth/authorize
OAUTH_TOKEN_URL=${AB_BASE_URL}/iam/v3/oauth/token
OAUTH_REDIRECT_URI=http://localhost:3000/oauth/callback

# OIDC Configuration (auto-derived)
JWKS_URI=${AB_BASE_URL}/iam/v3/oauth/jwks
JWT_ISSUER=${AB_BASE_URL}
JWT_ALGORITHMS=RS256

# Fallback Configuration
ENABLE_CLIENT_CREDENTIALS_FALLBACK=true  # HTTP mode (default: true)
# stdio mode: always enabled
```

## Authentication Flows

### 1. Authorization Code Flow with PKCE (User Authentication)

This is the primary flow for user authentication, providing user-specific permissions.

```
┌─────────┐                                                          ┌──────────────┐
│  User   │                                                          │ MCP Client   │
└────┬────┘                                                          └──────┬───────┘
     │                                                                      │
     │  1. Call start_oauth_login tool                                      │
     │─────────────────────────────────────────────────────────────────────►┤
     │                                                                      │
     │  2. Generate session + OTP token                                     │
     ├◄─────────────────────────────────────────────────────────────────────│
     │     {                                                                │
     │       session_token: "uuid",                                         │
     │       otp_token: "uuid",                                             │
     │       login_url: "/auth/login?otp_token=..."                         │
     │     }                                                                │
     │                                                                      │
     │  3. Open login URL in browser                                        │
     ├                                                                      │
     │                                                                      │
┌────▼────────────────────────────────────────────────────────────────────▼────┐
│                         OAuth Authorization Flow                             │
│                                                                              │
│  ┌─────────────┐         ┌──────────────┐         ┌─────────────────┐        │
│  │ MCP Server  │         │ AccelByte    │         │ User Browser    │        │
│  │             │         │ IAM          │         │                 │        │
│  └──────┬──────┘         └───────┬──────┘         └─────────┬───────┘        │
│         │                        │                          │                │
│         │  4. Exchange OTP for session token                │                │
│         │        (single-use, 10-min expiry)                │                │
│         ├◄───────────────────────┼──────────────────────────│                │
│         │                        │                          │                │
│         │  5. Generate PKCE parameters                      │                │
│         │     - code_verifier (random 32 bytes)             │                │
│         │     - code_challenge (SHA256 hash)                │                │
│         │     - state (with embedded session token)         │                │
│         │                        │                          │                │
│         │  6. Redirect to authorization URL                 │                │
│         │     with PKCE challenge                           │                │
│         ├────────────────────────┼─────────────────────────►│                │
│         │                        │                          │                │
│         │                        │  7. User login & consent │                │
│         │                        │◄─────────────────────────┤                │
│         │                        │                          │                │
│         │                        │  8. Authorization code   │                │
│         ├                        ┼─────────────────────────►│                │
│         │  9. Callback with code & state                    │                │
│         │◄───────────────────────┼──────────────────────────┤                │
│         │                        │                          │                │
│         │  10. Validate state    │                          │                │
│         │      Extract session   │                          │                │
│         │                        │                          │                │
│         │  11. Exchange code for tokens                     │                │
│         │      (with code_verifier)                         │                │
│         ├───────────────────────►│                          │                │
│         │                        │                          │                │
│         │  12. Access + Refresh tokens                      │                │
│         │◄───────────────────────┤                          │                │
│         │                        │                          │                │
│         │  13. Store tokens in session                      │                │
│         │      sessionManager.setAuthenticated()            │                │
│         │                        │                          │                │
│         │  14. Success page                                 │                │
│         ├────────────────────────┼─────────────────────────►│                │
│         │                        │                          │                │
└─────────┴────────────────────────┴──────────────────────────┴────────────────┘
     │                                                                      │
     │  15. Use session_token in MCP client                                 │
     │      (Mcp-Session-Id header or SESSION_TOKEN env)                    │
     │◄─────────────────────────────────────────────────────────────────────┤
     │                                                                      │
```

#### Key Security Features

1. **PKCE (Proof Key for Code Exchange)**
   - `code_verifier`: Random 32-byte string (base64url encoded)
   - `code_challenge`: SHA256 hash of code_verifier (base64url encoded)
   - Prevents authorization code interception attacks

2. **OTP Tokens**
   - One-time use only
   - 10-minute expiration
   - Prevents session token exposure in URLs

3. **State Parameter**
   - Format: `{random_state}:session:{session_token}`
   - CSRF protection
   - Session binding

### 2. Client Credentials Flow (Application Authentication)

Fallback flow when no user authentication is available, providing application-level permissions.

```
┌─────────────┐                                    ┌──────────────┐
│ MCP Client  │                                    │ MCP Server   │
└──────┬──────┘                                    └──────┬───────┘
       │                                                  │
       │  1. API Request (no session token)               │
       ├─────────────────────────────────────────────────►│
       │                                                  │
       │                                    ┌─────────────▼──────────┐
       │                                    │ Check for user token   │
       │                                    │ - Bearer token?        │
       │                                    │ - Session token?       │
       │                                    └─────────────┬──────────┘
       │                                                  │
       │                                            Not Found
       │                                                  │
       │                                    ┌─────────────▼──────────┐
       │                                    │ Client credentials     │
       │                                    │ enabled?               │
       │                                    └─────────────┬──────────┘
       │                                                  │
       │                                                 Yes
       │                                                  │
       │                                    ┌─────────────▼──────────┐
       │                                    │ Check token cache      │
       │                                    └─────────────┬──────────┘
       │                                                  │
       │                                         ┌────────┴────────┐
       │                                         │                 │
       │                                    Valid Cache      Expired/None
       │                                         │                 │
       │                                         │    ┌────────────▼──────────┐
       │                                         │    │ Request new token     │
       │                                         │    │ POST /oauth/token     │
       │                                         │    │ grant_type=           │
       │                                         │    │   client_credentials  │
       │                                         │    └────────────┬──────────┘
       │                                         │                 │
       │                                         │    ┌────────────▼──────────┐
       │                                         │    │ Cache token           │
       │                                         │    └────────────┬──────────┘
       │                                         │                 │
       │                                         └────────┬────────┘
       │                                                  │
       │                                    ┌─────────────▼──────────┐
       │                                    │ Use token for request  │
       │                                    │ (app-level perms)      │
       │                                    └─────────────┬──────────┘
       │                                                  │
       │  2. Response with app-level access               │
       │◄─────────────────────────────────────────────────┤
       │                                                  │
```

#### Token Caching

- Tokens cached with 60-second safety margin before expiry
- Automatic refresh on expiration
- Reduces token endpoint calls

### 3. Token Refresh Flow

Automatic token refresh when access token expires but refresh token is still valid.

```
┌─────────────┐                                    ┌──────────────┐
│ MCP Client  │                                    │ MCP Server   │
└──────┬──────┘                                    └──────┬───────┘
       │                                                  │
       │  1. API Request with session token               │
       ├─────────────────────────────────────────────────►│
       │                                                  │
       │                                    ┌─────────────▼──────────┐
       │                                    │ Get access token       │
       │                                    │ from session           │
       │                                    └─────────────┬──────────┘
       │                                                  │
       │                                    ┌─────────────▼──────────┐
       │                                    │ Check expiration       │
       │                                    │ Date.now() >= expires? │
       │                                    └─────────────┬──────────┘
       │                                                  │
       │                                              Expired
       │                                                  │
       │                                    ┌─────────────▼──────────┐
       │                                    │ Has refresh token?     │
       │                                    └─────────────┬──────────┘
       │                                                  │
       │                                                 Yes
       │                                                  │
       │                                    ┌─────────────▼──────────────┐
       │                                    │ POST /oauth/token          │
       │                                    │ grant_type=refresh_token   │
       │                                    │ refresh_token=...          │
       │                                    └─────────────┬──────────────┘
       │                                                  │
       │                                         ┌────────┴────────┐
       │                                         │                 │
       │                                     Success            Failure
       │                                         │                 │
       │                          ┌──────────────▼──────┐  ┌──────▼──────┐
       │                          │ Update session      │  │ Mark session│
       │                          │ - new access_token  │  │ as expired  │
       │                          │ - new refresh_token │  │             │
       │                          │ - new expires_at    │  │ Fall back to│
       │                          └──────────────┬──────┘  │ client creds│
       │                                         │         └──────┬──────┘
       │                                         │                │
       │                          ┌──────────────▼──────┐         │
       │                          │ Continue with       │         │
       │                          │ refreshed token     │         │
       │                          └──────────────┬──────┘         │
       │                                         │                │
       │  2. Response                            │                │
       │◄────────────────────────────────────────┴────────────────┘
       │                                                  │
```

## Authentication Priority

When processing a request, the OAuth middleware checks authentication sources in this order:

```
1. Bearer Token (Authorization header or cookie)
   ↓ (if not found)
2. Session Token
   a. Mcp-Session-Id header (HTTP mode)
   b. SESSION_TOKEN environment variable (stdio mode)
   ↓ (if not found or expired)
3. Client Credentials (if enabled)
   ↓ (if disabled or failed)
4. Return 401 Unauthorized
```

### Token Types and Permissions

| Token Type | Source | Permissions | Use Case |
|------------|--------|-------------|----------|
| **User OAuth Token** | Authorization Code Flow | User-specific, scoped to user roles | User operations, personal data access |
| **Client Credentials** | Client Credentials Flow | Application-level, no user context | Server operations, public data |

## Session Management

### Session States

```
┌──────────┐
│ pending  │  Initial state after session creation
└────┬─────┘
     │
     │ OAuth login successful
     ▼
┌──────────────┐
│authenticated │  User logged in, tokens stored
└────┬─────────┘
     │
     │ Token refresh failed OR manual logout
     ▼
┌──────────┐
│ expired  │  Session no longer valid
└──────────┘
```

### Session Data Structure

```typescript
interface SessionData {
  status: 'pending' | 'authenticated' | 'expired';
  access_token?: string;
  refresh_token?: string;
  expires_at?: number;           // Access token expiry
  refresh_expires_at?: number;   // Refresh token expiry
  user_id?: string;
  user_email?: string;
  user_name?: string;
  created_at: number;
  last_accessed_at: number;
}
```


## Security Features

### 1. PKCE (Proof Key for Code Exchange)

Prevents authorization code interception:

```typescript
// Generate code verifier (43-128 characters)
code_verifier = base64url(random(32 bytes))

// Generate code challenge
code_challenge = base64url(SHA256(code_verifier))

// Authorization request
GET /oauth/authorize?
  code_challenge={code_challenge}&
  code_challenge_method=S256

// Token request
POST /oauth/token
  code={authorization_code}&
  code_verifier={code_verifier}
```

### 2. OTP Tokens

Secure OAuth URLs without exposing session tokens:

- **Format**: UUID v4
- **Expiration**: 10 minutes
- **Usage**: Single-use only
- **Mapping**: OTP → Session Token

### 3. State Parameter

CSRF protection and session binding:

- **Format**: `{random_state}:session:{session_token}`
- **Validation**: Must match stored state
- **Cleanup**: Removed after successful callback

### 4. Rate Limiting

OAuth callback protection:

- **Window**: 5 minutes
- **Limit**: 10 attempts per IP
- **Action**: Return 429 Too Many Requests

## Transport Modes

### HTTP Mode

- Full OAuth flow with browser redirects
- Session management via `Mcp-Session-Id` header
- Client credentials fallback configurable

### Stdio Mode

- Auto-generated session tokens (no manual configuration)
- OAuth flow via `start_oauth_login` tool
- Client credentials always enabled
- All logs to stderr

## API Endpoints

### OAuth Endpoints

```
GET  /auth/login?otp_token={uuid}
     - Initiate OAuth flow (requires OTP token)
     - Redirects to AccelByte authorization

GET  /oauth/callback?code={code}&state={state}
     - OAuth callback handler
     - Exchanges code for tokens
     - Stores tokens in session
```

### Discovery Endpoints

```
GET  /.well-known/oauth-authorization-server
     - OAuth server metadata (RFC 8414)

GET  /.well-known/openid-configuration
     - OpenID Connect discovery

GET  /.well-known/oauth-protected-resource
     - Protected resource metadata (RFC 9728)
```

## MCP Tools

### start_oauth_login

Initiates OAuth flow and returns secure login URL:

```json
{
  "name": "start_oauth_login",
  "arguments": {}
}
```

**Response:**
```json
{
  "session_token": "uuid",
  "otp_token": "uuid",
  "login_url": "http://localhost:3000/auth/login?otp_token=uuid",
  "instructions": "Open this URL in your browser...",
  "expires_in": 600
}
```

### get_token_info

Get information about current authentication:

```json
{
  "name": "get_token_info",
  "arguments": {}
}
```

**Response:**
```json
{
  "authenticated": true,
  "user": {
    "id": "user-id",
    "email": "user@example.com",
    "name": "User Name"
  },
  "token_type": "user_oauth",
  "expires_at": "2024-01-01T00:00:00Z"
}
```

## Error Handling

### Common Error Scenarios

| Error | Cause | Resolution |
|-------|-------|------------|
| `invalid_grant` | Invalid authorization code or code_verifier | Restart OAuth flow |
| `invalid_state` | State mismatch or CSRF attempt | Restart OAuth flow |
| `expired_token` | Access token expired | Automatic refresh or re-authenticate |
| `invalid_token` | Token signature invalid | Re-authenticate |
| `session_expired` | Refresh token expired | Call `start_oauth_login` again |

### Session Expiration Handling

When a session expires:

1. **HTTP Mode (fallback enabled)**: Automatically uses client credentials
2. **HTTP Mode (fallback disabled)**: Returns 401 with re-authentication instructions
3. **Stdio Mode**: Uses client credentials (always enabled)

## Configuration Examples

### Minimal Configuration

```bash
AB_BASE_URL=https://yourgame.accelbyte.io
OAUTH_CLIENT_ID=your-client-id
OAUTH_CLIENT_SECRET=your-client-secret
```

All OAuth and OIDC URLs are auto-derived from `AB_BASE_URL`.

### Full Configuration

```bash
# Base URL
AB_BASE_URL=https://yourgame.accelbyte.io

# OAuth
OAUTH_CLIENT_ID=your-client-id
OAUTH_CLIENT_SECRET=your-client-secret
OAUTH_AUTHORIZATION_URL=https://yourgame.accelbyte.io/iam/v3/oauth/authorize
OAUTH_TOKEN_URL=https://yourgame.accelbyte.io/iam/v3/oauth/token
OAUTH_REDIRECT_URI=http://localhost:3000/oauth/callback

# OIDC
JWKS_URI=https://yourgame.accelbyte.io/iam/v3/oauth/jwks
JWT_ISSUER=https://yourgame.accelbyte.io
JWT_AUDIENCE=your-audience
JWT_ALGORITHMS=RS256

# Fallback
ENABLE_CLIENT_CREDENTIALS_FALLBACK=true
```

## References

- [OAuth 2.1 Specification](https://datatracker.ietf.org/doc/html/draft-ietf-oauth-v2-1)
- [PKCE (RFC 7636)](https://datatracker.ietf.org/doc/html/rfc7636)
- [JWKS (RFC 7517)](https://datatracker.ietf.org/doc/html/rfc7517)
- [MCP Specification](https://modelcontextprotocol.io/specification/2025-06-18/)
- [AccelByte IAM Documentation](https://docs.accelbyte.io/)
