# AGS API MCP Server

A simple Streamable HTTP-based MCP (Model Context Protocol) server built with TypeScript that issues Accelbyte AGS API requests on behalf of the authenticated user.

## Features

- **Dual Transport Support**: Supports both HTTP and stdio transports for maximum flexibility
  - **HTTP Mode**: Traditional HTTP-based MCP server for web clients
  - **Stdio Mode**: Direct stdin/stdout communication for MCP clients like Claude Desktop
- **OAuth 2.1 with PKCE**: Secure authentication using OAuth 2.1 with Proof Key for Code Exchange
- **Client Credentials Flow**: Automatic server-to-server authentication when no user token is provided
- **JWT Token Verification**: Secure token validation using JWKS (JSON Web Key Set)
- **Static OAuth Client**: Simplified OAuth flow using pre-configured client credentials
- **User Context Propagation**: Authenticated user context passed to all MCP tools
- **Smart Logging**: All logs automatically redirected to stderr in stdio mode
- **Example Tools**: Built-in tools for demonstration and testing


## Prerequisites

- Node.js 18+ 
- pnpm (install with: `npm install -g pnpm`)
- IAM OAuth provider in an Accelbyte Environment

## Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd ags-api-mcp
```

2. Install dependencies:
```bash
pnpm install
```

3. Set up environment configuration:
```bash
pnpm run setup
```
This will create a `.env` file from the template.

4. Configure your AccelByte environment in `.env`:
```env
# Base URL for AccelByte environment, e.g. https://development.accelbyte.io
AB_BASE_URL=<your_base_url>

# OAuth Configuration (optional - defaults will be derived from AB_BASE_URL)
OAUTH_CLIENT_ID=<your_client_id>
OAUTH_CLIENT_SECRET=<redacted>

# Server Configuration
PORT=3000
NODE_ENV=development
```

**Note**: OAuth URLs (`OAUTH_AUTHORIZATION_URL`, `OAUTH_TOKEN_URL`) and OIDC configuration (`JWKS_URI`, `JWT_ISSUER`) will automatically be derived from `AB_BASE_URL` if not explicitly set.

## Usage

### Stdio Mode (Default)

#### Development Mode
```bash
pnpm run dev:stdio
```

#### Production Mode
```bash
pnpm run build
pnpm start:stdio
```

### HTTP Mode

#### Development Mode
```bash
TRANSPORT=http pnpm run dev
```

#### Production Mode
```bash
TRANSPORT=http pnpm run build
TRANSPORT=http pnpm start
```

```

**Note**: In stdio mode:
- All logs are automatically redirected to stderr to avoid interfering with the MCP protocol on stdout
- The server communicates via stdin/stdout using the MCP protocol
- HTTP endpoints are not available in this mode
- Client credentials flow is automatically used if `OAUTH_CLIENT_ID` is configured

📖 **For detailed client configuration instructions**, see [STDIO_CLIENT_CONFIG.md](STDIO_CLIENT_CONFIG.md)

#### Quick Start: Claude Desktop Configuration

Add this to your `claude_desktop_config.json`:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`  
**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "ags-api": {
      "command": "node",
      "args": ["/absolute/path/to/ags-api-mcp-server/dist/index.js"],
      "env": {
        "TRANSPORT": "stdio",
        "AB_BASE_URL": "https://yourgame.accelbyte.io",
        "OAUTH_CLIENT_ID": "your-client-id",
        "OAUTH_CLIENT_SECRET": "your-client-secret",
        "LOG_LEVEL": "info"
      }
    }
  }
}
```

After adding the configuration, restart Claude Desktop and the tools will be available.

### Watch Mode (for development)
```bash
pnpm run watch
```

### Testing
```bash
# Run the TypeScript unit tests (node:test via ts-node)
pnpm test

# Invoke the legacy integration harness
pnpm run test:integration
```

### Environment Setup
```bash
# Set up environment variables
pnpm run setup

# Test with environment variables
pnpm run test:env
```

### OpenAPI Spec Processing
```bash
# Process OpenAPI specs (filter APIs and clean up fields)
pnpm run process-specs

# With custom input folder
pnpm run process-specs -- /path/to/input/folder

# With custom input and output folders
pnpm run process-specs -- /path/to/input/folder /path/to/output/folder
```

The processing script performs the following cleanup operations:
- **Filters out operations**: e.g. can be used to remove POST, PUT, PATCH, DELETE methods
- **Filters out deprecated APIs**: Removes operations marked as deprecated
- **Removes documentation fields**: Cleans up `host`, `externalDocs`, and `x-docs` fields
- **Removes environment-specific data**: Removes `realm` field from `x-version`
- **Ignores specified services**: Skips processing of buildinfo, challenge, differ, eventlog, matchmaking, sessionbrowser, ugc
- **Prettifies JSON**: Formats output with proper indentation

### Development Mode (Skip Authentication)

## Environment Variables

The server uses the following environment variables (configured in `.env`):

### Required Variables
- `AB_BASE_URL` - Base URL for AccelByte environment (e.g., https://development.accelbyte.io)

### OAuth Variables (Optional)
- `OAUTH_CLIENT_ID` - OAuth client ID
- `OAUTH_CLIENT_SECRET` - OAuth client secret
- `OAUTH_AUTHORIZATION_URL` - OAuth authorization URL (default: {AB_BASE_URL}/iam/v3/oauth/authorize)
- `OAUTH_TOKEN_URL` - OAuth token URL (default: {AB_BASE_URL}/iam/v3/oauth/token)

### OIDC Variables (Optional - derived from AB_BASE_URL)
- `JWKS_URI` - JWKS endpoint for token signature verification (default: {AB_BASE_URL}/iam/v3/oauth/jwks)
- `JWT_ISSUER` - Expected token issuer (default: {AB_BASE_URL})
- `JWT_AUDIENCE` - Expected token audience (default: 0f8b2a3ecb63466994d5e4631d3b9fe7)
- `JWT_ALGORITHMS` - Supported JWT algorithms (default: RS256)

### Other Optional Variables
- `PORT` - Server port (default: 3000)
- `NODE_ENV` - Environment mode (development/production)
- `LOG_LEVEL` - Logging level (debug, info, warn, error, fatal)
- `TRANSPORT` - Transport mode (http or stdio; default: stdio)
  - `stdio` - Run with stdin/stdout communication for MCP clients only (default)
  - `http` - Run as HTTP server only


## API Endpoints

### MCP Protocol
- `POST /mcp` - Main MCP endpoint (requires authentication)

### Health Check
- `GET /health` - Server health status

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

## MCP Protocol Usage

### Initialize
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": "2024-11-05",
    "capabilities": {},
    "clientInfo": {
      "name": "example-client",
      "version": "1.0.0"
    }
  }
}
```

### List Tools
```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/list"
}
```

### Call Tool
```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "get_token_info",
    "arguments": {}
  }
}
```

## OAuth Configuration

### Simplified OAuth Flow
This MCP server uses a **simplified OAuth 2.1 flow** with static client credentials:

1. **No Dynamic Registration**: Uses pre-configured OAuth client credentials
2. **Direct OAuth Flow**: Client connects directly to AccelByte OAuth server
3. **JWT Verification**: Server validates tokens using AccelByte's JWKS
4. **User Context**: Authenticated user information passed to all tools

### AccelByte OAuth Example
```env
# Minimal configuration - URLs are automatically derived
AB_BASE_URL=https://development.accelbyte.io
```

**Note**: All OAuth and OIDC URLs are automatically derived from `AB_BASE_URL`. `OAUTH_CLIENT_ID` and `OAUTH_CLIENT_SECRET` are configured in your MCP client's environment.

## Security Features

- **Helmet.js**: Security headers
- **CORS**: Cross-origin resource sharing configuration
- **JWT**: Secure token-based authentication
- **HTTP-only Cookies**: Secure session management
- **Input Validation**: Tool parameter validation
- **Error Handling**: Comprehensive error handling

## Development

### Project Structure
```
src/
├── index.ts              # Main server entry point
├── mcp-server.ts         # MCP protocol implementation
├── oauth-middleware.ts   # OAuth authentication middleware
└── tools/
    └── static-tools.ts  # Example MCP tools
```

### Adding New Tools

1. Create a new tool class or add methods to `StaticTools`
2. Register the tool in `src/index.ts`:
```typescript
mcpServer.registerTool('tool_name', toolInstance.method.bind(toolInstance));
```

3. Optionally, provide a schema for better tool discovery:
```typescript
mcpServer.registerTool('tool_name', handler, {
  name: 'tool_name',
  description: 'Tool description',
  inputSchema: {
    type: 'object',
    properties: {
      param1: { type: 'string', description: 'Parameter description' }
    },
    required: ['param1']
  }
});
```

## Docker Deployment

The MCP server can be deployed using Docker for easy containerization and deployment.

### Building the Docker Image

Build the Docker image from the project directory:

```bash
docker build -t ags-api-mcp-server .
```

### Running with Docker

#### Option 1: Using Environment File

1. Create a `.env` file with your configuration:
```bash
cp env.oidc.example .env
```

2. Edit `.env` with your AccelByte environment details:
```env
# Base URL for AccelByte environment; REQUIRED
AB_BASE_URL=https://yourgame.accelbyte.io

# Server Configuration
PORT=3000
NODE_ENV=production
LOG_LEVEL=info
```

3. Run the container:
```bash
# Run in background
docker run -d \
  --name ags-api-mcp-server \
  --env-file .env \
  -p 3000:3000 \
  ags-api-mcp-server

# Or run interactively to see logs
docker run -it --rm \
  --name ags-api-mcp-server \
  --env-file .env \
  -p 3000:3000 \
  ags-api-mcp-server
```

#### Option 2: Direct Environment Variables

```bash
docker run -d \
  --name ags-api-mcp-server \
  -e AB_BASE_URL=https://yourgame.accelbyte.io \
  -e PORT=3000 \
  -e NODE_ENV=production \
  -e LOG_LEVEL=info \
  -p 3000:3000 \
  ags-api-mcp-server
```

### Docker Container Management

```bash
# View logs
docker logs ags-api-mcp-server

# Follow logs in real-time
docker logs -f ags-api-mcp-server

# Stop and remove container
docker stop ags-api-mcp-server
docker rm ags-api-mcp-server
```

### Health Check

The Docker container includes a built-in health check that monitors the `/health` endpoint:

```bash
# Check container health status
docker ps

# Manual health check
curl http://localhost:3000/health
```

### Docker Features

- **Multi-stage build**: Optimized image size with separate build and runtime stages
- **Health checks**: Built-in monitoring of server health
- **Port exposure**: Port 3000 is automatically exposed
- **Production ready**: Configured for production deployment
- **Lightweight**: Based on Node.js Alpine Linux image

## Testing

Test the server using curl or any HTTP client:

1. **Health Check**:
```bash
curl http://localhost:3000/health
```

2. **MCP Request** (after authentication):
```bash
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Cookie: auth_token=your_jwt_token" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/list"
  }'
```
## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## Support

For issues and questions, please open an issue in the repository.
