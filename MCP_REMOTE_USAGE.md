# Using AGS API MCP Server with mcp-remote

This guide explains how to use the AGS API MCP Server with `mcp-remote` for OAuth authentication and MCP tool access.

## Overview

The AGS API MCP Server uses a **simplified OAuth 2.1 flow** with static client credentials, eliminating the need for dynamic client registration. This approach provides better performance and easier configuration.

## Prerequisites

- Node.js 18+
- Claude Desktop installed
- AccelByte development account with OAuth client credentials
- `mcp-remote` package (installed via npx)

## Architecture

```
Claude Desktop → mcp-remote (port 3334) → MCP Server (port 3000) → AccelByte IAM
```

- **Claude Desktop**: The MCP client
- **mcp-remote**: OAuth proxy that handles authentication
- **MCP Server**: Your AGS API server with tools
- **AccelByte IAM**: OAuth provider for authentication

## Setup Instructions

### 1. Configure MCP Server

Create a `.env` file with minimal configuration (OAuth credentials are handled by mcp-remote):

```env
# OAuth Discovery URLs (for metadata only - mcp-remote handles actual OAuth)
OAUTH_AUTHORIZATION_URL=https://development.accelbyte.io/iam/v3/oauth/authorize
OAUTH_TOKEN_URL=https://development.accelbyte.io/iam/v3/oauth/token
OAUTH_USER_INFO_URL=https://development.accelbyte.io/iam/v3/public/users/userinfo

# OIDC Configuration (for JWT token verification)
JWKS_URI=https://development.accelbyte.io/iam/v3/oauth/jwks
JWT_ISSUER=https://development.accelbyte.io
JWT_AUDIENCE=<your_client_id>
JWT_ALGORITHMS=RS256
DISABLE_JWT_VALIDATION=false

# Server Configuration
PORT=3000
NODE_ENV=development
LOG_LEVEL=info
```

**Important**: `OAUTH_CLIENT_ID` and `OAUTH_CLIENT_SECRET` are **NOT needed** for mcp-remote mode since mcp-remote handles the OAuth flow using its own static credentials.

### Why OAuth Credentials Are Not Needed

In mcp-remote mode:
- **mcp-remote** handles OAuth authorization and token exchange using its static credentials
- **MCP Server** only needs OAuth URLs for discovery metadata and JWT verification settings
- **No token exchange** happens on the MCP server side
- **Access tokens** are passed from mcp-remote to MCP server via Authorization header

### 2. Start MCP Server

```bash
# Install dependencies
npm install

# Build the server
npm run build

# Start the server
npm start
```

The server will start on `http://localhost:3000` and provide:
- OAuth discovery endpoints
- MCP protocol endpoints
- Authentication pages

### 3. Configure Claude Desktop

Update your Claude Desktop configuration file:

**Location**: `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "ags-api-mcp": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "http://localhost:3000/mcp",
        "3334",
        "--host",
        "localhost",
        "--static-oauth-client-info",
        "{ \"client_id\": \"<your_client_id>\", \"client_secret\": \"<redacted>\" }"
      ]
    }
  }
}
```

**Important**: Replace `<your_client_id>` and `<redacted>` with your actual AccelByte OAuth credentials.

### 4. Restart Claude Desktop

After updating the configuration:
1. Quit Claude Desktop completely
2. Restart Claude Desktop
3. The MCP server should appear in the available tools

## OAuth Flow

When you first use the MCP server, mcp-remote will:

1. **Discover OAuth Server**: Query the MCP server for OAuth metadata
2. **Redirect to AccelByte**: Open your browser to AccelByte's OAuth login
3. **User Authentication**: You log in with your AccelByte credentials
4. **Token Exchange**: mcp-remote exchanges the authorization code for an access token
5. **MCP Communication**: All subsequent MCP requests include the access token

## Available Tools

The MCP server provides several tools for AccelByte API interaction:

### 1. Get User Info
Retrieve authenticated user information from the OAuth token.

```json
{
  "name": "get_user_info",
  "arguments": {}
}
```

**Response**:
```json
{
  "message": "User information from authenticated token",
  "accessTokenAvailable": true,
  "accessTokenLength": 1234,
  "user": {
    "sub": "user_id",
    "client_id": "your_client_id",
    "scope": "openid profile email",
    "namespace": "your_namespace",
    "display_name": "User Name",
    "country": "US",
    "is_comply": true
  },
  "tokenInfo": {
    "issuer": "https://development.accelbyte.io",
    "expiresAt": 1694567890,
    "issuedAt": 1694564290,
    "jti": "token_id"
  }
}
```

### 2. Make API Call
Make authenticated API calls to AccelByte services.

```json
{
  "name": "make_api_call",
  "arguments": {
    "url": "https://development.accelbyte.io/iam/v3/public/users/me"
  }
}
```

**Response**:
```json
{
  "success": true,
  "url": "https://development.accelbyte.io/iam/v3/public/users/me",
  "status": 200,
  "data": {
    "userId": "user_id",
    "displayName": "User Name",
    "email": "user@example.com",
    "country": "US"
  }
}
```

### 3. Echo Tool
Simple echo tool for testing.

```json
{
  "name": "echo",
  "arguments": {
    "message": "Hello, World!"
  }
}
```

### 4. System Information
Get system information.

```json
{
  "name": "get_system_info",
  "arguments": {}
}
```

### 5. Time Tools
Get current time or calculate time differences.

```json
{
  "name": "get_time",
  "arguments": {}
}
```

```json
{
  "name": "calculate_time_difference",
  "arguments": {
    "startTime": "2024-01-01T00:00:00Z",
    "endTime": "2024-01-02T12:00:00Z"
  }
}
```

### 6. String Utilities
Various string manipulation tools.

```json
{
  "name": "generate_random_string",
  "arguments": {
    "length": 10,
    "includeNumbers": true,
    "includeSymbols": false
  }
}
```

```json
{
  "name": "convert_case",
  "arguments": {
    "text": "hello world",
    "case": "upper"
  }
}
```

## Troubleshooting

### Common Issues

#### 1. Authentication Failed
**Error**: `Authentication failed` or `Access token not available`

**Solutions**:
- Verify your OAuth credentials in both `.env` and Claude Desktop config
- Check that the MCP server is running on port 3000
- Ensure mcp-remote is using the correct client credentials
- Check AccelByte OAuth client configuration

#### 2. Connection Refused
**Error**: `Connection refused` or `ECONNREFUSED`

**Solutions**:
- Ensure MCP server is running: `npm start`
- Check server logs for errors
- Verify port 3000 is not blocked by firewall
- Test server health: `curl http://localhost:3000/health`

#### 3. Invalid JWT Token
**Error**: `JsonWebTokenError` or `jwt audience invalid`

**Solutions**:
- Verify `JWT_AUDIENCE` matches your client ID
- Check `JWT_ISSUER` is correct
- Ensure `JWKS_URI` is accessible
- Check AccelByte token format and claims

#### 4. OAuth Redirect Mismatch
**Error**: `redirect_uri_mismatch`

**Solutions**:
- Ensure `OAUTH_REDIRECT_URI` is `http://localhost:3334/oauth/callback`
- Check AccelByte OAuth client redirect URI configuration
- Verify mcp-remote is using the correct callback URL

### Debug Mode

Enable detailed logging by setting:

```env
LOG_LEVEL=debug
```

This will show:
- OAuth flow details
- JWT token verification steps
- MCP request/response logging
- API call details

### Testing OAuth Flow

Test the OAuth flow manually:

1. **Check OAuth Discovery**:
   ```bash
   curl http://localhost:3000/.well-known/oauth-authorization-server
   ```

2. **Test MCP Server Health**:
   ```bash
   curl http://localhost:3000/health
   ```

3. **View Authentication Page**:
   Open `http://localhost:3000/auth/login` in your browser

## Security Considerations

### Production Deployment

For production use:

1. **Use HTTPS**: Configure SSL/TLS certificates
2. **Secure Secrets**: Use environment variables or secret management
3. **Network Security**: Restrict access to authorized networks
4. **Token Validation**: Ensure JWT validation is enabled
5. **Audit Logging**: Enable comprehensive logging

### Environment Variables

Never commit sensitive credentials to version control:

```bash
# Add to .gitignore
.env
.env.local
.env.production
```

### OAuth Client Security

- Use strong client secrets
- Regularly rotate credentials
- Limit OAuth scopes to minimum required
- Monitor for suspicious activity

## Advanced Configuration

### Custom OAuth Provider

To use with a different OAuth provider:

1. Update OAuth URLs in `.env`
2. Configure JWKS URI for token verification
3. Adjust JWT issuer and audience settings
4. Test with provider-specific requirements

### Multiple Environments

Support multiple environments:

```env
# Development
OAUTH_CLIENT_ID=dev_client_id
OAUTH_AUTHORIZATION_URL=https://dev.accelbyte.io/iam/v3/oauth/authorize

# Production
OAUTH_CLIENT_ID=prod_client_id
OAUTH_AUTHORIZATION_URL=https://accelbyte.io/iam/v3/oauth/authorize
```

### Custom Tools

Add custom tools by:

1. Creating tool functions in `src/tools/`
2. Registering tools in `src/index.ts`
3. Providing tool schemas for better discovery
4. Testing with MCP client

### Sequence Diagram (swimlanes.io)
```
title: MCP Remote Discovery and OAuth Tool Invocation
lane MCP Client
lane Browser
lane mcp-remote
lane MCP Server
lane AccelByte IAM

group Discovery
    MCP Client->mcp-remote: Request MCP provider metadata
    mcp-remote->MCP Server: Fetch server discovery endpoints\n(e.g. /.well-known/oauth-authorization-server)
    MCP Server->mcp-remote: Return discovery metadata\n(auth endpoints, JWKS URI, etc.)
    mcp-remote->MCP Client: Provide discovery details
end

MCP Client->mcp-remote: Request tool execution (JSON-RPC over HTTP/SSE)
mcp-remote->MCP Client: Check local token cache

group Token missing or expired
    mcp-remote->Browser: Redirect client to OAuth login URL
    Browser->AccelByte IAM: Load login & consent page
    AccelByte IAM->Browser: Prompt for credentials/consent
    Browser->AccelByte IAM: Submit credentials, approve scopes
    AccelByte IAM->Browser: Redirect back with authorization code
    Browser->mcp-remote: Deliver authorization code callback
    mcp-remote->AccelByte IAM: Exchange code for access/refresh tokens
    AccelByte IAM->mcp-remote: Return tokens
    mcp-remote->MCP Client: Notify authentication complete\n(store tokens in cache)
end

mcp-remote->MCP Server: Forward tool request\nAuthorization: Bearer <access_token>
MCP Server->AccelByte IAM: Fetch JWKS / validate signature (if needed)
AccelByte IAM->MCP Server: JWKS keys / validation OK

MCP Server->mcp-remote: Tool response (JSON-RPC result stream)
mcp-remote->MCP Client: Relay tool output to client

```
## Support

For issues and questions:

1. Check the troubleshooting section above
2. Review server logs for error details
3. Verify OAuth configuration
4. Test with minimal configuration
5. Open an issue in the repository

## License

MIT License - see LICENSE file for details.
