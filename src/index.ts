import express from "express";
import http from "http";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { MCPServer, Resource } from "./mcp-server.js";
import { OAuthMiddleware } from "./oauth-middleware.js";
import { StaticTools } from "./tools/static-tools.js";
import { OpenApiTools } from "./tools/openapi-tools.js";
import { logger } from "./logger.js";
import {
  config,
  serverConfig,
  oauthConfig,
  oidcConfig,
  openApiConfig,
} from "./config.js";
import { StdioMCPServer } from "./stdio-server.js";
import { StreamableHTTPTransport } from "./streamable-http.js";
import { httpServerStatus } from "./http-server-status.js";


let stdioServer: StdioMCPServer | null = null;
let httpServer: any = null;
let globalStreamableHttp: StreamableHTTPTransport | undefined;

// Re-export httpServerStatus for backward compatibility
export { httpServerStatus };

// Start server based on transport configuration
if (config.transport === "stdio") {
  logger.info("Starting MCP Server in stdio mode");
  stdioServer = new StdioMCPServer();

  // Register resources for stdio mode
  registerResources(stdioServer);

  stdioServer.start().catch((error: unknown) => {
    logger.fatal({ error }, "Failed to start stdio MCP server");
    process.exit(1);
  });

  // Always start HTTP server for OAuth routes in stdio mode
  // Session token is auto-generated and managed by StdioMCPServer
  const sessionToken = stdioServer.getSessionToken();
  logger.info(
    {
      sessionToken: sessionToken.substring(0, 8) + "...",
      port: serverConfig.port,
    },
    "Attempting to start HTTP server for OAuth authentication routes (stdio mode)",
  );
  httpServer = startHttpServer(true, sessionToken); // true = OAuth routes only, pass session token
} else {
  logger.info("Starting MCP Server in HTTP mode");
  httpServer = startHttpServer(false); // false = full HTTP server
}

logger.info(`MCP Server running in ${config.transport} mode`);

// Graceful shutdown handling
process.on("SIGINT", async () => {
  logger.info("Received SIGINT, shutting down gracefully...");

  if (stdioServer) {
    await stdioServer.stop();
  }

  if (globalStreamableHttp) {
    globalStreamableHttp.stop();
  }

  if (httpServer) {
    httpServer.close(() => {
      logger.info("HTTP server closed");
    });
  }

  process.exit(0);
});

process.on("SIGTERM", async () => {
  logger.info("Received SIGTERM, shutting down gracefully...");

  if (stdioServer) {
    await stdioServer.stop();
  }

  if (globalStreamableHttp) {
    globalStreamableHttp.stop();
  }

  if (httpServer) {
    httpServer.close(() => {
      logger.info("HTTP server closed");
    });
  }

  process.exit(0);
});

/**
 * Unified resource registration helper that works for both MCPServer and StdioMCPServer
 */
function registerResources(mcpServer: MCPServer | StdioMCPServer): void {
  // Register resources here
  // Example: mcpServer.registerResource("file://config", handler, { uri: "file://config", name: "Configuration", description: "Server configuration", mimeType: "application/json" });
  // Resources can be added as needed
}

function startHttpServer(
  oauthOnly: boolean = false,
  stdioSessionToken?: string,
) {
  const app = express();
  const port = serverConfig.port;

  // Middleware
  app.use(helmet());
  app.use(cors());
  app.use(cookieParser()); // Parse cookies from Cookie header
  app.use(express.json());

  // Initialize OAuth middleware
  const oauthMiddleware = new OAuthMiddleware();

  // Initialize MCP server and register tools only if not OAuth-only mode
  let mcpServer: MCPServer | undefined;
  let staticTools: StaticTools | undefined;
  let openApiTools: OpenApiTools | undefined;
  let streamableHttp: StreamableHTTPTransport | undefined;

  if (!oauthOnly) {
    // Initialize MCP server
    mcpServer = new MCPServer();

    // Register resources for HTTP mode
    registerResources(mcpServer);

    // Initialize Streamable HTTP transport
    streamableHttp = new StreamableHTTPTransport(mcpServer);
    globalStreamableHttp = streamableHttp;

    // Register static tools
    staticTools = new StaticTools();
    mcpServer.registerTool(
      "get_token_info",
      staticTools.getTokenInfo.bind(staticTools),
    );
    mcpServer.registerTool(
      "start_oauth_login",
      staticTools.startOAuthLogin.bind(staticTools),
      {
        name: "start_oauth_login",
        description:
          "Start OAuth login flow and get a session token. Returns a URL to open in a browser for authentication.",
        inputSchema: {
          type: "object",
          properties: {},
          required: [],
        },
      },
    );

    mcpServer.registerTool("logout", staticTools.logout.bind(staticTools), {
      name: "logout",
      description:
        "Logout from the current OAuth session. Clears access and refresh tokens for the current session.",
      inputSchema: {
        type: "object",
        properties: {},
        required: [],
      },
    });

    // Register OpenAPI-derived tools
    openApiTools = new OpenApiTools({
      specsDir: openApiConfig.specsDir,
      defaultSearchLimit: openApiConfig.defaultSearchLimit,
      defaultServerUrl: openApiConfig.defaultServerUrl,
      includeWriteRequests: openApiConfig.includeWriteRequests,
    });

    mcpServer.registerTool(
      "search-apis",
      openApiTools.searchApis.bind(openApiTools),
      {
        name: "search-apis",
        description:
          "Search across OpenAPI operations loaded from the configured specifications directory.",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description:
                "Free-text keywords to match against API path, summary, description, or tags.",
            },
            limit: {
              type: "integer",
              minimum: 1,
              maximum: 50,
              description:
                "Maximum number of results to return (default configured on the server).",
            },
            method: {
              type: "string",
              description: "Optional HTTP method filter (e.g., GET, POST).",
            },
            tag: {
              type: "string",
              description:
                "Optional tag filter; must exactly match a tag defined in the spec.",
            },
            spec: {
              type: "string",
              description:
                "Optional spec identifier (filename, title, or slug) to scope the search.",
            },
          },
        },
      },
    );

    mcpServer.registerTool(
      "describe-apis",
      openApiTools.describeApi.bind(openApiTools),
      {
        name: "describe-apis",
        description:
          "Return detailed information about a specific API operation defined in the loaded OpenAPI specs.",
        inputSchema: {
          type: "object",
          properties: {
            apiId: {
              type: "string",
              description:
                "Identifier returned by search-apis (format: spec:METHOD:/path).",
            },
            spec: {
              type: "string",
              description: "Spec identifier when apiId is not provided.",
            },
            method: {
              type: "string",
              description: "HTTP method (required when apiId is not provided).",
            },
            path: {
              type: "string",
              description:
                "Path template from the OpenAPI document (required when apiId is not provided).",
            },
          },
        },
      },
    );

    mcpServer.registerTool("run-apis", openApiTools.runApi.bind(openApiTools), {
      name: "run-apis",
      description:
        "Execute an API request against the target endpoint using details from the OpenAPI specification.",
      inputSchema: {
        type: "object",
        properties: {
          apiId: {
            type: "string",
            description:
              "Identifier returned by search-apis (format: spec:METHOD:/path).",
          },
          spec: {
            type: "string",
            description: "Spec identifier when apiId is not provided.",
          },
          method: {
            type: "string",
            description: "HTTP method (required when apiId is not provided).",
          },
          path: {
            type: "string",
            description:
              "Path template from the OpenAPI document (required when apiId is not provided).",
          },
          serverUrl: {
            type: "string",
            description:
              "Override the server URL; defaults to the first server defined in the spec.",
          },
          pathParams: {
            type: "object",
            description:
              "Values for templated path parameters (key/value pairs).",
          },
          query: {
            type: "object",
            description:
              "Query string parameters to append to the request URL.",
          },
          headers: {
            type: "object",
            description: "Additional HTTP headers to include with the request.",
          },
          body: {
            description:
              "Request payload for methods that support a body. Provide JSON-compatible data or a raw string.",
            oneOf: [
              { type: "object" },
              { type: "array", items: {} },
              { type: "string" },
              { type: "number" },
              { type: "boolean" },
            ],
          },
          useAccessToken: {
            type: "boolean",
            description:
              "Set to false to skip automatically including the user access token in the Authorization header.",
          },
          timeoutMs: {
            type: "integer",
            minimum: 1,
            description: "Request timeout in milliseconds (defaults to 15000).",
          },
        },
      },
    });
  } // End of if (!oauthOnly)

  // OAuth 2.0 Authorization Server Metadata endpoint (RFC 8414)
  app.get("/.well-known/oauth-authorization-server", (req, res) => {
    logger.info(
      {
        method: req.method,
        url: req.url,
        headers: {
          "user-agent": req.get("User-Agent"),
          accept: req.get("Accept"),
          "x-forwarded-for": req.get("X-Forwarded-For"),
          "x-real-ip": req.get("X-Real-IP"),
        },
        ip: req.ip,
      },
      "OAuth Authorization Server Metadata request received",
    );

    const metadata = {
      issuer: oauthConfig.authorizationUrl.replace("/oauth/authorize", ""),
      authorization_endpoint: oauthConfig.authorizationUrl,
      token_endpoint: oauthConfig.tokenUrl,
      jwks_uri: oidcConfig.jwksUri,
      scopes_supported: [
        "commerce",
        "account",
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
      redirect_uris: [oauthConfig.redirectUri],
    };

    logger.debug({ metadata }, "Returning OAuth Authorization Server Metadata");
    res.json(metadata);
  });

  // OpenID Connect Discovery endpoint (RFC 8414)
  app.get("/.well-known/openid-configuration", (req, res) => {
    logger.info(
      {
        method: req.method,
        url: req.url,
        headers: {
          "user-agent": req.get("User-Agent"),
          accept: req.get("Accept"),
          "x-forwarded-for": req.get("X-Forwarded-For"),
          "x-real-ip": req.get("X-Real-IP"),
        },
        ip: req.ip,
      },
      "OpenID Connect Discovery request received",
    );

    const metadata = {
      issuer: oauthConfig.authorizationUrl.replace("/oauth/authorize", ""),
      authorization_endpoint: oauthConfig.authorizationUrl,
      token_endpoint: oauthConfig.tokenUrl,
      jwks_uri: oidcConfig.jwksUri,
      scopes_supported: [
        "commerce",
        "account",
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
      redirect_uris: [oauthConfig.redirectUri],
    };

    logger.info({ metadata }, "Returning OpenID Connect Discovery Metadata");
    res.json(metadata);
  });

  // OAuth 2.0 Protected Resource Metadata endpoint (RFC 9728)
  app.get("/.well-known/oauth-protected-resource", (req, res) => {
    logger.info(
      {
        method: req.method,
        url: req.url,
        headers: {
          "user-agent": req.get("User-Agent"),
          accept: req.get("Accept"),
          "x-forwarded-for": req.get("X-Forwarded-For"),
          "x-real-ip": req.get("X-Real-IP"),
        },
        ip: req.ip,
      },
      "OAuth Protected Resource Metadata request received",
    );

    const baseUrl = serverConfig.baseUrl;
    const metadata = {
      resource: baseUrl,
      authorization_servers: [
        {
          issuer: oauthConfig.authorizationUrl.replace("/oauth/authorize", ""),
          authorization_endpoint: oauthConfig.authorizationUrl,
          token_endpoint: oauthConfig.tokenUrl,
          jwks_uri: oidcConfig.jwksUri,
          scopes_supported: [
            "commerce",
            "account",
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
        },
      ],
      scopes_supported: [
        "commerce",
        "account",
        "social",
        "publishing",
        "analytics",
      ],
      bearer_methods_supported: ["header"],
      resource_documentation: `${baseUrl}/.well-known/oauth-authorization-server`,
    };

    logger.debug({ metadata }, "Returning OAuth Protected Resource Metadata");
    res.json(metadata);
  });

  // Note: Dynamic Client Registration removed - using static OAuth client credentials
  // Use pre-configured client_id and client_secret

  // OAuth routes (always available)
  app.get("/auth/login", oauthMiddleware.initiateOAuth.bind(oauthMiddleware));
  app.get(
    "/oauth/callback",
    oauthMiddleware.handleCallback.bind(oauthMiddleware),
  );

  // MCP endpoints (only in full HTTP mode, not in OAuth-only mode)
  if (!oauthOnly) {
    // Streamable HTTP MCP endpoint - POST
    app.post(
      "/mcp",
      oauthMiddleware.authenticate.bind(oauthMiddleware),
      async (req, res) => {
        logger.debug(
          {
            method: req.method,
            url: req.url,
            headers: {
              "user-agent": req.get("User-Agent"),
              "content-type": req.get("Content-Type"),
              authorization: req.get("Authorization")
                ? "***REDACTED***"
                : undefined,
              "mcp-protocol-version": req.get("MCP-Protocol-Version"),
              "mcp-session-id": req.get("Mcp-Session-Id"),
              "x-forwarded-for": req.get("X-Forwarded-For"),
              "x-real-ip": req.get("X-Real-IP"),
            },
            body: req.body,
            ip: req.ip,
            user: req.user,
          },
          "MCP POST request received",
        );

        // Extract user context
        const userContext = {
          accessToken:
            req.accessToken || req.get("Authorization")?.replace("Bearer ", ""),
          user: req.user,
          sub: req.user?.sub,
          client_id: req.user?.client_id,
          scope: req.user?.scope,
          namespace: req.user?.namespace,
        };

        await streamableHttp!.handlePost(req, res, userContext);
      },
    );

    // Streamable HTTP MCP endpoint - GET (for SSE streams)
    app.get(
      "/mcp",
      oauthMiddleware.authenticate.bind(oauthMiddleware),
      async (req, res) => {
        logger.debug(
          {
            method: req.method,
            url: req.url,
            headers: {
              "user-agent": req.get("User-Agent"),
              accept: req.get("Accept"),
              "mcp-protocol-version": req.get("MCP-Protocol-Version"),
              "mcp-session-id": req.get("Mcp-Session-Id"),
              "last-event-id": req.get("Last-Event-Id"),
              "x-forwarded-for": req.get("X-Forwarded-For"),
              "x-real-ip": req.get("X-Real-IP"),
            },
            ip: req.ip,
            user: req.user,
          },
          "MCP GET request received",
        );

        await streamableHttp!.handleGet(req, res);
      },
    );

    // Streamable HTTP MCP endpoint - DELETE (for session termination)
    app.delete(
      "/mcp",
      oauthMiddleware.authenticate.bind(oauthMiddleware),
      async (req, res) => {
        logger.debug(
          {
            method: req.method,
            url: req.url,
            headers: {
              "mcp-session-id": req.get("Mcp-Session-Id"),
            },
            ip: req.ip,
            user: req.user,
          },
          "MCP DELETE request received",
        );

        await streamableHttp!.handleDelete(req, res);
      },
    );
  } // End of if (!oauthOnly) - MCP endpoints

  // Root endpoint (always available)
  app.get("/", (req, res) => {
    const baseUrl = serverConfig.baseUrl;

    if (oauthOnly) {
      res.json({
        message: "OAuth Authentication Server",
        mode: "oauth-only",
        note: "This server is running in OAuth-only mode to support stdio MCP client authentication",
        endpoints: {
          login: `${baseUrl}/auth/login`,
          callback: `${baseUrl}/oauth/callback`,
          health: `${baseUrl}/health`,
        },
        version: "1.0.0",
        authentication: {
          type: "OAuth 2.1 with PKCE",
          flow: "Visit /auth/login with session_token parameter to authenticate",
        },
      });
    } else {
      res.json({
        message: "MCP Server is running",
        mode: "full-http",
        endpoints: {
          mcp: `${baseUrl}/mcp`,
          health: `${baseUrl}/health`,
          auth: `${baseUrl}/auth/login`,
        },
        version: "1.0.0",
        authentication: {
          required: true,
          type: "OIDC",
          flow: "Visit /auth/login to authenticate and get a token for MCP clients",
        },
      });
    }
  });

  // Health check endpoint
  app.get("/health", (req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // Error handling middleware
  app.use(
    (
      err: Error,
      req: express.Request,
      res: express.Response,
      next: express.NextFunction,
    ) => {
      logger.error({ error: err }, "Unhandled error occurred");
      res.status(500).json({ error: "Internal server error" });
    },
  );

  // Create server but don't listen yet
  const server = http.createServer(app);

  // Attach error handler BEFORE calling listen
  server.on("error", (error: any) => {
    if (oauthOnly) {
      // In stdio mode with OAuth-only server, this is a non-fatal error
      const errorMessage =
        error.code === "EADDRINUSE"
          ? `Port ${port} is already in use`
          : error.message || "Unknown error";

      httpServerStatus.error = errorMessage;
      httpServerStatus.available = false;

      logger.warn(
        {
          error: errorMessage,
          port,
        },
        "⚠️  HTTP OAuth server failed to start in stdio mode - OAuth authentication will not work",
      );
      logger.warn(
        `To fix: Either free up port ${port} or set PORT environment variable to use a different port`,
      );
    } else {
      // In HTTP mode, this is fatal
      logger.fatal({ error }, "Failed to start HTTP MCP server");
      process.exit(1);
    }
  });

  server.on("listening", () => {
    if (oauthOnly) {
      // Mark HTTP server as available for stdio mode
      httpServerStatus.available = true;
      httpServerStatus.port = port;

      logger.info(
        { port, mode: "oauth-only" },
        "HTTP OAuth Server started (OAuth routes only)",
      );
      logger.info(`OAuth login: http://localhost:${port}/auth/login`);
      logger.info(`OAuth callback: http://localhost:${port}/oauth/callback`);
      logger.info(`Health check: http://localhost:${port}/health`);
    } else {
      logger.info(
        { port, mode: "full-http" },
        "HTTP MCP Server started (full mode)",
      );
      logger.info(`Health check: http://localhost:${port}/health`);
      logger.info(`OAuth login: http://localhost:${port}/auth/login`);
      logger.info(`OAuth callback: http://localhost:${port}/oauth/callback`);
      logger.info(`MCP endpoint: http://localhost:${port}/mcp`);
    }
  });

  // Now call listen - error handler is already attached
  server.listen(port);

  return server;
}
