import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { StaticTools } from './tools/static-tools';
import { OpenApiTools } from './tools/openapi-tools';
import { logger } from './logger';
import { openApiConfig, oauthConfig } from './config';
import { OAuthMiddleware } from './oauth-middleware';

export class StdioMCPServer {
  private server: Server;
  private staticTools: StaticTools;
  private openApiTools: OpenApiTools;
  private oauthMiddleware: OAuthMiddleware;

  constructor() {
    this.server = new Server(
      {
        name: 'ags-api-mcp-server',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.staticTools = new StaticTools();
    this.openApiTools = new OpenApiTools({
      specsDir: openApiConfig.specsDir,
      defaultSearchLimit: openApiConfig.defaultSearchLimit,
      defaultServerUrl: openApiConfig.defaultServerUrl,
      includeWriteRequests: openApiConfig.includeWriteRequests
    });
    this.oauthMiddleware = new OAuthMiddleware();

    this.setupHandlers();
    logger.info('Stdio MCP Server initialized');
  }

  private setupHandlers(): void {
    // Handle list tools request
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      logger.debug('Handling tools/list request via stdio');
      
      return {
        tools: [
          {
            name: 'get_token_info',
            description: 'Get information about the authenticated token and user from the access token',
            inputSchema: {
              type: 'object',
              properties: {}
            }
          },
          {
            name: 'search-apis',
            description: 'Search across OpenAPI operations loaded from the configured specifications directory.',
            inputSchema: {
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                  description: 'Free-text keywords to match against API path, summary, description, or tags.'
                },
                limit: {
                  type: 'integer',
                  minimum: 1,
                  maximum: 50,
                  description: 'Maximum number of results to return (default configured on the server).'
                },
                method: {
                  type: 'string',
                  description: 'Optional HTTP method filter (e.g., GET, POST).'
                },
                tag: {
                  type: 'string',
                  description: 'Optional tag filter; must exactly match a tag defined in the spec.'
                },
                spec: {
                  type: 'string',
                  description: 'Optional spec identifier (filename, title, or slug) to scope the search.'
                }
              }
            }
          },
          {
            name: 'describe-apis',
            description: 'Return detailed information about a specific API operation defined in the loaded OpenAPI specs.',
            inputSchema: {
              type: 'object',
              properties: {
                apiId: {
                  type: 'string',
                  description: 'Identifier returned by search-apis (format: spec:METHOD:/path).'
                },
                spec: {
                  type: 'string',
                  description: 'Spec identifier when apiId is not provided.'
                },
                method: {
                  type: 'string',
                  description: 'HTTP method (required when apiId is not provided).'
                },
                path: {
                  type: 'string',
                  description: 'Path template from the OpenAPI document (required when apiId is not provided).'
                }
              }
            }
          },
          {
            name: 'run-apis',
            description: 'Execute an API request against the target endpoint using details from the OpenAPI specification.',
            inputSchema: {
              type: 'object',
              properties: {
                apiId: {
                  type: 'string',
                  description: 'Identifier returned by search-apis (format: spec:METHOD:/path).'
                },
                spec: {
                  type: 'string',
                  description: 'Spec identifier when apiId is not provided.'
                },
                method: {
                  type: 'string',
                  description: 'HTTP method (required when apiId is not provided).'
                },
                path: {
                  type: 'string',
                  description: 'Path template from the OpenAPI document (required when apiId is not provided).'
                },
                serverUrl: {
                  type: 'string',
                  description: 'Override the server URL; defaults to the first server defined in the spec.'
                },
                pathParams: {
                  type: 'object',
                  description: 'Values for templated path parameters (key/value pairs).'
                },
                query: {
                  type: 'object',
                  description: 'Query string parameters to append to the request URL.'
                },
                headers: {
                  type: 'object',
                  description: 'Additional HTTP headers to include with the request.'
                },
                body: {
                  description: 'Request payload for methods that support a body. Provide JSON-compatible data or a raw string.'
                },
                useAccessToken: {
                  type: 'boolean',
                  description: 'Set to false to skip automatically including the user access token in the Authorization header.'
                },
                timeoutMs: {
                  type: 'integer',
                  minimum: 1,
                  description: 'Request timeout in milliseconds (defaults to 15000).'
                }
              }
            }
          }
        ]
      };
    });

    // Handle call tool request
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      
      logger.info({ tool: name, args }, 'Handling tools/call request via stdio');

      try {
        let result: any;
        
        // Get access token from client credentials if available
        const userContext = await this.getUserContext();

        switch (name) {
          case 'get_token_info':
            result = await this.staticTools.getTokenInfo(args || {}, userContext);
            break;
          case 'search-apis':
            result = await this.openApiTools.searchApis(args || {});
            break;
          case 'describe-apis':
            result = await this.openApiTools.describeApi(args || {});
            break;
          case 'run-apis':
            result = await this.openApiTools.runApi(args || {}, userContext);
            break;
          default:
            throw new Error(`Unknown tool: ${name}`);
        }

        return {
          content: [
            {
              type: 'text',
              text: typeof result === 'string' ? result : JSON.stringify(result, null, 2)
            }
          ]
        };
      } catch (error) {
        logger.error({ error, tool: name }, 'Error executing tool via stdio');
        throw error;
      }
    });
  }

  private async getUserContext() {
    // Try to get client credentials token if configured and enabled
    const clientCredentialsManager = (this.oauthMiddleware as any).clientCredentialsManager;
    
    if (clientCredentialsManager && oauthConfig.clientId && oauthConfig.enableClientCredentialsFallback) {
      logger.debug('Attempting to get client credentials token for stdio request');
      const tokenResult = await clientCredentialsManager.getAccessToken();
      
      if (tokenResult) {
        logger.debug({ 
          isFromCache: tokenResult.isFromCache 
        }, 'Using client credentials token for stdio request');
        return {
          accessToken: tokenResult.accessToken,
          isFromCache: tokenResult.isFromCache,
          user: {
            id: 'client_credentials',
            name: 'Client Credentials'
          }
        };
      }
    } else if (clientCredentialsManager && !oauthConfig.enableClientCredentialsFallback) {
      logger.debug('Client credentials fallback is disabled for stdio mode');
    }

    return {};
  }

  async start(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    
    logger.info('Stdio MCP Server started - listening on stdin/stdout');
  }

  async stop(): Promise<void> {
    await this.server.close();
    logger.info('Stdio MCP Server stopped');
  }
}

// Start the stdio server if this file is run directly
if (require.main === module) {
  const server = new StdioMCPServer();
  
  server.start().catch((error) => {
    logger.fatal({ error }, 'Failed to start stdio MCP server');
    process.exit(1);
  });

  // Graceful shutdown handling
  process.on('SIGINT', async () => {
    logger.info('Received SIGINT, shutting down gracefully...');
    await server.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    logger.info('Received SIGTERM, shutting down gracefully...');
    await server.stop();
    process.exit(0);
  });
}

