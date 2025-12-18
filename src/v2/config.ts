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

const ConfigSchema = z.object({
  mcp: McpConfigSchema,
  openapi: OpenApiConfigSchema,
  runtime: RuntimeConfigSchema,
});

type Config = z.infer<typeof ConfigSchema>;

// Load and validate configuration
function loadConfig(): Config {
  try {
    const mcpPort = parseInt(
      process.env.MCP_PORT || process.env.PORT || "3000",
      10,
    );
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
    };

    const config: Config = ConfigSchema.parse(raw);

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
        // OpenAPI Configuration
        openapiSpecsDir: config.openapi.specsDir,
        openapiServerUrl: config.openapi.serverUrl,
        openapiSearchLimit: config.openapi.searchLimit,
        openapiMaxSearchLimit: config.openapi.maxSearchLimit,
        openapiDefaultRunTimeoutMs: config.openapi.runTimeoutMs,
        openapiMaxRunTimeoutMs: config.openapi.maxRunTimeoutMs,
        includeWriteRequests: config.openapi.includeWriteRequests,
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

export type { Config };
export default config;
