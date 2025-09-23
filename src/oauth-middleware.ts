import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import axios from 'axios';
import jwksClient from 'jwks-client';
import crypto from 'crypto';
import { logger } from './logger';
import { oauthConfig, oidcConfig } from './config';

export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  authorizationUrl: string;
  tokenUrl: string;
  userInfoUrl: string;
}

export interface User {
  id: string;
  email?: string;
  name?: string;
  [key: string]: any;
}

export class OAuthMiddleware {
  private config: OAuthConfig;
  private jwksClient: any;
  private rateLimitMap: Map<string, number[]>;

  constructor() {
    this.config = oauthConfig;
    this.rateLimitMap = new Map();

    // Initialize JWKS client for OIDC token verification
    this.jwksClient = jwksClient({
      jwksUri: oidcConfig.jwksUri
    });
    logger.info({ jwksUri: oidcConfig.jwksUri }, 'JWKS client initialized');

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

  initiateOAuth(req: Request, res: Response): void {
    // Log incoming request details
    logger.info({
      method: req.method,
      url: req.url,
      headers: {
        'user-agent': req.get('User-Agent'),
        'accept': req.get('Accept'),
        'referer': req.get('Referer'),
        'x-forwarded-for': req.get('X-Forwarded-For'),
        'x-real-ip': req.get('X-Real-IP')
      },
      query: req.query,
      ip: req.ip,
      cookies: req.cookies
    }, 'OAuth initiation request received');

    if (!this.config.clientId || !this.config.authorizationUrl) {
      logger.error('OAuth not configured - missing clientId or authorizationUrl');
      res.status(501).json({ 
        error: 'OAuth not configured. Please set OAUTH_CLIENT_ID and OAUTH_AUTHORIZATION_URL environment variables.' 
      });
      return;
    }

    const state = this.generateState();
    const codeVerifier = this.generateCodeVerifier();
    const codeChallenge = this.generateCodeChallenge(codeVerifier);
    
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      response_type: 'code',
      scope: 'openid profile email',
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      resource: 'http://localhost:3000' // RFC 8707 Resource Indicators
    });

    // Store state and code verifier in cookies for validation
    res.cookie('oauth_state', state, { 
      httpOnly: true, 
      secure: process.env.NODE_ENV === 'production',
      maxAge: 600000 // 10 minutes
    });
    
    res.cookie('oauth_code_verifier', codeVerifier, { 
      httpOnly: true, 
      secure: process.env.NODE_ENV === 'production',
      maxAge: 600000 // 10 minutes
    });

    const authUrl = `${this.config.authorizationUrl}?${params.toString()}`;
    
    logger.info({
      state,
      codeVerifier: codeVerifier.substring(0, 8) + '...',
      codeChallenge,
      authUrl,
      clientId: this.config.clientId,
      redirectUri: this.config.redirectUri,
      scope: 'openid profile email'
    }, 'OAuth initiation - redirecting to authorization server');

    res.redirect(authUrl);
  }

  async handleCallback(req: Request, res: Response): Promise<void> {
    // Log incoming callback request details
    logger.info({
      method: req.method,
      url: req.url,
      headers: {
        'user-agent': req.get('User-Agent'),
        'accept': req.get('Accept'),
        'referer': req.get('Referer'),
        'x-forwarded-for': req.get('X-Forwarded-For'),
        'x-real-ip': req.get('X-Real-IP')
      },
      query: req.query,
      ip: req.ip,
      cookies: req.cookies
    }, 'OAuth callback request received');

    // Security: Rate limiting for OAuth callbacks
    const clientKey = req.ip || 'unknown';
    const now = Date.now();
    const windowMs = 5 * 60 * 1000; // 5 minutes
    const maxAttempts = 10; // Max 10 attempts per 5 minutes per IP
    
    if (!this.rateLimitMap) {
      this.rateLimitMap = new Map();
    }
    
    const clientAttempts = this.rateLimitMap.get(clientKey) || [];
    const recentAttempts = clientAttempts.filter((timestamp: number) => now - timestamp < windowMs);
    
    if (recentAttempts.length >= maxAttempts) {
      logger.error({ 
        ip: req.ip, 
        attempts: recentAttempts.length,
        windowMs 
      }, 'OAuth callback rate limit exceeded');
      res.status(429).json({ error: 'Too many OAuth callback attempts' });
      return;
    }
    
    recentAttempts.push(now);
    this.rateLimitMap.set(clientKey, recentAttempts);

    const { code, state } = req.query;
    const storedState = req.cookies?.oauth_state;
    const codeVerifier = req.cookies?.oauth_code_verifier;

    logger.info({
      code: code ? `${String(code).substring(0, 8)}...` : 'none',
      state,
      storedState,
      hasCodeVerifier: !!codeVerifier,
      codeVerifier: codeVerifier ? `${codeVerifier.substring(0, 8)}...` : 'none',
      allQueryParams: req.query,
      headers: req.headers
    }, 'OAuth callback parameters extracted');

    if (!code) {
      logger.error('Authorization code not provided in callback');
      res.status(400).json({ error: 'Authorization code not provided' });
      return;
    }

    if (state !== storedState) {
      logger.warn({ 
        receivedState: state, 
        storedState,
        stateMatch: state === storedState,
        hasStoredState: !!storedState,
        cookies: req.cookies,
        ip: req.ip,
        userAgent: req.get('User-Agent')
      }, 'State parameter mismatch - this might be expected for mcp-remote');
      
      // For mcp-remote, we might not have stored state, so we'll proceed without strict validation
      if (!storedState) {
        // Additional security checks for mcp-remote callbacks
        const isLocalhost = req.ip === '127.0.0.1' || req.ip === '::1' || req.ip === '::ffff:127.0.0.1';
        const isLocalhostReferer = req.get('Referer')?.includes('localhost') || req.get('Referer')?.includes('127.0.0.1');
        
        if (!isLocalhost && !isLocalhostReferer) {
          logger.error({ 
            ip: req.ip, 
            referer: req.get('Referer'),
            userAgent: req.get('User-Agent')
          }, 'Suspicious OAuth callback - not from localhost');
          res.status(400).json({ error: 'Invalid callback source' });
          return;
        }
        
        logger.info('No stored state found - proceeding with callback (likely mcp-remote) with localhost validation');
      } else {
        res.status(400).json({ error: 'Invalid state parameter' });
        return;
      }
    }

    if (!codeVerifier) {
      logger.warn('Code verifier not found in cookies - this might be expected for mcp-remote');
      // For mcp-remote, we might not have stored code verifier, so we'll proceed without PKCE
      logger.info('Proceeding without PKCE (likely mcp-remote)');
    }

    try {
      // Exchange authorization code for access token with PKCE (if available)
      const tokenRequestData: any = {
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        code,
        redirect_uri: this.config.redirectUri,
        grant_type: 'authorization_code',
        resource: 'http://localhost:3000' // RFC 8707 Resource Indicators
      };

      // Add code verifier only if available (for PKCE)
      if (codeVerifier) {
        tokenRequestData.code_verifier = codeVerifier;
      }

      logger.info({ 
        tokenUrl: this.config.tokenUrl,
        clientId: this.config.clientId,
        redirectUri: this.config.redirectUri,
        hasClientSecret: !!this.config.clientSecret,
        codeLength: String(code).length,
        codeVerifierLength: codeVerifier ? codeVerifier.length : 0,
        hasCodeVerifier: !!codeVerifier,
        requestData: {
          ...tokenRequestData,
          client_secret: this.config.clientSecret ? '***REDACTED***' : undefined,
          code_verifier: codeVerifier ? '***REDACTED***' : undefined
        }
      }, 'Exchanging authorization code for access token');

      let tokenResponse;
      try {
        tokenResponse = await axios.post(this.config.tokenUrl, tokenRequestData, {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        });
      } catch (error: any) {
        logger.error({
          error: error.message,
          status: error.response?.status,
          statusText: error.response?.statusText,
          responseData: error.response?.data,
          requestData: {
            ...tokenRequestData,
            client_secret: tokenRequestData.client_secret ? '***REDACTED***' : undefined,
            code_verifier: tokenRequestData.code_verifier ? '***REDACTED***' : undefined
          }
        }, 'Token exchange failed with AccelByte');
        
        res.status(400).json({ 
          error: 'Authentication failed',
          details: `Request failed with status code ${error.response?.status || 'unknown'}`,
          accelbyteError: error.response?.data
        });
        return;
      }

      logger.info({ 
        status: tokenResponse.status,
        statusText: tokenResponse.statusText,
        headers: tokenResponse.headers,
        tokenType: tokenResponse.data.token_type,
        expiresIn: tokenResponse.data.expires_in,
        scope: tokenResponse.data.scope,
        hasAccessToken: !!tokenResponse.data.access_token,
        hasRefreshToken: !!tokenResponse.data.refresh_token,
        hasIdToken: !!tokenResponse.data.id_token,
        responseData: {
          ...tokenResponse.data,
          access_token: tokenResponse.data.access_token ? '***REDACTED***' : undefined,
          refresh_token: tokenResponse.data.refresh_token ? '***REDACTED***' : undefined,
          id_token: tokenResponse.data.id_token ? '***REDACTED***' : undefined
        }
      }, 'Successfully received access token from OIDC provider');

      const { access_token } = tokenResponse.data;

      // Get user information
      let user: User;
      if (this.config.userInfoUrl) {
        logger.info({ 
          userInfoUrl: this.config.userInfoUrl
        }, 'Fetching user information from OIDC provider');

        const userResponse = await axios.get(this.config.userInfoUrl, {
          headers: {
            'Authorization': `Bearer ${access_token}`
          }
        });
        
        logger.info({ 
          status: userResponse.status,
          userId: userResponse.data.sub || userResponse.data.id,
          email: userResponse.data.email,
          name: userResponse.data.name
        }, 'Successfully retrieved user information from OIDC provider');

        user = userResponse.data;
      } else {
        logger.info('No user info URL configured, using fallback user info from token response');
        // Fallback user info from token response
        user = {
          id: tokenResponse.data.user_id || 'unknown',
          email: tokenResponse.data.email,
          name: tokenResponse.data.name
        };
      }

      // Store user info in session (no JWT needed for OIDC)
      // The access_token from OIDC provider is used directly

      // Clear OAuth state and code verifier cookies
      res.clearCookie('oauth_state');
      res.clearCookie('oauth_code_verifier');

      // Set OIDC access token as HTTP-only cookie
      res.cookie('auth_token', access_token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        maxAge: 60 * 60 * 1000 // 1 hour
      });

      // Redirect to the auth page with the token for easy copying
      res.redirect(`/?token=${encodeURIComponent(access_token)}`);

    } catch (error) {
      logger.error({ error }, 'OAuth callback error');
      res.status(500).json({ 
        error: 'Authentication failed',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  logout(req: Request, res: Response): void {
    res.clearCookie('auth_token');
    res.json({ message: 'Logged out successfully' });
  }

  async authenticate(req: Request, res: Response, next: NextFunction): Promise<void> {
    const token = req.cookies?.auth_token || req.headers.authorization?.replace('Bearer ', '');
    const hasToken = !!token;

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
      hasToken,
      tokenSource: req.cookies?.auth_token ? 'cookie' : (req.headers.authorization ? 'header' : 'none')
    }, 'Authentication attempt');

    // Skip OIDC validation if disabled
    if (oidcConfig.disableValidation) {
      logger.debug('OIDC validation disabled, skipping token verification');
      req.user = { id: 'anonymous', email: 'anonymous@example.com', name: 'Anonymous User' };
      req.accessToken = 'disabled-validation';
      next();
      return;
    }

    if (!token) {
      logger.info({ 
        ip: req.ip,
        endpoint: req.path,
        userAgent: req.headers['user-agent']
      }, 'No token provided, handling authentication flow');
      
      // Set WWW-Authenticate header
      res.set('WWW-Authenticate', 'Bearer realm="MCP Server"');
      
      // For MCP SSE endpoints, return a specific response that MCP clients can handle
      if (req.path.startsWith('/sse') || req.path.startsWith('/mcp/sse') || req.path.startsWith('/mcp')) {
        res.status(401).json({ 
          error: 'Authentication required',
          type: 'mcp_auth_required',
          authUrl: '/auth/login',
          message: 'MCP client needs to authenticate. Visit /auth/login to authenticate.'
        });
        return;
      }
      
      // // For MCP POST endpoints, return JSON error
      // if (req.path.startsWith('/mcp')) {
      //   res.status(401).json({ 
      //     error: 'Authentication required',
      //     loginUrl: '/auth/login',
      //     message: 'MCP request requires authentication. Visit /auth/login to authenticate.'
      //   });
      //   return;
      // }
      
      // For other endpoints, redirect to OAuth flow
      res.redirect('/auth/login');
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
        loginUrl: '/auth/login'
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
          // Validate token audience for this MCP server (RFC 8707)
          const expectedAudience = 'https://localhost:3000';
          const tokenAudience = decoded.aud;
          
          if (tokenAudience && !this.isValidAudience(tokenAudience, expectedAudience)) {
            logger.error({ 
              tokenAudience,
              expectedAudience,
              sub: decoded.sub
            }, 'Token audience validation failed - token not intended for this MCP server');
            reject(new Error('Token audience validation failed'));
            return;
          }
          resolve(decoded);
        }
      });
    });
  }

  private isValidAudience(tokenAudience: string | string[], expectedAudience: string): boolean {
    if (Array.isArray(tokenAudience)) {
      return tokenAudience.includes(expectedAudience);
    }
    return tokenAudience === expectedAudience;
  }

  private generateState(): string {
    return Math.random().toString(36).substring(2, 15) + 
           Math.random().toString(36).substring(2, 15);
  }

  private generateCodeVerifier(): string {
    return crypto.randomBytes(32).toString('base64url');
  }

  private generateCodeChallenge(codeVerifier: string): string {
    return crypto.createHash('sha256').update(codeVerifier).digest('base64url');
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
