# Stdio Mode Client Configuration

This guide explains how to configure various MCP clients to use the AGS API MCP Server in stdio mode.

## Table of Contents
- [Claude Desktop](#claude-desktop)
- [VSCode with Cline](#vscode-with-cline)
- [Environment Configuration](#environment-configuration)
- [Troubleshooting](#troubleshooting)

## Claude Desktop

Claude Desktop is the most popular MCP client. Here's how to configure it to use the AGS API MCP Server in stdio mode.

### Configuration File Location

The configuration file location varies by operating system:

- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
- **Linux**: `~/.config/Claude/claude_desktop_config.json`

### Basic Configuration

Add the following to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "ags-api": {
      "command": "node",
      "args": [
        "/absolute/path/to/ags-api-mcp-server/dist/index.js"
      ],
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

### Configuration with Client Credentials

If you want to use client credentials flow for automatic authentication:

```json
{
  "mcpServers": {
    "ags-api": {
      "command": "node",
      "args": [
        "/absolute/path/to/ags-api-mcp-server/dist/index.js"
      ],
      "env": {
        "TRANSPORT": "stdio",
        "AB_BASE_URL": "https://yourgame.accelbyte.io",
        "OAUTH_CLIENT_ID": "your-client-id",
        "OAUTH_CLIENT_SECRET": "your-client-secret",
        "OAUTH_TOKEN_URL": "https://yourgame.accelbyte.io/iam/v3/oauth/token",
        "LOG_LEVEL": "info",
        "NODE_ENV": "production"
      }
    }
  }
}
```

### Development Configuration with Debug Logging

For debugging, use verbose logging:

```json
{
  "mcpServers": {
    "ags-api": {
      "command": "node",
      "args": [
        "/absolute/path/to/ags-api-mcp-server/dist/index.js"
      ],
      "env": {
        "TRANSPORT": "stdio",
        "AB_BASE_URL": "https://yourgame.accelbyte.io",
        "OAUTH_CLIENT_ID": "your-client-id",
        "OAUTH_CLIENT_SECRET": "your-client-secret",
        "LOG_LEVEL": "debug",
        "NODE_ENV": "development"
      }
    }
  }
}
```

### Using Environment File

If you prefer to use a `.env` file, you can use a shell wrapper:

1. Create a wrapper script `start-mcp.sh`:

```bash
#!/bin/bash
cd /absolute/path/to/ags-api-mcp-server
source .env
export TRANSPORT=stdio
node dist/index.js
```

2. Make it executable:
```bash
chmod +x start-mcp.sh
```

3. Configure Claude Desktop to use the wrapper:

```json
{
  "mcpServers": {
    "ags-api": {
      "command": "/absolute/path/to/ags-api-mcp-server/start-mcp.sh"
    }
  }
}
```

### Configuration with pnpm (Alternative)

If you prefer using pnpm:

```json
{
  "mcpServers": {
    "ags-api": {
      "command": "pnpm",
      "args": [
        "--dir",
        "/absolute/path/to/ags-api-mcp-server",
        "start:stdio"
      ],
      "env": {
        "AB_BASE_URL": "https://yourgame.accelbyte.io",
        "OAUTH_CLIENT_ID": "your-client-id",
        "OAUTH_CLIENT_SECRET": "your-client-secret"
      }
    }
  }
}
```

## VSCode with Cline

Cline (formerly Claude Dev) is a popular VSCode extension that supports MCP.

### Configuration

1. Open VSCode Settings (Cmd/Ctrl + ,)
2. Search for "Cline MCP Settings"
3. Add the server configuration:

```json
{
  "cline.mcpServers": {
    "ags-api": {
      "command": "node",
      "args": [
        "/absolute/path/to/ags-api-mcp-server/dist/index.js"
      ],
      "env": {
        "TRANSPORT": "stdio",
        "AB_BASE_URL": "https://yourgame.accelbyte.io",
        "OAUTH_CLIENT_ID": "your-client-id",
        "OAUTH_CLIENT_SECRET": "your-client-secret"
      }
    }
  }
}
```

## Environment Configuration

### Required Environment Variables

The following environment variables must be set:

| Variable | Description | Required |
|----------|-------------|----------|
| `TRANSPORT` | Must be set to `stdio` | Yes |
| `AB_BASE_URL` | Your AccelByte environment URL | Yes |
| `OAUTH_CLIENT_ID` | OAuth client ID for authentication | Yes* |
| `OAUTH_CLIENT_SECRET` | OAuth client secret | Yes* |

\* Required for client credentials flow. Can be empty string if your OAuth provider doesn't require a secret.

### Optional Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `LOG_LEVEL` | Logging level (debug, info, warn, error, fatal) | `info` |
| `NODE_ENV` | Environment mode (development/production) | `development` |
| `OAUTH_TOKEN_URL` | OAuth token endpoint URL | `{AB_BASE_URL}/iam/v3/oauth/token` |
| `JWKS_URI` | JWKS endpoint for token verification | `{AB_BASE_URL}/iam/v3/oauth/jwks` |
| `JWT_ISSUER` | JWT token issuer | `{AB_BASE_URL}` |
| `OPENAPI_SPECS_DIR` | Directory containing OpenAPI specs | `openapi-specs` |

## Viewing Logs

Since all logs are redirected to stderr in stdio mode, you can view them in different ways depending on your client:

### Claude Desktop Logs

**macOS:**
```bash
# View logs in real-time
tail -f ~/Library/Logs/Claude/mcp*.log

# Or open the logs directory
open ~/Library/Logs/Claude/
```

**Windows:**
```powershell
# Open the logs directory
explorer %LOCALAPPDATA%\Claude\logs
```

**Linux:**
```bash
# View logs
tail -f ~/.config/Claude/logs/mcp*.log
```

### Viewing Logs Manually

You can also run the server manually to see logs directly:

```bash
cd /path/to/ags-api-mcp-server
TRANSPORT=stdio AB_BASE_URL=https://yourgame.accelbyte.io \
  OAUTH_CLIENT_ID=your-client-id \
  OAUTH_CLIENT_SECRET=your-client-secret \
  node dist/index.js
```

## Troubleshooting

### Server Not Starting

**Symptom**: Claude Desktop shows "Server failed to start" or similar error.

**Solutions**:
1. Check that Node.js is installed and accessible:
   ```bash
   node --version  # Should show v18 or higher
   ```

2. Verify the path to `dist/index.js` is correct and absolute

3. Check that the server builds successfully:
   ```bash
   cd /path/to/ags-api-mcp-server
   npm run build
   ```

4. Test the server manually:
   ```bash
   TRANSPORT=stdio AB_BASE_URL=https://yourgame.accelbyte.io node dist/index.js
   ```

### Authentication Errors

**Symptom**: Tools fail with authentication errors.

**Solutions**:
1. Verify your `OAUTH_CLIENT_ID` and `OAUTH_CLIENT_SECRET` are correct

2. Check that the client has the necessary permissions in your AccelByte environment

3. Verify the `AB_BASE_URL` is correct

4. Check logs for detailed error messages

### Tools Not Appearing

**Symptom**: MCP tools don't show up in the client.

**Solutions**:
1. Restart the MCP client completely

2. Check Claude Desktop logs for errors

3. Verify the configuration file is valid JSON:
   ```bash
   cat ~/Library/Application\ Support/Claude/claude_desktop_config.json | python -m json.tool
   ```

4. Ensure `TRANSPORT=stdio` is set in the environment

5. Check if OpenAPI specs directory is found (look for warnings in logs)

### OpenAPI Specs Not Found

**Symptom**: Warning message "OpenAPI specs directory not found" in logs.

**Solutions**:
1. The server now automatically resolves paths relative to the project directory, so the `openapi-specs` folder should be found automatically

2. Verify the `openapi-specs` directory exists in your project:
   ```bash
   ls /path/to/ags-api-mcp-server/openapi-specs/
   ```

3. Check the logs for the resolved path:
   - Look for `"openapiSpecsDir"` in the configuration log
   - The path should be absolute and point to your project's openapi-specs directory

4. If using a custom location, ensure `OPENAPI_SPECS_DIR` is set correctly:
   - Use absolute path: `/full/path/to/specs`
   - Or relative to project: `custom-specs` (resolves to `/project/root/custom-specs`)

5. The project root is automatically detected based on where the compiled code lives

### Connection Issues

**Symptom**: Client can't communicate with the server.

**Solutions**:
1. Make sure only one instance of the server is running

2. Check that stdio communication isn't being blocked:
   ```bash
   # Test stdio communication
   echo '{"jsonrpc":"2.0","method":"initialize","params":{},"id":1}' | \
     TRANSPORT=stdio AB_BASE_URL=https://yourgame.accelbyte.io node dist/index.js
   ```

3. Verify no other process is interfering with stdin/stdout

### Debugging Tips

1. **Enable Debug Logging**:
   ```json
   "env": {
     "LOG_LEVEL": "debug"
   }
   ```

2. **Test Manually First**:
   ```bash
   TRANSPORT=stdio LOG_LEVEL=debug node dist/index.js
   ```
   Then type JSON-RPC messages manually to test

3. **Check Environment Variables**:
   Add logging to verify environment variables are set correctly

4. **Validate OpenAPI Specs**:
   Ensure the `openapi-specs` directory exists and contains valid specs

## Testing Your Configuration

### Quick Test

1. Add the configuration to your MCP client
2. Restart the client
3. In Claude Desktop, start a new conversation
4. Type: "What MCP tools do you have available?"
5. You should see tools like:
   - `get_token_info`
   - `search-apis`
   - `describe-apis`
   - `run-apis`

### Test Client Credentials

Ask Claude to:
```
Use the get_token_info tool to show me information about the current authentication
```

If client credentials are working, you should see detailed information including:
- **Token type**: `client_credentials` or `user_token`
- **Cache status**: Whether the token came from cache or was freshly obtained
- **Expiration info**: When the token expires and time remaining in human-readable format
- **Token claims**: Full JWT payload including:
  - Standard JWT claims (issuer, subject, audience, expiration, etc.)
  - Custom claims (grant type, client ID, namespace, scope, roles, permissions)
  - User-specific claims (if present): display name, country, email verification, etc.
- **Token header**: Algorithm, type, and key ID used for signing

Example output:
```json
{
  "message": "Token information from authenticated token",
  "tokenMetadata": {
    "type": "client_credentials",
    "isExpired": false,
    "isFromCache": true,
    "length": 1234,
    "prefix": "eyJhbGciOiJSUzI1NiIs..."
  },
  "tokenClaims": {
    "issuer": "https://yourgame.accelbyte.io",
    "subject": "client:your-client-id",
    "expiresAt": "2025-10-10T15:30:00.000Z",
    "timeUntilExpiry": "25 minute(s)",
    "isExpired": false,
    "grantType": "client_credentials",
    "clientId": "your-client-id",
    "namespace": "yourgame",
    "scope": "commerce account social"
  }
}
```

### Test API Search

Ask Claude to:
```
Search for user-related APIs using the search-apis tool
```

You should get a list of relevant API endpoints.

## Security Considerations

1. **Protect Your Credentials**: Never commit `claude_desktop_config.json` with real credentials to version control

2. **Use Environment-Specific Clients**: Create separate OAuth clients for development and production

3. **Rotate Secrets Regularly**: Update `OAUTH_CLIENT_SECRET` periodically

4. **Limit Client Permissions**: Only grant the OAuth client the minimum required permissions

5. **Monitor Usage**: Check logs regularly for unusual activity

## Advanced Configuration

### Multiple Environments

You can configure multiple server instances for different environments:

```json
{
  "mcpServers": {
    "ags-api-dev": {
      "command": "node",
      "args": ["/path/to/ags-api-mcp-server/dist/index.js"],
      "env": {
        "TRANSPORT": "stdio",
        "AB_BASE_URL": "https://dev.accelbyte.io",
        "OAUTH_CLIENT_ID": "dev-client-id",
        "OAUTH_CLIENT_SECRET": "dev-secret"
      }
    },
    "ags-api-prod": {
      "command": "node",
      "args": ["/path/to/ags-api-mcp-server/dist/index.js"],
      "env": {
        "TRANSPORT": "stdio",
        "AB_BASE_URL": "https://prod.accelbyte.io",
        "OAUTH_CLIENT_ID": "prod-client-id",
        "OAUTH_CLIENT_SECRET": "prod-secret"
      }
    }
  }
}
```

### Custom OpenAPI Specs Location

You can specify a custom location for OpenAPI specs using either:
- **Relative path**: Resolved relative to the project directory
- **Absolute path**: Used as-is

```json
{
  "mcpServers": {
    "ags-api": {
      "command": "node",
      "args": ["/path/to/ags-api-mcp-server/dist/index.js"],
      "env": {
        "TRANSPORT": "stdio",
        "AB_BASE_URL": "https://yourgame.accelbyte.io",
        "OAUTH_CLIENT_ID": "your-client-id",
        "OAUTH_CLIENT_SECRET": "your-client-secret",
        "OPENAPI_SPECS_DIR": "/custom/path/to/openapi-specs"
      }
    }
  }
}
```

**Note**: The server automatically resolves paths relative to the project root, so you don't need to worry about the current working directory when the MCP client launches the server.

## Support

If you encounter issues not covered in this guide:

1. Check the server logs (stderr output)
2. Enable debug logging (`LOG_LEVEL=debug`)
3. Review the [main README](README.md) for general server configuration
4. Check your AccelByte environment configuration
5. Verify your OAuth client settings in the AccelByte Admin Portal

## Example Full Configuration

Here's a complete, production-ready configuration example:

```json
{
  "mcpServers": {
    "ags-api": {
      "command": "node",
      "args": [
        "/Users/yourname/projects/ags-api-mcp-server/dist/index.js"
      ],
      "env": {
        "TRANSPORT": "stdio",
        "NODE_ENV": "production",
        "LOG_LEVEL": "info",
        "AB_BASE_URL": "https://yourgame.accelbyte.io",
        "OAUTH_CLIENT_ID": "1234567890abcdef",
        "OAUTH_CLIENT_SECRET": "your-secret-here",
        "OAUTH_TOKEN_URL": "https://yourgame.accelbyte.io/iam/v3/oauth/token",
        "JWKS_URI": "https://yourgame.accelbyte.io/iam/v3/oauth/jwks",
        "JWT_ISSUER": "https://yourgame.accelbyte.io",
        "OPENAPI_SPECS_DIR": "openapi-specs",
        "OPENAPI_DEFAULT_SEARCH_LIMIT": "5",
        "INCLUDE_WRITE_REQUESTS": "false"
      }
    }
  }
}
```

Replace the paths and credentials with your actual values, and you're ready to go!

