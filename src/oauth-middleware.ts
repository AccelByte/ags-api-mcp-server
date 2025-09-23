import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import axios from 'axios';
import jwksClient from 'jwks-client';
import { logger } from './logger';
import { oauthConfig, oidcConfig } from './config';

export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  authorizationUrl: string;
  tokenUrl: string;
  enableClientCredentialsFallback: boolean;
}

export interface User {
  id: string;
  email?: string;
  name?: string;
  [key: string]: any;
}

interface ClientCredentialsToken {
  accessToken: string;
  expiresAt: number;
}

interface ClientCredentialsResult {
  accessToken: string;
  isFromCache: boolean;
}

class ClientCredentialsManager {
  private cachedToken: ClientCredentialsToken | null = null;
  private tokenUrl: string;
  private clientId: string;
  private clientSecret: string;

  constructor(tokenUrl: string, clientId: string, clientSecret: string) {
    this.tokenUrl = tokenUrl;
    this.clientId = clientId;
    this.clientSecret = clientSecret;
  }

  async getAccessToken(): Promise<ClientCredentialsResult | null> {
    // Check if we have a valid cached token
    if (this.cachedToken && Date.now() < this.cachedToken.expiresAt) {
      logger.debug({ expiresAt: new Date(this.cachedToken.expiresAt).toISOString() }, 'Using cached client credentials token');
      return {
        accessToken: this.cachedToken.accessToken,
        isFromCache: true
      };
    }

    // Token expired or not available, get a new one
    try {
      logger.info({ tokenUrl: this.tokenUrl, clientId: this.clientId }, 'Requesting new client credentials token');

      const basicAuth = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
      
      const response = await axios.post(
        this.tokenUrl,
        new URLSearchParams({
          grant_type: 'client_credentials'
        }).toString(),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': `Basic ${basicAuth}`
          }
        }
      );

      const { access_token, expires_in } = response.data;
      
      if (!access_token) {
        logger.error({ responseData: response.data }, 'No access token in client credentials response');
        return null;
      }

      // Cache the token with a safety margin (subtract 60 seconds from expiry)
      const expiresInMs = (expires_in || 3600) * 1000;
      const expiresAt = Date.now() + expiresInMs - 60000;

      this.cachedToken = {
        accessToken: access_token,
        expiresAt
      };

      logger.info({ 
        expiresIn: expires_in, 
        expiresAt: new Date(expiresAt).toISOString() 
      }, 'Successfully obtained client credentials token');

      return {
        accessToken: access_token,
        isFromCache: false
      };
    } catch (error: any) {
      logger.error({
        error: error.message,
        status: error.response?.status,
        statusText: error.response?.statusText,
        responseData: error.response?.data
      }, 'Failed to obtain client credentials token');
      return null;
    }
  }

  clearCache(): void {
    this.cachedToken = null;
    logger.debug('Client credentials token cache cleared');
  }
}

export class OAuthMiddleware {
  private config: OAuthConfig;
  private jwksClient: any;
  private clientCredentialsManager: ClientCredentialsManager | null = null;

  constructor() {
    this.config = oauthConfig;

    // Initialize JWKS client for OIDC token verification
    this.jwksClient = jwksClient({
      jwksUri: oidcConfig.jwksUri
    });
    logger.info({ jwksUri: oidcConfig.jwksUri }, 'JWKS client initialized');

    // Initialize client credentials manager if configured
    if (this.config.clientId && this.config.tokenUrl) {
      this.clientCredentialsManager = new ClientCredentialsManager(
        this.config.tokenUrl,
        this.config.clientId,
        this.config.clientSecret || ''
      );
      logger.info('Client credentials manager initialized');
    }

    this.validateConfig();
  }

  private validateConfig(): void {
    const required = ['clientId', 'authorizationUrl', 'tokenUrl'];
    const missing = required.filter(key => !this.config[key as keyof OAuthConfig]);

    // clientSecret can be empty string, so we only check if it's undefined
    if (this.config.clientSecret === undefined) {
      missing.push('clientSecret');
    }

    if (missing.length > 0) {
      logger.warn({ missing }, 'Missing OAuth configuration');
      logger.warn('OAuth authentication will be disabled. Set environment variables to enable.');
    }
  }

  // Note: initiateOAuth and handleCallback methods removed - using session token authentication instead

  async authenticate(req: Request, res: Response, next: NextFunction): Promise<void> {
    let token = req.cookies?.auth_token || req.headers.authorization?.replace('Bearer ', '');
    const hasProvidedToken = !!token;

    logger.debug({ 
      method: req.method,
      url: req.url,
      path: req.path,
      headers: {
        'user-agent': req.headers['user-agent'],
        'authorization': req.headers.authorization ? '***REDACTED***' : undefined,
        'content-type': req.headers['content-type'],
        'accept': req.headers.accept,
        'x-forwarded-for': req.headers['x-forwarded-for'],
        'x-real-ip': req.headers['x-real-ip']
      },
      cookies: req.cookies,
      query: req.query,
      body: req.body,
      ip: req.ip,
      hasToken: hasProvidedToken,
      tokenSource: req.cookies?.auth_token ? 'cookie' : (req.headers.authorization ? 'header' : 'none')
    }, 'Authentication attempt');

    if (!token) {
      // Try to get a client credentials token if configured and enabled
      if (this.clientCredentialsManager && this.config.enableClientCredentialsFallback) {
        logger.info({ 
          ip: req.ip,
          endpoint: req.path,
          userAgent: req.headers['user-agent']
        }, 'No token provided, attempting client credentials flow');
        
        const clientTokenResult = await this.clientCredentialsManager.getAccessToken();
        if (clientTokenResult) {
          logger.info({ 
            isFromCache: clientTokenResult.isFromCache 
          }, 'Using client credentials token for request');
          token = clientTokenResult.accessToken;
          // Set the token in the request for downstream processing
          req.accessToken = clientTokenResult.accessToken;
          
          // Create a minimal user object for client credentials
          req.user = {
            id: 'client_credentials',
            name: 'Client Credentials',
            isFromCache: clientTokenResult.isFromCache
          };
          
          next();
          return;
        } else {
          logger.warn('Failed to obtain client credentials token');
        }
      } else if (this.clientCredentialsManager && !this.config.enableClientCredentialsFallback) {
        logger.debug('Client credentials fallback is disabled');
      }

      logger.info({ 
        ip: req.ip,
        endpoint: req.path,
        userAgent: req.headers['user-agent']
      }, 'No token provided, handling authentication flow');
      
      // Set WWW-Authenticate header
      res.set('WWW-Authenticate', 'Bearer realm="MCP Server"');

      // Return 401 for all unauthenticated requests
      res.status(401).json({
        error: 'Authentication required',
        message: 'Please provide a valid access token via Bearer authorization header or session cookie.'
      });
      return;
    }

    try {
      logger.debug({
        tokenLength: token.length,
        tokenPrefix: token.substring(0, 20) + '...',
        jwksUri: oidcConfig.jwksUri,
        issuer: oidcConfig.issuer,
        audience: oidcConfig.audience
      }, 'Starting OIDC token verification');

      // Use JWKS for OIDC token verification (RS256)
      const decoded = await this.verifyTokenWithJWKS(token);
      req.user = decoded.user || decoded;
      req.accessToken = decoded.access_token || token;
      
      logger.info({ 
        userId: req.user?.id,
        email: req.user?.email,
        name: req.user?.name,
        endpoint: req.path,
        tokenType: decoded.token_type,
        expiresAt: decoded.exp,
        issuedAt: decoded.iat,
        audience: decoded.aud,
        issuer: decoded.iss,
        scope: decoded.scope
      }, 'Authentication successful');
      
      next();
    } catch (error) {
      logger.error({ 
        error: error instanceof Error ? error.message : 'Unknown error',
        errorType: error instanceof Error ? error.constructor.name : 'Unknown',
        stack: error instanceof Error ? error.stack : undefined,
        tokenLength: token.length,
        tokenPrefix: token.substring(0, 20) + '...',
        ip: req.ip,
        endpoint: req.path,
        jwksUri: oidcConfig.jwksUri
      }, 'OIDC token verification error');
      
      // Set WWW-Authenticate header for invalid tokens
      res.set('WWW-Authenticate', 'Bearer realm="MCP Server"');

      res.status(401).json({
        error: 'Invalid or expired token',
        message: 'Please provide a valid access token.'
      });
    }
  }

  private async verifyTokenWithJWKS(token: string): Promise<any> {
    if (!this.jwksClient) {
      throw new Error('JWKS client not initialized');
    }

    // Decode JWT payload for debugging (without verification)
    const decoded = jwt.decode(token, { complete: true });
    const payload = decoded?.payload as any;
    
    return new Promise((resolve, reject) => {
      jwt.verify(token, (header, callback) => {
        this.jwksClient!.getSigningKey(header.kid, (err: any, key: any) => {
          if (err) {
            logger.error({ 
              error: err,
              kid: header.kid,
              jwksUri: oidcConfig.jwksUri
            }, 'Failed to fetch signing key from JWKS');
            callback(err);
            return;
          }
          
          const signingKey = key?.getPublicKey ? key.getPublicKey() : key?.publicKey || key?.rsaPublicKey;
          
          if (!signingKey) {
            logger.error({
              kid: header.kid,
              keyProperties: Object.keys(key || {}),
              keyType: typeof key,
              hasGetPublicKey: typeof key?.getPublicKey,
              hasPublicKey: !!key?.publicKey,
              hasRsaPublicKey: !!key?.rsaPublicKey
            }, 'No signing key found in JWKS response');
            callback(new Error('No signing key found'));
            return;
          }

          callback(null, signingKey);
        });
      }, {
        algorithms: oidcConfig.algorithms as jwt.Algorithm[],
        issuer: oidcConfig.issuer,
        audience: payload?.aud ? oidcConfig.audience : undefined
      }, (err: any, decoded: any) => {
        if (err) {
          logger.error({ 
            error: err.message,
            errorType: err.name,
            issuer: oidcConfig.issuer,
            audience: oidcConfig.audience
          }, 'OIDC token verification failed');
          reject(err);
        } else {
          resolve(decoded);
        }
      });
    });
  }
}

// Extend Express Request interface
declare global {
  namespace Express {
    interface Request {
      user?: User;
      accessToken?: string;
    }
  }
}
