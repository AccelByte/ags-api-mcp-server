// Copyright (c) 2025 AccelByte Inc. All Rights Reserved.
// This is licensed software from AccelByte Inc, for limitations
// and restrictions contact your company contract manager.

import type { Express, Request, Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ErrorCode } from "@modelcontextprotocol/sdk/types.js";

import setAuthFromToken from "../auth/middleware.js";
import log from "../logger.js";
import { jsonRPCError, logError } from "../utils.js";

interface McpRequestContext {
  agsBaseUrl: string;
}

/**
 * Factory function type for creating MCP server instances.
 * Each call should return a new, independent server instance.
 */
type McpServerFactory = (context: McpRequestContext) => Promise<McpServer>;

interface RegisterMcpRoutesOptions {
  /**
   * The route path for MCP endpoints. Defaults to "/mcp".
   */
  path?: string;

  /**
   * Whether to enable authentication middleware. Defaults to false.
   */
  enableAuth?: boolean;

  /**
   * The default AGS base URL to use if not provided in the request context.
   */
  defaultAgsBaseUrl?: string;
}

/**
 * Registers MCP routes on an Express application for stateless MCP server handling.
 * Sets up POST handler for MCP requests and returns method not allowed for GET/DELETE.
 *
 * This function implements a stateless pattern where a new MCP server instance is created
 * for each request and cleaned up when the response closes. This ensures no state is
 * shared between requests.
 *
 * @param app - Express application instance
 * @param factory - Factory function that creates a new MCP server instance for each request
 */
function registerMcpRoutes(
  app: Express,
  factory: McpServerFactory,
  options: RegisterMcpRoutesOptions = {},
): void {
  const { path = "/mcp", enableAuth = false, defaultAgsBaseUrl } = options;

  const postHandler = async (req: Request, res: Response) => {
    if (enableAuth && !req.headers.authorization) {
      res
        .status(401)
        .json(jsonRPCError(ErrorCode.InvalidRequest, "Unauthorized"));
      return;
    }

    const context: McpRequestContext = {
      agsBaseUrl:
        req.ags?.baseUrl ||
        defaultAgsBaseUrl ||
        "https://development.accelbyte.io",
    };

    try {
      const server = await factory(context);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      res.on("close", async () => {
        await transport.close();
        await server.close();
      });
    } catch (error: unknown) {
      // Log error for debugging with proper type narrowing
      logError(error, log, { handler: "MCP POST" });
      res
        .status(500)
        .json(jsonRPCError(ErrorCode.InternalError, "Internal error"));
    }
  };

  if (enableAuth) {
    app.post(path, setAuthFromToken(), postHandler);
  } else {
    app.post(path, postHandler);
  }

  app.get(path, async (_: Request, res: Response) => {
    res
      .status(405)
      .json(jsonRPCError(ErrorCode.InvalidRequest, "Method not allowed"));
  });

  app.delete(path, async (_: Request, res: Response) => {
    res
      .status(405)
      .json(jsonRPCError(ErrorCode.InvalidRequest, "Method not allowed"));
  });
}

export type { McpRequestContext, McpServerFactory, RegisterMcpRoutesOptions };
export default registerMcpRoutes;
