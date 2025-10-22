import dotenv from 'dotenv';
import path from 'path';
import { logger } from './logger';

// Determine project root directory
// In development (src/), __dirname is the src directory
// In production (dist/), __dirname is the dist directory
// We need to go up one level from dist or stay at src's parent
const isCompiledCode = __dirname.endsWith('dist');
const projectRoot = isCompiledCode 
  ? path.resolve(__dirname, '..') 
  : path.resolve(__dirname, '..');

// Load environment variables from project root
dotenv.config({ path: path.join(projectRoot, '.env') });

export interface Config {
  // Server Configuration
  port: number;
  nodeEnv: string;
  logLevel: string;
  transport: 'http' | 'stdio';

  // OpenAPI configuration
  openapi: {
    specsDir: string;
    defaultSearchLimit: number;
    defaultServerUrl?: string;
    includeWriteRequests: boolean;
  };
  
  // OAuth Configuration
  oauth: {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    authorizationUrl: string;
    tokenUrl: string;
    enableClientCredentialsFallback: boolean;
  };
  
  // OIDC Configuration
  oidc: {
    jwksUri: string;
    issuer: string;
    audience: string;
    algorithms: string[];
  };
}

// Environment variable validation
function validateEnvVar(name: string, value: string | undefined, required: boolean = true): string {
  if (required && (!value || value.trim() === '')) {
    throw new Error(`Required environment variable ${name} is not set`);
  }
  return value || '';
}

function validatePort(portStr: string | undefined): number {
  const port = parseInt(portStr || '3000', 10);
  if (isNaN(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port number: ${portStr}. Must be between 1 and 65535`);
  }
  return port;
}

function validateLogLevel(level: string | undefined): string {
  const validLevels = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'];
  const logLevel = level || 'info';
  if (!validLevels.includes(logLevel)) {
    throw new Error(`Invalid log level: ${logLevel}. Must be one of: ${validLevels.join(', ')}`);
  }
  return logLevel;
}

function validateBoolean(value: string | undefined, defaultValue: boolean = false): boolean {
  if (!value) return defaultValue;
  const lowerValue = value.toLowerCase();
  return lowerValue === 'true' || lowerValue === '1' || lowerValue === 'yes';
}

function validateTransport(value: string | undefined): 'http' | 'stdio' {
  const transport = (value || 'stdio').toLowerCase();
  if (transport !== 'http' && transport !== 'stdio') {
    throw new Error(`Invalid transport: ${transport}. Must be 'http' or 'stdio'`);
  }
  return transport as 'http' | 'stdio';
}

function validatePositiveInteger(name: string, value: string | undefined, defaultValue: number): number {
  if (!value) {
    return defaultValue;
  }
  const parsed = parseInt(value, 10);
  if (isNaN(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${name}: ${value}. Must be a positive integer.`);
  }
  return parsed;
}

// Load and validate configuration
function loadConfig(): Config {
  try {
    // Get AB_BASE_URL for building default URLs
    const abBaseUrl = validateEnvVar('AB_BASE_URL', process.env.AB_BASE_URL, false) || 'https://test.accelbyte.io';
    
    // Determine transport mode first so we can use it for other config values
    const transport = validateTransport(process.env.TRANSPORT);
    
    const config: Config = {
      // Server Configuration
      port: validatePort(process.env.PORT),
      nodeEnv: validateEnvVar('NODE_ENV', process.env.NODE_ENV, false) || 'development',
      logLevel: validateLogLevel(process.env.LOG_LEVEL),
      transport,

      // OpenAPI configuration
      openapi: {
        specsDir: (() => {
          const specsDirEnv = validateEnvVar('OPENAPI_SPECS_DIR', process.env.OPENAPI_SPECS_DIR, false) || 'openapi-specs';
          // If it's already an absolute path, use it as is, otherwise resolve relative to project root
          return path.isAbsolute(specsDirEnv) 
            ? specsDirEnv 
            : path.resolve(projectRoot, specsDirEnv);
        })(),
        defaultSearchLimit: validatePositiveInteger('OPENAPI_DEFAULT_SEARCH_LIMIT', process.env.OPENAPI_DEFAULT_SEARCH_LIMIT, 5),
        defaultServerUrl: abBaseUrl,
        includeWriteRequests: validateBoolean(process.env.INCLUDE_WRITE_REQUESTS, true)
      },
      
      // OAuth Configuration
      oauth: {
        clientId: validateEnvVar('OAUTH_CLIENT_ID', process.env.OAUTH_CLIENT_ID, false),
        clientSecret: validateEnvVar('OAUTH_CLIENT_SECRET', process.env.OAUTH_CLIENT_SECRET, false),
        redirectUri: validateEnvVar('OAUTH_REDIRECT_URI', process.env.OAUTH_REDIRECT_URI, false) || '', // Not used with session token auth
        authorizationUrl: validateEnvVar('OAUTH_AUTHORIZATION_URL', process.env.OAUTH_AUTHORIZATION_URL, false) || `${abBaseUrl}/iam/v3/oauth/authorize`,
        tokenUrl: validateEnvVar('OAUTH_TOKEN_URL', process.env.OAUTH_TOKEN_URL, false) || `${abBaseUrl}/iam/v3/oauth/token`,
        // Always enable client credentials fallback in stdio mode, respect flag in HTTP mode (default: false)
        enableClientCredentialsFallback: transport === 'stdio'
          ? true
          : validateBoolean(process.env.ENABLE_CLIENT_CREDENTIALS_FALLBACK, false),
      },
      
      // OIDC Configuration
      oidc: {
        jwksUri: validateEnvVar('JWKS_URI', process.env.JWKS_URI, false) || `${abBaseUrl}/iam/v3/oauth/jwks`,
        issuer: validateEnvVar('JWT_ISSUER', process.env.JWT_ISSUER, false) || abBaseUrl,
        audience: validateEnvVar('JWT_AUDIENCE', process.env.JWT_AUDIENCE, false) || 'NOT_SET',
        algorithms: process.env.JWT_ALGORITHMS ? process.env.JWT_ALGORITHMS.split(',') : ['RS256']
      }
    };

    // Log configuration status
    logger.info({ 
      projectRoot,
      port: config.port,
      nodeEnv: config.nodeEnv,
      logLevel: config.logLevel,
      transport: config.transport,
      openapiSpecsDir: config.openapi.specsDir,
      openapiDefaultServerUrl: config.openapi.defaultServerUrl,
      includeWriteRequests: config.openapi.includeWriteRequests,
      oauthConfigured: !!(config.oauth.clientId && config.oauth.authorizationUrl),
      enableClientCredentialsFallback: config.oauth.enableClientCredentialsFallback,
      oidcConfigured: !!(config.oidc.jwksUri && config.oidc.issuer)
    }, 'Configuration loaded');

    // Warn about missing OAuth configuration
    if (!config.oauth.clientId || !config.oauth.authorizationUrl) {
      logger.warn('OAuth configuration is incomplete. Authentication will be disabled.');
      logger.warn('Set OAUTH_CLIENT_ID and OAUTH_AUTHORIZATION_URL to enable OAuth.');
    }

    // Warn about missing OIDC configuration
    if (!config.oidc.jwksUri || !config.oidc.issuer) {
      logger.warn('OIDC configuration is incomplete. Set JWKS_URI and JWT_ISSUER environment variables.');
    }

    return config;
  } catch (error) {
    logger.fatal({ error: error instanceof Error ? error.message : 'Unknown error' }, 'Failed to load configuration');
    process.exit(1);
  }
}

// Export the configuration
export const config = loadConfig();

// Export individual config sections for convenience
export const serverConfig = {
  port: config.port,
  nodeEnv: config.nodeEnv,
  logLevel: config.logLevel
};

export const oauthConfig = config.oauth;
export const oidcConfig = config.oidc;
export const openApiConfig = config.openapi;
