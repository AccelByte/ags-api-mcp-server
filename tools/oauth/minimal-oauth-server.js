#!/usr/bin/env node
/**
 * Minimal OAuth Server for Testing MCP_HOSTED Feature
 *
 * This is a bare minimum OAuth 2.0 authorization server that can be used
 * to test the MCP server with MCP_HOSTED=true.
 *
 * ⚠️ SECURITY WARNINGS
 *
 * This is a TESTING-ONLY server. Do NOT use in production!
 *
 * - In-memory storage: All data (authorization codes, tokens, clients) is stored
 *   in memory and will be lost on restart
 * - No persistence: No database, no file storage - everything is ephemeral
 * - No security hardening: Missing production features like:
 *   - Rate limiting
 *   - CSRF protection
 *   - Input validation/sanitization
 *   - Secure password storage (passwords are stored in plain text)
 *   - Token rotation/revocation
 *   - Audit logging
 *   - Security headers (CSP, HSTS, etc.)
 * - Hardcoded credentials: Default test credentials are hardcoded
 * - Memory leaks: In-memory Maps will grow indefinitely in long-running servers
 *   (acceptable for testing)
 * - No TLS enforcement: Designed for localhost/testing only
 *
 * For production use, implement a proper OAuth 2.0 authorization server with:
 * - Database persistence
 * - Proper security measures
 * - Token lifecycle management
 * - Audit logging
 * - Rate limiting
 * - CSRF protection
 *
 * FEATURES
 *
 * - OAuth 2.0 Authorization Code flow with PKCE support
 * - JWT access token issuance
 * - Refresh token support
 * - OAuth discovery endpoints (.well-known/oauth-authorization-server)
 * - Simple login and consent pages
 * - Dynamic Client Registration (DCR) - RFC 7591
 * - Minimal implementation suitable for testing
 *
 * QUICK START
 *
 * Option 1: Run with Docker Compose (Recommended)
 *
 *   # From project root
 *   docker-compose -f tools/oauth/docker-compose.yml up -d
 *
 *   # Or from tools/oauth directory
 *   cd tools/oauth && docker-compose up -d
 *
 * Option 2: Run Directly with Node.js
 *
 *   PORT=3001 node tools/oauth/minimal-oauth-server.js
 *
 * Option 3: Run OAuth Server Only with Docker
 *
 *   docker build -t minimal-oauth-server -f tools/oauth/Dockerfile.oauth tools/oauth
 *   docker run -d --name minimal-oauth-server -p 3001:3001 \
 *     -e ISSUER_URL=https://your-domain.com minimal-oauth-server
 *
 * CONFIGURATION
 *
 * Environment Variables:
 *
 *   PORT                    - Port to run the server on (default: 3001)
 *   ISSUER_URL             - Base URL of the OAuth server (default: http://localhost:3001)
 *   CLIENT_ID              - OAuth client ID (default: test-client)
 *   CLIENT_SECRET          - OAuth client secret (default: test-secret)
 *   JWT_SECRET             - Secret for signing JWTs (default: test-jwt-secret-change-in-production)
 *
 * TEST CREDENTIALS
 *
 * ⚠️ WARNING: These are hardcoded test credentials for development/testing only.
 * Never use these in production!
 *
 * - Client ID: test-client (set via CLIENT_ID env var)
 * - Client Secret: test-secret (set via CLIENT_SECRET env var)
 * - Username: test-user (hardcoded)
 * - Password: test123 (hardcoded)
 *
 * ENDPOINTS
 *
 * Discovery:
 *   GET /.well-known/oauth-authorization-server  - OAuth server metadata
 *   GET /.well-known/jwks.json                   - JSON Web Key Set
 *
 * OAuth:
 *   GET  /oauth/authorize                        - Authorization endpoint (shows login/consent page)
 *   POST /oauth/authorize                        - Handle login/consent submission
 *   POST /oauth/token                            - Token endpoint (exchange code for tokens, refresh tokens)
 *
 * Dynamic Client Registration (DCR) - RFC 7591:
 *   POST   /oauth/register                      - Register a new OAuth client
 *   GET    /oauth/register/:clientId           - Get registered client information
 *   PUT    /oauth/register/:clientId            - Update registered client
 *   DELETE /oauth/register/:clientId           - Delete registered client
 *
 * Health:
 *   GET /health                                  - Health check endpoint
 *
 * USING WITH MCP SERVER
 *
 * Important: Hosted Mode Behavior
 *
 * When MCP_HOSTED=true, the MCP server derives the authorization server URL from
 * the request host header. This means:
 *
 * - If your MCP server is accessed at https://mcp.yourdomain.com, it expects the
 *   OAuth server to be accessible at the same hostname (https://mcp.yourdomain.com)
 * - The OAuth server's ISSUER_URL must match the request hostname
 * - Tokens issued by the OAuth server must have an 'iss' claim matching the hostname
 *
 * Deployment Options:
 *
 * 1. Reverse Proxy (Recommended)
 *    Use a reverse proxy (nginx, Traefik, etc.) to route requests:
 *    - /mcp → MCP server
 *    - /oauth/* → OAuth server
 *    - /.well-known/* → OAuth server
 *
 *    See tools/oauth/nginx.docker.conf for an example nginx configuration.
 *
 * 2. Docker Compose with Reverse Proxy
 *    See tools/oauth/docker-compose.yml for the complete setup.
 *
 * MCP Server Configuration:
 *
 *   MCP_HOSTED=true
 *   MCP_VALIDATE_TOKEN_ISSUER=false  # Optional: validates token issuer matches request host
 *   AB_BASE_URL=http://localhost:8080  # Should match the public hostname
 *
 * DYNAMIC CLIENT REGISTRATION (DCR)
 *
 * The server supports Dynamic Client Registration (RFC 7591), allowing clients to
 * register themselves dynamically.
 *
 * Example: Register a new client
 *
 *   curl -X POST http://localhost:3001/oauth/register \
 *     -H "Content-Type: application/json" \
 *     -d '{
 *       "redirect_uris": ["https://myapp.com/callback"],
 *       "client_name": "My Application",
 *       "scope": "account commerce",
 *       "grant_types": ["authorization_code"],
 *       "response_types": ["code"]
 *     }'
 *
 * OAUTH FLOW EXAMPLE
 *
 * 1. Authorization Request:
 *    GET /oauth/authorize?client_id=test-client&redirect_uri=...&response_type=code&scope=account&code_challenge=...&code_challenge_method=S256&state=...
 *
 * 2. User Login/Consent: User logs in and approves the request
 *
 * 3. Authorization Code: User is redirected back with an authorization code
 *
 * 4. Token Exchange:
 *    POST /oauth/token
 *    Content-Type: application/x-www-form-urlencoded
 *    Authorization: Basic base64(client_id:client_secret)
 *
 *    grant_type=authorization_code&code=...&redirect_uri=...&code_verifier=...
 *
 * 5. Access Token: Server returns access token and refresh token
 *
 * LIMITATIONS
 *
 * ⚠️ This is a minimal server for testing only!
 *
 * - No database persistence (all data stored in memory)
 * - No password hashing (passwords stored in plain text)
 * - No proper PKCE validation (simplified implementation)
 * - No token revocation
 * - No rate limiting
 * - No proper security headers
 * - Uses HS256 JWT signing (should use RS256 in production)
 *
 * Do NOT use this in production! This is only for testing the MCP_HOSTED feature.
 *
 * PRODUCTION CONSIDERATIONS
 *
 * For production use, you should:
 *
 * 1. Use a proper OAuth server (e.g., Keycloak, Auth0, Okta, or AccelByte IAM)
 * 2. Implement proper database persistence
 * 3. Use RS256 JWT signing with proper key management
 * 4. Implement token revocation
 * 5. Add rate limiting and security headers
 * 6. Use proper password hashing
 * 7. Implement proper PKCE validation
 * 8. Add logging and monitoring
 *
 * TROUBLESHOOTING
 *
 * Token Issuer Validation Fails:
 *   - Make sure ISSUER_URL matches the public URL of your OAuth server
 *   - Check that the token's 'iss' claim matches the expected issuer
 *   - Verify the request host header matches the issuer URL
 *
 * Discovery Endpoint Not Found:
 *   curl http://localhost:3001/.well-known/oauth-authorization-server
 *
 * CORS Issues:
 *   CORS is already enabled by default. If you encounter issues, check the CORS
 *   configuration in the code.
 */

import express from "express";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import cookieParser from "cookie-parser";
import cors from "cors";

const PORT = parseInt(process.env.PORT || "3001", 10);
const ISSUER_URL = process.env.ISSUER_URL || `http://localhost:${PORT}`;
const CLIENT_ID = process.env.CLIENT_ID || "test-client";
const CLIENT_SECRET = process.env.CLIENT_SECRET || "test-secret";
const JWT_SECRET =
  process.env.JWT_SECRET || "test-jwt-secret-change-in-production";

const app = express();
app.use(cors());
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// In-memory storage (for testing only - use a database in production)
// NOTE: These Maps will grow indefinitely in long-running servers. For production,
// implement TTL-based expiration or periodic cleanup. This is acceptable for testing.
const authorizationCodes = new Map(); // code -> { clientId, codeChallenge, codeVerifier, redirectUri, userId, scope, expiresAt }
const refreshTokens = new Map(); // refreshToken -> { userId, clientId, scope }
const registeredClients = new Map(); // clientId -> { clientId, clientSecret, redirectUris, scopes, ... }
const processedApprovals = new Map(); // requestKey -> timestamp (to prevent duplicate redirects, auto-expires after 60s)

// Mock user database (for testing only)
const users = {
  "test-user": {
    id: "test-user",
    email: "test@example.com",
    name: "Test User",
    password: "test123", // In production, use proper password hashing
  },
};

// Helper: Generate random string
function generateRandomString(length = 32) {
  return crypto.randomBytes(length).toString("base64url");
}

// Helper: Generate code challenge from verifier
function generateCodeChallenge(verifier) {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}

// Helper: Create JWT access token
function createAccessToken(
  userId,
  clientId,
  scope = "account commerce social",
) {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    {
      iss: ISSUER_URL,
      sub: userId,
      aud: clientId,
      exp: now + 3600, // 1 hour
      iat: now,
      scope,
      client_id: clientId,
      grant_type: "authorization_code",
      namespace: "accelbyte",
      user_id: userId,
      display_name: users[userId]?.name || "Test User",
      roles: [],
      permissions: [],
    },
    JWT_SECRET,
    { algorithm: "HS256" },
  );
}

// Helper: Create JWT refresh token (as a simple token, not JWT)
function createRefreshToken() {
  return generateRandomString(64);
}

// Helper: Handle redirects for both HTTP and custom protocol schemes
function handleRedirect(res, redirectUri, params) {
  try {
    // Check if response already sent
    if (res.headersSent) {
      return;
    }

    const url = new URL(redirectUri);
    const protocol = url.protocol.toLowerCase();
    const fullUri = `${redirectUri}?${params.toString()}`;

    if (protocol === "http:" || protocol === "https:") {
      // Standard HTTP redirect
      res.redirect(fullUri);
    } else {
      // Custom protocol scheme (e.g., cursor://) - use HTML/JS redirect
      // Set content type and status explicitly
      res.status(200);
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>Authorization Successful - Redirecting...</title>
          <style>
            body { 
              font-family: Arial, sans-serif; 
              max-width: 600px; 
              margin: 50px auto; 
              padding: 20px; 
              text-align: center;
            }
            .success { 
              color: #28a745; 
              background: #d4edda; 
              padding: 20px; 
              border-radius: 5px; 
              margin: 20px 0;
            }
            a {
              display: inline-block;
              background: #28a745;
              color: white;
              padding: 15px 30px;
              text-decoration: none;
              border-radius: 5px;
              margin: 20px 0;
              font-size: 18px;
            }
            a:hover {
              background: #218838;
            }
          </style>
        </head>
        <body>
          <h1>✅ Authorization Successful!</h1>
          <div class="success">
            <p><strong>You have successfully authorized the application.</strong></p>
            <p>You should be redirected automatically. If not, click the button below.</p>
          </div>
          
          <a href="${fullUri.replace(/"/g, "&quot;")}" id="redirect-link" style="display: block; margin: 20px auto;">
            Open in Application
          </a>
          
          <script>
            (function() {
              const redirectUri = ${JSON.stringify(fullUri)};
              
              // Immediate redirect attempt
              try {
                window.location.href = redirectUri;
              } catch (e) {
                // Fallback: try clicking the link
                setTimeout(function() {
                  const link = document.getElementById("redirect-link");
                  if (link) {
                    link.click();
                  }
                }, 100);
              }
            })();
          </script>
        </body>
        </html>
      `);
    }
  } catch (e) {
    // If URL parsing fails, try HTTP redirect anyway
    const fullUri = `${redirectUri}?${params.toString()}`;
    res.redirect(fullUri);
  }
}

// ============================================================================
// Discovery Endpoints
// ============================================================================

// OAuth Authorization Server Metadata (RFC 8414)
app.get("/.well-known/oauth-authorization-server", (req, res) => {
  const baseUrl = ISSUER_URL;
  res.json({
    issuer: baseUrl,
    authorization_endpoint: `${baseUrl}/oauth/authorize`,
    token_endpoint: `${baseUrl}/oauth/token`,
    registration_endpoint: `${baseUrl}/oauth/register`,
    jwks_uri: `${baseUrl}/.well-known/jwks.json`,
    scopes_supported: [
      "account",
      "commerce",
      "social",
      "publishing",
      "analytics",
    ],
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: [
      "client_secret_basic",
      "client_secret_post",
    ],
    registration_endpoint_auth_methods_supported: ["none"],
  });
});

// JWKs endpoint (for token validation)
app.get("/.well-known/jwks.json", (req, res) => {
  // For HS256, we don't expose the secret, but we provide a minimal JWKs response
  // In production with RS256, you'd expose the public key here
  res.json({
    keys: [
      {
        kty: "oct",
        use: "sig",
        alg: "HS256",
        // Note: For HS256, the key is symmetric and shouldn't be exposed
        // This is just for testing. Use RS256 in production.
      },
    ],
  });
});

// ============================================================================
// OAuth Endpoints
// ============================================================================

// Authorization endpoint
app.get("/oauth/authorize", (req, res) => {
  const {
    client_id,
    redirect_uri,
    response_type,
    scope,
    state,
    code_challenge,
    code_challenge_method,
  } = req.query;

  // Check if client is registered via DCR or is the default test client
  const registeredClient = registeredClients.get(client_id);
  const isValidClient = registeredClient || client_id === CLIENT_ID;

  // Validate required parameters
  // Note: For user-facing flows, we could return HTML errors, but for consistency
  // with OAuth 2.0 spec and programmatic clients, we return JSON errors here.
  // User-facing errors (login/consent) are handled in the POST handler with HTML.
  if (!isValidClient) {
    return res
      .status(400)
      .json({
        error: "invalid_client",
        error_description: "Invalid client_id",
      });
  }

  if (response_type !== "code") {
    return res
      .status(400)
      .json({
        error: "unsupported_response_type",
        error_description: "Only 'code' response type is supported",
      });
  }

  if (!redirect_uri) {
    return res
      .status(400)
      .json({
        error: "invalid_request",
        error_description: "redirect_uri is required",
      });
  }

  if (code_challenge_method && code_challenge_method !== "S256") {
    return res
      .status(400)
      .json({
        error: "invalid_request",
        error_description: "Only S256 code challenge method is supported",
      });
  }

  // Check if user is already authenticated (via session/cookie)
  // For simplicity, we'll always show the login/consent page
  const userId = req.query.user_id || req.cookies?.user_id;

  if (!userId) {
    // Show login page
    return res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>OAuth Login</title>
        <style>
          body { font-family: Arial, sans-serif; max-width: 400px; margin: 50px auto; padding: 20px; }
          input { width: 100%; padding: 10px; margin: 10px 0; box-sizing: border-box; }
          button { width: 100%; padding: 10px; background: #007bff; color: white; border: none; cursor: pointer; }
          button:hover { background: #0056b3; }
        </style>
      </head>
      <body>
        <h2>OAuth Login</h2>
        <form method="POST" action="/oauth/authorize">
          ${Object.keys(req.query)
            .map(
              (key) =>
                `<input type="hidden" name="${key}" value="${req.query[key]}">`,
            )
            .join("")}
          <input type="text" name="username" placeholder="Username" value="test-user" required>
          <input type="password" name="password" placeholder="Password" value="test123" required>
          <button type="submit">Login</button>
        </form>
        <p><small>Default: test-user / test123</small></p>
      </body>
      </html>
    `);
  }

  // Show consent page
  const scopes = (scope || "account").split(" ");
  return res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Authorize Application</title>
      <style>
        body { font-family: Arial, sans-serif; max-width: 400px; margin: 50px auto; padding: 20px; }
        button { width: 100%; padding: 10px; margin: 5px 0; cursor: pointer; }
        .approve { background: #28a745; color: white; border: none; }
        .deny { background: #dc3545; color: white; border: none; }
        button:hover { opacity: 0.9; }
      </style>
    </head>
    <body>
      <h2>Authorize Application</h2>
      <p><strong>${client_id}</strong> wants to access:</p>
      <ul>
        ${scopes.map((s) => `<li>${s}</li>`).join("")}
      </ul>
      <form method="POST" action="/oauth/authorize" id="consent-form">
        ${Object.keys(req.query)
          .filter((key) => key !== "user_id" && key !== "action")
          .map((key) => {
            const value = req.query[key];
            const safeValue =
              typeof value === "string"
                ? value.replace(/"/g, "&quot;").replace(/&/g, "&amp;")
                : value;
            return `<input type="hidden" name="${key}" value="${safeValue}">`;
          })
          .join("")}
        <input type="hidden" name="user_id" value="${userId}">
        <input type="hidden" name="action" id="action-input" value="">
        <button type="button" class="approve" id="approve-btn">Approve</button>
        <button type="button" class="deny" id="deny-btn">Deny</button>
      </form>
      <script>
        // Prevent duplicate submissions
        let submitted = false;
        const form = document.getElementById('consent-form');
        const approveBtn = document.getElementById('approve-btn');
        const denyBtn = document.getElementById('deny-btn');
        const actionInput = document.getElementById('action-input');
        
        approveBtn.addEventListener('click', function() {
          if (submitted) return;
          actionInput.value = 'approve';
          submitted = true;
          approveBtn.disabled = true;
          denyBtn.disabled = true;
          form.submit();
        });
        
        denyBtn.addEventListener('click', function() {
          if (submitted) return;
          actionInput.value = 'deny';
          submitted = true;
          approveBtn.disabled = true;
          denyBtn.disabled = true;
          form.submit();
        });
      </script>
    </body>
    </html>
  `);
});

// Handle authorization POST (login/consent)
app.post("/oauth/authorize", (req, res) => {
  const {
    client_id,
    redirect_uri,
    response_type,
    scope,
    state,
    code_challenge,
    code_challenge_method,
    username,
    password,
    user_id,
    action,
  } = req.body || {};

  // Handle duplicate action values (if form was submitted multiple times or has duplicates)
  const actionValue = Array.isArray(action)
    ? action[action.length - 1]
    : action;

  // Handle consent FIRST (if action is present, it's a consent decision, not a login)
  if (actionValue === "deny") {
    const errorParams = new URLSearchParams({
      error: "access_denied",
      error_description: "User denied the request",
      ...(state && { state }),
    });
    return handleRedirect(res, redirect_uri, errorParams);
  }

  if (actionValue === "approve" && user_id) {
    // Check if we've already processed this request (prevent duplicate redirects)
    const requestKey = `${client_id}:${redirect_uri}:${user_id}:${state || ""}`;
    if (processedApprovals.has(requestKey)) {
      return res.status(400).send(`
        <!DOCTYPE html>
        <html>
        <head><title>Already Processed</title></head>
        <body>
          <h2>Request Already Processed</h2>
          <p>This authorization request has already been processed. Please start a new authorization request.</p>
        </body>
        </html>
      `);
    }

    // Generate authorization code
    const code = generateRandomString(32);
    const codeVerifier = code_challenge ? generateRandomString(32) : null;

    // Store authorization code
    authorizationCodes.set(code, {
      clientId: client_id,
      codeChallenge: code_challenge || null,
      codeVerifier,
      redirectUri: redirect_uri,
      userId: user_id,
      scope: scope || "account",
      expiresAt: Date.now() + 600000, // 10 minutes
    });

    // Mark this approval as processed (expire after 1 minute)
    processedApprovals.set(requestKey, Date.now());
    setTimeout(() => processedApprovals.delete(requestKey), 60000);

    // Redirect with authorization code
    const params = new URLSearchParams({
      code,
      ...(state && { state }),
    });

    // Ensure response hasn't been sent yet
    if (res.headersSent) {
      return;
    }

    return handleRedirect(res, redirect_uri, params);
  }

  // Handle login (only if no action was specified)
  if (username && password && !actionValue) {
    const user = Object.values(users).find(
      (u) => u.id === username && u.password === password,
    );

    if (!user) {
      return res.status(401).send(`
        <!DOCTYPE html>
        <html>
        <head><title>Login Failed</title></head>
        <body>
          <h2>Login Failed</h2>
          <p>Invalid username or password.</p>
          <a href="/oauth/authorize?${new URLSearchParams(req.body).toString()}">Try again</a>
        </body>
        </html>
      `);
    }

    // Redirect back to authorization with user_id
    const params = new URLSearchParams(req.body);
    params.set("user_id", user.id);
    return res.redirect(`/oauth/authorize?${params.toString()}`);
  }

  // If we get here, it's an invalid request
  // Return HTML error page instead of JSON for better UX
  return res.status(400).send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Authorization Error</title>
      <style>
        body { font-family: Arial, sans-serif; max-width: 500px; margin: 50px auto; padding: 20px; }
        .error { color: #dc3545; background: #f8d7da; padding: 15px; border-radius: 5px; }
      </style>
    </head>
    <body>
      <h2>Authorization Error</h2>
      <div class="error">
        <p><strong>Error:</strong> Invalid request</p>
        <p>Action: ${actionValue || "missing"}</p>
        <p>User ID: ${user_id ? "present" : "missing"}</p>
        <p>Redirect URI: ${redirect_uri || "missing"}</p>
      </div>
      <p><a href="/oauth/authorize?${new URLSearchParams(req.query || {}).toString()}">Try again</a></p>
    </body>
    </html>
  `);
});

// Token endpoint
app.post("/oauth/token", (req, res) => {
  const grantType = req.body.grant_type;
  const authHeader = req.headers.authorization;

  // Extract client credentials from Basic Auth or body
  let clientId, clientSecret;
  if (authHeader?.startsWith("Basic ")) {
    const credentials = Buffer.from(authHeader.slice(6), "base64").toString();
    [clientId, clientSecret] = credentials.split(":");
  } else {
    clientId = req.body.client_id;
    clientSecret = req.body.client_secret;
  }

  // Check if client is registered via DCR
  const registeredClient = registeredClients.get(clientId);
  const isValidClient = registeredClient
    ? registeredClient.client_secret === clientSecret
    : clientId === CLIENT_ID && clientSecret === CLIENT_SECRET;

  // Validate client credentials
  if (!isValidClient) {
    return res
      .status(401)
      .json({
        error: "invalid_client",
        error_description: "Invalid client credentials",
      });
  }

  if (grantType === "authorization_code") {
    const { code, redirect_uri, code_verifier } = req.body;

    if (!code) {
      return res
        .status(400)
        .json({
          error: "invalid_request",
          error_description: "code is required",
        });
    }

    const authCode = authorizationCodes.get(code);

    if (!authCode) {
      return res
        .status(400)
        .json({
          error: "invalid_grant",
          error_description: "Invalid authorization code",
        });
    }

    // Check expiration
    if (authCode.expiresAt < Date.now()) {
      authorizationCodes.delete(code);
      return res
        .status(400)
        .json({
          error: "invalid_grant",
          error_description: "Authorization code expired",
        });
    }

    // Validate redirect URI (allow case-insensitive comparison for custom protocols)
    const normalizedStored = authCode.redirectUri.toLowerCase();
    const normalizedProvided = redirect_uri.toLowerCase();
    if (normalizedStored !== normalizedProvided) {
      return res
        .status(400)
        .json({
          error: "invalid_grant",
          error_description: "redirect_uri mismatch",
        });
    }

    // Validate PKCE
    if (authCode.codeChallenge) {
      if (!code_verifier) {
        return res
          .status(400)
          .json({
            error: "invalid_request",
            error_description: "code_verifier is required",
          });
      }
      const expectedChallenge = generateCodeChallenge(code_verifier);
      if (expectedChallenge !== authCode.codeChallenge) {
        return res
          .status(400)
          .json({
            error: "invalid_grant",
            error_description: "Invalid code_verifier",
          });
      }
    }

    // Generate tokens
    const accessToken = createAccessToken(
      authCode.userId,
      authCode.clientId,
      authCode.scope,
    );
    const refreshToken = createRefreshToken();

    // Store refresh token
    refreshTokens.set(refreshToken, {
      userId: authCode.userId,
      clientId: authCode.clientId,
      scope: authCode.scope,
    });

    // Delete authorization code (one-time use)
    authorizationCodes.delete(code);

    res.json({
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: 3600,
      refresh_token: refreshToken,
      scope: authCode.scope,
    });
  } else if (grantType === "refresh_token") {
    const { refresh_token } = req.body;

    if (!refresh_token) {
      return res
        .status(400)
        .json({
          error: "invalid_request",
          error_description: "refresh_token is required",
        });
    }

    const refreshTokenData = refreshTokens.get(refresh_token);

    if (!refreshTokenData) {
      return res
        .status(400)
        .json({
          error: "invalid_grant",
          error_description: "Invalid refresh token",
        });
    }

    // Generate new access token
    const accessToken = createAccessToken(
      refreshTokenData.userId,
      refreshTokenData.clientId,
      refreshTokenData.scope,
    );

    res.json({
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: 3600,
      scope: refreshTokenData.scope,
    });
  } else {
    res.status(400).json({ error: "unsupported_grant_type" });
  }
});

// ============================================================================
// Dynamic Client Registration (DCR) - RFC 7591
// ============================================================================

// Register a new OAuth client
app.post("/oauth/register", (req, res) => {
  const {
    redirect_uris,
    token_endpoint_auth_method = "client_secret_basic",
    grant_types = ["authorization_code"],
    response_types = ["code"],
    client_name,
    client_uri,
    logo_uri,
    scope,
    contacts,
    tos_uri,
    policy_uri,
    software_id,
    software_version,
  } = req.body;

  // Validate required fields
  if (
    !redirect_uris ||
    !Array.isArray(redirect_uris) ||
    redirect_uris.length === 0
  ) {
    return res.status(400).json({
      error: "invalid_redirect_uri",
      error_description:
        "redirect_uris is required and must be a non-empty array",
    });
  }

  // Validate redirect URIs
  // Allow http://, https://, and custom protocol schemes (e.g., cursor://, file://)
  for (const uri of redirect_uris) {
    try {
      const url = new URL(uri);
      // Allow standard HTTP protocols and custom protocol schemes (for desktop apps)
      // Custom protocols are common for desktop/mobile apps (e.g., cursor://, myapp://)
      const protocol = url.protocol.toLowerCase();
      if (protocol !== "http:" && protocol !== "https:") {
        // For custom protocols, just validate it's a well-formed URL
        // Don't reject it - desktop apps commonly use custom schemes
        if (!protocol.endsWith(":")) {
          return res.status(400).json({
            error: "invalid_redirect_uri",
            error_description: `Invalid redirect URI protocol: ${uri}`,
          });
        }
        // Custom protocol is valid, continue
        continue;
      }
    } catch (e) {
      return res.status(400).json({
        error: "invalid_redirect_uri",
        error_description: `Invalid redirect URI format: ${uri}`,
      });
    }
  }

  // Generate client credentials
  const clientId = `client_${generateRandomString(16)}`;
  const clientSecret = generateRandomString(32);

  // Store registered client
  const clientInfo = {
    client_id: clientId,
    client_secret: clientSecret,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    client_secret_expires_at: 0, // 0 means never expires
    redirect_uris,
    token_endpoint_auth_method,
    grant_types,
    response_types,
    client_name: client_name || `Client ${clientId}`,
    client_uri,
    logo_uri,
    scope: scope || "account commerce social",
    contacts: contacts || [],
    tos_uri,
    policy_uri,
    software_id,
    software_version,
  };

  registeredClients.set(clientId, clientInfo);

  // Return client registration response (RFC 7591)
  res.status(201).json({
    client_id: clientId,
    client_secret: clientSecret,
    client_id_issued_at: clientInfo.client_id_issued_at,
    client_secret_expires_at: 0,
    redirect_uris,
    token_endpoint_auth_method,
    grant_types,
    response_types,
    ...(client_name && { client_name }),
    ...(client_uri && { client_uri }),
    ...(logo_uri && { logo_uri }),
    ...(scope && { scope }),
    ...(contacts && contacts.length > 0 && { contacts }),
    ...(tos_uri && { tos_uri }),
    ...(policy_uri && { policy_uri }),
    ...(software_id && { software_id }),
    ...(software_version && { software_version }),
  });
});

// Get registered client information
app.get("/oauth/register/:clientId", (req, res) => {
  const { clientId } = req.params;
  const client = registeredClients.get(clientId);

  if (!client) {
    return res.status(404).json({
      error: "invalid_client",
      error_description: "Client not found",
    });
  }

  // Return client info without secret (for GET requests)
  const { client_secret, ...clientInfo } = client;
  res.json(clientInfo);
});

// Update registered client
app.put("/oauth/register/:clientId", (req, res) => {
  const { clientId } = req.params;
  const client = registeredClients.get(clientId);

  if (!client) {
    return res.status(404).json({
      error: "invalid_client",
      error_description: "Client not found",
    });
  }

  // Validate client secret if provided
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    const providedSecret = authHeader.slice(7);
    if (providedSecret !== client.client_secret) {
      return res.status(401).json({
        error: "invalid_client",
        error_description: "Invalid client secret",
      });
    }
  } else {
    // Try client_secret in body
    if (
      req.body.client_secret &&
      req.body.client_secret !== client.client_secret
    ) {
      return res.status(401).json({
        error: "invalid_client",
        error_description: "Invalid client secret",
      });
    }
  }

  // Update client information
  const {
    redirect_uris,
    token_endpoint_auth_method,
    grant_types,
    response_types,
    client_name,
    client_uri,
    logo_uri,
    scope,
    contacts,
    tos_uri,
    policy_uri,
  } = req.body;

  if (redirect_uris) {
    // Validate redirect URIs
    for (const uri of redirect_uris) {
      try {
        const url = new URL(uri);
        if (url.protocol !== "http:" && url.protocol !== "https:") {
          return res.status(400).json({
            error: "invalid_redirect_uri",
            error_description: `Invalid redirect URI protocol: ${uri}`,
          });
        }
      } catch (e) {
        return res.status(400).json({
          error: "invalid_redirect_uri",
          error_description: `Invalid redirect URI format: ${uri}`,
        });
      }
    }
    client.redirect_uris = redirect_uris;
  }

  if (token_endpoint_auth_method)
    client.token_endpoint_auth_method = token_endpoint_auth_method;
  if (grant_types) client.grant_types = grant_types;
  if (response_types) client.response_types = response_types;
  if (client_name) client.client_name = client_name;
  if (client_uri !== undefined) client.client_uri = client_uri;
  if (logo_uri !== undefined) client.logo_uri = logo_uri;
  if (scope) client.scope = scope;
  if (contacts) client.contacts = contacts;
  if (tos_uri !== undefined) client.tos_uri = tos_uri;
  if (policy_uri !== undefined) client.policy_uri = policy_uri;

  registeredClients.set(clientId, client);

  // Return updated client info
  const { client_secret, ...clientInfo } = client;
  res.json(clientInfo);
});

// Delete registered client
app.delete("/oauth/register/:clientId", (req, res) => {
  const { clientId } = req.params;
  const client = registeredClients.get(clientId);

  if (!client) {
    return res.status(404).json({
      error: "invalid_client",
      error_description: "Client not found",
    });
  }

  // Validate client secret
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    const providedSecret = authHeader.slice(7);
    if (providedSecret !== client.client_secret) {
      return res.status(401).json({
        error: "invalid_client",
        error_description: "Invalid client secret",
      });
    }
  } else if (
    req.body.client_secret &&
    req.body.client_secret !== client.client_secret
  ) {
    return res.status(401).json({
      error: "invalid_client",
      error_description: "Invalid client secret",
    });
  }

  registeredClients.delete(clientId);
  res.status(204).send();
});

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "minimal-oauth-server" });
});

// Start server
app.listen(PORT, () => {
  console.log(`Minimal OAuth Server running on ${ISSUER_URL}`);
  console.log(
    `Discovery: ${ISSUER_URL}/.well-known/oauth-authorization-server`,
  );
  console.log(`Authorization: ${ISSUER_URL}/oauth/authorize`);
  console.log(`Token: ${ISSUER_URL}/oauth/token`);
  console.log(`Registration (DCR): ${ISSUER_URL}/oauth/register`);
  console.log(`\nTest credentials:`);
  console.log(`  Client ID: ${CLIENT_ID}`);
  console.log(`  Client Secret: ${CLIENT_SECRET}`);
  console.log(`  Username: test-user`);
  console.log(`  Password: test123`);
});
