# Quick Start Guide

Get the AGS API MCP Server up and running in minutes! This guide covers everything from local installation to MCP client configuration.

## Prerequisites

### 1. Local Installation

#### Windows
```powershell
# Install Git
winget install Git.Git

# Install Node.js (LTS version)
winget install OpenJS.NodeJS

# Install pnpm (optional, but recommended for this project)
npm install -g pnpm

# Verify installation
git --version
node --version
npm --version
pnpm --version
```

#### macOS
```bash
# Install Homebrew (if not already installed)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Install Git and Node.js
brew install git node

# Install pnpm (optional, but recommended for this project)
npm install -g pnpm

# Verify installation
git --version
node --version
npm --version
pnpm --version
```

#### Ubuntu Linux
```bash
# Update package index
sudo apt update

# Install Git and Node.js
sudo apt install -y git nodejs npm

# Install pnpm (optional, but recommended for this project)
npm install -g pnpm

# Verify installation
git --version
node --version
npm --version
pnpm --version
```

## Setup

### 2. Environment Preparation

#### 2.1 Clone the Repository
```bash
git clone <repository-url>
cd ags-api-mcp-server
```

#### 2.2 Install Dependencies
```bash
# Using pnpm (recommended)
pnpm install
```

#### 2.3 Configure AccelByte OAuth Client

**Note**: The redirect URI configuration below is only required if you intend to use user token authentication (OAuth Authorization Code flow). If you only need application-level authentication using client credentials flow, you can skip the redirect URI configuration.

1. **Log into your AccelByte Admin Portal**
   - Navigate to your target environment (e.g., yourgame.accelbyte.io/admin)
   - Go to **Game Setup** → **Games and Apps** → **IAM Clients**

2. **Create or Configure OAuth Client**
   - **Client ID**: Note this down (you'll need it later)
   - **Client Types**: Confidential
   - **Client Secret**: Generate and save securely
   - **Redirect URI** (required for user authentication): `http://localhost:3000/oauth/callback`
     - **Important**: This redirect URI must exactly match what you configure in AccelByte IAM. If they don't match, the OAuth flow will fail.
     - The default redirect URI is `http://localhost:3000/oauth/callback` (or your configured `OAUTH_REDIRECT_URI` if set)
     - If you change `OAUTH_REDIRECT_URI` in your environment variables, you must update the redirect URI in AccelByte IAM to match
   - **Scopes**: Add required scopes (e.g., `openid`, `account`, etc.)

3. **Adjust Token Timeouts** (Optional)
   - **Access Token Expiry**: Set to desired duration
   - **Refresh Token Expiry**: Set to desired duration

### 3. Build the Project
```bash
# Using pnpm (recommended)
pnpm run build
```

### 4. Configure Environment

#### 4.1 Create Environment File
```bash
# Using pnpm (recommended)
pnpm run setup
```

#### 4.2 Edit `.env` File
Open `.env` and configure the `AB_BASE_URL`.  

In the case of shared cloud users, JWT_ISSUER is different from your AB_BASE_URL so it also needs to be configured (e.g. https://prod.gamingservices.accelbyte.io):

```env
# REQUIRED: Your AccelByte environment base URL
AB_BASE_URL=https://yourgame.accelbyte.io

# Everything else uses sensible defaults
# PORT=3000
# NODE_ENV=development
# LOG_LEVEL=info
```

**That's it!** All other OAuth and OIDC URLs are automatically derived from `AB_BASE_URL`.

### 5. Run the MCP Server
```bash
# Using pnpm
pnpm dev
```

The server will start on `http://localhost:3000`. You should see among other logs:
```
INFO: MCP Server started
    port: 3000
```

### 6. Configure MCP Host (Claude Desktop)

#### 6.1 Configure Claude Desktop

**Location**: `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows)

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

**Replace**:
- `/absolute/path/to/ags-api-mcp-server/dist/index.js` with the actual path to your built server
- `https://yourgame.accelbyte.io` with your AccelByte environment URL
- `your-client-id` with your AccelByte OAuth client ID
- `your-client-secret` with your AccelByte OAuth client secret

#### 6.2 Restart Claude Desktop
1. Quit Claude Desktop completely
2. Restart Claude Desktop
3. A browser window should pop up for the OAuth authentcation flow.  Note that the user you use to authenticate here is the same user's permission that is used for executing the AGS API on that environment.
4. The AGS API MCP server should appear in available tools.  There are some bugs in Claude Desktop handling refresh token expiry.  If the tool is not available after succcesful login, just restart Claude Desktop.

## 7. Sample Usage

### 7.1 Example Claude Desktop Conversation

The exact response you get may be different...

```
You: "What AccelByte APIs are available for user management?"

Claude: I'll search for user management APIs in your AccelByte environment.

[Uses search-apis tool to find relevant APIs]

Claude: I found several user management APIs:
- getUserProfile: Get user profile information
- updateUserProfile: Update user profile
- getUserStatItems: Get user statistics
- And more...

You: "Show me details about the getUserProfile API"

Claude: [Uses describe-apis tool to show detailed API documentation]

You: "Get the public info for user 'player123'"

Claude: [Uses run-apis tool to execute the API call with authentication]
```

## Troubleshooting

### Common Issues

#### Server Won't Start
```bash
# Check if port 3000 is in use
lsof -i :3000  # macOS/Linux
netstat -ano | findstr :3000  # Windows

```

#### Authentication Fails
1. Verify your OAuth client credentials in Claude Desktop config
2. Check that `AB_BASE_URL` is correct in `.env`
3. **Redirect URI Mismatch**: Ensure the redirect URI configured in AccelByte IAM exactly matches your `OAUTH_REDIRECT_URI` (default: `http://localhost:3000/oauth/callback`)
   - If they don't match, AccelByte will reject the OAuth callback and authentication will fail
   - Check your AccelByte IAM client settings: **Game Setup** → **Games and Apps** → **IAM Clients** → Your Client → Redirect URI

#### MCP Server Not Appearing in Claude
1. Restart Claude Desktop completely
2. Check Claude Desktop logs for errors
3. Verify the server path is correct in your configuration

### Debug Mode
Enable detailed logging:
```bash
LOG_LEVEL=debug pnpm dev
```

### Clean Up
Clear authentication cache:
```bash
rm -rf ~/.mcp-auth
```

## Next Steps

- **Explore APIs**: Use the search tools to discover available AccelByte APIs
- **Advanced Config**: See `STDIO_CLIENT_CONFIG.md` for detailed configuration

## Support

- **Documentation**: See `README.md` for full documentation
- **Issues**: Open an issue in the repository
- **Logs**: Check server logs for detailed error information

---

**🎉 You're all set!** Your AGS API MCP Server is now running and ready to use with Claude Desktop.
