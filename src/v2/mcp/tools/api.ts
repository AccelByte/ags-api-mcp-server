// Copyright (c) 2025 AccelByte Inc. All Rights Reserved.
// This is licensed software from AccelByte Inc, for limitations
// and restrictions contact your company contract manager.

/**
 * MCP v2 API Tools Implementation
 *
 * This file implements the search-apis, describe-apis, and run-apis tools for the MCP v2 server.
 * These tools have been ported from src/tools/openapi-tools.ts with several intentional
 * design changes to align with the MCP v2 architecture.
 *
 * ============================================================================
 * FEATURES NOT PORTED (and reasons):
 * ============================================================================
 *
 * 1. USER CONTEXT PARAMETER
 *    - NOT PORTED: userContext parameter passed to runApi method
 *    - REASON: The v2 architecture uses a different authentication flow where
 *      tokens are passed via extra.authInfo.token rather than a userContext object.
 *      The token is extracted from the Authorization header and passed directly
 *      to the underlying OpenApiTools.runApi method, maintaining statelessness.
 *
 * 2. INLINE JSON SCHEMA DEFINITIONS
 *    - NOT PORTED: Inline JSON Schema objects defined in tool registration
 *    - REASON: V2 uses Zod schemas for type-safe validation and better developer
 *      experience. Schemas are defined once and reused for both input validation
 *      and output validation, ensuring consistency.
 *
 * 3. UNBOUNDED LIMIT PARAMETERS
 *    - NOT PORTED: No maximum limit enforcement for search-apis limit parameter
 *    - REASON: V2 enforces configurable maximum limits (maxSearchLimit) to prevent
 *      resource exhaustion and ensure predictable performance. Limits are validated
 *      at the schema level using Zod.
 *
 * 4. UNBOUNDED TIMEOUT PARAMETERS
 *    - NOT PORTED: No maximum timeout enforcement for run-apis timeoutMs parameter
 *    - REASON: V2 enforces configurable maximum timeouts (maxRunTimeoutMs) to prevent
 *      long-running requests from blocking the server. Timeouts are validated at the
 *      schema level with sensible defaults and maximums.
 *
 * 5. PER-REQUEST OpenApiTools INSTANCES
 *    - NOT PORTED: Creating new OpenApiTools instance for each server instance
 *    - REASON: V2 caches OpenApiTools instances based on configuration to avoid
 *      reloading OpenAPI specifications on every request. This significantly improves
 *      performance since specs don't change at runtime.
 *
 * ============================================================================
 * FEATURES IMPROVED:
 * ============================================================================
 *
 * 1. Zod Schema Validation: All inputs and outputs are validated against strict
 *    Zod schemas for type safety, runtime validation, and better error messages.
 *
 * 2. Structured MCP Response: Returns both content (text) and structuredContent
 *    following MCP protocol specifications, enabling clients to consume structured
 *    data without parsing JSON strings.
 *
 * 3. Output Schema Definitions: Explicit output schemas for all tools, enabling
 *    better client-side type generation and validation.
 *
 * 4. Better Error Handling: Uses McpError with proper error codes (ErrorCode)
 *    instead of generic Error objects, providing structured error information.
 *
 * 5. Configurable Limits: Enforces maximum limits for search results and request
 *    timeouts through configuration, preventing resource exhaustion while allowing
 *    reasonable defaults.
 *
 * 6. Token Handling: Cleaner token passing via extra.authInfo.token with
 *    optional useAccessToken flag, maintaining stateless architecture.
 *
 * 7. Instance Caching: Caches OpenApiTools instances based on configuration key,
 *    avoiding redundant spec loading and improving performance for stateless
 *    request handling.
 *
 * 8. Type Safety: Full TypeScript type safety with Zod schema inference, catching
 *    type errors at compile time and runtime.
 *
 * ============================================================================
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod/v3";

import { Config } from "../../config.js";
import { OpenApiTools } from "../../../tools/openapi-tools.js";

const HTTP_METHODS = [
  "GET",
  "PUT",
  "POST",
  "DELETE",
  "PATCH",
  "HEAD",
  "OPTIONS",
  "TRACE",
] as const;

// #region Schemas

const ParameterSummarySchema = z.object({
  name: z.string(),
  in: z.string(),
  required: z.boolean(),
  description: z.string().optional(),
  schema: z.unknown().optional(),
  example: z.unknown().optional(),
  deprecated: z.boolean().optional(),
});

const RequestBodyContentSummarySchema = z.object({
  contentType: z.string(),
  schema: z.unknown().optional(),
  example: z.unknown().optional(),
});

const RequestBodySummarySchema = z.object({
  description: z.string().optional(),
  required: z.boolean().optional(),
  contents: z.array(RequestBodyContentSummarySchema),
});

const ResponseContentSummarySchema = z.object({
  contentType: z.string(),
  schema: z.unknown().optional(),
  example: z.unknown().optional(),
});

const ResponseSummarySchema = z.object({
  status: z.string(),
  description: z.string().optional(),
  contents: z.array(ResponseContentSummarySchema),
});

const ApiOperationBaseSchema = z.object({
  apiId: z.string(),
  spec: z.string(),
  specTitle: z.string().optional(),
  specVersion: z.string().optional(),
  basePath: z.string().optional(),
  path: z.string(),
  method: z.enum(HTTP_METHODS),
  summary: z.string().optional(),
  description: z.string().optional(),
  operationId: z.string().optional(),
  tags: z.array(z.string()),
  servers: z.array(z.string()),
});

const ApiOperationIdentifierSchema = z.object({
  apiId: z
    .string()
    .optional()
    .describe(
      "Identifier returned by the search-apis tool (format: spec:METHOD:/path).",
    ),
  spec: z
    .string()
    .optional()
    .describe("Spec identifier (required when apiId is not provided)"),
  method: z
    .string()
    .optional()
    .describe("HTTP method (required when apiId is not provided)"),
  path: z
    .string()
    .optional()
    .describe("Path template (required when apiId is not provided)."),
});

function createSearchApisInputSchema(config: Config) {
  return z.object({
    query: z
      .string()
      .optional()
      .describe(
        "Text search query to match against API operations (searches in paths, summaries, descriptions, and operation IDs). Case-insensitive.",
      ),
    limit: z
      .number()
      .min(1)
      .max(config.openapi.maxSearchLimit)
      .optional()
      .describe(
        `Maximum number of results to return (default: ${config.openapi.searchLimit}, max: ${config.openapi.maxSearchLimit}).`,
      ),
    method: z
      .enum(HTTP_METHODS)
      .optional()
      .describe(
        `Filter by HTTP method (e.g., 'GET', 'POST', 'PUT', 'DELETE', 'PATCH').`,
      ),
    tag: z
      .string()
      .optional()
      .describe(
        "Filter by OpenAPI tag to find operations with a specific tag.",
      ),
    spec: z
      .string()
      .optional()
      .describe(
        "Filter by specification name to search only within a specific OpenAPI specification.",
      ),
  });
}

const SearchApisResultSchema = ApiOperationBaseSchema.extend({
  parameterCount: z.number(),
  hasRequestBody: z.boolean(),
  score: z.number(),
});

const SearchApisOutputSchema = z.object({
  totalOperations: z.number(),
  matched: z.number(),
  returned: z.number(),
  results: z.array(SearchApisResultSchema),
  availableSpecs: z.array(
    z.object({
      spec: z.string(),
      title: z.string().optional(),
      version: z.string().optional(),
      servers: z.array(z.string()),
    }),
  ),
});

const DescribeApisInputSchema = ApiOperationIdentifierSchema;

const DescribeApisOutputSchema = ApiOperationBaseSchema.extend({
  parameters: z.array(ParameterSummarySchema),
  requestBody: RequestBodySummarySchema.optional(),
  responses: z.array(ResponseSummarySchema),
});

function createRunApisInputSchema(config: Config) {
  return ApiOperationIdentifierSchema.extend({
    serverUrl: z
      .string()
      .optional()
      .describe(
        "Override the server URL; defaults to the first server defined in the spec.",
      ),
    pathParams: z
      .record(z.string(), z.union([z.string(), z.number()]))
      .optional()
      .describe("Values for templated path parameters (key/value pairs)."),
    query: z
      .record(
        z.string(),
        z.union([
          z.string(),
          z.number(),
          z.array(z.union([z.string(), z.number()])),
        ]),
      )
      .optional()
      .describe("Query string parameters to append to the request URL."),
    headers: z
      .record(z.string(), z.string())
      .optional()
      .describe("Additional HTTP headers to include with the request."),
    body: z
      .union([
        z.string(),
        z.number(),
        z.boolean(),
        z.array(z.any()), // keep as any - user provided data
        z.record(z.any()), // keep as any - user provided data
      ])
      .optional()
      .describe(
        "Request payload for methods that support a body. Provide JSON-compatible data (string, number, boolean, array, object) or a raw string.",
      ),
    useAccessToken: z
      .boolean()
      .optional()
      .describe("Use access token from the user context."),
    timeoutMs: z
      .number()
      .min(1)
      .max(config.openapi.maxRunTimeoutMs)
      .default(config.openapi.runTimeoutMs)
      .describe(
        `Timeout in milliseconds (default: ${config.openapi.runTimeoutMs}, max: ${config.openapi.maxRunTimeoutMs}).`,
      ),
  });
}

const RunApisOutputSchema = z.object({
  request: z.object({
    method: z.string(),
    url: z.string(),
    headers: z.record(z.string(), z.string()),
    body: z.unknown().optional(),
  }),
  response: z
    .object({
      status: z.number().optional(),
      statusText: z.string().optional(),
      headers: z.record(z.string(), z.string()).optional(),
      data: z.unknown().optional(),
      durationMs: z.number().optional(),
    })
    .optional(),
  error: z
    .object({
      message: z.string().optional(),
      code: z.string().optional(),
      status: z.number().optional(),
      headers: z.record(z.string(), z.string()).optional(),
      data: z.unknown().optional(),
      durationMs: z.number().optional(),
    })
    .optional(),
});

// #endregion Schemas

// Cache for OpenApiTools instance to avoid reloading specs on every createServer call
// Since the MCP server is stateless, createServer is called frequently, but the
// OpenAPI specs don't change, so we can cache the instance.
let cachedConfigKey: string | null = null;
let cachedOpenApiTools: OpenApiTools | null = null;

function getConfigKey(config: Config): string {
  return JSON.stringify(config.openapi);
}

function getOrCreateOpenApiTools(config: Config): OpenApiTools {
  const configKey = getConfigKey(config);

  // Reuse cached instance if config matches
  if (cachedOpenApiTools && cachedConfigKey === configKey) {
    return cachedOpenApiTools;
  }

  // Create new instance and cache it
  cachedOpenApiTools = new OpenApiTools({
    specsDir: config.openapi.specsDir,
    defaultSearchLimit: config.openapi.searchLimit,
    maxSearchLimit: config.openapi.maxSearchLimit,
    defaultRunTimeoutMs: config.openapi.runTimeoutMs,
    maxRunTimeoutMs: config.openapi.maxRunTimeoutMs,
    defaultServerUrl: config.openapi.serverUrl,
    includeWriteRequests: config.openapi.includeWriteRequests,
  });
  cachedConfigKey = configKey;

  return cachedOpenApiTools;
}

function setupApiTools(mcpServer: McpServer, config: Config) {
  // Create schemas with config values
  const SearchApisInputSchema = createSearchApisInputSchema(config);
  const RunApisInputSchema = createRunApisInputSchema(config);

  // Reuse cached OpenApiTools instance to avoid reloading specs
  const openApiTools = getOrCreateOpenApiTools(config);

  mcpServer.registerTool(
    "search-apis",
    {
      description:
        "Search across OpenAPI operations loaded from the configured specifications directory.",
      inputSchema: SearchApisInputSchema.shape,
      outputSchema: SearchApisOutputSchema.shape,
    },
    async ({ query, limit, method, tag, spec }) => {
      const rawResult = await openApiTools.searchApis({
        query,
        limit,
        method,
        tag,
        spec,
      });
      const validatedResult = SearchApisOutputSchema.safeParse(rawResult);

      if (!validatedResult.success) {
        throw new McpError(
          ErrorCode.InternalError,
          `Search result validation failed: ${validatedResult.error.message}`,
        );
      }

      return {
        content: [{ type: "text", text: JSON.stringify(validatedResult.data) }],
        structuredContent: validatedResult.data,
      };
    },
  );

  mcpServer.registerTool(
    "describe-apis",
    {
      description:
        "Return detailed information about a specific API operation.",
      inputSchema: DescribeApisInputSchema.shape,
      outputSchema: DescribeApisOutputSchema.shape,
    },
    async ({ apiId, spec, method, path }) => {
      const rawResult = await openApiTools.describeApi({
        apiId,
        spec,
        method,
        path,
      });
      const validatedResult = DescribeApisOutputSchema.safeParse(rawResult);

      if (!validatedResult.success) {
        throw new McpError(
          ErrorCode.InternalError,
          `Describe API result validation failed: ${validatedResult.error.message}`,
        );
      }
      return {
        content: [{ type: "text", text: JSON.stringify(validatedResult.data) }],
        structuredContent: validatedResult.data,
      };
    },
  );

  mcpServer.registerTool(
    "run-apis",
    {
      description:
        "Execute an API request against the target endpoint using details from the OpenAPI specification.",
      inputSchema: RunApisInputSchema.shape,
      outputSchema: RunApisOutputSchema.shape,
    },
    async (
      {
        apiId,
        spec,
        method,
        path,
        serverUrl,
        pathParams,
        query,
        headers,
        body,
        useAccessToken,
        timeoutMs,
      },
      extra,
    ) => {
      const shouldUseToken = useAccessToken !== false;
      const token = shouldUseToken ? extra.authInfo?.token : undefined;

      const rawResult = await openApiTools.runApi(
        {
          apiId,
          spec,
          method,
          path,
          serverUrl,
          pathParams,
          query,
          headers,
          body,
          useAccessToken: shouldUseToken,
          timeoutMs,
        },
        undefined,
        token,
      );
      const validatedResult = RunApisOutputSchema.safeParse(rawResult);

      if (!validatedResult.success) {
        throw new McpError(
          ErrorCode.InternalError,
          `Run API result validation failed: ${validatedResult.error.message}`,
        );
      }
      return {
        content: [{ type: "text", text: JSON.stringify(validatedResult.data) }],
        structuredContent: validatedResult.data,
      };
    },
  );
}

export default setupApiTools;
