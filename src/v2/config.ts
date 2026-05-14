// Copyright (c) 2025 AccelByte Inc. All Rights Reserved.
// This is licensed software from AccelByte Inc, for limitations
// and restrictions contact your company contract manager.

import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { z } from "zod/v3";
import log from "./logger.js";

/**
 * Determines the project root directory.
 * In development (src/v2/), dirname is the v2 directory.
 * In production (dist/v2/), dirname is the dist/v2 directory.
 * We need to go up two levels from dist/v2 or src/v2 to get to project root.
 */
function getProjectRoot(): string {
  const filename = fileURLToPath(import.meta.url);
  const dirname = path.dirname(filename);

  // Both development and production need to go up two levels
  return path.resolve(dirname, "../..");
}

const projectRoot = getProjectRoot();

// Load environment variables from project root
dotenv.config({ path: path.join(projectRoot, ".env") });

const EnvBooleanSchema = z.preprocess((val) => {
  if (val === undefined || val === null) return val;
  const str = String(val).toLowerCase().trim();
  const truthy = ["true", "1", "yes", "y"];
  const falsy = ["false", "0", "no", "n"];
  if (truthy.includes(str)) return true;
  if (falsy.includes(str)) return false;
  return val;
}, z.coerce.boolean());

const McpConfigSchema = z.object({
  port: z.coerce.number().min(1).max(65535).default(3000),
  path: z.string().default("/mcp"),
  serverUrl: z.string().url(),
  enableAuth: EnvBooleanSchema.default(true),
  enableRenderTools: EnvBooleanSchema.default(true),
  /**
   * TEMPORARY WORKAROUND: OAuth authorization server discovery mode.
   * Needed because VS Code (and some MCP clients) cannot discover the actual
   * authorization server at /.well-known/oauth-authorization-server when it
   * lives on a different host. This makes the MCP server proxy/redirect
   * discovery and registration requests to the real auth server.
   *
   * Values: "none" | "redirect" | "proxy" | "proxyRegister"
   * - none: Standard discovery (default, no workaround)
   * - redirect: 307 redirect to actual auth server's discovery endpoint
   * - proxy: Proxy the discovery document from actual auth server
   * - proxyRegister: Like proxy, but also proxies the registration endpoint
   *
   * TODO: Remove once MCP clients (VS Code, etc.) properly support OAuth
   * authorization server discovery when the auth server is on a different host.
   */
  authServerDiscoveryMode: z
    .enum(["none", "redirect", "proxy", "proxyRegister"])
    .default("none"),
});

const RuntimeConfigSchema = z.object({
  nodeEnv: z.enum(["development", "production"]).default("development"),
  logLevel: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),
});

const OpenApiConfigSchema = z.object({
  specsDir: z.string(),
  searchLimit: z.coerce.number().positive().default(10),
  maxSearchLimit: z.coerce.number().positive().default(50),
  runTimeoutMs: z.coerce.number().positive().default(15_000),
  maxRunTimeoutMs: z.coerce.number().positive().default(60_000),
  serverUrl: z.string().url().default("https://development.accelbyte.io"),
  includeWriteRequests: EnvBooleanSchema.default(true),
});

const HostedConfigSchema = z.object({
  enabled: EnvBooleanSchema.default(false),
  validateTokenIssuer: EnvBooleanSchema.default(true),
  allowParentDomainIssuer: EnvBooleanSchema.default(false),
});

type HostedConfig = z.infer<typeof HostedConfigSchema>;

const ConfigSchema = z.object({
  mcp: McpConfigSchema,
  openapi: OpenApiConfigSchema,
  runtime: RuntimeConfigSchema,
  hosted: HostedConfigSchema,
});

type Config = z.infer<typeof ConfigSchema>;

// Load and validate configuration
function loadConfig(): Config {
  try {
    const mcpPort = parseInt(
      process.env.MCP_PORT || process.env.PORT || "3000",
      10,
    );
    // Track whether the URL was provided explicitly (vs auto-derived from
    // MCP_PROTOCOL/MCP_HOSTNAME/MCP_PORT). The hosted-mode startup guard
    // below requires an explicit value because the auto-derived
    // http://localhost:<port> form must never end up in the WWW-Authenticate
    // resource_metadata URL that public clients fetch.
    const mcpServerUrlAutoDerived = !process.env.MCP_SERVER_URL;
    let mcpServerUrl: string;

    if (process.env.MCP_SERVER_URL) {
      mcpServerUrl = process.env.MCP_SERVER_URL;
    } else {
      const mcpProtocol = process.env.MCP_PROTOCOL || "http";
      const mcpHostname = process.env.MCP_HOSTNAME || "localhost";
      mcpServerUrl =
        mcpPort !== 80 && mcpPort !== 443
          ? `${mcpProtocol}://${mcpHostname}:${mcpPort}`
          : `${mcpProtocol}://${mcpHostname}`;
    }

    const openapiSpecsDirEnv = process.env.OPENAPI_SPECS_DIR || "openapi-specs";
    const openapiSpecsDir = path.isAbsolute(openapiSpecsDirEnv)
      ? openapiSpecsDirEnv
      : path.resolve(projectRoot, openapiSpecsDirEnv);

    const raw = {
      mcp: {
        port: mcpPort,
        path: process.env.MCP_PATH,
        serverUrl: mcpServerUrl,
        enableAuth: process.env.MCP_AUTH,
        enableRenderTools: process.env.ENABLE_RENDER_TOOLS,
        authServerDiscoveryMode: process.env.MCP_AUTH_SERVER_DISCOVERY_MODE,
      },
      openapi: {
        specsDir: openapiSpecsDir,
        searchLimit: process.env.OPENAPI_DEFAULT_SEARCH_LIMIT,
        maxSearchLimit: process.env.OPENAPI_MAX_SEARCH_LIMIT,
        runTimeoutMs: process.env.OPENAPI_DEFAULT_RUN_TIMEOUT_MS,
        maxRunTimeoutMs: process.env.OPENAPI_MAX_RUN_TIMEOUT_MS,
        serverUrl: process.env.AB_BASE_URL,
        includeWriteRequests: process.env.INCLUDE_WRITE_REQUESTS,
      },
      runtime: {
        nodeEnv: process.env.NODE_ENV,
        logLevel: process.env.LOG_LEVEL,
      },
      hosted: {
        enabled: process.env.MCP_HOSTED,
        validateTokenIssuer: process.env.MCP_VALIDATE_TOKEN_ISSUER,
        allowParentDomainIssuer: process.env.ALLOW_PARENT_DOMAIN_ISSUER,
      },
    };

    const config: Config = ConfigSchema.parse(raw);

    // Auth server discovery workaround is for local use only; it must not
    // be enabled in hosted (multi-tenant) mode where the server is publicly
    // reachable, as it exposes an unauthenticated registration proxy.
    if (
      config.hosted.enabled &&
      config.mcp.authServerDiscoveryMode !== "none"
    ) {
      throw new Error(
        "MCP_AUTH_SERVER_DISCOVERY_MODE cannot be used with MCP_HOSTED=true. " +
          "The auth server discovery workaround is intended for local use only.",
      );
    }

    // In hosted mode the MCP server URL must be set explicitly. The auto-derived
    // value (http://localhost:<port>) would silently end up in the
    // WWW-Authenticate header that OAuth-discovering clients fetch, undoing
    // the very fix that introduced this code path. Fail loud at startup
    // rather than emit a wrong URL on every 401.
    if (config.hosted.enabled && mcpServerUrlAutoDerived) {
      throw new Error(
        "MCP_HOSTED=true requires MCP_SERVER_URL to be set explicitly to the " +
          "public URL clients use to reach this MCP server (e.g. " +
          "http://localhost:3030 for a local Docker container, or " +
          "https://mcp.example.com behind a public reverse proxy). Without " +
          "it the WWW-Authenticate resource_metadata URL would point at the " +
          "auto-derived hostname instead of the MCP server's real public URL.",
      );
    }

    log.info(
      {
        projectRoot,
        // Runtime Configuration
        nodeEnv: config.runtime.nodeEnv,
        logLevel: config.runtime.logLevel,
        // MCP Configuration
        mcpPath: config.mcp.path,
        mcpServerUrl: config.mcp.serverUrl,
        mcpAuthEnabled: config.mcp.enableAuth,
        enableRenderTools: config.mcp.enableRenderTools,
        mcpAuthServerDiscoveryMode: config.mcp.authServerDiscoveryMode,
        // OpenAPI Configuration
        openapiSpecsDir: config.openapi.specsDir,
        openapiServerUrl: config.openapi.serverUrl,
        openapiSearchLimit: config.openapi.searchLimit,
        openapiMaxSearchLimit: config.openapi.maxSearchLimit,
        openapiDefaultRunTimeoutMs: config.openapi.runTimeoutMs,
        openapiMaxRunTimeoutMs: config.openapi.maxRunTimeoutMs,
        includeWriteRequests: config.openapi.includeWriteRequests,
        // Hosted Configuration
        hostedEnabled: config.hosted.enabled,
        hostedValidateTokenIssuer: config.hosted.validateTokenIssuer,
        hostedAllowParentDomainIssuer: config.hosted.allowParentDomainIssuer,
      },
      "Configuration loaded",
    );

    return config;
  } catch (error) {
    log.fatal(
      { error: error instanceof Error ? error.message : "Unknown error" },
      "Failed to load configuration",
    );
    process.exit(1);
    throw error;
  }
}

const config = loadConfig();

export type { Config, HostedConfig };
export default config;
