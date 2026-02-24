// Copyright (c) 2025 AccelByte Inc. All Rights Reserved.
// This is licensed software from AccelByte Inc, for limitations
// and restrictions contact your company contract manager.

import type { Express, Request, Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ErrorCode } from "@modelcontextprotocol/sdk/types.js";

import setAuthFromToken from "../auth/middleware.js";
import log from "../logger.js";
import securityLog from "../security-logger.js";
import { jsonRPCError, logError, deriveBaseUrl } from "../utils.js";

interface McpRequestContext {
  agsBaseUrl: string;
  namespace?: string;
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
    const { namespace }: { namespace?: string } = req.params;

    // Validate namespace if present to prevent path injection
    if (namespace && !/^[a-zA-Z0-9_-]+$/.test(namespace)) {
      res
        .status(400)
        .json(jsonRPCError(ErrorCode.InvalidRequest, "Invalid namespace"));
      return;
    }

    if (enableAuth && !req.headers.authorization) {
      securityLog.authFailure({
        ip: req.ip,
        reason: "missing_authorization_header",
        path: req.path,
      });
      // Construct resource_metadata URL for WWW-Authenticate header
      const baseUrl = deriveBaseUrl(req, defaultAgsBaseUrl);
      const resourceMetadataPath = namespace
        ? `/.well-known/oauth-protected-resource/${namespace}`
        : `/.well-known/oauth-protected-resource`;

      res.set(
        "WWW-Authenticate",
        `Bearer resource_metadata="${baseUrl}${resourceMetadataPath}"`,
      );
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
      namespace,
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
      logError(error, log, { handler: "MCP POST", namespace });
      res
        .status(500)
        .json(jsonRPCError(ErrorCode.InternalError, "Internal error"));
    }
  };

  // Register routes for both the base path and the namespace-parameterized path
  const routePatterns = [path, `${path}/:namespace`];

  routePatterns.forEach((routePattern) => {
    if (enableAuth) {
      app.post(
        routePattern,
        setAuthFromToken({
          defaultAgsBaseUrl:
            defaultAgsBaseUrl || "https://development.accelbyte.io",
        }),
        postHandler,
      );
    } else {
      app.post(routePattern, postHandler);
    }

    app.get(routePattern, async (_: Request, res: Response) => {
      res
        .status(405)
        .json(jsonRPCError(ErrorCode.InvalidRequest, "Method not allowed"));
    });

    app.delete(routePattern, async (_: Request, res: Response) => {
      res
        .status(405)
        .json(jsonRPCError(ErrorCode.InvalidRequest, "Method not allowed"));
    });
  });
}

export type { McpRequestContext, McpServerFactory, RegisterMcpRoutesOptions };
export default registerMcpRoutes;
