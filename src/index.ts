import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { MCPServer } from './mcp-server';
import { OAuthMiddleware } from './oauth-middleware';
import { StaticTools } from './tools/static-tools';
import { OpenApiTools } from './tools/openapi-tools';
import { logger } from './logger';
import { serverConfig, oauthConfig, oidcConfig, openApiConfig } from './config';

const app = express();
const port = serverConfig.port;

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());

// Initialize OAuth middleware
const oauthMiddleware = new OAuthMiddleware();

// Initialize MCP server
const mcpServer = new MCPServer();

// Register static tools
const staticTools = new StaticTools();
mcpServer.registerTool('echo', staticTools.echo.bind(staticTools));
mcpServer.registerTool('get_time', staticTools.getTime.bind(staticTools));
mcpServer.registerTool('calculate', staticTools.calculate.bind(staticTools));
mcpServer.registerTool('get_system_info', staticTools.getSystemInfo.bind(staticTools));
mcpServer.registerTool('generate_random_string', staticTools.generateRandomString.bind(staticTools));
mcpServer.registerTool('convert_case', staticTools.convertCase.bind(staticTools));
mcpServer.registerTool('get_user_info', staticTools.getUserInfo.bind(staticTools));
// mcpServer.registerTool('make_api_call', staticTools.makeApiCall.bind(staticTools));


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
          { type: 'array' },
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
    redirect_uris: ['http://localhost:3334/oauth/callback']
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
    redirect_uris: ['http://localhost:3334/oauth/callback']
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
// mcp-remote should use pre-configured client_id and client_secret

// OAuth routes
app.get('/auth/login', oauthMiddleware.initiateOAuth.bind(oauthMiddleware));
app.get('/oauth/callback', oauthMiddleware.handleCallback.bind(oauthMiddleware));
app.get('/callback', oauthMiddleware.handleCallback.bind(oauthMiddleware));
app.get('/auth/logout', oauthMiddleware.logout.bind(oauthMiddleware));

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

// SSE endpoint for MCP streaming
app.get('/mcp/sse', oauthMiddleware.authenticate.bind(oauthMiddleware), (req, res) => {
  logger.debug({
    method: req.method,
    url: req.url,
    headers: {
      'user-agent': req.get('User-Agent'),
      'accept': req.get('Accept'),
      'authorization': req.get('Authorization') ? '***REDACTED***' : undefined,
      'x-forwarded-for': req.get('X-Forwarded-For'),
      'x-real-ip': req.get('X-Real-IP')
    },
    query: req.query,
    ip: req.ip,
    user: req.user
  }, 'MCP SSE request received');
  
  mcpServer.handleSSE(req, res);
});

// Alternative SSE endpoint (some MCP clients expect just /sse)
app.get('/sse', oauthMiddleware.authenticate.bind(oauthMiddleware), (req, res) => {
  logger.debug({
    method: req.method,
    url: req.url,
    headers: {
      'user-agent': req.get('User-Agent'),
      'accept': req.get('Accept'),
      'authorization': req.get('Authorization') ? '***REDACTED***' : undefined,
      'x-forwarded-for': req.get('X-Forwarded-For'),
      'x-real-ip': req.get('X-Real-IP')
    },
    query: req.query,
    ip: req.ip,
    user: req.user
  }, 'MCP SSE (alternative) request received');
  
  mcpServer.handleSSE(req, res);
});

// Additional MCP endpoints that some clients might expect
app.get('/stream', oauthMiddleware.authenticate.bind(oauthMiddleware), (req, res) => {
  mcpServer.handleSSE(req, res);
});

app.get('/events', oauthMiddleware.authenticate.bind(oauthMiddleware), (req, res) => {
  mcpServer.handleSSE(req, res);
});

// Root endpoint for MCP clients that expect it
app.get('/', (req, res) => {
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  res.json({ 
    message: 'MCP Server is running',
    endpoints: {
      sse: `${baseUrl}/sse`,
      mcp: `${baseUrl}/mcp`,
      health: `${baseUrl}/health`,
      auth: `${baseUrl}/auth/login`
    },
    version: '1.0.0',
    authentication: {
      required: true,
      type: 'OIDC',
      flow: 'Visit /auth/login to authenticate and get a token for MCP clients'
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

app.listen(port, () => {
  logger.info({ port }, 'MCP Server started');
  logger.info(`Health check: http://localhost:${port}/health`);
  logger.info(`OAuth login: http://localhost:${port}/auth/login`);
  logger.info(`MCP endpoint: http://localhost:${port}/mcp`);
  logger.info(`MCP SSE endpoints: http://localhost:${port}/sse, http://localhost:${port}/mcp/sse`);
});
