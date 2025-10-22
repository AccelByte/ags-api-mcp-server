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

1. **Log into your AccelByte Admin Portal**
   - Navigate to your target environment (e.g., test.accelbyte.io/admin)
   - Go to **Game Setup** → **Games and Apps** → **IAM Clients**

2. **Create or Configure OAuth Client**
   - **Client ID**: Note this down (you'll need it later)
   - **Client Types**: Confidential
   - **Client Secret**: Generate and save securely
   - **Grant Types**: Enable "Client Credentials" grant type
   - **Scopes**: Add required scopes (e.g., `openid`, `account`, etc.)

3. **Adjust Token Timeouts** (Optional)
   - **Access Token Expiry**: Set to desired duration
   - **Refresh Token Expiry**: Set to desired duration

4. **Adjust Client ID's Permissions**
   - This step is **important**.  The permission will limit what APIs this server can do.  We recommend to give the least amount of permissions as possible especially if you are planning to share the client credentials with others.



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
# NODE_ENV=development
# LOG_LEVEL=info
```

**That's it!** All other OAuth and OIDC URLs are automatically derived from `AB_BASE_URL`.

### 5. Run the MCP Server
```bash
# Using pnpm (stdio mode is now the default)
pnpm dev
```

The server will connect via stdin/stdout using the MCP protocol. All logs will be redirected to stderr to avoid interfering with the protocol on stdout.

## Troubleshooting

#### Authentication Fails
1. Verify your OAuth client credentials are configured in `.env`
2. Check that `AB_BASE_URL` is correct in `.env`
3. Ensure client credentials grant type is enabled for your OAuth client

#### MCP Server Not Appearing in Claude
1. Restart Claude Desktop completely
2. Check Claude Desktop logs for errors
3. Verify the server is running: `ps aux | grep node`

### Debug Mode
Enable detailed logging:
```bash
LOG_LEVEL=debug pnpm dev
```

## Next Steps

- **Explore APIs**: Use the search tools to discover available AccelByte APIs
- **Advanced Config**: See `README.md` for detailed configuration

## Support

- **Documentation**: See `README.md` for full documentation
- **Issues**: Open an issue in the repository
- **Logs**: Check server logs for detailed error information

---

**🎉 You're all set!** Your AGS API MCP Server is now running and ready to use with Claude Desktop.
