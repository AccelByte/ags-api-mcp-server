import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { MCPServer } from './mcp-server';
import { OAuthMiddleware } from './oauth-middleware';
import { StaticTools } from './tools/static-tools';
import { OpenApiTools } from './tools/openapi-tools';
import { logger } from './logger';
import { config, serverConfig, oauthConfig, oidcConfig, openApiConfig } from './config';
import { StdioMCPServer } from './stdio-server';

let stdioServer: StdioMCPServer | null = null;
let httpServer: any = null;

// Start server based on transport configuration
if (config.transport === 'stdio') {
  logger.info('Starting MCP Server in stdio mode');
  stdioServer = new StdioMCPServer();
  
  stdioServer.start().catch((error) => {
    logger.fatal({ error }, 'Failed to start stdio MCP server');
    process.exit(1);
  });
} else {
  logger.info('Starting MCP Server in HTTP mode');
  httpServer = startHttpServer();
}

logger.info(`MCP Server running in ${config.transport} mode`);


// Graceful shutdown handling
process.on('SIGINT', async () => {
  logger.info('Received SIGINT, shutting down gracefully...');
  
  if (stdioServer) {
    await stdioServer.stop();
  }
  
  if (httpServer) {
    httpServer.close(() => {
      logger.info('HTTP server closed');
    });
  }
  
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM, shutting down gracefully...');
  
  if (stdioServer) {
    await stdioServer.stop();
  }
  
  if (httpServer) {
    httpServer.close(() => {
      logger.info('HTTP server closed');
    });
  }
  
  process.exit(0);
});

function startHttpServer() {
const app = express();
const port = serverConfig.port;

// Middleware
app.use(helmet());
app.use(cors());
app.use(cookieParser()); // Parse cookies from Cookie header
app.use(express.json());

// Initialize OAuth middleware
const oauthMiddleware = new OAuthMiddleware();

// Initialize MCP server
const mcpServer = new MCPServer();

// Register static tools
const staticTools = new StaticTools();
mcpServer.registerTool('get_token_info', staticTools.getTokenInfo.bind(staticTools));


// Register OpenAPI-derived tools
const openApiTools = new OpenApiTools({
  specsDir: openApiConfig.specsDir,
  defaultSearchLimit: openApiConfig.defaultSearchLimit,
  defaultServerUrl: openApiConfig.defaultServerUrl,
  includeWriteRequests: openApiConfig.includeWriteRequests
});

mcpServer.registerTool('search-apis', openApiTools.searchApis.bind(openApiTools), {
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
});

mcpServer.registerTool('describe-apis', openApiTools.describeApi.bind(openApiTools), {
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
});

mcpServer.registerTool('run-apis', openApiTools.runApi.bind(openApiTools), {
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
        description: 'Request payload for methods that support a body. Provide JSON-compatible data or a raw string.',
        oneOf: [
          { type: 'object' },
          { type: 'array', items: {} },
          { type: 'string' },
          { type: 'number' },
          { type: 'boolean' }
        ]
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
});



// OAuth 2.0 Authorization Server Metadata endpoint (RFC 8414)
app.get('/.well-known/oauth-authorization-server', (req, res) => {
  logger.info({
    method: req.method,
    url: req.url,
    headers: {
      'user-agent': req.get('User-Agent'),
      'accept': req.get('Accept'),
      'x-forwarded-for': req.get('X-Forwarded-For'),
      'x-real-ip': req.get('X-Real-IP')
    },
    ip: req.ip
  }, 'OAuth Authorization Server Metadata request received');

  const metadata = {
    issuer: oauthConfig.authorizationUrl.replace('/oauth/authorize', ''),
    authorization_endpoint: oauthConfig.authorizationUrl,
    token_endpoint: oauthConfig.tokenUrl,
    jwks_uri: oidcConfig.jwksUri,
    scopes_supported: ['openid', 'profile', 'email'],
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
    redirect_uris: [oauthConfig.redirectUri]
  };

  logger.debug({ metadata }, 'Returning OAuth Authorization Server Metadata');
  res.json(metadata);
});

// OpenID Connect Discovery endpoint (RFC 8414)
app.get('/.well-known/openid-configuration', (req, res) => {
  logger.info({
    method: req.method,
    url: req.url,
    headers: {
      'user-agent': req.get('User-Agent'),
      'accept': req.get('Accept'),
      'x-forwarded-for': req.get('X-Forwarded-For'),
      'x-real-ip': req.get('X-Real-IP')
    },
    ip: req.ip
  }, 'OpenID Connect Discovery request received');

  const metadata = {
    issuer: oauthConfig.authorizationUrl.replace('/oauth/authorize', ''),
    authorization_endpoint: oauthConfig.authorizationUrl,
    token_endpoint: oauthConfig.tokenUrl,
    jwks_uri: oidcConfig.jwksUri,
    scopes_supported: ['openid', 'profile', 'email'],
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
    redirect_uris: [oauthConfig.redirectUri]
  };

  logger.info({ metadata }, 'Returning OpenID Connect Discovery Metadata');
  res.json(metadata);
});

// OAuth 2.0 Protected Resource Metadata endpoint (RFC 9728)
app.get('/.well-known/oauth-protected-resource', (req, res) => {
  logger.info({
    method: req.method,
    url: req.url,
    headers: {
      'user-agent': req.get('User-Agent'),
      'accept': req.get('Accept'),
      'x-forwarded-for': req.get('X-Forwarded-For'),
      'x-real-ip': req.get('X-Real-IP')
    },
    ip: req.ip
  }, 'OAuth Protected Resource Metadata request received');

  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const metadata = {
    resource: baseUrl,
    authorization_servers: [
      {
        issuer: oauthConfig.authorizationUrl.replace('/oauth/authorize', ''),
        authorization_endpoint: oauthConfig.authorizationUrl,
        token_endpoint: oauthConfig.tokenUrl,
        jwks_uri: oidcConfig.jwksUri,
        scopes_supported: ['openid', 'profile', 'email'],
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
        registration_endpoint: `${baseUrl}/oauth/register`
      }
    ],
    scopes_supported: ['openid', 'profile', 'email'],
    bearer_methods_supported: ['header'],
    resource_documentation: `${baseUrl}/.well-known/oauth-authorization-server`
  };

  logger.debug({ metadata }, 'Returning OAuth Protected Resource Metadata');
  res.json(metadata);
});

// Note: Dynamic Client Registration removed - using static OAuth client credentials
// Note: OAuth routes (/auth/login, /oauth/callback) removed - using session token authentication

// Protected MCP endpoint
app.post('/mcp', oauthMiddleware.authenticate.bind(oauthMiddleware), (req, res) => {
  logger.debug({
    method: req.method,
    url: req.url,
    headers: {
      'user-agent': req.get('User-Agent'),
      'content-type': req.get('Content-Type'),
      'authorization': req.get('Authorization') ? '***REDACTED***' : undefined,
      'x-forwarded-for': req.get('X-Forwarded-For'),
      'x-real-ip': req.get('X-Real-IP')
    },
    body: req.body,
    ip: req.ip,
    user: req.user
  }, 'MCP POST request received');
  
  mcpServer.handleRequest(req, res);
});

// Root endpoint for MCP clients that expect it
app.get('/', (req, res) => {
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  res.json({
    message: 'MCP Server is running',
    endpoints: {
      mcp: `${baseUrl}/mcp`,
      health: `${baseUrl}/health`
    },
    version: '1.0.0',
    authentication: {
      required: true,
      type: 'OIDC',
      flow: 'Session token authentication via OAuth client credentials'
    }
  });
});


// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Error handling middleware
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error({ error: err }, 'Unhandled error occurred');
  res.status(500).json({ error: 'Internal server error' });
});

const server = app.listen(port, () => {
  logger.info({ port }, 'HTTP MCP Server started');
  logger.info(`Health check: http://localhost:${port}/health`);
  logger.info(`MCP endpoint: http://localhost:${port}/mcp`);
});

return server;
}
