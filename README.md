# AGS API MCP Server

A simple Streamable HTTP-based MCP (Model Context Protocol) server built with TypeScript that issues Accelbyte AGS API requests on behalf of the authenticated user.

## Features

- **Dual Transport Support**: Supports both HTTP and stdio transports for maximum flexibility
  - **HTTP Mode**: Streamable HTTP transport compliant with [MCP Specification 2025-06-18](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports#streamable-http)
  - **Stdio Mode**: Direct stdin/stdout communication for MCP clients like Claude Desktop
    - **Auto-Generated Session Tokens**: Session tokens are now automatically generated in stdio mode - no manual configuration needed!
- **Streamable HTTP Transport**: Full implementation of MCP Streamable HTTP specification
  - Server-Sent Events (SSE) for real-time server-to-client messaging
  - Session management with secure session IDs
  - Protocol version negotiation
  - Stream resumability with event IDs
  - Origin validation for security
- **OAuth 2.1 with PKCE**: Secure authentication using OAuth 2.1 with Proof Key for Code Exchange
- **OTP Token Security**: OAuth login URLs use one-time password tokens instead of exposing session tokens (10-min expiry, single-use)
- **Secure Authentication**: Only secure authentication methods supported (Bearer tokens, MCP session IDs, OTP tokens)
- **Client Credentials Flow**: Automatic server-to-server authentication when no user token is provided
- **JWT Token Verification**: Secure token validation using JWKS (JSON Web Key Set)
- **Static OAuth Client**: Simplified OAuth flow using pre-configured client credentials
- **User Context Propagation**: Authenticated user context passed to all MCP tools
- **Smart Logging**: All logs automatically redirected to stderr in stdio mode
- **Example Tools**: Built-in tools for demonstration and testing


## Prerequisites

- Node.js 20+ 
- pnpm (install with: `npm install -g pnpm`)
- IAM OAuth provider in an Accelbyte Environment

## Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd ags-api-mcp-server
```

2. Install dependencies:
```bash
pnpm install
```

3. Set up environment configuration:
```bash
pnpm run setup
```

4. Configure your AccelByte environment in `.env`:
```env
AB_BASE_URL=https://yourgame.accelbyte.io
OAUTH_CLIENT_ID=your-client-id
OAUTH_CLIENT_SECRET=your-client-secret
```

📖 **For detailed setup instructions**, see [docs/QUICK_START.md](docs/QUICK_START.md)

**Note**: 
- OAuth URLs and OIDC configuration are automatically derived from `AB_BASE_URL` if not explicitly set
- **Redirect URI**: If you plan to use user token authentication, you must register the redirect URI (`http://localhost:3000/oauth/callback` by default) in your AccelByte IAM client settings. This is not required if you only use client credentials flow
- See [docs/ENVIRONMENT_VARIABLES.md](docs/ENVIRONMENT_VARIABLES.md) for complete configuration reference

## Usage

### Stdio Mode (default)

The server supports stdio transport for MCP clients that communicate via stdin/stdout (like Claude Desktop).

**Development**:
```bash
pnpm run dev
```

**Production**:
```bash
pnpm run build
pnpm start
```

📖 **For detailed client configuration and setup**, see [docs/QUICK_START.md](docs/QUICK_START.md)

### HTTP Mode

**Development**:
```bash
pnpm run dev:http
```

**Production**:
```bash
pnpm run build
pnpm start:http
```

### Development Commands

```bash
# Watch mode (auto-rebuild on changes)
pnpm run watch

# Run tests
pnpm test

# Process OpenAPI specs
pnpm run process-specs
```

📖 **For detailed development workflows**, see [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)  
📖 **For testing guide**, see [docs/TESTING.md](docs/TESTING.md)

## Environment Variables

The server uses environment variables for configuration. Essential variables:

- `AB_BASE_URL` - Base URL for AccelByte environment (required)
- `OAUTH_CLIENT_ID` - OAuth client ID (optional but recommended)
- `OAUTH_CLIENT_SECRET` - OAuth client secret (optional but recommended)
- `PORT` - Server port (default: 3000)
- `TRANSPORT` - Transport mode: `stdio` or `http` (default: `stdio`)
- `LOG_LEVEL` - Logging level: `debug`, `info`, `warn`, `error`, `fatal` (default: `info`)

📖 **For complete environment variable reference**, see [docs/ENVIRONMENT_VARIABLES.md](docs/ENVIRONMENT_VARIABLES.md)


## API Endpoints

### MCP Protocol
- `POST /mcp` - Send JSON-RPC messages to server
- `GET /mcp` - Open SSE stream for server-to-client messages

### Authentication
- `GET /auth/login?otp_token=<uuid>` - Initiate OAuth login flow
- `GET /oauth/callback` - OAuth callback handler

### Health & Discovery
- `GET /health` - Server health status
- `GET /.well-known/*` - OAuth/OIDC discovery endpoints

📖 **For detailed API reference**, see [docs/API_REFERENCE.md](docs/API_REFERENCE.md)  
📖 **For Streamable HTTP transport details**, see [docs/STREAMABLE_HTTP.md](docs/STREAMABLE_HTTP.md)

## MCP Tools

The server includes tools for AccelByte API interaction:

### 1. Get Token Info
Get information about the authenticated token and user.
```json
{
  "name": "get_token_info",
  "arguments": {}
}
```

### 2. OpenAPI Tools
The server also provides dynamically generated tools from OpenAPI specifications:
- **search-apis**: Search across loaded OpenAPI operations
- **describe-apis**: Get detailed information about specific API operations
- **run-apis**: Execute API requests against endpoints with authentication

## Development

📖 **For development guide, project structure, and adding new tools**, see [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)

## Docker Deployment

Build and run the Docker image:

```bash
# Build
docker build -t ags-api-mcp-server .

# Run (HTTP mode)
docker run -d \
  --name ags-api-mcp-server \
  -e AB_BASE_URL=https://yourgame.accelbyte.io \
  -e TRANSPORT=http \
  -p 3000:3000 \
  ags-api-mcp-server
```

📖 **For detailed Docker deployment guide**, see [docs/DOCKER.md](docs/DOCKER.md)

## Testing

Run tests:
```bash
pnpm test
```

📖 **For testing guide and examples**, see [docs/TESTING.md](docs/TESTING.md)

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## Documentation

### Getting Started
- [docs/QUICK_START.md](docs/QUICK_START.md) - Quick start guide and setup instructions

### Core Documentation
- [docs/STREAMABLE_HTTP.md](docs/STREAMABLE_HTTP.md) - Streamable HTTP transport implementation
- [docs/OAUTH_FLOW.md](docs/OAUTH_FLOW.md) - OAuth authentication flow details
- [docs/API_REFERENCE.md](docs/API_REFERENCE.md) - Complete API endpoints reference
- [docs/ENVIRONMENT_VARIABLES.md](docs/ENVIRONMENT_VARIABLES.md) - Environment variables reference

### Deployment & Operations
- [docs/DOCKER.md](docs/DOCKER.md) - Docker deployment guide

### Development
- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) - Development guide and contributing
- [docs/TESTING.md](docs/TESTING.md) - Testing guide and examples

## Support

For issues and questions, please open an issue in the repository.
