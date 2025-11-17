import jwt from "jsonwebtoken";
import { UserContext } from "../mcp-server.js";
import { logger } from "../logger.js";
import { sessionManager } from "../session-manager.js";
import { otpManager } from "../otp-manager.js";
import { config, serverConfig } from "../config.js";
import { httpServerStatus } from "../http-server-status.js";
import open from "open";

export class StaticTools {
  /**
   * Get token information from the authenticated token
   */
  async getTokenInfo(args?: any, userContext?: UserContext): Promise<object> {
    if (!userContext) {
      throw new Error("User context not available - authentication required");
    }

    if (!userContext.accessToken) {
      throw new Error("Access token not available in user context");
    }

    // Decode the JWT token to get full payload
    let decodedToken: any = null;
    let tokenType = "unknown";
    let isExpired = false;
    let timeUntilExpiry = "unknown";
    let isFromCache = userContext.isFromCache || false;

    // Use stdio session token if available (stdio mode only), otherwise fall back to env var (legacy/HTTP mode)
    const sessionToken =
      userContext.stdioSessionToken || userContext.mcpSessionId;
    let refreshTokenInfo: any = null;

    if (sessionToken) {
      const session = sessionManager.getSession(sessionToken);
      if (session && session.refresh_expires_at) {
        const refreshTimeLeft = session.refresh_expires_at - Date.now();
        const refreshExpired = refreshTimeLeft <= 0;

        refreshTokenInfo = {
          has_refresh_token: !!session.refresh_token,
          refresh_token_expires_at: new Date(
            session.refresh_expires_at,
          ).toISOString(),
          refresh_token_expires_in_minutes: Math.floor(refreshTimeLeft / 60000),
          refresh_token_expired: refreshExpired,
        };

        if (!refreshExpired) {
          const diffMins = Math.floor(refreshTimeLeft / 60000);
          const diffHours = Math.floor(diffMins / 60);
          const diffDays = Math.floor(diffHours / 24);

          if (diffDays > 0) {
            refreshTokenInfo.refresh_token_time_until_expiry = `${diffDays} day(s) ${diffHours % 24} hour(s)`;
          } else if (diffHours > 0) {
            refreshTokenInfo.refresh_token_time_until_expiry = `${diffHours} hour(s) ${diffMins % 60} minute(s)`;
          } else {
            refreshTokenInfo.refresh_token_time_until_expiry = `${diffMins} minute(s)`;
          }
        } else {
          refreshTokenInfo.refresh_token_time_until_expiry = "expired";
        }
      }
    }

    try {
      decodedToken = jwt.decode(userContext.accessToken, { complete: true });

      if (decodedToken && decodedToken.payload) {
        const payload = decodedToken.payload;

        // Determine token type based on claims
        if (
          payload.grant_type === "client_credentials" ||
          (payload.sub && payload.sub.includes("client:")) ||
          (!payload.display_name && payload.client_id)
        ) {
          tokenType = "client_credentials";
        } else if (
          payload.grant_type === "authorization_code" ||
          payload.display_name
        ) {
          tokenType = "user_token";
        } else if (payload.grant_type === "refresh_token") {
          tokenType = "refresh_token";
        }

        // Check expiration
        if (payload.exp) {
          const expiryDate = new Date(payload.exp * 1000);
          const now = new Date();
          isExpired = expiryDate < now;

          if (!isExpired) {
            const diffMs = expiryDate.getTime() - now.getTime();
            const diffMins = Math.floor(diffMs / 60000);
            const diffHours = Math.floor(diffMins / 60);
            const diffDays = Math.floor(diffHours / 24);

            if (diffDays > 0) {
              timeUntilExpiry = `${diffDays} day(s) ${diffHours % 24} hour(s)`;
            } else if (diffHours > 0) {
              timeUntilExpiry = `${diffHours} hour(s) ${diffMins % 60} minute(s)`;
            } else {
              timeUntilExpiry = `${diffMins} minute(s)`;
            }
          } else {
            timeUntilExpiry = "expired";
          }
        }
      }
    } catch (error) {
      logger.warn({ error }, "Failed to decode JWT token");
    }

    const response: any = {
      message: "Token information from authenticated token",
      default_namespace: decodedToken?.payload?.namespace || null,
      namespace_usage_hint: decodedToken?.payload?.namespace
        ? `Use namespace "${decodedToken.payload.namespace}" as the implicit namespace for subsequent API requests when namespace is not explicitly specified`
        : "No namespace available in token",
      tokenMetadata: {
        type: tokenType,
        isExpired,
        isFromCache,
        length: userContext.accessToken.length,
        prefix: userContext.accessToken.substring(0, 20) + "...",
      },
    };

    if (decodedToken && decodedToken.payload) {
      const payload = decodedToken.payload;

      response.tokenClaims = {
        // Standard JWT claims
        issuer: payload.iss,
        subject: payload.sub,
        audience: payload.aud,
        expiresAt: payload.exp
          ? new Date(payload.exp * 1000).toISOString()
          : undefined,
        expiresAtTimestamp: payload.exp,
        issuedAt: payload.iat
          ? new Date(payload.iat * 1000).toISOString()
          : undefined,
        issuedAtTimestamp: payload.iat,
        notBefore: payload.nbf
          ? new Date(payload.nbf * 1000).toISOString()
          : undefined,
        jwtId: payload.jti,

        // Custom claims
        grantType: payload.grant_type,
        clientId: payload.client_id,
        namespace: payload.namespace,
        scope: payload.scope,
        roles: payload.roles,
        permissions: payload.permissions,

        // User-specific claims (if present)
        userId: payload.user_id,
        displayName: payload.display_name,
        country: payload.country,
        dateOfBirth: payload.date_of_birth,
        emailVerified: payload.email_verified,
        phoneVerified: payload.phone_verified,
        isComply: payload.is_comply,

        // Timing information
        timeUntilExpiry,
        isExpired,
      };

      // Add header information
      if (decodedToken.header) {
        response.tokenHeader = {
          algorithm: decodedToken.header.alg,
          type: decodedToken.header.typ,
          keyId: decodedToken.header.kid,
        };
      }
    }

    // Include original user context information for backwards compatibility
    response.userContext = {
      sub: userContext.sub,
      client_id: userContext.client_id,
      scope: userContext.scope,
      namespace: userContext.namespace,
      user: userContext.user,
    };

    // Add refresh token information if available
    if (refreshTokenInfo) {
      response.refreshTokenInfo = refreshTokenInfo;
    }

    return response;
  }

  /**
   * Start OAuth login flow
   * Uses stdio session token (auto-generated) in stdio mode, MCP session ID in HTTP mode
   */
  async startOAuthLogin(
    args?: any,
    userContext?: UserContext,
  ): Promise<object> {
    // Try to get session token from: 1) stdio session token (stdio mode), 2) MCP session ID (HTTP mode)
    const sessionToken =
      userContext?.stdioSessionToken || userContext?.mcpSessionId;

    // Case 1: No session token available - this should not happen in stdio mode anymore
    if (!sessionToken) {
      logger.error(
        "No session token found - this should not happen in stdio or HTTP mode",
      );

      return {
        success: false,
        error: "No session token available",
        message:
          "Internal error: Session token is missing. This should not happen in stdio or HTTP mode.",
        note: "If you are seeing this error, please report it as a bug. In stdio mode, session tokens are auto-generated. In HTTP mode, MCP session IDs are used automatically.",
      };
    }

    // Case 2: Session token available - check session and launch browser
    const source = userContext?.stdioSessionToken
      ? "stdio auto-generated token"
      : "MCP session ID";
    logger.debug(
      {
        sessionToken: sessionToken.substring(0, 8) + "...",
        source,
      },
      "Session token found, checking session status",
    );

    // Get the base URL for the server
    const baseUrl = serverConfig.baseUrl;

    // Check if session already exists and is authenticated
    const existingSession = sessionManager.getSession(sessionToken);

    if (existingSession?.status === "authenticated") {
      logger.debug(
        { sessionToken: sessionToken.substring(0, 8) + "..." },
        "Session already authenticated",
      );
      return {
        success: true,
        already_authenticated: true,
        message: "Your session is already authenticated and ready to use!",
        user: {
          id: existingSession.user_id,
          email: existingSession.user_email,
          name: existingSession.user_name,
        },
        token_expires_at: existingSession.expires_at
          ? new Date(existingSession.expires_at).toISOString()
          : undefined,
        has_refresh_token: !!existingSession.refresh_token,
        hint: "Your MCP tools will now use this authenticated session automatically.",
      };
    }

    // Create or reuse pending session
    if (!existingSession || existingSession.status === "expired") {
      // Register this session token in the session manager
      sessionManager.createSessionWithToken(sessionToken, baseUrl);
      logger.debug(
        { sessionToken: sessionToken.substring(0, 8) + "..." },
        "Created new session with configured token",
      );
    }

    // Generate OTP token for secure URL (prevents session token exposure in logs/URLs)
    const otpToken = otpManager.generateOTP(sessionToken);
    const loginUrl = `${baseUrl}/auth/login?otp_token=${otpToken}`;

    logger.debug(
      {
        sessionToken: sessionToken.substring(0, 8) + "...",
        otpToken: otpToken.substring(0, 8) + "...",
        loginUrl,
      },
      "Generated OTP token for secure OAuth URL",
    );

    // Only auto-launch browser in stdio mode (server runs on user's machine)
    // In HTTP mode, the server might be remote, so browser would open on server, not user's machine
    const isStdioMode = config.transport === "stdio";

    // In stdio mode, check if HTTP server is actually available
    if (isStdioMode) {
      logger.debug(
        {
          available: httpServerStatus.available,
          error: httpServerStatus.error,
          port: httpServerStatus.port,
        },
        "Checking HTTP server status for OAuth login",
      );

      if (!httpServerStatus.available) {
        const errorMsg =
          httpServerStatus.error || "HTTP server is not available";
        const port = httpServerStatus.port || serverConfig.port;

        logger.warn(
          {
            sessionToken: sessionToken.substring(0, 8) + "...",
            error: errorMsg,
            port,
          },
          "OAuth login attempted but HTTP server is not available",
        );

        return {
          success: false,
          error: "HTTP OAuth server is not available",
          message: `OAuth authentication will not work because the HTTP server failed to start. ${errorMsg}.`,
          troubleshooting: [
            `The HTTP server could not start on port ${port}`,
            `To fix this issue, you have two options:`,
            `1. Free up port ${port} by stopping the application using it`,
            `2. Set the PORT environment variable to use a different port (e.g., PORT=3001)`,
            `After fixing the port issue, restart the MCP server`,
          ],
          technical_details: {
            transport_mode: "stdio",
            http_server_status: "unavailable",
            error: errorMsg,
            port,
          },
        };
      }
    }

    if (isStdioMode) {
      // stdio mode: Try to launch browser (server is on user's machine)
      try {
        await open(loginUrl);
        logger.debug(
          {
            sessionToken: sessionToken.substring(0, 8) + "...",
            url: loginUrl,
          },
          "Browser launched for OAuth authentication (stdio mode)",
        );

        return {
          success: true,
          browser_launched: true,
          message:
            "Browser window opened for authentication. Please complete the login process.",
          login_url: loginUrl,
          otp_token: otpToken,
          otp_expires_in: 600, // 10 minutes
          instructions: [
            "1. A browser window should have opened automatically",
            "2. Complete the OAuth authentication in your browser",
            "3. After successful login, you can close the browser window",
            "4. Your MCP tools will immediately start working with your authenticated session",
            "5. OTP token in URL is single-use and expires in 10 minutes",
          ],
          security_note:
            "The URL uses a one-time password token for security. It can only be used once and expires in 10 minutes.",
          note: "If browser did not open automatically, please check your system settings or manually restart the tool.",
        };
      } catch (error) {
        logger.error(
          { error, sessionToken: sessionToken.substring(0, 8) + "..." },
          "Failed to launch browser",
        );

        return {
          success: false,
          browser_launched: false,
          error: "Failed to automatically open browser",
          message:
            "Browser failed to open automatically. The login URL is available in the server logs.",
          login_url: loginUrl,
          otp_token: otpToken,
          otp_expires_in: 600, // 10 minutes
          instructions: [
            '1. Check the server logs for the login URL (look for "Browser launched for OAuth authentication")',
            "2. Manually open the URL in your browser",
            "3. Complete the OAuth authentication",
            "4. After successful login, your MCP tools will work immediately",
            "5. OTP token in URL is single-use and expires in 10 minutes",
          ],
          security_note:
            "The URL uses a one-time password token for security. It can only be used once and expires in 10 minutes.",
          troubleshooting:
            "If you continue to have issues, ensure your system allows the application to open browsers, or check your default browser settings.",
        };
      }
    } else {
      // HTTP mode: Don't auto-launch browser (server might be remote)
      logger.debug(
        {
          sessionToken: sessionToken.substring(0, 8) + "...",
          url: loginUrl,
          transport: config.transport,
        },
        "HTTP mode detected - login URL available in server logs",
      );

      return {
        success: true,
        browser_launched: false,
        message:
          "HTTP mode detected. Please check the server logs for the authentication URL.",
        login_url: loginUrl,
        otp_token: otpToken,
        otp_expires_in: 600, // 10 minutes
        instructions: [
          "1. Check the server logs for the login URL",
          "2. Open the URL in your browser on your local machine",
          "3. Complete the OAuth authentication",
          "4. After successful login, your MCP tools will work immediately",
          "5. OTP token in URL is single-use and expires in 10 minutes",
        ],
        security_note:
          "The URL uses a one-time password token for security. It can only be used once and expires in 10 minutes.",
        note: "Browser auto-launch is only available in stdio mode. In HTTP mode with a remote server, you need to manually access the URL from your local browser.",
      };
    }
  }

  /**
   * Logout current OAuth session
   * Clears access and refresh tokens for the current session
   */
  async logout(args?: any, userContext?: UserContext): Promise<object> {
    // Try to get session token from: 1) stdio session token (stdio mode), 2) MCP session ID (HTTP mode)
    const sessionToken =
      userContext?.stdioSessionToken || userContext?.mcpSessionId;

    // Case 1: No session token available
    if (!sessionToken) {
      logger.error("No session token found for logout");

      return {
        success: false,
        error: "No session token available",
        message:
          "Cannot logout: No active session found. This should not happen in stdio or HTTP mode.",
      };
    }

    // Case 2: Session token available - logout the session
    logger.debug(
      {
        sessionToken: sessionToken.substring(0, 8) + "...",
      },
      "Logout requested",
    );

    const success = sessionManager.logout(sessionToken);

    if (success) {
      const session = sessionManager.getSession(sessionToken);

      return {
        success: true,
        message:
          "Successfully logged out. Your access and refresh tokens have been cleared.",
        session_status: session?.status || "expired",
        note: "You will need to authenticate again using start_oauth_login to access protected APIs.",
      };
    } else {
      return {
        success: false,
        error: "Session not found",
        message:
          "No active session found to logout. You may already be logged out.",
      };
    }
  }
}
