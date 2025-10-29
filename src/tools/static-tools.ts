import jwt from 'jsonwebtoken';
import { UserContext } from '../mcp-server';
import { logger } from '../logger';

export class StaticTools {
  /**
   * Get token information from the authenticated token
   */
  async getTokenInfo(args?: any, userContext?: UserContext): Promise<object> {
    if (!userContext) {
      throw new Error('User context not available - authentication required');
    }

    if (!userContext.accessToken) {
      throw new Error('Access token not available in user context');
    }

    // Decode the JWT token to get full payload
    let decodedToken: any = null;
    let tokenType = 'unknown';
    let isExpired = false;
    let timeUntilExpiry = 'unknown';
    let isFromCache = userContext.isFromCache || false;

    try {
      decodedToken = jwt.decode(userContext.accessToken, { complete: true });

      if (decodedToken && decodedToken.payload) {
        const payload = decodedToken.payload;

        // Determine token type based on claims
        if (payload.grant_type === 'client_credentials' ||
          (payload.sub && payload.sub.includes('client:')) ||
          (!payload.display_name && payload.client_id)) {
          tokenType = 'client_credentials';
        } else if (payload.grant_type === 'authorization_code' || payload.display_name) {
          tokenType = 'user_token';
        } else if (payload.grant_type === 'refresh_token') {
          tokenType = 'refresh_token';
        }

        // Check expiration
        if (payload.exp) {
          const expiryDate = new Date(payload.exp * 1000);
          const now = new Date();
          isExpired = expiryDate < now;

          if (!isExpired) {
            const diffMs = expiryDate.getTime() - now.getTime();
            const diffMins = Math.floor(diffMs / 60000);
            const diffHours = Math.floor(diffMins / 60);
            const diffDays = Math.floor(diffHours / 24);

            if (diffDays > 0) {
              timeUntilExpiry = `${diffDays} day(s) ${diffHours % 24} hour(s)`;
            } else if (diffHours > 0) {
              timeUntilExpiry = `${diffHours} hour(s) ${diffMins % 60} minute(s)`;
            } else {
              timeUntilExpiry = `${diffMins} minute(s)`;
            }
          } else {
            timeUntilExpiry = 'expired';
          }
        }
      }
    } catch (error) {
      logger.warn({ error }, 'Failed to decode JWT token');
    }

    const response: any = {
      message: 'Token information from authenticated token',
      default_namespace: decodedToken?.payload?.namespace || null,
      namespace_usage_hint: decodedToken?.payload?.namespace
        ? `Use namespace "${decodedToken.payload.namespace}" as the implicit namespace for subsequent API requests when namespace is not explicitly specified`
        : 'No namespace available in token',
      tokenMetadata: {
        type: tokenType,
        isExpired,
        isFromCache
      }
    };

    if (decodedToken && decodedToken.payload) {
      const payload = decodedToken.payload;

      response.tokenClaims = {
        // Standard JWT claims
        issuer: payload.iss,
        subject: payload.sub ? payload.sub.substring(0, 8) + '...' : undefined,
        audience: payload.aud,
        expiresAt: payload.exp ? new Date(payload.exp * 1000).toISOString() : undefined,
        expiresAtTimestamp: payload.exp,
        issuedAt: payload.iat ? new Date(payload.iat * 1000).toISOString() : undefined,
        issuedAtTimestamp: payload.iat,
        notBefore: payload.nbf ? new Date(payload.nbf * 1000).toISOString() : undefined,

        // Custom claims
        grantType: payload.grant_type,
        clientId: payload.client_id ? payload.client_id.substring(0, 8) + '...' : undefined,
        namespace: payload.namespace,

        // User-specific claims (if present)
        userId: payload.user_id ? payload.user_id.substring(0, 8) + '...' : undefined,
        displayName: payload.display_name,
        emailVerified: payload.email_verified,
        phoneVerified: payload.phone_verified,
        isComply: payload.is_comply,

        // Timing information
        timeUntilExpiry,
        isExpired
      };
    }

    return response;
  }
}
