# AGS API MCP Server

## Description

The AGS API MCP Server is a Model Context Protocol (MCP) server that provides AI assistants with access to AccelByte Gaming Services APIs through OpenAPI integration.

> **Note:** V2 is **HTTP-only** and uses Bearer token authentication. For stdio transport or server-managed OAuth, see [V1 documentation](docs/v1/README.md).

### What It Is

An MCP server built with TypeScript that bridges AI assistants (VS Code Copilot, Cursor, Claude) with AccelByte Gaming Services APIs. It implements the Model Context Protocol to expose AccelByte APIs as tools that AI assistants can discover and use.

### What It's For

Enable AI assistants to interact with AccelByte APIs by:
- Searching for available AccelByte API operations
- Getting detailed information about specific APIs
- Executing API requests with proper authentication
- Retrieving token information

### What It Does

- **Exposes AccelByte APIs as MCP Tools**: Provides access to AccelByte APIs through MCP tools
- **Provides Semantic Search**: Search across OpenAPI operations by description, tags, or path
- **Executes API Requests**: Runs API calls with proper authentication and validation
- **Provides Token Information**: Retrieves information about authenticated tokens

## Prerequisites

- **Docker** - Container runtime (required)
- **AccelByte Environment URL** (`AB_BASE_URL`) - Your AccelByte environment base URL

## Running the Server

> **Note**: MCP clients require the server to be running before configuration. Start the server first, then configure your MCP client (see [Quick Start](#quick-start) below).

Start the server using Docker:

```bash
docker run -d \
  --name ags-api-mcp-server \
  -e AB_BASE_URL=https://yourgame.accelbyte.io \
  -e MCP_AUTH=true \
  -p 3000:3000 \
  ghcr.io/accelbyte/ags-api-mcp-server:2026.1.0
```

**Note**: Replace `https://yourgame.accelbyte.io` with your actual AccelByte environment URL.

Verify the server is running:

```bash
curl http://localhost:3000/health
```

You should see: `{"status":"ok","timestamp":"..."}`

See [Docker Deployment Guide](docs/DOCKER.md) for detailed Docker instructions.

## Quick Start

V2 uses HTTP transport, which requires the server to be running before configuring MCP clients. Follow these steps:

### Step 1: Start the Server

Start the MCP server using Docker:

```bash
docker run -d \
  --name ags-api-mcp-server \
  -e AB_BASE_URL=https://yourgame.accelbyte.io \
  -e MCP_AUTH=true \
  -p 3000:3000 \
  ghcr.io/accelbyte/ags-api-mcp-server:2026.1.0
```

**Note**: Replace `https://yourgame.accelbyte.io` with your actual AccelByte environment URL.

Verify the server is running:

```bash
curl http://localhost:3000/health
```

You should see: `{"status":"ok","timestamp":"..."}`

### Step 2: Configure Your MCP Client

Once the server is running, configure your MCP client to connect via HTTP:

#### Visual Studio Code

Create or edit `.vscode/mcp.json` in your workspace (or configure in user settings):

```json
{
  "servers": {
    "ags-api": {
      "type": "http",
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

**Location**: 
- Workspace: `.vscode/mcp.json`
- User settings: VS Code settings UI or `settings.json`

See the [VS Code MCP documentation](https://code.visualstudio.com/docs/copilot/customization/mcp-servers#_other-options-to-add-an-mcp-server) for more details.

#### Cursor

Create or edit `.cursor/mcp.json` in your workspace (or configure in user settings):

```json
{
  "mcpServers": {
    "ags-api": {
      "type": "http",
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

**Location**:
- Workspace: `.cursor/mcp.json`
- User settings: Cursor settings UI

See the [Cursor MCP documentation](https://cursor.com/docs/context/mcp#using-mcpjson) for more details.

#### Claude Desktop

Edit your Claude Desktop configuration file:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`  
**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "ags-api": {
      "type": "http",
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

**After configuration**: Restart Claude Desktop to load the MCP server.

See the [Claude Desktop MCP documentation](https://modelcontextprotocol.io/docs/develop/connect-local-servers#installing-the-filesystem-server) for more details.

#### Claude Code

Claude Code uses a different configuration system than Claude Desktop. You can configure MCP servers either via CLI command or by creating a `.mcp.json` file.

**Option 1: Using CLI Command**

```bash
claude mcp add --transport http ags-api http://localhost:3000/mcp
```

**Option 2: Using .mcp.json File**

Create or edit `.mcp.json` in your project root:

```json
{
  "mcpServers": {
    "ags-api": {
      "type": "http",
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

**Location**: `.mcp.json` in your project root directory

See the [Claude Code MCP documentation](https://code.claude.com/docs/en/mcp#installing-mcp-servers) for more details.

#### Antigravity

Create or edit `mcp_config.json` in your project root:

```json
{
  "mcpServers": {
    "ags-api": {
      "type": "http",
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

**Location**: `mcp_config.json` in your project root directory

See the [Antigravity MCP documentation](https://antigravity.google/docs/mcp#connecting-custom-mcp-servers) for more details.

#### Gemini CLI

Gemini CLI uses a different configuration system. You can configure MCP servers either via CLI command or by editing `settings.json`.

**Option 1: Using CLI Command**

```bash
gemini mcp add --transport http ags-api http://localhost:3000/mcp
```

**Option 2: Using settings.json File**

Edit your Gemini CLI settings file:

**User scope**: `~/.gemini/settings.json`  
**Project scope**: `.gemini/settings.json` (in your project root)

```json
{
  "mcpServers": {
    "ags-api": {
      "type": "http",
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

**Location**: 
- User scope: `~/.gemini/settings.json`
- Project scope: `.gemini/settings.json` in your project root

See the [Gemini CLI MCP documentation](https://geminicli.com/docs/tools/mcp-server/#configure-the-mcp-server-in-settingsjson) for more details.

## Running with OAuth Server (MCP_HOSTED)

For testing the `MCP_HOSTED` feature, you can run both the MCP server and a minimal OAuth server together using Docker Compose:

```bash
# Run from the project root
docker-compose -f tools/oauth/docker-compose.yml up -d

# Or from the tools/oauth directory
cd tools/oauth && docker-compose up -d
```

This starts:
- **MCP Server** on `http://localhost:8080/mcp`
- **OAuth Server** on `http://localhost:8080/oauth`
- **Nginx Reverse Proxy** routing requests to both servers

**Access Points:**
- MCP Server: `http://localhost:8080/mcp`
- OAuth Discovery: `http://localhost:8080/.well-known/oauth-authorization-server`
- MCP Discovery: `http://localhost:8080/.well-known/oauth-protected-resource`

**Test Credentials:**
- Client ID: `test-client`
- Client Secret: `test-secret`
- Username: `test-user`
- Password: `test123`

See the header comment in `tools/oauth/minimal-oauth-server.js` for detailed documentation.

## Using the Tools

Once configured, your AI assistant can use the following MCP tools to interact with AccelByte APIs:

### `get_token_info`

Get information about the authenticated user and token (if available). Returns details such as:
- User ID and display name
- Namespace
- Roles and permissions
- Token expiration information

**Example usage**: Ask your AI assistant "What's my current user information?" or "Show me my token details".

### `search-apis`

Search for AccelByte API operations by:
- Description or summary text
- HTTP method (GET, POST, PUT, DELETE, etc.)
- API tags
- Service name

**Example usage**: "Find APIs for user management" or "Search for inventory-related endpoints".

### `describe-apis`

Get detailed information about a specific API operation, including:
- Request parameters and schemas
- Response schemas
- Authentication requirements
- Example requests

**Example usage**: "Show me details about the getUserProfile API" or "What parameters does the createItem endpoint need?".

### `run-apis`

Execute API requests against AccelByte endpoints. The server handles:
- Authentication with your token
- Request validation
- Response formatting

**Note**: For write operations (POST, PUT, PATCH, DELETE), the server may request your consent before executing.

**Example usage**: "Get my user profile" or "List all items in my inventory".

### Workflow Support

The server also provides workflow resources and prompts for running predefined workflows. Ask your AI assistant about available workflows or use the `run-workflow` prompt.

## Authentication

V2 uses **Bearer token authentication**. Clients must obtain a JWT token from AccelByte's OAuth service and include it in the `Authorization` header:

```
Authorization: Bearer <your-jwt-token>
```

The server validates the token on each request but does not manage OAuth flows or token refresh. Clients are responsible for:
- Obtaining tokens from AccelByte OAuth
- Refreshing tokens when they expire
- Including tokens in requests

See [API Reference](docs/API_REFERENCE.md) for authentication details.

## Documentation

For detailed documentation, see:

- [Quick Start Guide](docs/QUICK_START.md) - Detailed setup instructions
- [API Reference](docs/API_REFERENCE.md) - Complete API documentation
- [Environment Variables](docs/ENVIRONMENT_VARIABLES.md) - Configuration options
- [Docker Deployment](docs/DOCKER.md) - Advanced Docker configuration
- [Development Guide](docs/DEVELOPMENT.md) - Contributing and extending the server

## Support

For issues and questions, please open an issue in the repository.
