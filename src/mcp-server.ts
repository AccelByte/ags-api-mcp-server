import { Request, Response } from 'express';
import { logger } from './logger';

export interface MCPRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: any;
}

export interface MCPResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

export interface Tool {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
}

export interface UserContext {
  accessToken?: string;
  user?: any;
  sub?: string;
  client_id?: string;
  scope?: string;
  namespace?: string;
  isFromCache?: boolean;
}

export class MCPServer {
  private tools: Map<string, Function> = new Map();
  private toolSchemas: Map<string, Tool> = new Map();

  registerTool(name: string, handler: Function, schema?: Tool) {
    this.tools.set(name, handler);
    if (schema) {
      this.toolSchemas.set(name, schema);
    }
  }

  async handleRequest(req: Request, res: Response): Promise<void> {
    try {
      const mcpRequest: MCPRequest = req.body;

      if (!mcpRequest.jsonrpc || mcpRequest.jsonrpc !== '2.0') {
        this.sendError(res, mcpRequest.id, -32600, 'Invalid Request');
        return;
      }

      // Extract user context from request
      const userContext: UserContext = {
        accessToken: req.accessToken || req.get('Authorization')?.replace('Bearer ', ''),
        user: req.user,
        sub: req.user?.sub,
        client_id: req.user?.client_id,
        scope: req.user?.scope,
        namespace: req.user?.namespace
      };

      const response = await this.processRequest(mcpRequest, userContext);
      res.json(response);
    } catch (error) {
      logger.error({ error }, 'Error processing MCP request');
      this.sendError(res, req.body?.id || 'unknown', -32603, 'Internal error');
    }
  }

  private async processRequest(request: MCPRequest, userContext?: UserContext): Promise<MCPResponse> {
    const { method, params, id } = request;

    try {
      switch (method) {
        case 'initialize':
          return this.handleInitialize(id, params);
        
        case 'tools/list':
          return this.handleListTools(id);
        
        case 'tools/call':
          return await this.handleCallTool(id, params, userContext);
        
        case 'ping':
          return this.handlePing(id);
        
        default:
          return this.createErrorResponse(id, -32601, 'Method not found');
      }
    } catch (error) {
      logger.error({ error, method }, 'Error processing MCP method');
      return this.createErrorResponse(id, -32603, 'Internal error');
    }
  }

  private handleInitialize(id: string | number, params: any): MCPResponse {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: {}
        },
        serverInfo: {
          name: 'ags-api-mcp-server',
          version: '1.0.0'
        }
      }
    };
  }

  private handleListTools(id: string | number): MCPResponse {
    const tools: Tool[] = [];
    
    // First, add tools with explicit schemas
    for (const [name, schema] of this.toolSchemas) {
      tools.push(schema);
    }

    // Then, add tools without schemas by generating default schemas
    const toolsWithSchemas = new Set(this.toolSchemas.keys());
    for (const [name, handler] of this.tools) {
      if (!toolsWithSchemas.has(name)) {
        tools.push(this.generateDefaultToolSchema(name));
      }
    }

    return {
      jsonrpc: '2.0',
      id,
      result: {
        tools
      }
    };
  }

  private generateDefaultToolSchema(name: string): Tool {
    const toolSchemas: Record<string, Tool> = {
      'get_token_info': {
        name: 'get_token_info',
        description: 'Get information about the authenticated token and user from the access token',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      }
    };

    return toolSchemas[name] || {
      name,
      description: `Execute ${name} tool`,
      inputSchema: {
        type: 'object',
        properties: {}
      }
    };
  }

  private async handleCallTool(id: string | number, params: any, userContext?: UserContext): Promise<MCPResponse> {
    const { name, arguments: args } = params;

    if (!name) {
      return this.createErrorResponse(id, -32602, 'Tool name is required');
    }

    const tool = this.tools.get(name);
    if (!tool) {
      return this.createErrorResponse(id, -32601, `Tool '${name}' not found`);
    }

    try {
      const result = await tool(args || {}, userContext);
      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [
            {
              type: 'text',
              text: typeof result === 'string' ? result : JSON.stringify(result, null, 2)
            }
          ]
        }
      };
    } catch (error) {
      logger.error({ 
        error, 
        toolName: name,
        errorType: error?.constructor?.name || typeof error,
        errorMessage: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined
      }, 'Error executing MCP tool');
      return this.createErrorResponse(id, -32603, `Tool execution failed: ${error}`);
    }
  }

  private handlePing(id: string | number): MCPResponse {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        message: 'pong'
      }
    };
  }

  private createErrorResponse(id: string | number, code: number, message: string): MCPResponse {
    return {
      jsonrpc: '2.0',
      id,
      error: {
        code,
        message
      }
    };
  }

  private sendError(res: Response, id: string | number, code: number, message: string): void {
    const response: MCPResponse = {
      jsonrpc: '2.0',
      id,
      error: {
        code,
        message
      }
    };
    res.status(400).json(response);
  }
}
