// Copyright (c) 2025 AccelByte Inc.
// SPDX-License-Identifier: Apache-2.0

import type { Express, Request, Response } from "express";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ErrorCode } from "@modelcontextprotocol/sdk/types.js";

import setAuthFromToken, {
  parseAuthorizationHeader,
} from "../auth/middleware.js";
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

  /**
   * Fallback public URL for this MCP server. Trusted reverse-proxy headers take
   * precedence so OAuth metadata URLs stay on the same public origin as the
   * MCP resource URL. Untrusted hosted request context is never used here.
   */
  mcpServerUrl?: string;

  /**
   * Whether hosted mode is enabled.
   */
  hostedMode?: boolean;

  /**
   * Allow the JWT `iss` claim to be a parent domain of the derived AGS base
   * URL. Threaded into the JWKS-verified issuer check in `setAuthFromToken`
   * so the full authentication pipeline honors the same flag as the
   * `resolveAgsHost` pre-check. Without this, enabling the flag in hosted
   * mode passes the pre-check but still 401s in the middleware.
   */
  allowParentDomainIssuer?: boolean;

  /**
   * If provided, `GET <mcpPath>/version.json` returns this {name, version}
   * payload — the only server-identity probe hosted deployments have, whose
   * ingress forwards /mcp* and so never reaches / or /health.
   */
  serverInfo?: { name: string; version: string };
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
  const {
    path = "/mcp",
    enableAuth = false,
    defaultAgsBaseUrl,
    mcpServerUrl,
    hostedMode = false,
    allowParentDomainIssuer = false,
    serverInfo,
  } = options;

  // Co-located guard: hosted mode requires a safe public fallback URL when no
  // trusted proxy origin is available. Fail at registration time rather than
  // relying solely on the far-away config.ts startup check, so test/library
  // callers also see it.
  if (hostedMode && !mcpServerUrl) {
    throw new Error(
      "registerMcpRoutes: hostedMode=true requires mcpServerUrl to be set " +
        "to the public URL clients use to reach this MCP server.",
    );
  }

  // A root MCP path ("/") contributes no path segment when building derived
  // paths. Without this, `${path}/:namespace` registers the unreachable
  // route `//:namespace` and the advertised resource_metadata URL gains a
  // double slash. auth/routes.ts applies the same rule to its path-aware
  // well-known routes.
  // Trailing slashes are stripped as well as the root case: "/mcp/" would
  // otherwise build "/mcp//:namespace" and "/mcp//version.json", which no
  // ordinary request matches. config.ts normalizes MCP_PATH too; this covers
  // callers that construct the routes directly.
  const mcpBasePath = path === "/" ? "" : path.replace(/\/+$/, "");

  const postHandler = async (req: Request, res: Response) => {
    const { namespace }: { namespace?: string } = req.params;

    // Validate namespace if present to prevent path injection
    if (namespace && !/^[a-zA-Z0-9_-]+$/.test(namespace)) {
      res
        .status(400)
        .json(jsonRPCError(ErrorCode.InvalidRequest, "Invalid namespace"));
      return;
    }

    if (enableAuth && !(req as Request & { auth?: AuthInfo }).auth) {
      const authHeader = req.headers.authorization;
      const parsed = parseAuthorizationHeader(authHeader);
      let reason = "auth_verification_failed";
      if (!authHeader) {
        reason = "missing_authorization_header";
      } else if (parsed?.scheme !== "bearer") {
        reason = "unsupported_auth_scheme";
      }
      securityLog.authFailure({
        ip: req.ip,
        reason,
        path: req.path,
      });
      // RFC 9728 inserts the protected-resource well-known path before the
      // complete MCP resource path. For example, /mcp/foundations maps to
      // /.well-known/oauth-protected-resource/mcp/foundations.
      const baseUrl = deriveBaseUrl(req, mcpServerUrl || defaultAgsBaseUrl, {
        allowHostedContext: !hostedMode,
      });
      const resourcePath = namespace
        ? `${mcpBasePath}/${namespace}`
        : mcpBasePath;
      const resourceMetadataPath = `/.well-known/oauth-protected-resource${resourcePath}`;

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

  // RFC 9110 §15.5.6 requires a 405 to name the methods that ARE allowed.
  // Without it a method-aware proxy or client sees the rejection with no hint
  // that POST is the way in, and gives up instead of retrying.
  const ALLOWED_MCP_METHODS = "POST";

  // Registered before the `:namespace` pattern, which would otherwise swallow
  // it. ".json" is load-bearing: namespaces match /^[a-zA-Z0-9_-]+$/, so the
  // dot puts this path out of reach of a tenant — a bare "version" would be a
  // legal namespace. Name and version are disclosed unauthenticated by
  // design; gate at the ingress if a deployment objects to fingerprinting.
  if (serverInfo) {
    app.get(`${mcpBasePath}/version.json`, (_: Request, res: Response) => {
      res.json(serverInfo);
    });
  }

  // Register routes for both the base path and the namespace-parameterized path
  const routePatterns = [mcpBasePath || "/", `${mcpBasePath}/:namespace`];

  routePatterns.forEach((routePattern) => {
    if (enableAuth) {
      app.post(
        routePattern,
        setAuthFromToken({
          defaultAgsBaseUrl:
            defaultAgsBaseUrl || "https://development.accelbyte.io",
          allowParentDomainIssuer,
        }),
        postHandler,
      );
    } else {
      app.post(routePattern, postHandler);
    }

    app.get(routePattern, async (_: Request, res: Response) => {
      // MCP Streamable HTTP reserves GET for server→client SSE and mandates
      // 405 where no stream is offered. This server is stateless
      // (sessionIdGenerator: undefined), so there is never one to open; going
      // stateful means branching on `Accept: text/event-stream` here.
      //
      // Never answer 200: rmcp (>= 2.0, used by Codex) opens OAuth discovery
      // with a GET on this URL and reads any 200 as the RFC 9728 metadata
      // document, aborting on the missing required `resource` field before it
      // ever POSTs and sees postHandler's WWW-Authenticate challenge.
      // Server identity lives on `<mcpPath>/version.json` instead.
      res
        .set("Allow", ALLOWED_MCP_METHODS)
        .status(405)
        .json(jsonRPCError(ErrorCode.InvalidRequest, "Method not allowed"));
    });

    app.delete(routePattern, async (_: Request, res: Response) => {
      res
        .set("Allow", ALLOWED_MCP_METHODS)
        .status(405)
        .json(jsonRPCError(ErrorCode.InvalidRequest, "Method not allowed"));
    });
  });
}

export type { McpRequestContext, McpServerFactory, RegisterMcpRoutesOptions };
export default registerMcpRoutes;
