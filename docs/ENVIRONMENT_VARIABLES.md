# Environment Variables Reference

The server uses environment variables for configuration. These can be set in a `.env` file (created via `pnpm run setup`) or passed directly to the process.

## Required Variables

### `AB_BASE_URL`
- **Description**: Base URL for AccelByte environment
- **Example**: `https://yourgame.accelbyte.io`
- **Required**: Yes
- **Note**: This is the primary configuration variable. Many other URLs are automatically derived from this value.

## OAuth Variables (Optional)

### `OAUTH_CLIENT_ID`
- **Description**: OAuth client ID for authentication
- **Required**: No (but recommended for full functionality)
- **Note**: Used for both user authentication and client credentials flow

### `OAUTH_CLIENT_SECRET`
- **Description**: OAuth client secret for authentication
- **Required**: No (but recommended for full functionality)
- **Security**: Keep this value secure and never commit it to version control

### `OAUTH_AUTHORIZATION_URL`
- **Description**: OAuth authorization URL
- **Default**: `{AB_BASE_URL}/iam/v3/oauth/authorize`
- **Required**: No
- **Note**: Automatically derived from `AB_BASE_URL` if not explicitly set

### `OAUTH_TOKEN_URL`
- **Description**: OAuth token URL
- **Default**: `{AB_BASE_URL}/iam/v3/oauth/token`
- **Required**: No
- **Note**: Automatically derived from `AB_BASE_URL` if not explicitly set

### `ENABLE_CLIENT_CREDENTIALS_FALLBACK`
- **Description**: Enable automatic client credentials fallback when no user token is provided
- **Default**: `true` for HTTP mode, always enabled for stdio mode
- **Required**: No
- **HTTP mode behavior**:
  - When `true`: Automatically uses client credentials flow if no token is provided
  - When `false`: Requires explicit authentication and returns 401 if no token provided
- **Stdio mode behavior**: Always enabled regardless of this flag

## OIDC Variables (Optional - derived from AB_BASE_URL)

These variables are automatically derived from `AB_BASE_URL` if not explicitly set. Override them only if your environment has non-standard OIDC endpoints.

### `JWKS_URI`
- **Description**: JWKS endpoint for token signature verification
- **Default**: `{AB_BASE_URL}/iam/v3/oauth/jwks`
- **Required**: No

### `JWT_ISSUER`
- **Description**: Expected token issuer
- **Default**: `{AB_BASE_URL}`
- **Required**: No
- **Note**: For shared cloud users, this may differ from `AB_BASE_URL` (e.g., `https://prod.gamingservices.accelbyte.io`)

### `JWT_AUDIENCE`
- **Description**: Expected token audience
- **Default**: `0f8b2a3ecb63466994d5e4631d3b9fe7`
- **Required**: No

### `JWT_ALGORITHMS`
- **Description**: Supported JWT algorithms
- **Default**: `RS256`
- **Required**: No

## Advertised URL Variables (Optional)

These variables control the base URL used for OAuth redirects and login URLs. They are particularly useful when deploying the MCP server behind a reverse proxy.

### `ADVERTISED_PROTOCOL`
- **Description**: Protocol for OAuth callback URLs
- **Default**: `http`
- **Required**: No
- **Options**: `http` or `https`

### `ADVERTISED_HOSTNAME`
- **Description**: Hostname for OAuth callback URLs
- **Default**: `localhost`
- **Required**: No
- **Note**: Set this to your public hostname when behind a reverse proxy

### `ADVERTISED_PORT`
- **Description**: Port for OAuth callback URLs
- **Default**: `80`
- **Required**: No
- **Note**: 
  - If set to 80 or 443, the port will be omitted from the URL
  - Examples: `http://localhost` (port 80) or `http://localhost:3000`

## Other Optional Variables

### `PORT`
- **Description**: Server port
- **Default**: `3000`
- **Required**: No

### `NODE_ENV`
- **Description**: Environment mode
- **Default**: `development`
- **Required**: No
- **Options**: `development` or `production`

### `LOG_LEVEL`
- **Description**: Logging level
- **Default**: `info`
- **Required**: No
- **Options**: `debug`, `info`, `warn`, `error`, `fatal`

### `TRANSPORT`
- **Description**: Transport mode
- **Default**: `stdio`
- **Required**: No
- **Options**:
  - `stdio` - Run with stdin/stdout communication for MCP clients
  - `http` - Run as HTTP server

## Configuration Example

A minimal `.env` file might look like:

```env
# Required
AB_BASE_URL=https://yourgame.accelbyte.io

# OAuth (optional but recommended)
OAUTH_CLIENT_ID=your-client-id
OAUTH_CLIENT_SECRET=your-client-secret

# Server Configuration (optional)
PORT=3000
NODE_ENV=development
LOG_LEVEL=info
```

All other OAuth and OIDC URLs will automatically be derived from `AB_BASE_URL`.

## Setting Environment Variables

### Using .env file
1. Run `pnpm run setup` to create a `.env` file from the template
2. Edit the `.env` file with your configuration

### Using command line
```bash
AB_BASE_URL=https://yourgame.accelbyte.io OAUTH_CLIENT_ID=your-id node dist/index.js
```

### Using environment in MCP client config
For stdio mode, set environment variables in your MCP client configuration (e.g., Claude Desktop):

```json
{
  "mcpServers": {
    "ags-api": {
      "command": "node",
      "args": ["/path/to/dist/index.js"],
      "env": {
        "AB_BASE_URL": "https://yourgame.accelbyte.io",
        "OAUTH_CLIENT_ID": "your-client-id",
        "OAUTH_CLIENT_SECRET": "your-client-secret"
      }
    }
  }
}
```

