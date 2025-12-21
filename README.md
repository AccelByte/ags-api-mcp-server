# AGS API MCP Server

A stateless MCP (Model Context Protocol) server built with TypeScript for AccelByte Gaming Services APIs with OpenAPI integration.

> **🎉 V2 Available:** This server now uses the V2 architecture (stateless, HTTP-only) by default. For V1 (stdio support, server-managed OAuth), see [V2 Architecture Guide](docs/V2_ARCHITECTURE.md).

## V2 Architecture (Current)

**V2** is optimized for production deployments with:
- ✅ **Stateless design** - No server-side sessions, perfect for containers
- ✅ **HTTP-only transport** - Simple, scalable, easy to debug
- ✅ **Client-managed auth** - Bearer tokens via Authorization header
- ✅ **Type-safe** - Zod validation throughout
- ✅ **User consent** - Elicitation for write operations
- ✅ **Better DX** - Structured responses, clear errors

**Quick Start V2:**
```bash
# Set required environment variables
export AB_BASE_URL="https://your-env.accelbyte.io"
export MCP_AUTH=true  # Enable authentication

# Start the server
pnpm start

# Server runs at http://localhost:3000
# Endpoint: http://localhost:3000/mcp
# Health: http://localhost:3000/health
```

See [V2 Architecture Guide](docs/V2_ARCHITECTURE.md) for detailed comparison with V1.

---

## Features

### Core MCP Protocol
- **Streamable HTTP Transport** - Minimal spec-compliant implementation (POST-only)
- **MCP Tools** - `get_token_info`, `search-apis`, `describe-apis`, `run-apis`
- **MCP Prompts** - `run-workflow` with autocomplete support
- **MCP Resources** - Workflow schema, specification, and definitions
- **User Consent** - Elicitation for write operations (POST/PUT/PATCH/DELETE)

### OpenAPI Integration
- **Dynamic API Discovery** - Load OpenAPI specs from directory
- **Semantic Search** - Find APIs by description, tags, or path
- **Automatic Documentation** - Generate tool descriptions from OpenAPI
- **Request Validation** - Validate requests against OpenAPI schemas
- **Configurable Limits** - Max search results, request timeouts

### Production Ready
- **Stateless Operation** - No sessions, scales horizontally
- **Health Checks** - `/health` endpoint for monitoring
- **Rate Limiting** - 100 requests per 15 minutes
- **Request Logging** - Structured logging with Pino
- **Error Handling** - Proper error middleware
- **Graceful Shutdown** - SIGTERM/SIGINT with timeout
- **Type Safety** - Zod validation throughout

### Security
- **Bearer Token Auth** - Standard Authorization header
- **Origin Validation** - Prevents DNS rebinding attacks
- **Input Validation** - Zod schemas for all inputs
- **Rate Limiting** - Prevents abuse

---

## V1 Features (Legacy)

V1 includes additional features (stdio transport, server-managed OAuth, SSE streams). Available via:
- `pnpm run start:v1-stdio` - stdio transport with auto-generated sessions
- `pnpm run start:v1-http` - HTTP transport with full OAuth flow

See [V2 Architecture Guide](docs/V2_ARCHITECTURE.md) for complete V1 vs V2 comparison.


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

**V2 Configuration (Minimal):**
```env
# Required
AB_BASE_URL=https://yourgame.accelbyte.io
MCP_AUTH=true  # Enable authentication (optional, default: true)

# Optional
MCP_PORT=3000
MCP_PATH=/mcp
OPENAPI_SPECS_DIR=openapi-specs
```

**V1 Configuration (OAuth):**
```env
# For V1 only - server-managed OAuth
AB_BASE_URL=https://yourgame.accelbyte.io
OAUTH_CLIENT_ID=your-client-id
OAUTH_CLIENT_SECRET=your-client-secret
TRANSPORT=stdio  # or 'http'
```

📖 **For detailed setup instructions**, see [docs/QUICK_START.md](docs/QUICK_START.md)
📖 **For all configuration options**, see [docs/ENVIRONMENT_VARIABLES.md](docs/ENVIRONMENT_VARIABLES.md)

**Note (V2):**
- V2 is stateless - clients provide Bearer tokens via Authorization header
- No OAuth configuration needed on the server
- Perfect for production deployments

**Note (V1):**
- OAuth URLs derived from `AB_BASE_URL` if not set explicitly
- Redirect URI must be registered in AccelByte IAM: `http://localhost:3000/oauth/callback`

## Usage

### V2 (Default - HTTP Mode)

**Development:**
```bash
pnpm run dev  # Watch mode
```

**Production:**
```bash
pnpm run build
pnpm start  # Runs V2 at http://localhost:3000
```

### V1 (Legacy)

**Stdio Mode:**
```bash
pnpm run build
pnpm run start:v1-stdio
```

**HTTP Mode:**
```bash
pnpm run build
pnpm run start:v1-http
```

📖 **For detailed V1 setup**, see [docs/QUICK_START.md](docs/QUICK_START.md)

### Development Commands

```bash
# Watch mode (auto-rebuild on changes)
pnpm run dev

# Run tests
pnpm test

# Lint
pnpm run lint

# Format
pnpm run format

# Process OpenAPI specs
pnpm run process-specs

# Inspect with MCP Inspector (V2)
pnpm run inspect

# Inspect with MCP Inspector (V1 stdio)
pnpm run inspect:v1-stdio

# Inspect with MCP Inspector (V1 http)
pnpm run inspect:v1-http
```

📖 **For detailed development workflows**, see [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)  
📖 **For testing guide**, see [docs/TESTING.md](docs/TESTING.md)

## Environment Variables

### V2 Configuration

Essential variables for V2:

- `AB_BASE_URL` - Base URL for AccelByte environment (required)
- `MCP_PORT` or `PORT` - Server port (default: 3000)
- `MCP_PATH` - MCP endpoint path (default: `/mcp`)
- `MCP_AUTH` - Enable authentication (default: `true`)
- `MCP_SERVER_URL` - Full server URL (auto-derived from port if not set)
- `OPENAPI_SPECS_DIR` - OpenAPI specs directory (default: `openapi-specs`)
- `LOG_LEVEL` - Logging level (default: `info`)

### V1 Configuration (Legacy)

Additional variables for V1:

- `OAUTH_CLIENT_ID` - OAuth client ID (required for V1)
- `OAUTH_CLIENT_SECRET` - OAuth client secret (required for V1)
- `TRANSPORT` - Transport mode: `stdio` or `http` (default: `stdio`)

📖 **For complete environment variable reference**, see [docs/ENVIRONMENT_VARIABLES.md](docs/ENVIRONMENT_VARIABLES.md)


## API Endpoints

### V2 Endpoints

**MCP Protocol:**
- `POST /mcp` - Send JSON-RPC messages (requires `Authorization: Bearer <token>`)
- `GET /mcp` - Returns 405 Method Not Allowed (V2 is POST-only)
- `DELETE /mcp` - Returns 405 Method Not Allowed

**Health & Info:**
- `GET /health` - Server health status
- `GET /` - Server information and endpoints
- `GET /.well-known/oauth-protected-resource` - Resource metadata

### V1 Endpoints (Legacy)

**MCP Protocol:**
- `POST /mcp` - Send JSON-RPC messages
- `GET /mcp` - Open SSE stream for server-to-client messages
- `DELETE /mcp` - Close session

**Authentication:**
- `GET /auth/login?otp_token=<uuid>` - Initiate OAuth login flow
- `GET /oauth/callback` - OAuth callback handler

**Discovery:**
- `GET /.well-known/oauth-authorization-server` - OAuth server metadata
- `GET /.well-known/openid-configuration` - OIDC configuration

📖 **For detailed API reference**, see [docs/API_REFERENCE.md](docs/API_REFERENCE.md)  
📖 **For Streamable HTTP transport details**, see [docs/STREAMABLE_HTTP.md](docs/STREAMABLE_HTTP.md)

## MCP Tools

### V2 Tools (4 tools)

1. **`get_token_info`** - Get information about the authenticated token and user
   - Returns namespace, user ID, roles, token expiration, etc.
   - Includes hints for common scenarios
   
2. **`search-apis`** - Search across loaded OpenAPI operations
   - Filter by query text, HTTP method, tag, or spec
   - Configurable result limit (max 50)
   - Zod-validated input/output schemas
   
3. **`describe-apis`** - Get detailed information about specific API operations
   - Full request/response schemas
   - Authentication requirements
   - Example requests
   - Zod-validated input/output schemas
   
4. **`run-apis`** - Execute API requests against endpoints
   - User consent via elicitation for write operations
   - Automatic authentication with user token
   - Configurable timeouts (max 60s)
   - Zod-validated input/output schemas

### V1 Tools (6 tools)

V1 includes two additional tools for server-managed OAuth:

5. **`start_oauth_login`** - Initiate OAuth login flow (V1 only)
6. **`logout`** - Clear user session (V1 only)

See [V2 Architecture Guide](docs/V2_ARCHITECTURE.md) for detailed tool comparison.

## Development

📖 **For development guide, project structure, and adding new tools**, see [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)

## Docker Deployment

### V2 (Default)

Build and run the V2 Docker image:

```bash
# Build
docker build -t ags-api-mcp-server:v2 .

# Run
docker run -d \
  --name ags-api-mcp-server \
  -e AB_BASE_URL=https://yourgame.accelbyte.io \
  -e MCP_AUTH=true \
  -p 3000:3000 \
  ags-api-mcp-server:v2

# Health check
curl http://localhost:3000/health
```

The Dockerfile uses V2 by default (`CMD ["node", "--enable-source-maps", "dist/v2/index.js"]`).

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
