# Quick Start Guide (V2)

Get the AGS API MCP Server V2 up and running in minutes!

> **Note:** This is the V2 quick start guide. For V1 documentation, see [docs/v1/QUICK_START.md](v1/QUICK_START.md).

## What is V2?

V2 is a **stateless, HTTP-only** MCP server optimized for production deployments:
- ✅ No server-side sessions
- ✅ Client-managed authentication
- ✅ Simple deployment
- ✅ Horizontal scaling

See [V2_ARCHITECTURE.md](V2_ARCHITECTURE.md) for detailed comparison with V1.

---

## Prerequisites

### Required Software

- **Node.js 20+** - JavaScript runtime
- **pnpm** - Package manager (recommended)
- **Git** - Version control

### Installation by Platform

#### macOS
```bash
# Install Homebrew (if not already installed)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Install Node.js and Git
brew install git node

# Install pnpm
npm install -g pnpm

# Verify installation
node --version  # Should be v20 or higher
pnpm --version
```

#### Windows
```powershell
# Install Node.js (LTS version)
winget install OpenJS.NodeJS.LTS

# Install Git
winget install Git.Git

# Install pnpm
npm install -g pnpm

# Verify installation
node --version
pnpm --version
```

#### Ubuntu Linux
```bash
# Update package index
sudo apt update

# Install Node.js 20.x
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs git

# Install pnpm
npm install -g pnpm

# Verify installation
node --version
pnpm --version
```

---

## Setup

### 1. Clone Repository

```bash
git clone <repository-url>
cd ags-api-mcp-server
```

### 2. Install Dependencies

```bash
pnpm install
```

### 3. Configure Environment

#### Create .env file
```bash
pnpm run setup
```

#### Edit .env
Open `.env` and set your AccelByte environment:

```bash
# Required
AB_BASE_URL=https://yourgame.accelbyte.io

# Optional (defaults shown)
MCP_PORT=3000
MCP_AUTH=true
NODE_ENV=development
LOG_LEVEL=info
```

That's it! V2 requires only `AB_BASE_URL`.

### 4. Build

```bash
pnpm run build
```

---

## Running the Server

### Development Mode

```bash
pnpm run dev
```

This starts the server in watch mode (auto-restart on changes).

### Production Mode

```bash
pnpm start
```

The server will start on `http://localhost:3000`.

**Expected output**:
```
INFO: Configuration loaded
  mcpServerUrl: http://localhost:3000
  mcpAuthEnabled: true
  openapiServerUrl: https://yourgame.accelbyte.io
INFO: MCP Server listening on port 3000
```

---

## Verify Installation

Test the health endpoint:

```bash
curl http://localhost:3000/health
```

Expected response:
```json
{
  "status": "ok",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

Test the server info:
```bash
curl http://localhost:3000/
```

---

## Usage

### With MCP Client (HTTP)

V2 uses standard HTTP with Bearer token authentication.

**Example with curl**:
```bash
# Get your JWT token from AccelByte OAuth
TOKEN="your-jwt-token-here"

# Call MCP endpoint
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/list",
    "params": {}
  }'
```

### Authentication Flow

```
┌─────────────┐                          ┌──────────────┐
│   Client    │                          │ OAuth Server │
└──────┬──────┘                          └──────┬───────┘
       │                                        │
       │  1. Obtain JWT (external)              │
       │───────────────────────────────────────►│
       │                                        │
       │  2. JWT Token                          │
       │◄───────────────────────────────────────┤
       │                                        │
       │         ┌──────────────┐               │
       │         │  MCP Server  │               │
       │         └──────┬───────┘               │
       │                │                       │
       │  3. POST /mcp  │                       │
       │  Authorization: Bearer <JWT>           │
       ├───────────────►│                       │
       │                │                       │
       │  4. Response   │                       │
       │◄───────────────┤                       │
       │                │                       │
```

**Key Points**:
1. Client obtains JWT **externally** from OAuth provider
2. Client sends JWT in `Authorization` header
3. Server validates and uses token for API calls
4. Client handles token refresh

---

## Available Tools

V2 provides 4 MCP tools:

### 1. `get_token_info`
Get information about authenticated user and token.

### 2. `search-apis`
Search across loaded OpenAPI operations.

### 3. `describe-apis`
Get detailed information about specific API operations.

### 4. `run-apis`
Execute API requests (with user consent for write operations).

See [API_REFERENCE.md](API_REFERENCE.md) for detailed tool documentation.

---

## Development Workflow

### Watch Mode

Auto-rebuild on changes:
```bash
pnpm run dev
```

### Testing

Run tests:
```bash
pnpm test
```

### Linting

```bash
pnpm run lint
```

### Formatting

```bash
pnpm run format
```

---

## Docker Deployment

### Build Image

```bash
docker build -t ags-api-mcp-server:v2 .
```

### Run Container

```bash
docker run -d \
  --name ags-api-mcp-server \
  -e AB_BASE_URL=https://yourgame.accelbyte.io \
  -e MCP_AUTH=true \
  -p 3000:3000 \
  ags-api-mcp-server:v2
```

### Health Check

```bash
curl http://localhost:3000/health
```

See [DOCKER.md](DOCKER.md) for detailed Docker documentation.

---

## Configuration Options

### Disable Authentication (Development Only)

```bash
export MCP_AUTH=false
pnpm start
```

⚠️ **Not recommended for production!**

### Change Port

```bash
export MCP_PORT=3001
pnpm start
```

### Custom Endpoint Path

```bash
export MCP_PATH=/api/mcp
pnpm start
```

### Enable Debug Logging

```bash
export LOG_LEVEL=debug
pnpm start
```

See [ENVIRONMENT_VARIABLES.md](ENVIRONMENT_VARIABLES.md) for all options.

---

## Troubleshooting

### Server Won't Start

**Check required variables**:
```bash
# Must be set
echo $AB_BASE_URL
```

**Check port availability**:
```bash
# macOS/Linux
lsof -i :3000

# Windows
netstat -ano | findstr :3000
```

**Solution**: Change port or kill conflicting process.

### Authentication Fails

**Check auth is enabled**:
```bash
echo $MCP_AUTH  # Should be "true" or unset
```

**Check token format**:
- Must be valid JWT from AccelByte IAM
- Include `Authorization: Bearer <token>` header

### Port Already in Use

**Change port**:
```bash
export MCP_PORT=3001
pnpm start
```

### Connection Refused

**Check server is running**:
```bash
curl http://localhost:3000/health
```

### API Calls Timeout

**Increase timeout**:
```bash
export OPENAPI_DEFAULT_RUN_TIMEOUT_MS=30000
pnpm start
```

---

## Next Steps

### Learn More
- [API Reference](API_REFERENCE.md) - Complete API documentation
- [V2 Architecture](V2_ARCHITECTURE.md) - Architectural overview
- [Environment Variables](ENVIRONMENT_VARIABLES.md) - Configuration options
- [Development Guide](DEVELOPMENT.md) - Contributing and extending

### Advanced Topics
- [Docker Deployment](DOCKER.md) - Container deployment
- [Testing Guide](TESTING.md) - Testing strategies

### V1 Documentation
- [V1 Quick Start](v1/QUICK_START.md) - Legacy V1 guide
- [V1 OAuth Flow](v1/OAUTH_FLOW.md) - Server-managed OAuth

---

## Support

- **Documentation**: See [README.md](../README.md)
- **Issues**: Open an issue in the repository
- **Logs**: Check server logs for detailed errors

---

**🎉 You're all set!** Your AGS API MCP Server V2 is ready to use.

