// Copyright (c) 2025 AccelByte Inc.
// SPDX-License-Identifier: Apache-2.0

import { randomUUID } from "node:crypto";

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
import { getPlaybookVersion } from "./prompts/playbooks.js";
import { recallSession, rememberSession } from "./session-cache.js";
import { clientUserAgent, runWithRequestProvenance } from "./provenance.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Per-request client identity, introduced by MCP revision 2026-07-28.
 *
 * From that revision on, every request — `tools/call` included — carries the
 * calling client's name and version in `params._meta`, so no session state is
 * needed to attribute a downstream call. Read straight off the request body
 * rather than through the SDK, which as of 1.30.0 still tops out at 2025-11-25.
 */
const CLIENT_INFO_META_KEY = "io.modelcontextprotocol/clientInfo";

function perRequestClientInfo(
  body: unknown,
): Record<string, unknown> | undefined {
  if (!isRecord(body) || !isRecord(body.params)) return undefined;
  // `_meta` is the wire name fixed by the MCP spec, not a local naming choice.
  // eslint-disable-next-line no-underscore-dangle
  const meta = body.params._meta;
  if (!isRecord(meta)) return undefined;
  const clientInfo = meta[CLIENT_INFO_META_KEY];
  return isRecord(clientInfo) ? clientInfo : undefined;
}

export interface McpRequestContext {
  agsBaseUrl: string;
  namespace?: string;
  userAgent: string;
  playbookVersion?: string;
  contextVersions?: Record<string, string>;
  sessionId?: string;
}

/** A session id we minted: opaque, and safe to echo in a response header. */
const SESSION_ID_PATTERN = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;

function resolveSessionId(req: Request): string {
  const supplied = req.headers["mcp-session-id"];
  const candidate = Array.isArray(supplied) ? supplied[0] : supplied;
  // Only ids matching the shape we mint are honoured. An unrecognised value is
  // replaced rather than trusted, so a caller cannot read or poison another
  // session's provenance by guessing a key.
  return candidate && SESSION_ID_PATTERN.test(candidate)
    ? candidate
    : randomUUID();
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

    // The preferred source: present on every request once the client speaks
    // MCP 2026-07-28. Needs no session state at all.
    const requestClientInfo = perRequestClientInfo(req.body);

    // --- BEGIN AFT-215 bridge: delete once clients speak MCP 2026-07-28 ---
    // Until then, `clientInfo` arrives only on `initialize`, and this server is
    // stateless (a fresh McpServer and transport per POST), so the identity is
    // gone by the time a tool call runs. The session id below is minted by this
    // route, not by MCP: 2026-07-28 removes `Mcp-Session-Id` and instructs
    // servers not to mint or echo it. Everything in this block goes away with
    // the SDK upgrade — see AFT-215 (blocked by AFT-174).
    const sessionId = resolveSessionId(req);
    res.setHeader("Mcp-Session-Id", sessionId);

    // Only `initialize` may assert an identity. Honouring `clientInfo` on any
    // method would let a `tools/call` restamp its own attribution per request,
    // which is neither what the 2025-era protocol does nor what the corpus
    // should record.
    const legacyClientInfo =
      req.body?.method === "initialize" &&
      isRecord(req.body?.params?.clientInfo)
        ? req.body.params.clientInfo
        : undefined;
    if (legacyClientInfo) {
      rememberSession(sessionId, {
        clientName:
          typeof legacyClientInfo.name === "string"
            ? legacyClientInfo.name
            : undefined,
        clientVersion:
          typeof legacyClientInfo.version === "string"
            ? legacyClientInfo.version
            : undefined,
      });
    }
    const session = recallSession(sessionId);
    // --- END AFT-215 bridge ---

    // The per-request envelope wins whenever it is present, so the bridge above
    // stops being consulted on its own as clients migrate. Removing it is then
    // a dead-code deletion rather than a behavioural change.
    const clientName = requestClientInfo?.name ?? session?.clientName;
    const clientVersion = requestClientInfo?.version ?? session?.clientVersion;
    // Resolved before the provenance scope opens, so the value the scope stores
    // is never mutated after the fact.
    //
    // Provenance is telemetry: an unavailable playbook asset costs attribution
    // on AFS submits and nothing else. It must never fail a request — least of
    // all `initialize` or `tools/list`, which have no bearing on AFS at all.
    // An unavailable asset is logged once per retry window at the load site,
    // not here: this runs on every POST, so warning here emitted one line per
    // MCP request for what is a single deployment-wide condition.
    const playbookVersion = await getPlaybookVersion("afs");

    const context: McpRequestContext = {
      agsBaseUrl:
        req.ags?.baseUrl ||
        defaultAgsBaseUrl ||
        "https://development.accelbyte.io",
      namespace,
      userAgent: clientUserAgent(clientName, clientVersion),
      playbookVersion,
      contextVersions: session?.contextVersions,
      sessionId,
    };

    await runWithRequestProvenance(context, async () => {
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
    });
  };

  // RFC 9110 §15.5.6 requires a 405 to name the methods that ARE allowed.
  // Without it a method-aware proxy or client sees the rejection with no hint
  // that POST is the way in, and gives up instead of retrying.
  const ALLOWED_MCP_METHODS = "POST";

  // Registration order is what makes this win: Express matches first-declared,
  // and the `:namespace` pattern below would otherwise swallow it. GET does no
  // namespace validation at all — that lives in postHandler — so ordering, not
  // the /^[a-zA-Z0-9_-]+$/ rule, is the mechanism.
  //
  // ".json" is still load-bearing, for the inverse reason: a tenant namespaced
  // "version" is legal, and this route would shadow it, answering their GET
  // with 200 serverInfo — the exact body that breaks rmcp's OAuth discovery.
  // The dot makes that collision impossible.
  //
  // Name and version are disclosed unauthenticated by design; gate at the
  // ingress if a deployment objects to fingerprinting.
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

export type { McpServerFactory, RegisterMcpRoutesOptions };
export default registerMcpRoutes;
