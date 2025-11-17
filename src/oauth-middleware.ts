import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import axios from 'axios';
import crypto from 'crypto';
import jwksClient from 'jwks-client';
import { logger } from './logger.js';
import { oauthConfig, oidcConfig } from './config.js';
import { sessionManager } from './session-manager.js';
import { otpManager } from './otp-manager.js';

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
      logger.debug({ tokenUrl: this.tokenUrl, clientId: this.clientId }, 'Requesting new client credentials token');

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

      logger.debug({ 
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
  private jwksClientPromise: Promise<any> | null = null;
  private rateLimitMap: Map<string, number[]>;
  private clientCredentialsManager: ClientCredentialsManager | null = null;

  constructor() {
    this.config = oauthConfig;
    this.rateLimitMap = new Map();

    // JWKS client will be lazily initialized using dynamic import
    // This is necessary because jwks-client is an ES Module

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

  private async initializeJwksClient(): Promise<any> {
    if (this.jwksClient) {
      return this.jwksClient;
    }

    if (this.jwksClientPromise) {
      return this.jwksClientPromise;
    }

    this.jwksClientPromise = (async () => {
      try {
        this.jwksClient = jwksClient({
          jwksUri: oidcConfig.jwksUri
        });
        
        logger.info({ jwksUri: oidcConfig.jwksUri }, 'JWKS client initialized');
        return this.jwksClient;
      } catch (error) {
        logger.error({ error }, 'Failed to initialize JWKS client');
        throw error;
      }
    })();

    return this.jwksClientPromise;
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
    logger.debug({
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

    // Extract otp_token from query (only secure method supported)
    let sessionToken: string | undefined;
    
    const otpToken = req.query.otp_token as string | undefined;
    if (otpToken) {
      // Exchange OTP for session token
      sessionToken = otpManager.exchangeOTP(otpToken) || undefined;
      
      if (!sessionToken) {
        logger.warn({ 
          otpToken: otpToken.substring(0, 8) + '...',
          ip: req.ip 
        }, 'Invalid or expired OTP token');
        res.status(400).json({ 
          error: 'Invalid or expired OTP token',
          message: 'The one-time password token is invalid, expired, or already used. Please generate a new one.'
        });
        return;
      }
      
      logger.debug({
        otpToken: otpToken.substring(0, 8) + '...',
        sessionToken: sessionToken.substring(0, 8) + '...'
      }, 'OTP token successfully exchanged for session token');
    }
    
    // Check if OTP token was provided
    if (!sessionToken) {
      logger.warn({ 
        ip: req.ip,
        query: req.query 
      }, 'OAuth login initiated without OTP token');
      res.status(400).json({ 
        error: 'Missing OTP token',
        message: 'OAuth login requires an OTP token. Call the start_oauth_login tool to get a secure login URL.'
      });
      return;
    }
    
    // Generate state and encode session token
    const state = this.generateState();
    const stateWithSession = `${state}:session:${sessionToken}`;
    
    const codeVerifier = this.generateCodeVerifier();
    const codeChallenge = this.generateCodeChallenge(codeVerifier);
    
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      response_type: 'code',
      // scope: omitted to use AccelByte's default scopes
      state: stateWithSession,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256'
      // Note: Resource parameter removed - AccelByte may not support RFC 8707 Resource Indicators
    });

    // Store state and code verifier in cookies for validation
    res.cookie('oauth_state', stateWithSession, { 
      httpOnly: true, 
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax', // Allow cookies on same-site redirects
      maxAge: 600000 // 10 minutes
    });
    
    res.cookie('oauth_code_verifier', codeVerifier, { 
      httpOnly: true, 
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax', // Allow cookies on same-site redirects
      maxAge: 600000 // 10 minutes
    });

    const authUrl = `${this.config.authorizationUrl}?${params.toString()}`;
    
    logger.debug({
      state: stateWithSession.substring(0, 20) + '...',
      stateLength: stateWithSession.length,
      hasSessionToken: !!sessionToken,
      sessionToken: sessionToken ? sessionToken.substring(0, 8) + '...' : undefined,
      codeVerifier: codeVerifier.substring(0, 8) + '...',
      codeVerifierLength: codeVerifier.length,
      codeChallenge,
      codeChallengeLength: codeChallenge.length,
      authUrl,
      clientId: this.config.clientId,
      redirectUri: this.config.redirectUri,
      scope: 'default (omitted from request)',
      cookiesWillBeSet: {
        oauth_state: stateWithSession.substring(0, 10) + '...',
        oauth_code_verifier: codeVerifier.substring(0, 10) + '...'
      }
    }, 'OAuth initiation - redirecting to authorization server with PKCE');

    logger.debug({
      cookieSettings: {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 600000,
        domain: undefined // Let browser set domain automatically
      }
    }, 'Cookie settings for oauth_state and oauth_code_verifier');

    res.redirect(authUrl);
  }

  async handleCallback(req: Request, res: Response): Promise<void> {
    // Log incoming callback request details
    logger.debug({
      method: req.method,
      url: req.url,
      fullUrl: `${req.protocol}://${req.get('host')}${req.originalUrl}`,
      path: req.path,
      headers: {
        'user-agent': req.get('User-Agent'),
        'accept': req.get('Accept'),
        'referer': req.get('Referer'),
        'x-forwarded-for': req.get('X-Forwarded-For'),
        'x-real-ip': req.get('X-Real-IP'),
        'cookie': req.get('Cookie') ? 'present' : 'none'
      },
      query: req.query,
      queryString: req.url.split('?')[1],
      ip: req.ip,
      cookies: req.cookies,
      configuredRedirectUri: this.config.redirectUri,
      configuredClientId: this.config.clientId
    }, 'OAuth callback request received - START OF CALLBACK HANDLER');

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

    // Extract session token from state if present (format: "randomstate:session:uuid")
    let sessionToken: string | undefined;
    let baseState: string = String(state || '');
    let baseStoredState: string = String(storedState || '');
    
    if (state && String(state).includes(':session:')) {
      const parts = String(state).split(':session:');
      baseState = parts[0];
      sessionToken = parts[1];
    }
    
    if (storedState && String(storedState).includes(':session:')) {
      const parts = String(storedState).split(':session:');
      baseStoredState = parts[0];
      // If we didn't get sessionToken from query, try from stored state
      if (!sessionToken) {
        sessionToken = parts[1];
      }
    }

    logger.debug({
      code: code ? `${String(code).substring(0, 8)}...` : 'none',
      codeLength: code ? String(code).length : 0,
      state,
      stateLength: state ? String(state).length : 0,
      storedState,
      storedStateLength: storedState ? storedState.length : 0,
      hasSessionToken: !!sessionToken,
      sessionToken: sessionToken ? `${sessionToken.substring(0, 8)}...` : undefined,
      hasCodeVerifier: !!codeVerifier,
      codeVerifier: codeVerifier ? `${codeVerifier.substring(0, 8)}...` : 'none',
      codeVerifierLength: codeVerifier ? codeVerifier.length : 0,
      allQueryParams: req.query,
      allCookies: Object.keys(req.cookies || {}),
      referer: req.get('Referer'),
      userAgent: req.get('User-Agent'),
      configuredRedirectUri: this.config.redirectUri
    }, 'OAuth callback parameters extracted - DETAILED');

    if (!code) {
      logger.error('Authorization code not provided in callback');
      res.status(400).json({ error: 'Authorization code not provided' });
      return;
    }

    if (baseState !== baseStoredState) {
      logger.warn({ 
        receivedState: state, 
        baseState,
        storedState,
        baseStoredState,
        stateMatch: baseState === baseStoredState,
        hasStoredState: !!storedState,
        hasSessionToken: !!sessionToken,
        cookies: req.cookies,
        ip: req.ip,
        userAgent: req.get('User-Agent')
      }, 'State parameter mismatch - this might be expected for external OAuth flows');
      
      // For external OAuth flows, we might not have stored state, so we'll proceed without strict validation
      if (!storedState) {
        // Additional security checks for external OAuth callbacks
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
        
        logger.debug('No stored state found - proceeding with callback (likely external OAuth flow) with localhost validation');
      } else {
        res.status(400).json({ error: 'Invalid state parameter' });
        return;
      }
    }

    if (!codeVerifier) {
      logger.error({
        hasCookieHeader: !!req.get('Cookie'),
        allCookies: Object.keys(req.cookies || {}),
        expectedCookies: ['oauth_state', 'oauth_code_verifier'],
        referer: req.get('Referer'),
        userAgent: req.get('User-Agent')
      }, 'CRITICAL: Code verifier not found in cookies');
      
      // Check if this looks like a direct browser flow (not external OAuth)
      const isDirectBrowserFlow = req.get('User-Agent')?.includes('Mozilla') || 
                                   req.get('Referer')?.includes('accelbyte.io');
      
      if (isDirectBrowserFlow) {
        logger.error('This appears to be a direct browser OAuth flow, but cookies are missing!');
        logger.error('Without code_verifier, AccelByte will reject the token exchange (invalid_grant)');
        logger.error('Possible causes: 1) Cookies blocked by browser, 2) Cookie sameSite issue, 3) Domain mismatch');
        
        res.status(500).json({ 
          error: 'OAuth flow failed',
          message: 'PKCE cookies not preserved. Please check browser cookie settings.',
          details: {
            expectedCookies: ['oauth_state', 'oauth_code_verifier'],
            receivedCookies: Object.keys(req.cookies || {}),
            troubleshooting: [
              'Check if cookies are enabled in your browser',
              'Try in an incognito/private window',
              'Check browser console for cookie warnings',
              'Ensure you\'re accessing via http://localhost:3000 (not 127.0.0.1)'
            ]
          }
        });
        return;
      }
      
      logger.debug('Code verifier not found in cookies - assuming external OAuth flow');
    }

    try {
      // Exchange authorization code for access token with PKCE (if available)
      const tokenRequestData: any = {
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        code,
        redirect_uri: this.config.redirectUri,
        grant_type: 'authorization_code'
        // Note: Resource parameter removed - AccelByte may not support RFC 8707 Resource Indicators
      };

      // Add code verifier only if available (for PKCE)
      if (codeVerifier) {
        tokenRequestData.code_verifier = codeVerifier;
      }

      // Prepare request details for logging
      const requestHeaders = {
        'Content-Type': 'application/x-www-form-urlencoded'
      };

      // Convert to URLSearchParams to see exact format
      const formData = new URLSearchParams();
      Object.entries(tokenRequestData).forEach(([key, value]) => {
        formData.append(key, String(value));
      });

      logger.debug({ 
        tokenUrl: this.config.tokenUrl,
        clientId: this.config.clientId,
        redirectUri: this.config.redirectUri,
        hasClientSecret: !!this.config.clientSecret,
        clientSecretLength: this.config.clientSecret?.length || 0,
        codeLength: String(code).length,
        codePrefix: String(code).substring(0, 10) + '...',
        codeVerifierLength: codeVerifier ? codeVerifier.length : 0,
        hasCodeVerifier: !!codeVerifier,
        requestHeaders,
        requestData: {
          ...tokenRequestData,
          client_secret: this.config.clientSecret ? `***REDACTED*** (${this.config.clientSecret.length} chars)` : undefined,
          code: String(code).substring(0, 10) + '...',
          code_verifier: codeVerifier ? `***REDACTED*** (${codeVerifier.length} chars)` : undefined
        },
        formEncodedBody: formData.toString().replace(
          /client_secret=[^&]*/g, 
          'client_secret=***REDACTED***'
        ).replace(
          /code_verifier=[^&]*/g,
          'code_verifier=***REDACTED***'
        )
      }, 'Exchanging authorization code for access token - FULL REQUEST DETAILS');

      let tokenResponse;
      try {
        tokenResponse = await axios.post(this.config.tokenUrl, formData, {
          headers: requestHeaders
        });
      } catch (error: any) {
        logger.error({
          error: error.message,
          errorCode: error.code,
          status: error.response?.status,
          statusText: error.response?.statusText,
          responseHeaders: error.response?.headers,
          responseData: error.response?.data,
          requestUrl: this.config.tokenUrl,
          requestMethod: 'POST',
          requestHeaders,
          requestData: {
            ...tokenRequestData,
            client_secret: tokenRequestData.client_secret ? `***REDACTED*** (${tokenRequestData.client_secret.length} chars)` : undefined,
            code: String(tokenRequestData.code).substring(0, 10) + '...',
            code_verifier: tokenRequestData.code_verifier ? `***REDACTED*** (${tokenRequestData.code_verifier.length} chars)` : undefined
          },
          fullRequestBody: formData.toString().replace(
            /client_secret=[^&]*/g, 
            'client_secret=***REDACTED***'
          ).replace(
            /code_verifier=[^&]*/g,
            'code_verifier=***REDACTED***'
          ).replace(
            /code=[^&]*/g,
            match => {
              const codeValue = match.split('=')[1];
              return `code=${codeValue.substring(0, 10)}...`;
            }
          )
        }, 'Token exchange failed with AccelByte - FULL ERROR DETAILS');
        
        res.status(400).json({ 
          error: 'Authentication failed',
          details: `Request failed with status code ${error.response?.status || 'unknown'}`,
          accelbyteError: error.response?.data
        });
        return;
      }

      logger.debug({ 
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

      const { access_token, refresh_token, expires_in, refresh_expires_in } = tokenResponse.data;

      // Get user information from token response
      logger.debug('Using user info from token response');
      const user: User = {
        id: tokenResponse.data.user_id || 'unknown',
        email: tokenResponse.data.email,
        name: tokenResponse.data.name
      };

      // Store tokens in session manager if session_token was provided
      if (sessionToken) {
        const stored = sessionManager.setAuthenticated(
          sessionToken,
          access_token,
          refresh_token,
          expires_in || 3600, // Default to 1 hour if not provided
          user.id,
          user.email,
          user.name,
          refresh_expires_in
        );

        if (stored) {
          logger.debug({ 
            sessionToken: sessionToken.substring(0, 8) + '...',
            userId: user.id,
            hasRefreshToken: !!refresh_token 
          }, 'Tokens stored in session manager');
        } else {
          logger.warn({ 
            sessionToken: sessionToken.substring(0, 8) + '...' 
          }, 'Failed to store tokens in session manager - session may not exist');
        }
      }

      // Store user info in session (no JWT needed for OIDC)
      // The access_token from OIDC provider is used directly

      // Clear OAuth state and code verifier cookies
      res.clearCookie('oauth_state');
      res.clearCookie('oauth_code_verifier');

      // Set OIDC access token as HTTP-only cookie (for backwards compatibility)
      res.cookie('auth_token', access_token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        maxAge: 60 * 60 * 1000 // 1 hour
      });

      // If session token was used, show success page. Otherwise redirect with token in URL
      if (sessionToken) {
        res.send(`
          <!DOCTYPE html>
          <html>
          <head>
            <title>Authentication Successful</title>
            <style>
              body { font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; }
              .success { color: #28a745; font-size: 24px; margin-bottom: 20px; }
              .info { background: #f8f9fa; padding: 15px; border-radius: 5px; margin-bottom: 20px; }
              code { background: #e9ecef; padding: 2px 6px; border-radius: 3px; }
            </style>
          </head>
          <body>
            <div class="success">✅ Authentication Successful!</div>
            <div class="info">
              <p><strong>Your session is now authenticated.</strong></p>
              <p>Session Token: <code>${sessionToken.substring(0, 8)}...${sessionToken.substring(sessionToken.length - 4)}</code></p>
              <p>User: ${user.name || user.email || user.id}</p>
            </div>
            <p>You can now close this window and use your MCP client with this session token.</p>
            <p>Use the <code>get_token_info</code> tool to verify your session is active and using an OAuth user token.</p>
          </body>
          </html>
        `);
      } else {
        // Redirect to the auth page with the token for easy copying (legacy behavior)
        res.redirect(`/?token=${encodeURIComponent(access_token)}`);
      }

    } catch (error) {
      logger.error({ error }, 'OAuth callback error');
      res.status(500).json({ 
        error: 'Authentication failed',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }


  async authenticate(req: Request, res: Response, next: NextFunction): Promise<void> {
    let token = req.cookies?.auth_token || req.headers.authorization?.replace('Bearer ', '');
    const hasProvidedToken = !!token;

    // Check for session token (priority: MCP session ID > SESSION_TOKEN env)
    const sessionToken = (req.headers['mcp-session-id'] as string)

    // If session token is provided, try to get access token from session
    if (sessionToken && !token) {
      const sessionResult = sessionManager.getAccessToken(sessionToken);
      
      if (sessionResult) {
        // Get full session data for user info
        const session = sessionManager.getSession(sessionToken);
        
        // If token is expired, attempt synchronous refresh before proceeding
        if (sessionResult.isExpired && session?.refresh_token) {
          logger.debug({ 
            sessionToken: sessionToken.substring(0, 8) + '...',
            userId: session?.user_id
          }, 'Access token expired, attempting synchronous refresh with refresh token');
          
          try {
            const refreshed = await sessionManager.refreshToken(
              sessionToken,
              this.config.tokenUrl,
              this.config.clientId,
              this.config.clientSecret
            );
            
            if (refreshed) {
              // Successfully refreshed - get new token
              const newSessionResult = sessionManager.getAccessToken(sessionToken);
              if (newSessionResult) {
                token = newSessionResult.accessToken;
                req.accessToken = newSessionResult.accessToken;
                
                if (session) {
                  req.user = {
                    id: session.user_id || 'unknown',
                    email: session.user_email,
                    name: session.user_name
                  };
                }
                
                logger.debug({ 
                  sessionToken: sessionToken.substring(0, 8) + '...',
                  userId: session?.user_id
                }, 'Token refreshed successfully, proceeding with request');
                
                next();
                return;
              }
            }
            
            // Refresh failed - session is now marked as expired, fall through to client credentials
            logger.warn({ 
              sessionToken: sessionToken.substring(0, 8) + '...',
              userId: session?.user_id
            }, 'Refresh token failed or expired - session marked as expired');
            
            (req as any).sessionExpired = true;
            (req as any).expiredSessionToken = sessionToken.substring(0, 8) + '...' + sessionToken.substring(sessionToken.length - 4);
            
            // Don't set token, fall through to client credentials fallback
            token = undefined;
          } catch (error) {
            logger.error({ 
              error, 
              sessionToken: sessionToken.substring(0, 8) + '...' 
            }, 'Exception during token refresh');
            
            (req as any).sessionExpired = true;
            (req as any).expiredSessionToken = sessionToken.substring(0, 8) + '...' + sessionToken.substring(sessionToken.length - 4);
            token = undefined;
          }
        } else {
          // Token is valid (not expired)
          token = sessionResult.accessToken;
          req.accessToken = sessionResult.accessToken;
          
          if (session) {
            req.user = {
              id: session.user_id || 'unknown',
              email: session.user_email,
              name: session.user_name
            };
          }
          
          const tokenSource = req.headers['mcp-session-id'] ? 'MCP session' : 'SESSION_TOKEN env';
          
          logger.debug({ 
            sessionToken: sessionToken.substring(0, 8) + '...',
            userId: session?.user_id,
            isExpired: sessionResult.isExpired,
            source: tokenSource
          }, 'Using token from session');
          
          // Token found and valid, proceed with authentication
          next();
          return;
        }
      } else {
        // Check if session exists but is expired
        const session = sessionManager.getSession(sessionToken);
        
        if (session && session.status === 'expired') {
          logger.warn({ 
            sessionToken: sessionToken.substring(0, 8) + '...',
            fallbackEnabled: this.config.enableClientCredentialsFallback
          }, 'User session has expired');
          
          // Mark that session expired (for fallback warning)
          (req as any).sessionExpired = true;
          (req as any).expiredSessionToken = sessionToken.substring(0, 8) + '...' + sessionToken.substring(sessionToken.length - 4);
        } else {
          logger.debug({ 
            sessionToken: sessionToken.substring(0, 8) + '...' 
          }, 'Session token provided but no valid session found');
        }
      }
    }

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
      // Check if we're falling back from an expired session
      const isSessionExpiredFallback = !!(req as any).sessionExpired;
      
      // Try to get a client credentials token if configured and enabled
      if (this.clientCredentialsManager && this.config.enableClientCredentialsFallback) {
        if (isSessionExpiredFallback) {
          logger.warn({ 
            ip: req.ip,
            endpoint: req.path,
            expiredSessionToken: (req as any).expiredSessionToken
          }, '⚠️  USER SESSION EXPIRED - Falling back to client credentials (app-level permissions)');
        } else {
          logger.debug({ 
            ip: req.ip,
            endpoint: req.path,
            userAgent: req.headers['user-agent']
          }, 'No token provided, attempting client credentials flow');
        }
        
        const clientTokenResult = await this.clientCredentialsManager.getAccessToken();
        if (clientTokenResult) {
          if (isSessionExpiredFallback) {
            logger.warn({ 
              isFromCache: clientTokenResult.isFromCache,
              expiredSessionToken: (req as any).expiredSessionToken
            }, '⚠️  Using CLIENT CREDENTIALS as fallback - User now has APP-LEVEL permissions (not user-specific). Re-authenticate with start_oauth_login tool to restore user permissions.');
            
            // Add warning header for HTTP clients
            res.setHeader('X-Auth-Status', 'session-expired-using-fallback');
            res.setHeader('X-Auth-Level', 'application');
            res.setHeader('X-Session-Status', 'expired');
          } else {
            logger.debug({ 
              isFromCache: clientTokenResult.isFromCache 
            }, 'Using client credentials token for request');
          }
          
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

      // At this point, no token is available - check if it's due to expired session
      if (isSessionExpiredFallback) {
        logger.warn({ 
          ip: req.ip,
          endpoint: req.path,
          expiredSessionToken: (req as any).expiredSessionToken,
          userAgent: req.headers['user-agent']
        }, '🔒 USER SESSION EXPIRED - Client credentials fallback is disabled, returning 401');
      } else {
        logger.debug({ 
          ip: req.ip,
          endpoint: req.path,
          userAgent: req.headers['user-agent']
        }, 'No token provided, handling authentication flow');
      }
      
      // Set WWW-Authenticate header
      res.set('WWW-Authenticate', 'Bearer realm="MCP Server"');
      
      // For MCP endpoints, return a specific response that MCP clients can handle
      if (req.path.startsWith('/mcp')) {
        if (isSessionExpiredFallback) {
          // Session expired - provide specific guidance
          res.status(401).json({ 
            error: 'Session expired',
            type: 'session_expired',
            session_token_hint: (req as any).expiredSessionToken,
            message: 'Your authentication session has expired. Please re-authenticate to continue.',
            action: 'Use the start_oauth_login tool to re-authenticate and get a new session.',
            note: 'Your refresh token has expired. You need to complete the OAuth flow again.'
          });
        } else {
          // No authentication at all
          res.status(401).json({ 
            error: 'Authentication required',
            type: 'mcp_auth_required',
            authUrl: '/auth/login',
            message: 'MCP client needs to authenticate. Visit /auth/login to authenticate.'
          });
        }
        return;
      }
      
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
      
      logger.debug({ 
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
    // Ensure JWKS client is initialized
    const jwksClient = await this.initializeJwksClient();
    
    if (!jwksClient) {
      throw new Error('JWKS client not initialized');
    }

    // Decode JWT payload for debugging (without verification)
    const decoded = jwt.decode(token, { complete: true });
    const payload = decoded?.payload as any;
    
    return new Promise((resolve, reject) => {
      jwt.verify(token, (header, callback) => {
        jwksClient.getSigningKey(header.kid, (err: any, key: any) => {
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
