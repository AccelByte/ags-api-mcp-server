import dotenv from 'dotenv';
import { logger } from './logger';

// Load environment variables
dotenv.config();

export interface Config {
  // Server Configuration
  port: number;
  nodeEnv: string;
  logLevel: string;

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
    userInfoUrl: string;
  };
  
  // OIDC Configuration
  oidc: {
    jwksUri: string;
    issuer: string;
    audience: string;
    algorithms: string[];
    disableValidation: boolean;
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
    const config: Config = {
      // Server Configuration
      port: validatePort(process.env.PORT),
      nodeEnv: validateEnvVar('NODE_ENV', process.env.NODE_ENV, false) || 'development',
      logLevel: validateLogLevel(process.env.LOG_LEVEL),

      // OpenAPI configuration
      openapi: {
        specsDir: validateEnvVar('OPENAPI_SPECS_DIR', process.env.OPENAPI_SPECS_DIR, false) || 'openapi-specs',
        defaultSearchLimit: validatePositiveInteger('OPENAPI_DEFAULT_SEARCH_LIMIT', process.env.OPENAPI_DEFAULT_SEARCH_LIMIT, 5),
        defaultServerUrl: validateEnvVar('AB_BASE_URL', process.env.AB_BASE_URL, false) || undefined,
        includeWriteRequests: validateBoolean(process.env.INCLUDE_WRITE_REQUESTS, false)
      },
      
      // OAuth Configuration
      oauth: {
        clientId: validateEnvVar('OAUTH_CLIENT_ID', process.env.OAUTH_CLIENT_ID, false),
        clientSecret: validateEnvVar('OAUTH_CLIENT_SECRET', process.env.OAUTH_CLIENT_SECRET, false),
        redirectUri: validateEnvVar('OAUTH_REDIRECT_URI', process.env.OAUTH_REDIRECT_URI, false) || 'http://localhost:3000/oauth/callback',
        authorizationUrl: validateEnvVar('OAUTH_AUTHORIZATION_URL', process.env.OAUTH_AUTHORIZATION_URL, false),
        tokenUrl: validateEnvVar('OAUTH_TOKEN_URL', process.env.OAUTH_TOKEN_URL, false),
        userInfoUrl: validateEnvVar('OAUTH_USER_INFO_URL', process.env.OAUTH_USER_INFO_URL, false),
      },
      
      // OIDC Configuration
      oidc: {
        jwksUri: validateEnvVar('JWKS_URI', process.env.JWKS_URI, false) || 'https://development.accelbyte.io/iam/v3/oauth/jwks',
        issuer: validateEnvVar('JWT_ISSUER', process.env.JWT_ISSUER, false) || 'https://development.accelbyte.io',
        audience: validateEnvVar('JWT_AUDIENCE', process.env.JWT_AUDIENCE, false) || '0f8b2a3ecb63466994d5e4631d3b9fe7',
        algorithms: process.env.JWT_ALGORITHMS ? process.env.JWT_ALGORITHMS.split(',') : ['RS256'],
        disableValidation: validateBoolean(process.env.DISABLE_JWT_VALIDATION, false)
      }
    };

    // Log configuration status
    logger.info({ 
      port: config.port,
      nodeEnv: config.nodeEnv,
      logLevel: config.logLevel,
      openapiSpecsDir: config.openapi.specsDir,
      openapiDefaultServerUrl: config.openapi.defaultServerUrl,
      includeWriteRequests: config.openapi.includeWriteRequests,
      oauthConfigured: !!(config.oauth.clientId && config.oauth.authorizationUrl),
      oidcConfigured: !!(config.oidc.jwksUri && config.oidc.issuer),
      oidcValidationDisabled: config.oidc.disableValidation
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

    // Warn about disabled OIDC validation
    if (config.oidc.disableValidation) {
      logger.warn('OIDC validation is disabled. This should only be used for development/testing.');
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
