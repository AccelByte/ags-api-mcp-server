import { Request, Response } from "express";
import { logger } from "./logger.js";

export interface MCPRequest {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params?: any;
}

export interface MCPResponse {
  jsonrpc: "2.0";
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
    type: "object";
    properties: Record<string, any>;
    required?: string[];
  };
}

export interface Resource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface PromptArgument {
  name: string;
  description?: string;
  required?: boolean;
}

export interface Prompt {
  name: string;
  description?: string;
  arguments?: PromptArgument[];
  argsSchema?: Record<string, unknown>;
}

export interface UserContext {
  accessToken?: string;
  user?: any;
  sub?: string;
  client_id?: string;
  scope?: string;
  namespace?: string;
  isFromCache?: boolean;
  mcpSessionId?: string; // For Streamable HTTP transport
  stdioSessionToken?: string; // For stdio transport only - auto-generated session token
}

export class MCPServer {
  private tools: Map<string, Function> = new Map();
  private toolSchemas: Map<string, Tool> = new Map();
  private resources: Map<string, Resource> = new Map();
  private resourceHandlers: Map<string, Function> = new Map();
  private prompts: Map<string, Prompt> = new Map();
  private promptHandlers: Map<string, Function> = new Map();

  registerTool(name: string, handler: Function, schema?: Tool) {
    this.tools.set(name, handler);
    if (schema) {
      this.toolSchemas.set(name, schema);
    }
  }

  registerResource(resource: Resource, handler: Function) {
    this.resourceHandlers.set(resource.uri, handler);
    this.resources.set(resource.uri, resource);
  }

  registerPrompt(prompt: Prompt, handler: Function) {
    this.promptHandlers.set(prompt.name, handler);
    this.prompts.set(prompt.name, prompt);
  }

  async handleRequest(req: Request, res: Response): Promise<void> {
    try {
      const mcpRequest: MCPRequest = req.body;

      if (!mcpRequest.jsonrpc || mcpRequest.jsonrpc !== "2.0") {
        this.sendError(res, mcpRequest.id, -32600, "Invalid Request");
        return;
      }

      // Extract user context from request
      const userContext: UserContext = {
        accessToken:
          req.accessToken || req.get("Authorization")?.replace("Bearer ", ""),
        user: req.user,
        sub: req.user?.sub,
        client_id: req.user?.client_id,
        scope: req.user?.scope,
        namespace: req.user?.namespace,
      };

      const response = await this.processRequest(mcpRequest, userContext);
      res.json(response);
    } catch (error) {
      logger.error({ error }, "Error processing MCP request");
      this.sendError(res, req.body?.id || "unknown", -32603, "Internal error");
    }
  }

  async processRequest(
    request: MCPRequest,
    userContext?: UserContext,
  ): Promise<MCPResponse> {
    const { method, params, id } = request;

    try {
      switch (method) {
        case "initialize":
          return this.handleInitialize(id, params);

        case "tools/list":
          return this.handleListTools(id);

        case "tools/call":
          return await this.handleCallTool(id, params, userContext);

        case "resources/list":
          return this.handleListResources(id);

        case "resources/read":
          return await this.handleReadResource(id, params, userContext);

        case "prompts/list":
          return this.handleListPrompts(id);

        case "prompts/get":
          return await this.handleGetPrompt(id, params, userContext);

        case "completion/complete":
          return await this.handleCompletionRequest(id, params, userContext);

        case "ping":
          return this.handlePing(id);

        default:
          return this.createErrorResponse(id, -32601, "Method not found");
      }
    } catch (error) {
      logger.error({ error, method }, "Error processing MCP method");
      return this.createErrorResponse(id, -32603, "Internal error");
    }
  }

  private handleInitialize(id: string | number, params: any): MCPResponse {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2025-06-18",
        capabilities: {
          tools: {},
          resources: {},
          prompts: {},
          completions: {},
        },
        serverInfo: {
          name: "ags-api-mcp-server",
          version: "1.0.0",
        },
      },
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
      jsonrpc: "2.0",
      id,
      result: {
        tools,
      },
    };
  }

  private generateDefaultToolSchema(name: string): Tool {
    const toolSchemas: Record<string, Tool> = {
      get_token_info: {
        name: "get_token_info",
        description:
          "Get information about the authenticated token and user from the access token. Returns the namespace that should be used as the implicit default namespace for all subsequent API requests when a namespace parameter is not explicitly specified.",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
    };

    return (
      toolSchemas[name] || {
        name,
        description: `Execute ${name} tool`,
        inputSchema: {
          type: "object",
          properties: {},
        },
      }
    );
  }

  private async handleCallTool(
    id: string | number,
    params: any,
    userContext?: UserContext,
  ): Promise<MCPResponse> {
    const { name, arguments: args } = params;

    if (!name) {
      return this.createErrorResponse(id, -32602, "Tool name is required");
    }

    const tool = this.tools.get(name);
    if (!tool) {
      return this.createErrorResponse(id, -32601, `Tool '${name}' not found`);
    }

    try {
      const result = await tool(args || {}, userContext);
      return {
        jsonrpc: "2.0",
        id,
        result: {
          content: [
            {
              type: "text",
              text:
                typeof result === "string"
                  ? result
                  : JSON.stringify(result, null, 2),
            },
          ],
        },
      };
    } catch (error) {
      logger.error(
        {
          error,
          toolName: name,
          errorType: error?.constructor?.name || typeof error,
          errorMessage: error instanceof Error ? error.message : String(error),
          errorStack: error instanceof Error ? error.stack : undefined,
        },
        "Error executing MCP tool",
      );
      return this.createErrorResponse(
        id,
        -32603,
        `Tool execution failed: ${error}`,
      );
    }
  }

  private handleListResources(id: string | number): MCPResponse {
    const resources: Resource[] = [];

    // Return all registered resources
    for (const [uri, resource] of this.resources) {
      resources.push(resource);
    }

    return {
      jsonrpc: "2.0",
      id,
      result: {
        resources,
      },
    };
  }

  private async handleReadResource(
    id: string | number,
    params: any,
    userContext?: UserContext,
  ): Promise<MCPResponse> {
    if (!params || !params.uri) {
      return this.createErrorResponse(id, -32602, "Resource URI is required");
    }

    const { uri } = params;

    const handler = this.resourceHandlers.get(uri);
    if (!handler) {
      return this.createErrorResponse(
        id,
        -32601,
        `Resource '${uri}' not found`,
      );
    }

    try {
      const result = await handler(params || {}, userContext);
      return {
        jsonrpc: "2.0",
        id,
        result: {
          contents: Array.isArray(result)
            ? result
            : [
                {
                  uri,
                  mimeType: this.resources.get(uri)?.mimeType || "text/plain",
                  text:
                    typeof result === "string"
                      ? result
                      : JSON.stringify(result, null, 2),
                },
              ],
        },
      };
    } catch (error) {
      logger.error(
        {
          error,
          resourceUri: uri,
          errorType: error?.constructor?.name || typeof error,
          errorMessage: error instanceof Error ? error.message : String(error),
          errorStack: error instanceof Error ? error.stack : undefined,
        },
        "Error reading MCP resource",
      );
      return this.createErrorResponse(
        id,
        -32603,
        `Resource read failed: ${error}`,
      );
    }
  }

  private handleListPrompts(id: string | number): MCPResponse {
    const prompts: Prompt[] = [];

    // Return all registered prompts
    for (const [name, prompt] of this.prompts) {
      prompts.push(prompt);
    }

    return {
      jsonrpc: "2.0",
      id,
      result: {
        prompts,
      },
    };
  }

  private formatCompletionResult(suggestions: string[]) {
    const limited = suggestions.slice(0, 100);
    const baseResult: {
      values: string[];
      total?: number;
      hasMore?: boolean;
    } = {
      values: limited,
    };

    if (suggestions.length !== limited.length) {
      baseResult.hasMore = true;
      baseResult.total = suggestions.length;
    } else if (suggestions.length > 0) {
      baseResult.total = suggestions.length;
    }

    return { completion: baseResult };
  }

  private async handleCompletionRequest(
    id: string | number,
    params: any,
    userContext?: UserContext,
  ): Promise<MCPResponse> {
    if (!params?.ref || !params?.argument) {
      return this.createErrorResponse(
        id,
        -32602,
        "Completion reference and argument are required",
      );
    }

    const { ref, argument, context } = params;
    let suggestions: string[] = [];

    if (ref.type === "ref/prompt") {
      suggestions = await this.getPromptCompletionSuggestions(
        ref.name,
        argument.name,
        argument.value ?? "",
        context,
      );
    } else {
      logger.warn({ ref }, "Unsupported completion reference type");
    }

    return {
      jsonrpc: "2.0",
      id,
      result: this.formatCompletionResult(suggestions),
    };
  }

  private async getPromptCompletionSuggestions(
    promptName: string,
    argumentName: string,
    value: string,
    context?: { arguments?: Record<string, string> },
  ): Promise<string[]> {
    const prompt = this.prompts.get(promptName);
    if (!prompt?.argsSchema) {
      return [];
    }

    const field = (prompt.argsSchema as Record<string, any>)[argumentName];
    const completer =
      field?._def?.complete && typeof field._def.complete === "function"
        ? field._def.complete
        : undefined;

    if (!completer) {
      return [];
    }

    try {
      const suggestions = await Promise.resolve(completer(value, context));
      if (Array.isArray(suggestions)) {
        return suggestions.filter(
          (suggestion) => typeof suggestion === "string",
        );
      }
    } catch (error) {
      logger.error(
        { error, promptName, argumentName },
        "Error generating prompt completions",
      );
    }
    return [];
  }

  private async handleGetPrompt(
    id: string | number,
    params: any,
    userContext?: UserContext,
  ): Promise<MCPResponse> {
    if (!params || !params.name) {
      return this.createErrorResponse(id, -32602, "Prompt name is required");
    }

    const { name, arguments: args } = params;

    const prompt = this.prompts.get(name);
    if (!prompt) {
      return this.createErrorResponse(
        id,
        -32601,
        `Prompt '${name}' not found`,
      );
    }

    const handler = this.promptHandlers.get(name);
    if (!handler) {
      return this.createErrorResponse(
        id,
        -32603,
        `Prompt handler for '${name}' not found`,
      );
    }

    try {
      const result = await handler(args || {}, userContext);
      return {
        jsonrpc: "2.0",
        id,
        result: {
          description: prompt.description,
          messages: Array.isArray(result)
            ? result
            : [
                {
                  role: "user",
                  content: {
                    type: "text",
                    text:
                      typeof result === "string"
                        ? result
                        : JSON.stringify(result, null, 2),
                  },
                },
              ],
        },
      };
    } catch (error) {
      logger.error(
        {
          error,
          promptName: name,
          errorType: error?.constructor?.name || typeof error,
          errorMessage: error instanceof Error ? error.message : String(error),
          errorStack: error instanceof Error ? error.stack : undefined,
        },
        "Error getting MCP prompt",
      );
      return this.createErrorResponse(
        id,
        -32603,
        `Prompt get failed: ${error}`,
      );
    }
  }

  private handlePing(id: string | number): MCPResponse {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        message: "pong",
      },
    };
  }

  private createErrorResponse(
    id: string | number,
    code: number,
    message: string,
  ): MCPResponse {
    return {
      jsonrpc: "2.0",
      id,
      error: {
        code,
        message,
      },
    };
  }

  private sendError(
    res: Response,
    id: string | number,
    code: number,
    message: string,
  ): void {
    const response: MCPResponse = {
      jsonrpc: "2.0",
      id,
      error: {
        code,
        message,
      },
    };
    res.status(400).json(response);
  }
}
