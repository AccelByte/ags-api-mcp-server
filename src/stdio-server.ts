import { randomUUID } from "crypto";
import { pathToFileURL } from "url";
import { StaticTools } from "./tools/static-tools.js";
import { OpenApiTools } from "./tools/openapi-tools.js";
import { logger } from "./logger.js";
import { openApiConfig, oauthConfig } from "./config.js";
import { OAuthMiddleware } from "./oauth-middleware.js";
import { sessionManager } from "./session-manager.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  CompleteRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { Resource, Prompt } from "./mcp-server.js";

export class StdioMCPServer {
  private server: Server | null = null;
  private serverPromise: Promise<Server> | null = null;
  private staticTools: StaticTools;
  private openApiTools: OpenApiTools;
  private oauthMiddleware: OAuthMiddleware;
  private sessionToken: string; // Auto-generated session token for stdio mode only
  private resources: Map<string, Resource> = new Map();
  private resourceHandlers: Map<string, Function> = new Map();
  private prompts: Map<string, Prompt> = new Map();
  private promptHandlers: Map<string, Function> = new Map();

  constructor() {
    // Generate a session token for this stdio session (only valid for stdio mode)
    this.sessionToken = randomUUID();
    logger.info(
      {
        sessionToken: this.sessionToken.substring(0, 8) + "...",
      },
      "Generated session token for stdio mode OAuth authentication",
    );

    // Server will be lazily initialized using dynamic import
    // This is necessary because @modelcontextprotocol/sdk is an ES Module

    this.staticTools = new StaticTools();
    this.openApiTools = new OpenApiTools({
      specsDir: openApiConfig.specsDir,
      defaultSearchLimit: openApiConfig.defaultSearchLimit,
      defaultServerUrl: openApiConfig.defaultServerUrl,
      includeWriteRequests: openApiConfig.includeWriteRequests,
    });
    this.oauthMiddleware = new OAuthMiddleware();

    logger.info(
      "Stdio MCP Server initialized (server will be created on first use)",
    );
  }

  private async initializeServer(): Promise<Server> {
    if (this.server) {
      return this.server;
    }

    if (this.serverPromise) {
      return this.serverPromise;
    }

    this.serverPromise = (async () => {
      try {
        this.server = new Server(
          {
            name: "ags-api-mcp-server",
            version: "1.0.0",
          },
          {
            capabilities: {
              tools: {},
              resources: {},
              prompts: {},
              completions: {},
            },
          },
        );

        // Setup handlers after server is created
        await this.setupHandlers();

        logger.info("MCP Server instance created");
        return this.server;
      } catch (error) {
        logger.error({ 
          error,
          message: error instanceof Error ? error.message : String(error),
        }, "Failed to initialize MCP Server");
        throw error;
      }
    })();

    return this.serverPromise;
  }

  private async setupHandlers(): Promise<void> {
    if (!this.server) {
      throw new Error("Server must be initialized before setting up handlers");
    }

    // Handle list tools request
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      logger.debug("Handling tools/list request via stdio");

      return {
        tools: [
          {
            name: "get_token_info",
            description:
              "Get information about the authenticated token and user from the access token",
            inputSchema: {
              type: "object",
              properties: {},
            },
          },
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
                  description:
                    "HTTP method (required when apiId is not provided).",
                },
                path: {
                  type: "string",
                  description:
                    "Path template from the OpenAPI document (required when apiId is not provided).",
                },
              },
            },
          },
          {
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
                  description:
                    "HTTP method (required when apiId is not provided).",
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
                  description:
                    "Additional HTTP headers to include with the request.",
                },
                body: {
                  description:
                    "Request payload for methods that support a body. Provide JSON-compatible data or a raw string.",
                },
                useAccessToken: {
                  type: "boolean",
                  description:
                    "Set to false to skip automatically including the user access token in the Authorization header.",
                },
                timeoutMs: {
                  type: "integer",
                  minimum: 1,
                  description:
                    "Request timeout in milliseconds (defaults to 15000).",
                },
              },
            },
          },
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
          {
            name: "logout",
            description:
              "Logout from the current OAuth session. Clears access and refresh tokens for the current session.",
            inputSchema: {
              type: "object",
              properties: {},
              required: [],
            },
          },
        ],
      };
    });

    // Handle list resources request
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => {
      logger.debug("Handling resources/list request via stdio");

      const resources: Resource[] = [];
      for (const [uri, resource] of this.resources) {
        resources.push(resource);
      }

      return {
        resources,
      };
    });

    // Handle read resource request
    this.server.setRequestHandler(
      ReadResourceRequestSchema,
      async (request: any) => {
        if (!request.params || !request.params.uri) {
          throw new Error("Resource URI is required");
        }

        const { uri } = request.params;

        logger.info(
          { resource: uri },
          "Handling resources/read request via stdio",
        );

        const handler = this.resourceHandlers.get(uri);
        if (!handler) {
          throw new Error(`Resource '${uri}' not found`);
        }

        try {
          const userContext = await this.getUserContext();
          const userContextWithStdioToken = {
            ...userContext,
            stdioSessionToken: this.sessionToken,
          };

          const result = await handler(
            request.params || {},
            userContextWithStdioToken,
          );

          // Format result according to MCP spec
          const contents = Array.isArray(result)
            ? result
            : [
                {
                  uri,
                  mimeType: this.resources.get(uri)?.mimeType || "text/plain",
                  text:
                    typeof result === "string"
                      ? result
                      : JSON.stringify(result, null, 2),
                },
              ];

          return {
            contents,
          };
        } catch (error) {
          logger.error(
            { error, resource: uri },
            "Error reading resource via stdio",
          );
          throw error;
        }
      },
    );

    // Handle call tool request
    this.server.setRequestHandler(
      CallToolRequestSchema,
      async (request: any) => {
        const { name, arguments: args } = request.params;

        logger.info(
          { tool: name, args },
          "Handling tools/call request via stdio",
        );

        try {
          let result: any;

          // Get access token from client credentials if available
          const userContext = await this.getUserContext();

          // Add stdio session token to userContext (only for stdio mode)
          const userContextWithStdioToken = {
            ...userContext,
            stdioSessionToken: this.sessionToken, // SECURITY: Only used in stdio mode
          };

          switch (name) {
            case "get_token_info":
              result = await this.staticTools.getTokenInfo(
                args || {},
                userContextWithStdioToken,
              );
              break;
            case "start_oauth_login":
              result = await this.staticTools.startOAuthLogin(
                args,
                userContextWithStdioToken,
              );
              break;
            case "logout":
              result = await this.staticTools.logout(
                args,
                userContextWithStdioToken,
              );
              break;
            case "search-apis":
              result = await this.openApiTools.searchApis(args || {});
              break;
            case "describe-apis":
              result = await this.openApiTools.describeApi(args || {});
              break;
            case "run-apis":
              result = await this.openApiTools.runApi(
                args || {},
                userContextWithStdioToken,
              );
              break;
            default:
              throw new Error(`Unknown tool: ${name}`);
          }

          return {
            content: [
              {
                type: "text",
                text:
                  typeof result === "string"
                    ? result
                    : JSON.stringify(result, null, 2),
              },
            ],
          };
        } catch (error) {
          logger.error({ error, tool: name }, "Error executing tool via stdio");
          throw error;
        }
      },
    );

    // Handle list prompts request
    this.server.setRequestHandler(ListPromptsRequestSchema, async () => {
      logger.debug("Handling prompts/list request via stdio");

      const prompts: Prompt[] = [];
      for (const [name, prompt] of this.prompts) {
        prompts.push(prompt);
      }

      return {
        prompts,
      };
    });

    // Handle get prompt request
    this.server.setRequestHandler(
      GetPromptRequestSchema,
      async (request: any) => {
        if (!request.params || !request.params.name) {
          throw new Error("Prompt name is required");
        }

        const { name, arguments: args } = request.params;

        logger.info(
          { prompt: name, args },
          "Handling prompts/get request via stdio",
        );

        const handler = this.promptHandlers.get(name);
        if (!handler) {
          throw new Error(`Prompt '${name}' not found`);
        }

        try {
          const userContext = await this.getUserContext();
          const userContextWithStdioToken = {
            ...userContext,
            stdioSessionToken: this.sessionToken,
          };

          const result = await handler(args || {}, userContextWithStdioToken);

          const prompt = this.prompts.get(name);

          // Format result according to MCP spec
          return {
            description: prompt?.description,
            messages: Array.isArray(result)
              ? result
              : [
                  {
                    role: "user",
                    content: {
                      type: "text",
                      text:
                        typeof result === "string"
                          ? result
                          : JSON.stringify(result, null, 2),
                    },
                  },
                ],
          };
        } catch (error) {
          logger.error(
            { error, prompt: name },
            "Error getting prompt via stdio",
          );
          throw error;
        }
      },
    );

    this.server.setRequestHandler(
      CompleteRequestSchema,
      async (request: any) => {
        const { ref, argument, context } = request.params || {};
        if (!ref || !argument) {
          throw new Error("Completion reference and argument are required");
        }

        let suggestions: string[] = [];

        if (ref.type === "ref/prompt") {
          suggestions = await this.getPromptCompletionSuggestions(
            ref.name,
            argument.name,
            argument.value ?? "",
            context,
          );
        } else {
          logger.warn(
            { refType: ref.type },
            "Unsupported completion reference type via stdio",
          );
        }

        return {
          completion: this.formatCompletionResult(suggestions),
        };
      },
    );
  }

  private formatCompletionResult(suggestions: string[]) {
    const limited = suggestions.slice(0, 100);
    const result: {
      values: string[];
      total?: number;
      hasMore?: boolean;
    } = {
      values: limited,
    };

    if (suggestions.length !== limited.length) {
      result.hasMore = true;
      result.total = suggestions.length;
    } else if (suggestions.length > 0) {
      result.total = suggestions.length;
    }

    return result;
  }

  private async getPromptCompletionSuggestions(
    promptName: string,
    argumentName: string,
    value: string,
    context?: { arguments?: Record<string, string> },
  ): Promise<string[]> {
    const prompt = this.prompts.get(promptName);
    if (!prompt?.argsSchema) {
      return [];
    }

    const field = (prompt.argsSchema as Record<string, any>)[argumentName];
    const completer =
      field?._def?.complete && typeof field._def.complete === "function"
        ? field._def.complete
        : undefined;

    if (!completer) {
      return [];
    }

    try {
      const suggestions = await Promise.resolve(completer(value, context));
      if (Array.isArray(suggestions)) {
        return suggestions.filter(
          (suggestion) => typeof suggestion === "string",
        );
      }
    } catch (error) {
      logger.error(
        { error, promptName, argumentName },
        "Error generating prompt completions (stdio)",
      );
    }

    return [];
  }

  private async getUserContext() {
    // Use the auto-generated session token for this stdio session
    const sessionToken = this.sessionToken;

    logger.debug(
      {
        sessionToken: sessionToken.substring(0, 8) + "...",
      },
      "Using auto-generated session token for stdio mode, checking session",
    );

    const sessionResult = sessionManager.getAccessToken(sessionToken);

    if (sessionResult) {
      const session = sessionManager.getSession(sessionToken);

      // If token is expired, attempt synchronous refresh before proceeding
      if (
        sessionResult.isExpired &&
        session?.refresh_token &&
        oauthConfig.tokenUrl
      ) {
        logger.info(
          {
            sessionToken: sessionToken.substring(0, 8) + "...",
            userId: session?.user_id,
          },
          "Access token expired in stdio mode, attempting synchronous refresh with refresh token",
        );

        try {
          const refreshed = await sessionManager.refreshToken(
            sessionToken,
            oauthConfig.tokenUrl,
            oauthConfig.clientId,
            oauthConfig.clientSecret || "",
          );

          if (refreshed) {
            // Successfully refreshed - get new token
            const newSessionResult =
              sessionManager.getAccessToken(sessionToken);
            if (newSessionResult) {
              logger.info(
                {
                  sessionToken: sessionToken.substring(0, 8) + "...",
                  userId: session?.user_id,
                },
                "Token refreshed successfully in stdio mode, proceeding with request",
              );

              return {
                accessToken: newSessionResult.accessToken,
                user: {
                  id: session?.user_id || "unknown",
                  email: session?.user_email,
                  name: session?.user_name,
                },
              };
            }
          }

          // Refresh failed - log and fall through to client credentials
          logger.warn(
            {
              sessionToken: sessionToken.substring(0, 8) + "...",
              userId: session?.user_id,
            },
            "Refresh token failed or expired in stdio mode - session marked as expired",
          );
        } catch (error) {
          logger.error(
            {
              error,
              sessionToken: sessionToken.substring(0, 8) + "...",
            },
            "Exception during token refresh in stdio mode",
          );
        }

        // Refresh failed, fall through to check for expired session and client credentials
      } else {
        // Token is valid (not expired)
        logger.debug(
          {
            sessionToken: sessionToken.substring(0, 8) + "...",
            userId: session?.user_id,
            isExpired: sessionResult.isExpired,
          },
          "Using token from session for stdio request",
        );

        return {
          accessToken: sessionResult.accessToken,
          user: {
            id: session?.user_id || "unknown",
            email: session?.user_email,
            name: session?.user_name,
          },
        };
      }
    }

    // Session not found or refresh failed - check for expired session
    {
      // Check if session exists but is expired
      const session = sessionManager.getSession(sessionToken);

      if (session && session.status === "expired") {
        logger.warn(
          {
            sessionToken: sessionToken.substring(0, 8) + "...",
            fallbackEnabled: oauthConfig.enableClientCredentialsFallback,
          },
          "USER SESSION EXPIRED in stdio mode",
        );
      } else {
        logger.warn(
          {
            sessionToken: sessionToken.substring(0, 8) + "...",
          },
          "Auto-generated session token has no valid session - user needs to authenticate via start_oauth_login",
        );
      }
    }

    // Try to get client credentials token if configured and enabled
    const clientCredentialsManager = (this.oauthMiddleware as any)
      .clientCredentialsManager;
    const sessionExpired =
      sessionToken &&
      sessionManager.getSession(sessionToken)?.status === "expired";

    if (
      clientCredentialsManager &&
      oauthConfig.clientId &&
      oauthConfig.enableClientCredentialsFallback
    ) {
      if (sessionExpired) {
        logger.warn(
          "⚠️  USER SESSION EXPIRED - Falling back to client credentials (app-level permissions) in stdio mode",
        );
      } else {
        logger.debug(
          "Attempting to get client credentials token for stdio request",
        );
      }
      const tokenResult = await clientCredentialsManager.getAccessToken();

      if (tokenResult) {
        if (sessionExpired) {
          logger.warn(
            {
              isFromCache: tokenResult.isFromCache,
            },
            "⚠️  Using CLIENT CREDENTIALS as fallback in stdio mode - User now has APP-LEVEL permissions (not user-specific). Re-authenticate with start_oauth_login tool to restore user permissions.",
          );
        } else {
          logger.debug(
            {
              isFromCache: tokenResult.isFromCache,
            },
            "Using client credentials token for stdio request",
          );
        }
        return {
          accessToken: tokenResult.accessToken,
          isFromCache: tokenResult.isFromCache,
          user: {
            id: "client_credentials",
            name: "Client Credentials",
          },
        };
      }
    } else if (
      clientCredentialsManager &&
      !oauthConfig.enableClientCredentialsFallback
    ) {
      if (sessionExpired) {
        logger.warn(
          "🔒 USER SESSION EXPIRED in stdio mode - Client credentials fallback is disabled, requests will fail",
        );
      } else {
        logger.debug("Client credentials fallback is disabled for stdio mode");
      }
    }

    return {};
  }

  async start(): Promise<void> {
    // Ensure server is initialized
    const server = await this.initializeServer();

    const transport = new StdioServerTransport();
    await server.connect(transport);

    logger.info("Stdio MCP Server started - listening on stdin/stdout");
  }

  async stop(): Promise<void> {
    if (this.server) {
      await this.server.close();
      logger.info("Stdio MCP Server stopped");
    }
  }

  /**
   * Get the auto-generated session token for this stdio session
   * SECURITY: This token should ONLY be used in stdio mode
   */
  getSessionToken(): string {
    return this.sessionToken;
  }

  /**
   * Register a resource handler for stdio mode
   */
  registerResource(resource: Resource, handler: Function): void {
    this.resourceHandlers.set(resource.uri, handler);
    this.resources.set(resource.uri, resource);
  }

  /**
   * Register a prompt handler for stdio mode
   */
  registerPrompt(prompt: Prompt, handler: Function): void {
    this.promptHandlers.set(prompt.name, handler);
    this.prompts.set(prompt.name, prompt);
  }
}

// Start the stdio server if this file is run directly
// ES module equivalent of require.main === module
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const server = new StdioMCPServer();

  server.start().catch((error) => {
    logger.fatal({ error }, "Failed to start stdio MCP server");
    process.exit(1);
  });

  // Graceful shutdown handling
  process.on("SIGINT", async () => {
    logger.info("Received SIGINT, shutting down gracefully...");
    await server.stop();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    logger.info("Received SIGTERM, shutting down gracefully...");
    await server.stop();
    process.exit(0);
  });
}
