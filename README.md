# AGS API MCP Server

## Description

The AGS API MCP Server is a Model Context Protocol (MCP) server that provides AI assistants with access to AccelByte Gaming Services APIs through OpenAPI integration.

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

- **Docker** installed and running
- **AccelByte Environment URL** (`AB_BASE_URL`) - Your AccelByte environment base URL
- (Optional) **AccelByte OAuth Credentials** - If using authentication features

## Quick Start

### Visual Studio Code

Create or edit `.vscode/mcp.json` in your workspace (or configure in user settings):

```json
{
  "servers": {
    "ags-api": {
      "type": "stdio",
      "command": "docker",
      "args": [
        "run",
        "--rm",
        "--interactive",
        "--env", "AB_BASE_URL=https://yourgame.accelbyte.io",
        "--env", "OAUTH_CLIENT_ID=your-client-id",
        "--env", "OAUTH_CLIENT_SECRET=your-client-secret",
        "ghcr.io/accelbyte/ags-api-mcp-server:2026.1.0"
      ]
    }
  }
}
```

**Note**: Replace the placeholder values with your actual AccelByte credentials. You can also use input variables for sensitive data. See the [VS Code MCP documentation](https://code.visualstudio.com/docs/copilot/customization/mcp-servers#_other-options-to-add-an-mcp-server) for more details.

**Location**: 
- Workspace: `.vscode/mcp.json`
- User settings: VS Code settings UI or `settings.json`

### Cursor

Create or edit `.cursor/mcp.json` in your workspace (or configure in user settings):

```json
{
  "mcpServers": {
    "ags-api": {
      "command": "docker",
      "args": [
        "run",
        "--rm",
        "--interactive",
        "--env", "AB_BASE_URL=https://yourgame.accelbyte.io",
        "--env", "OAUTH_CLIENT_ID=your-client-id",
        "--env", "OAUTH_CLIENT_SECRET=your-client-secret",
        "ghcr.io/accelbyte/ags-api-mcp-server:2026.1.0"
      ]
    }
  }
}
```

**Note**: Replace the placeholder values with your actual AccelByte credentials. See the [Cursor MCP documentation](https://cursor.com/docs/context/mcp#using-mcpjson) for more details.

**Location**:
- Workspace: `.cursor/mcp.json`
- User settings: Cursor settings UI

### Claude Desktop

Edit your Claude Desktop configuration file:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`  
**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "ags-api": {
      "command": "docker",
      "args": [
        "run",
        "--rm",
        "--interactive",
        "--env", "AB_BASE_URL=https://yourgame.accelbyte.io",
        "--env", "OAUTH_CLIENT_ID=your-client-id",
        "--env", "OAUTH_CLIENT_SECRET=your-client-secret",
        "ghcr.io/accelbyte/ags-api-mcp-server:2026.1.0"
      ]
    }
  }
}
```

**Note**: Replace the placeholder values with your actual AccelByte credentials. See the [Claude Desktop MCP documentation](https://modelcontextprotocol.io/docs/develop/connect-local-servers#installing-the-filesystem-server) for more details.

**After configuration**: Restart your AI assistant application to load the MCP server.

### Claude Code

Claude Code uses a different configuration system than Claude Desktop. You can configure MCP servers either via CLI command or by creating a `.mcp.json` file.

#### Option 1: Using CLI Command

Run the following command in your terminal:

```bash
claude mcp add --transport stdio ags-api -- \
  docker run --rm --interactive \
  --env AB_BASE_URL=https://yourgame.accelbyte.io \
  --env OAUTH_CLIENT_ID=your-client-id \
  --env OAUTH_CLIENT_SECRET=your-client-secret \
  ghcr.io/accelbyte/ags-api-mcp-server:2026.1.0
```

**Note**: Replace the placeholder values with your actual AccelByte credentials. The `--` separator is required to distinguish Claude CLI flags from the Docker command.

#### Option 2: Using .mcp.json File

Create or edit `.mcp.json` in your project root:

```json
{
  "mcpServers": {
    "ags-api": {
      "type": "stdio",
      "command": "docker",
      "args": [
        "run",
        "--rm",
        "--interactive",
        "--env", "AB_BASE_URL=https://yourgame.accelbyte.io",
        "--env", "OAUTH_CLIENT_ID=your-client-id",
        "--env", "OAUTH_CLIENT_SECRET=your-client-secret",
        "ghcr.io/accelbyte/ags-api-mcp-server:2026.1.0"
      ]
    }
  }
}
```

**Note**: Replace the placeholder values with your actual AccelByte credentials. See the [Claude Code MCP documentation](https://code.claude.com/docs/en/mcp#installing-mcp-servers) for more details.

**Location**: `.mcp.json` in your project root directory

### Antigravity

Antigravity uses `mcp_config.json` for MCP server configuration. Create or edit the configuration file:

**Location**: `mcp_config.json` in your project root

```json
{
  "mcpServers": {
    "ags-api": {
      "command": "docker",
      "args": [
        "run",
        "--rm",
        "--interactive",
        "--env", "AB_BASE_URL=https://yourgame.accelbyte.io",
        "--env", "OAUTH_CLIENT_ID=your-client-id",
        "--env", "OAUTH_CLIENT_SECRET=your-client-secret",
        "ghcr.io/accelbyte/ags-api-mcp-server:2026.1.0"
      ]
    }
  }
}
```

**Note**: Replace the placeholder values with your actual AccelByte credentials. See the [Antigravity MCP documentation](https://antigravity.google/docs/mcp#connecting-custom-mcp-servers) for more details.

**Location**: `mcp_config.json` in your project root directory
### Gemini CLI

Gemini CLI uses a different configuration system. You can configure MCP servers either via CLI command or by editing `settings.json`.

#### Option 1: Using CLI Command

Run the following command in your terminal:

```bash
gemini mcp add --transport stdio --env AB_BASE_URL=https://yourgame.accelbyte.io --env OAUTH_CLIENT_ID=your-client-id --env OAUTH_CLIENT_SECRET=your-client-secret ags-api -- docker run --rm --interactive ghcr.io/accelbyte/ags-api-mcp-server:2026.1.0
```

**Note**: Replace the placeholder values with your actual AccelByte credentials. The `--` separator is required to distinguish Gemini CLI flags from the Docker command. See the [Gemini CLI MCP documentation](https://geminicli.com/docs/tools/mcp-server/#configure-the-mcp-server-in-settingsjson) for more details.

#### Option 2: Using settings.json File

Edit your Gemini CLI settings file:

**User scope**: `~/.gemini/settings.json`  
**Project scope**: `.gemini/settings.json` (in your project root)

```json
{
  "mcpServers": {
    "ags-api": {
      "command": "docker",
      "args": [
        "run",
        "--rm",
        "--interactive",
        "--env", "AB_BASE_URL=https://yourgame.accelbyte.io",
        "--env", "OAUTH_CLIENT_ID=your-client-id",
        "--env", "OAUTH_CLIENT_SECRET=your-client-secret",
        "ghcr.io/accelbyte/ags-api-mcp-server:2026.1.0"
      ]
    }
  }
}
```

**Note**: Replace the placeholder values with your actual AccelByte credentials. See the [Gemini CLI MCP documentation](https://geminicli.com/docs/tools/mcp-server/#configure-the-mcp-server-in-settingsjson) for more details.

**Location**: 
- User scope: `~/.gemini/settings.json`
- Project scope: `.gemini/settings.json` in your project root

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

## Bonus: Running Docker Container Manually

If you prefer to run the Docker container manually instead of configuring it through your AI assistant's MCP configuration files:

### Run the Container

```bash
docker run -d \
  --name ags-api-mcp-server \
  -e AB_BASE_URL=https://yourgame.accelbyte.io \
  -e OAUTH_CLIENT_ID=your-client-id \
  -e OAUTH_CLIENT_SECRET=your-client-secret \
  -p 3000:3000 \
  ghcr.io/accelbyte/ags-api-mcp-server:2026.1.0
```

**Note**: Replace the placeholder values with your actual AccelByte credentials.

The server will be available at `http://localhost:3000/mcp`, which you can then add in your VS Code, Cursor, Claude Code, Gemini CLI, or Antigravity configuration.

### Configure Your AI Assistant to Use the Running Container

#### Visual Studio Code

Add to `.vscode/mcp.json`:

```json
{
  "servers": {
    "ags-api": { "type": "http", "url": "http://localhost:3000/mcp" }
  }
}
```

#### Cursor

Add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "ags-api": { "type": "http", "url": "http://localhost:3000/mcp" }
  }
}
```

#### Claude Code

Claude Code uses a different configuration system than Claude Desktop. You can configure MCP servers either via CLI command or by creating a `.mcp.json` file.

##### Option 1: Using CLI Command

Run the following command in your terminal:

```bash
claude mcp add --transport http ags-api http://localhost:3000/mcp
```

##### Option 2: Using .mcp.json File

Create or edit `.mcp.json` in your project root:

```json
{
  "mcpServers": {
    "ags-api": { "type": "http", "url": "http://localhost:3000/mcp" }
  }
}
```

**Location**: `.mcp.json` in your project root directory

#### Gemini CLI

Gemini CLI uses a different configuration system. You can configure MCP servers either via CLI command or by editing `settings.json`.

##### Option 1: Using CLI Command

Run the following command in your terminal:

```bash
gemini mcp add --transport http ags-api http://localhost:3000/mcp
```

##### Option 2: Using settings.json File

Edit your Gemini CLI settings file:

**User scope**: `~/.gemini/settings.json`  
**Project scope**: `.gemini/settings.json` (in your project root)

```json
{
  "mcpServers": {
    "ags-api": { "type": "http", "url": "http://localhost:3000/mcp" }
  }
}
```

**Location**: 
- User scope: `~/.gemini/settings.json`
- Project scope: `.gemini/settings.json` in your project root

#### Antigravity

Add to `mcp_config.json`:

```json
{
  "mcpServers": {
    "ags-api": { "type": "http", "url": "http://localhost:3000/mcp" }
  }
}
```

## Documentation

For detailed documentation, see:

- [Quick Start Guide](docs/QUICK_START.md) - Detailed setup instructions
- [API Reference](docs/API_REFERENCE.md) - Complete API documentation
- [Environment Variables](docs/ENVIRONMENT_VARIABLES.md) - Configuration options
- [Docker Deployment](docs/DOCKER.md) - Advanced Docker configuration
- [Development Guide](docs/DEVELOPMENT.md) - Contributing and extending the server

## Support

For issues and questions, please open an issue in the repository.
