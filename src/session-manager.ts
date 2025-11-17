import crypto from 'crypto';
import axios from 'axios';
import { logger } from './logger.js';

export interface SessionData {
  status: 'pending' | 'authenticated' | 'expired';
  access_token?: string;
  refresh_token?: string;
  expires_at?: number; // Access token expiry
  refresh_expires_at?: number; // Refresh token expiry
  user_id?: string;
  user_email?: string;
  user_name?: string;
  created_at: number;
  last_accessed_at: number;
}

export interface SessionInfo {
  session_token: string;
  url: string;
  instructions: string;
  expires_in: number;
}

export class SessionManager {
  private sessions: Map<string, SessionData>;
  private cleanupInterval: NodeJS.Timeout | null = null;
  private readonly SESSION_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes for pending sessions
  private readonly AUTHENTICATED_SESSION_CLEANUP_MS = 30 * 24 * 60 * 60 * 1000; // 30 days for authenticated sessions
  private readonly CLEANUP_INTERVAL_MS = 60 * 1000; // Run cleanup every minute

  constructor() {
    this.sessions = new Map();
    // Skip cleanup interval in test mode to prevent hanging
    if (process.env.NODE_ENV !== 'test') {
      this.startCleanup();
    }
    logger.info('SessionManager initialized');
  }

  /**
   * Creates a new pending session and returns login URL
   */
  createSession(baseUrl: string): SessionInfo {
    const sessionToken = crypto.randomUUID();
    
    this.sessions.set(sessionToken, {
      status: 'pending',
      created_at: Date.now(),
      last_accessed_at: Date.now()
    });

    logger.info({ 
      sessionToken,
      totalSessions: this.sessions.size 
    }, 'New session created');

    return {
      session_token: sessionToken,
      url: `${baseUrl}/auth/login?session_token=${sessionToken}`,
      instructions: 'Open this URL in your browser to authenticate. After successful login, use the session_token in your MCP client configuration.',
      expires_in: this.SESSION_TIMEOUT_MS / 1000 // in seconds
    };
  }

  /**
   * Creates a new pending session with a specific token (for pre-configured SESSION_TOKEN)
   */
  createSessionWithToken(sessionToken: string, baseUrl: string): SessionInfo {
    this.sessions.set(sessionToken, {
      status: 'pending',
      created_at: Date.now(),
      last_accessed_at: Date.now()
    });

    logger.debug({ 
      sessionToken: sessionToken.substring(0, 8) + '...',
      totalSessions: this.sessions.size 
    }, 'New session created with provided token');

    return {
      session_token: sessionToken,
      url: `${baseUrl}/auth/login?session_token=${sessionToken}`,
      instructions: 'Open this URL in your browser to authenticate.',
      expires_in: this.SESSION_TIMEOUT_MS / 1000 // in seconds
    };
  }

  /**
   * Updates session with authentication tokens
   */
  setAuthenticated(
    sessionToken: string, 
    accessToken: string, 
    refreshToken: string | undefined,
    expiresIn: number,
    userId: string,
    userEmail?: string,
    userName?: string,
    refreshExpiresIn?: number
  ): boolean {
    const session = this.sessions.get(sessionToken);
    
    if (!session) {
      logger.warn({ sessionToken }, 'Attempted to authenticate non-existent session');
      return false;
    }

    session.status = 'authenticated';
    session.access_token = accessToken;
    session.refresh_token = refreshToken;
    session.expires_at = Date.now() + (expiresIn * 1000);
    if (refreshExpiresIn) {
      session.refresh_expires_at = Date.now() + (refreshExpiresIn * 1000);
    }
    session.user_id = userId;
    session.user_email = userEmail;
    session.user_name = userName;
    session.last_accessed_at = Date.now();

    logger.debug({ 
      sessionToken,
      userId,
      userEmail,
      expiresIn,
      refreshExpiresIn
    }, 'Session authenticated successfully');

    return true;
  }

  /**
   * Gets session data and updates last accessed time
   */
  getSession(sessionToken: string): SessionData | null {
    const session = this.sessions.get(sessionToken);
    
    if (!session) {
      return null;
    }

    // Update last accessed time
    session.last_accessed_at = Date.now();

    // Note: We don't mark session as 'expired' just because access token expired
    // The session should remain 'authenticated' as long as we have a valid refresh token
    // Only mark as 'expired' when refresh token refresh fails (handled in refreshToken method)

    return session;
  }

  /**
   * Gets access token from session
   */
  getAccessToken(sessionToken: string): { accessToken: string; isExpired: boolean } | null {
    const session = this.getSession(sessionToken);
    
    if (!session || session.status !== 'authenticated' || !session.access_token) {
      return null;
    }

    // Check if token is expired
    const isExpired = session.expires_at ? Date.now() >= session.expires_at : false;

    return {
      accessToken: session.access_token,
      isExpired
    };
  }

  /**
   * Refreshes an expired or expiring token
   */
  async refreshToken(sessionToken: string, tokenUrl: string, clientId: string, clientSecret: string): Promise<boolean> {
    const session = this.sessions.get(sessionToken);
    
    if (!session || !session.refresh_token) {
      logger.warn({ sessionToken }, 'Cannot refresh: no refresh token available');
      return false;
    }

    try {
      logger.info({ sessionToken }, 'Attempting to refresh token');

      const response = await axios.post(tokenUrl, 
        new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: session.refresh_token,
          client_id: clientId
        }).toString(),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`
          }
        }
      );

      const { access_token, refresh_token, expires_in, refresh_expires_in } = response.data;

      session.access_token = access_token;
      if (refresh_token) {
        session.refresh_token = refresh_token;
      }
      session.expires_at = Date.now() + (expires_in * 1000);
      if (refresh_expires_in) {
        session.refresh_expires_at = Date.now() + (refresh_expires_in * 1000);
      }
      session.last_accessed_at = Date.now();

      logger.info({ 
        sessionToken,
        expiresIn: expires_in,
        refreshExpiresIn: refresh_expires_in
      }, 'Token refreshed successfully');

      return true;
    } catch (error) {
      logger.error({ 
        sessionToken,
        error: error instanceof Error ? error.message : 'Unknown error'
      }, 'Failed to refresh token');
      
      session.status = 'expired';
      return false;
    }
  }

  /**
   * Logs out a session by clearing tokens and marking as expired
   */
  logout(sessionToken: string): boolean {
    const session = this.sessions.get(sessionToken);

    if (!session) {
      logger.warn({ sessionToken }, 'Attempted to logout non-existent session');
      return false;
    }

    // Clear sensitive token data
    session.access_token = undefined;
    session.refresh_token = undefined;
    session.expires_at = undefined;
    session.refresh_expires_at = undefined;
    session.status = 'expired';
    session.last_accessed_at = Date.now();

    logger.info({
      sessionToken,
      userId: session.user_id,
      userEmail: session.user_email
    }, 'User logged out successfully');

    return true;
  }

  /**
   * Deletes a session
   */
  deleteSession(sessionToken: string): boolean {
    const deleted = this.sessions.delete(sessionToken);

    if (deleted) {
      logger.info({ sessionToken }, 'Session deleted');
    }

    return deleted;
  }

  /**
   * Gets all sessions (for debugging)
   */
  getAllSessions(): Map<string, SessionData> {
    return new Map(this.sessions);
  }

  /**
   * Gets session count by status
   */
  getStats(): { total: number; pending: number; authenticated: number; expired: number } {
    const stats = {
      total: this.sessions.size,
      pending: 0,
      authenticated: 0,
      expired: 0
    };

    for (const session of this.sessions.values()) {
      stats[session.status]++;
    }

    return stats;
  }

  /**
   * Cleanup expired sessions
   */
  private cleanup(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [token, session] of this.sessions.entries()) {
      let shouldDelete = false;

      // Delete pending sessions older than SESSION_TIMEOUT_MS
      if (session.status === 'pending' && (now - session.created_at) > this.SESSION_TIMEOUT_MS) {
        shouldDelete = true;
      }

      // Delete expired sessions
      if (session.status === 'expired') {
        shouldDelete = true;
      }

      // Delete authenticated sessions that haven't been accessed in AUTHENTICATED_SESSION_CLEANUP_MS
      if (session.status === 'authenticated' && (now - session.last_accessed_at) > this.AUTHENTICATED_SESSION_CLEANUP_MS) {
        shouldDelete = true;
      }

      if (shouldDelete) {
        this.sessions.delete(token);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.info({ 
        cleaned,
        remaining: this.sessions.size 
      }, 'Session cleanup completed');
    }
  }

  /**
   * Start periodic cleanup
   */
  private startCleanup(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, this.CLEANUP_INTERVAL_MS);

    logger.debug('Session cleanup scheduled');
  }

  /**
   * Stop periodic cleanup
   */
  stop(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
      logger.info('SessionManager stopped');
    }
  }
}

// Singleton instance
export const sessionManager = new SessionManager();

