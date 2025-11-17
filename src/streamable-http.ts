import { Request, Response } from 'express';
import { randomBytes } from 'crypto';
import { logger } from './logger';
import { MCPServer, MCPRequest, MCPResponse, UserContext } from './mcp-server';
import { sessionManager } from './session-manager';

const PROTOCOL_VERSION = '2025-06-18';
const FALLBACK_PROTOCOL_VERSION = '2025-03-26';

interface SSEStream {
  res: Response;
  eventId: number;
  lastEventId: number;
  sessionId: string;
  requestId?: string | number; // The request ID this stream is responding to
  pendingMessages: Array<{ id: number; data: any }>;
  closed: boolean;
}

interface MCPSession {
  id: string;
  createdAt: number;
  lastAccessedAt: number;
  streams: Map<string, SSEStream>; // stream ID -> SSEStream
  eventCounter: number;
  initialized: boolean;
  protocolVersion: string;
  userContext?: UserContext;
}

export class StreamableHTTPTransport {
  private sessions: Map<string, MCPSession> = new Map();
  private mcpServer: MCPServer;
  private readonly SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
  private readonly CLEANUP_INTERVAL_MS = 60 * 1000; // 1 minute
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(mcpServer: MCPServer) {
    this.mcpServer = mcpServer;
    this.startCleanup();
    logger.info('StreamableHTTPTransport initialized');
  }

  /**
   * Validates Origin header to prevent DNS rebinding attacks
   */
  private validateOrigin(req: Request): boolean {
    const origin = req.get('Origin');
    
    // If no Origin header, allow (for same-origin requests or non-browser clients)
    if (!origin) {
      return true;
    }

    try {
      const url = new URL(origin);
      // Allow localhost and 127.0.0.1
      if (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1') {
        return true;
      }

      // For production, you should implement proper origin validation
      // For now, we'll log and allow
      logger.warn({ origin, hostname: url.hostname }, 'Non-localhost origin detected');
      return true;
    } catch (error) {
      logger.error({ origin, error }, 'Invalid origin header');
      return false;
    }
  }

  /**
   * Gets or validates protocol version from request header
   */
  private getProtocolVersion(req: Request): string {
    const headerVersion = req.get('MCP-Protocol-Version');
    
    if (!headerVersion) {
      // Backwards compatibility: assume older version if header not present
      return FALLBACK_PROTOCOL_VERSION;
    }

    // Validate version format (YYYY-MM-DD)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(headerVersion)) {
      throw new Error(`Invalid protocol version format: ${headerVersion}`);
    }

    // We support the current version and fallback version
    if (headerVersion === PROTOCOL_VERSION || headerVersion === FALLBACK_PROTOCOL_VERSION) {
      return headerVersion;
    }

    // For other versions, we'll accept but log a warning
    logger.warn({ version: headerVersion }, 'Unsupported protocol version, attempting to handle');
    return headerVersion;
  }

  /**
   * Gets or creates an MCP session
   */
  private getOrCreateSession(req: Request, isInitialize: boolean = false): MCPSession | null {
    const sessionIdHeader = req.get('Mcp-Session-Id');

    // If this is an initialize request, create a new session
    if (isInitialize) {
      if (sessionIdHeader) {
        logger.warn('Initialize request with existing session ID, ignoring');
      }
      // Create new session for initialization
      const sessionId = this.generateSessionId();
      const session: MCPSession = {
        id: sessionId,
        createdAt: Date.now(),
        lastAccessedAt: Date.now(),
        streams: new Map(),
        eventCounter: 0,
        initialized: false,
        protocolVersion: PROTOCOL_VERSION
      };
      this.sessions.set(sessionId, session);
      logger.debug({ sessionId }, 'New MCP session created');
      return session;
    }

    // For non-initialize requests, session ID is required
    if (!sessionIdHeader) {
      return null;
    }

    const session = this.sessions.get(sessionIdHeader);
    if (!session) {
      return null;
    }

    // Update last accessed time
    session.lastAccessedAt = Date.now();
    return session;
  }

  /**
   * Generates a cryptographically secure session ID
   */
  private generateSessionId(): string {
    return randomBytes(32).toString('hex');
  }

  /**
   * Generates a unique stream ID
   */
  private generateStreamId(): string {
    return randomBytes(16).toString('hex');
  }

  /**
   * Creates an SSE stream
   */
  private createSSEStream(res: Response, sessionId: string, lastEventId?: number): SSEStream {
    const streamId = this.generateStreamId();
    
    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering

    const stream: SSEStream = {
      res,
      eventId: lastEventId !== undefined ? lastEventId + 1 : 1,
      lastEventId: lastEventId !== undefined ? lastEventId : 0,
      sessionId,
      pendingMessages: [],
      closed: false
    };

    // Handle client disconnect
    res.on('close', () => {
      stream.closed = true;
      logger.debug({ sessionId, streamId }, 'SSE stream closed by client');
    });

    logger.debug({ sessionId, streamId, lastEventId }, 'SSE stream created');
    return stream;
  }

  /**
   * Sends an SSE event
   */
  private sendSSEEvent(stream: SSEStream, data: any, eventType?: string): void {
    if (stream.closed) {
      logger.warn('Attempted to send event on closed stream');
      return;
    }

    const eventId = stream.eventId++;
    
    try {
      if (eventType) {
        stream.res.write(`event: ${eventType}\n`);
      }
      stream.res.write(`id: ${eventId}\n`);
      stream.res.write(`data: ${JSON.stringify(data)}\n\n`);
      
      logger.debug({ eventId, eventType, sessionId: stream.sessionId }, 'SSE event sent');
    } catch (error) {
      logger.error({ error, eventId, sessionId: stream.sessionId }, 'Failed to send SSE event');
      stream.closed = true;
    }
  }

  /**
   * Handles POST requests (client sends JSON-RPC messages)
   */
  async handlePost(req: Request, res: Response, userContext?: UserContext): Promise<void> {
    try {
      // Validate origin
      if (!this.validateOrigin(req)) {
        res.status(403).json({ 
          jsonrpc: '2.0',
          error: { 
            code: -32600, 
            message: 'Invalid origin' 
          } 
        });
        return;
      }

      // Validate protocol version
      let protocolVersion: string;
      try {
        protocolVersion = this.getProtocolVersion(req);
      } catch (error) {
        res.status(400).json({
          jsonrpc: '2.0',
          error: {
            code: -32600,
            message: error instanceof Error ? error.message : 'Invalid protocol version'
          }
        });
        return;
      }

      // Validate Accept header
      const accept = req.get('Accept');
      if (!accept || (!accept.includes('application/json') && !accept.includes('text/event-stream'))) {
        res.status(400).json({
          jsonrpc: '2.0',
          error: {
            code: -32600,
            message: 'Accept header must include application/json or text/event-stream'
          }
        });
        return;
      }

      const message = req.body;

      // Validate JSON-RPC message
      if (!message || !message.jsonrpc || message.jsonrpc !== '2.0') {
        res.status(400).json({
          jsonrpc: '2.0',
          error: {
            code: -32600,
            message: 'Invalid JSON-RPC message'
          }
        });
        return;
      }

      const isInitialize = message.method === 'initialize';
      const isRequest = message.method && message.id !== undefined;
      const isNotification = message.method && message.id === undefined;
      const isResponse = !message.method && (message.result !== undefined || message.error !== undefined);

      // Get or create session
      const session = this.getOrCreateSession(req, isInitialize);

      // For non-initialize requests, session is required
      if (!isInitialize && !session) {
        res.status(404).json({
          jsonrpc: '2.0',
          error: {
            code: -32600,
            message: 'Session not found or expired'
          }
        });
        return;
      }

      // Handle responses and notifications
      if (isResponse || isNotification) {
        // Accept the message
        res.status(202).end();
        
        logger.debug({ 
          type: isResponse ? 'response' : 'notification',
          sessionId: session?.id 
        }, 'JSON-RPC message accepted');
        return;
      }

      // Handle requests
      if (isRequest && session) {
        // Store user context in session and add MCP session ID
        const contextWithSession = {
          ...userContext,
          mcpSessionId: session.id
        };
        
        if (userContext) {
          session.userContext = contextWithSession;
        }

        // Process the request with session ID in context
        const response = await this.processRequest(message, session, contextWithSession);

        // If this is initialize, set session ID header and create OAuth session
        if (isInitialize && response.result) {
          res.setHeader('Mcp-Session-Id', session.id);
          session.initialized = true;
          session.protocolVersion = protocolVersion;
          
          // Create a session in SessionManager so the MCP session ID can be used for OAuth
          // This allows clients to use: /auth/login?session_token=<Mcp-Session-Id>
          const baseUrl = `${req.protocol}://${req.get('host')}`;
          sessionManager.createSessionWithToken(session.id, baseUrl);
          logger.debug({ 
            mcpSessionId: session.id.substring(0, 8) + '...',
            oauthLoginUrl: `${baseUrl}/auth/login?session_token=${session.id}`
          }, 'MCP session created - can be used for OAuth authentication');
        }

        // Check if client accepts SSE
        if (accept.includes('text/event-stream')) {
          // Create SSE stream
          const lastEventId = req.get('Last-Event-Id');
          const stream = this.createSSEStream(
            res, 
            session.id, 
            lastEventId ? parseInt(lastEventId, 10) : undefined
          );
          
          stream.requestId = message.id;

          // Send the response
          this.sendSSEEvent(stream, response);

          // Close the stream after sending the response
          stream.res.end();
        } else {
          // Return JSON response
          res.json(response);
        }

        return;
      }

      // Invalid message
      res.status(400).json({
        jsonrpc: '2.0',
        error: {
          code: -32600,
          message: 'Invalid request'
        }
      });
    } catch (error) {
      logger.error({ error }, 'Error handling POST request');
      res.status(500).json({
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: 'Internal error'
        }
      });
    }
  }

  /**
   * Handles GET requests (client opens SSE stream for server messages)
   */
  async handleGet(req: Request, res: Response): Promise<void> {
    try {
      // Validate origin
      if (!this.validateOrigin(req)) {
        res.status(403).send('Invalid origin');
        return;
      }

      // Validate protocol version
      try {
        this.getProtocolVersion(req);
      } catch (error) {
        res.status(400).send(error instanceof Error ? error.message : 'Invalid protocol version');
        return;
      }

      // Validate Accept header
      const accept = req.get('Accept');
      if (!accept || !accept.includes('text/event-stream')) {
        res.status(405).send('Method Not Allowed - Accept: text/event-stream required');
        return;
      }

      // Get session
      const session = this.getOrCreateSession(req, false);
      if (!session) {
        res.status(404).send('Session not found or expired');
        return;
      }

      // Create SSE stream
      const lastEventId = req.get('Last-Event-Id');
      const stream = this.createSSEStream(
        res,
        session.id,
        lastEventId ? parseInt(lastEventId, 10) : undefined
      );

      // Store stream in session
      const streamId = this.generateStreamId();
      session.streams.set(streamId, stream);

      // If resuming, replay messages after lastEventId
      if (lastEventId) {
        // TODO: Implement message replay from persistent storage
        logger.debug({ sessionId: session.id, lastEventId }, 'Stream resumption requested');
      }

      // Keep the connection open
      // The stream will be used for server-initiated messages
      logger.debug({ sessionId: session.id, streamId }, 'GET SSE stream opened');

      // Clean up stream on close
      res.on('close', () => {
        session.streams.delete(streamId);
        logger.debug({ sessionId: session.id, streamId }, 'GET SSE stream closed');
      });
    } catch (error) {
      logger.error({ error }, 'Error handling GET request');
      res.status(500).send('Internal error');
    }
  }

  /**
   * Handles DELETE requests to terminate sessions
   *
   * Allows clients to explicitly clean up sessions when they're done.
   * Per MCP spec, clients SHOULD send DELETE when terminating sessions.
   */
  async handleDelete(req: Request, res: Response): Promise<void> {
    const sessionId = req.get('Mcp-Session-Id');

    if (!sessionId) {
      res.status(400).json({
        jsonrpc: '2.0',
        error: {
          code: -32600,
          message: 'Missing Mcp-Session-Id header'
        }
      });
      return;
    }

    const session = this.sessions.get(sessionId);

    if (!session) {
      logger.debug({
        ip: req.ip,
        sessionId: sessionId.substring(0, 8) + '...'
      }, 'DELETE request for non-existent session');

      res.status(404).json({
        jsonrpc: '2.0',
        error: {
          code: -32600,
          message: 'Session not found or already expired'
        }
      });
      return;
    }

    // Close all SSE streams for this session
    for (const [, stream] of session.streams) {
      if (!stream.closed) {
        stream.res.end();
        stream.closed = true;
      }
    }

    // Delete the session
    this.sessions.delete(sessionId);

    logger.info({
      ip: req.ip,
      sessionId: sessionId.substring(0, 8) + '...',
      streamsTerminated: session.streams.size
    }, 'MCP session terminated via DELETE request');

    res.status(200).json({
      jsonrpc: '2.0',
      result: {
        success: true,
        message: 'Session terminated successfully'
      }
    });
  }

  /**
   * Processes a JSON-RPC request
   */
  private async processRequest(
    message: MCPRequest, 
    session: MCPSession, 
    userContext?: UserContext
  ): Promise<MCPResponse> {
    try {
      // Call MCPServer's processRequest directly with the full userContext
      // This preserves the mcpSessionId and other context fields that would
      // be lost if we went through handleRequest (which recreates userContext)
      const response = await this.mcpServer.processRequest(message, userContext);
      
      return response;
    } catch (error) {
      logger.error({ error, method: message.method }, 'Error processing MCP request');
      return {
        jsonrpc: '2.0',
        id: message.id,
        error: {
          code: -32603,
          message: error instanceof Error ? error.message : 'Internal error'
        }
      };
    }
  }

  /**
   * Cleanup expired sessions
   */
  private cleanup(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [sessionId, session] of this.sessions.entries()) {
      if (now - session.lastAccessedAt > this.SESSION_TIMEOUT_MS) {
        // Close all streams
        for (const stream of session.streams.values()) {
          if (!stream.closed) {
            stream.res.end();
            stream.closed = true;
          }
        }
        
        this.sessions.delete(sessionId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.debug({ cleaned, remaining: this.sessions.size }, 'MCP session cleanup completed');
    }
  }

  /**
   * Start periodic cleanup
   */
  private startCleanup(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, this.CLEANUP_INTERVAL_MS);

    logger.debug('MCP session cleanup scheduled');
  }

  /**
   * Stop the transport and cleanup
   */
  stop(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    // Close all sessions and streams
    for (const session of this.sessions.values()) {
      for (const stream of session.streams.values()) {
        if (!stream.closed) {
          stream.res.end();
          stream.closed = true;
        }
      }
    }

    this.sessions.clear();
    logger.info('StreamableHTTPTransport stopped');
  }

  /**
   * Get session statistics
   */
  getStats(): { totalSessions: number; totalStreams: number } {
    let totalStreams = 0;
    for (const session of this.sessions.values()) {
      totalStreams += session.streams.size;
    }

    return {
      totalSessions: this.sessions.size,
      totalStreams
    };
  }
}

