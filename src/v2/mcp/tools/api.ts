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
 * TOOL OVERVIEW
 * ============================================================================
 *
 * 1. search-apis: Semantic search across loaded OpenAPI specifications
 *    - Searches paths, summaries, descriptions, and operation IDs
 *    - Supports filtering by method, tag, and spec name
 *    - Returns ranked results with configurable limits
 *
 * 2. describe-apis: Get detailed information about a specific API operation
 *    - Returns parameters, request body, and response schemas
 *    - Supports lookup by apiId (from search results) or spec/method/path
 *    - Includes examples and validation rules
 *
 * 3. run-apis: Execute API requests with automatic authentication
 *    - Supports path/query parameters, headers, and request bodies
 *    - Automatic token injection when useAccessToken is true (default)
 *    - User consent required via elicitation (allow parameter)
 *    - Structured response with request/response/error details
 *
 * ============================================================================
 * AUTHENTICATION FLOW (STATELESS)
 * ============================================================================
 *
 * The v2 MCP server is completely stateless and does NOT handle OAuth2
 * authentication or store any tokens/sessions. Token handling is simple:
 *
 * 1. MCP client obtains access token (via OAuth2 or other means externally)
 * 2. MCP client passes token in Authorization header with each request
 * 3. Middleware extracts token from header and attaches to req.auth
 * 4. MCP server receives token via extra.authInfo.token
 * 5. Token automatically injected into API requests when useAccessToken=true
 * 6. Token passed as third parameter to OpenApiTools.runApi()
 *
 * Example token flow:
 *   MCP Client → Authorization: Bearer <token>
 *   → Express Middleware (setAuthFromToken)
 *   → req.auth = { token, clientId, scopes, expiresAt }
 *   → MCP Request Handler → extra.authInfo.token
 *   → run-apis tool → OpenApiTools.runApi(params, undefined, token)
 *   → Target API with Authorization header
 *
 * IMPORTANT: The MCP server does NOT:
 *   - Store tokens or sessions
 *   - Handle OAuth2 flows (login, token exchange, refresh)
 *   - Manage token expiration or refresh
 *   - Cache authentication state
 *
 * Token management is the responsibility of the MCP client, not the server.
 *
 * ============================================================================
 * USER CONSENT VIA ELICITATION
 * ============================================================================
 *
 * The run-apis tool requires explicit user consent before executing API requests
 * with side effects (POST, PUT, PATCH, DELETE). Read-only operations (GET, HEAD,
 * OPTIONS, TRACE) can proceed without consent.
 *
 * Consent flow for write operations:
 * 1. Tool accepts optional `allow` boolean parameter
 * 2. If not provided, elicitAllow() prompts the user via MCP protocol
 * 3. If user denies or elicitation fails, returns structured error response
 * 4. Only executes API call after receiving explicit consent
 *
 * This security measure prevents unauthorized data modifications while allowing
 * LLM agents to freely explore and query read-only APIs without interrupting
 * the user experience.
 *
 * ============================================================================
 * KNOWN ISSUE: LLM AGENTS AND NESTED OBJECT PARAMETERS
 * ============================================================================
 *
 * Some LLM agents incorrectly serialize nested objects when making tool calls,
 * passing the literal string "[object Object]" instead of the actual JSON object.
 * This affects the `body` parameter in run-apis when it contains nested structures.
 *
 * AFFECTED MODELS (as of December 2025):
 *   - Auto agent: ❌ Passes "[object Object]"
 *   - Composer 1:  ❌ Passes "[object Object]"
 *
 * WORKING MODELS:
 *   - Claude Opus 4.5:   ✅ Correctly passes nested objects
 *   - Claude Sonnet 4.5: ✅ Correctly passes nested objects
 *
 * SYMPTOMS:
 *   - API returns 400 Bad Request or 415 Unsupported Media Type
 *   - Request body shows "body":"[object Object]" instead of actual JSON
 *   - Validation errors about malformed JSON
 *
 * WORKAROUND:
 *   Switch to a model that correctly serializes nested objects
 *   (e.g., Claude Opus 4.5 or Claude Sonnet 4.5).
 *
 * TECHNICAL NOTE:
 *   This is an LLM tool-calling serialization bug, not a schema issue.
 *   The body parameter schema correctly accepts objects via z.record(z.any())
 *   and the underlying API client handles nested objects properly.
 *
 * ============================================================================
 * USAGE EXAMPLES
 * ============================================================================
 *
 * Example 1: Search for user-related APIs
 *   search-apis({ query: "user profile", method: "GET", limit: 10 })
 *
 * Example 2: Get details about a specific API
 *   describe-apis({ apiId: "iam:GET:/v3/public/users/{userId}" })
 *
 * Example 3: Execute a read-only GET request (no consent required)
 *   run-apis({
 *     apiId: "iam:GET:/v3/public/users/{userId}",
 *     pathParams: { userId: "abc123" },
 *     useAccessToken: true
 *   })
 *
 * Example 4: Execute a POST request with body (consent required)
 *   run-apis({
 *     spec: "iam",
 *     method: "POST",
 *     path: "/v3/public/users",
 *     body: { email: "user@example.com", username: "newuser" },
 *     allow: true
 *   })
 *
 * Example 5: Execute a DELETE request (consent required)
 *   run-apis({
 *     apiId: "iam:DELETE:/v3/public/users/{userId}",
 *     pathParams: { userId: "abc123" },
 *     allow: true
 *   })
 *
 * ============================================================================
 * FEATURES NOT PORTED (and reasons):
 * ============================================================================
 *
 * 1. USER CONTEXT PARAMETER
 *    - NOT PORTED: userContext parameter passed to runApi method
 *    - REASON: The v2 architecture uses a cleaner authentication flow where
 *      tokens are passed via extra.authInfo.token rather than a userContext object.
 *      The token is extracted from the Authorization header and passed directly
 *      to the underlying OpenApiTools.runApi method, maintaining statelessness.
 *
 * 2. INLINE JSON SCHEMA DEFINITIONS
 *    - NOT PORTED: Inline JSON Schema objects defined in tool registration
 *    - REASON: V2 uses Zod schemas for type-safe validation and better developer
 *      experience. Schemas are defined once and reused for both input validation
 *      and output validation, ensuring consistency and reducing duplication.
 *
 * 3. UNBOUNDED LIMIT PARAMETERS
 *    - NOT PORTED: No maximum limit enforcement for search-apis limit parameter
 *    - REASON: V2 enforces configurable maximum limits (maxSearchLimit) to prevent
 *      resource exhaustion and ensure predictable performance. Limits are validated
 *      at the schema level using Zod with clear error messages.
 *
 * 4. UNBOUNDED TIMEOUT PARAMETERS
 *    - NOT PORTED: No maximum timeout enforcement for run-apis timeoutMs parameter
 *    - REASON: V2 enforces configurable maximum timeouts (maxRunTimeoutMs) to prevent
 *      long-running requests from blocking the server. Timeouts are validated at the
 *      schema level with sensible defaults (15s) and maximums (60s).
 *
 * 5. PER-REQUEST OpenApiTools INSTANCES
 *    - NOT PORTED: Creating new OpenApiTools instance for each server instance
 *    - REASON: V2 caches OpenApiTools instances based on configuration hash to avoid
 *      reloading OpenAPI specifications on every request. This significantly improves
 *      performance since specs are static and don't change at runtime.
 *
 * ============================================================================
 * FEATURES IMPROVED:
 * ============================================================================
 *
 * 1. Zod Schema Validation: All inputs and outputs are validated against strict
 *    Zod schemas for type safety, runtime validation, and better error messages.
 *    Schemas are defined once and reused across input/output/validation layers.
 *
 * 2. Structured MCP Response: Returns both content (text) and structuredContent
 *    following MCP protocol specifications, enabling clients to consume structured
 *    data without parsing JSON strings. This improves reliability and type safety.
 *
 * 3. Output Schema Definitions: Explicit output schemas for all tools, enabling
 *    better client-side type generation, validation, and autocomplete in IDEs.
 *    Outputs are validated before returning to catch implementation errors early.
 *
 * 4. Better Error Handling: Uses McpError with proper error codes (ErrorCode)
 *    instead of generic Error objects, providing structured error information
 *    that clients can handle programmatically with appropriate error recovery.
 *
 * 5. Configurable Limits: Enforces maximum limits for search results and request
 *    timeouts through configuration, preventing resource exhaustion while allowing
 *    reasonable defaults. Limits are environment-specific and overridable.
 *
 * 6. Token Handling: Cleaner token passing via extra.authInfo.token with
 *    optional useAccessToken flag (defaults to true), maintaining stateless
 *    architecture. Token extraction happens automatically from Authorization header.
 *
 * 7. Instance Caching: Caches OpenApiTools instances based on configuration key
 *    (JSON.stringify(config.openapi)), avoiding redundant spec loading and improving
 *    performance for stateless request handling. Cache invalidates on config change.
 *
 * 8. Type Safety: Full TypeScript type safety with Zod schema inference, catching
 *    type errors at compile time and runtime. Schemas serve as single source of
 *    truth for both TypeScript types and runtime validation.
 *
 * 9. Selective User Consent: Integrates MCP elicitation protocol for explicit
 *    user consent before executing write operations (POST, PUT, PATCH, DELETE).
 *    Read-only operations (GET, HEAD, OPTIONS, TRACE) proceed without consent,
 *    balancing security with user experience. Returns structured error when
 *    consent is denied without throwing exceptions.
 *
 * ============================================================================
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod/v3";

import { Config } from "../../config.js";
import { elicitAllow } from "../elicitations.js";
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
    allow: z
      .boolean()
      .optional()
      .describe(
        "Whether the user allows this API request. NEVER set this parameter without asking the user first. If not provided, the user will be prompted for consent via MCP elicitation when required.",
      ),
  });
}

const RunApisOutputSchema = z.object({
  request: z
    .object({
      method: z.string(),
      url: z.string(),
      headers: z.record(z.string(), z.string()),
      body: z.unknown().optional(),
    })
    .optional(),
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
        allow,
      },
      extra,
    ) => {
      // Determine the HTTP method for this request
      let resolvedMethod = method;
      if (!resolvedMethod && apiId) {
        // Extract method from apiId format: "spec:METHOD:/path"
        const [, methodFromApiId] = apiId.split(":");
        if (methodFromApiId) {
          resolvedMethod = methodFromApiId;
        }
      }

      // Only require consent for API calls with side effects (write operations)
      // Read-only operations (GET, HEAD, OPTIONS, TRACE) can proceed without consent
      const methodsRequiringConsent = ["POST", "PUT", "PATCH", "DELETE"];
      const requiresConsent =
        resolvedMethod &&
        methodsRequiringConsent.includes(resolvedMethod.toUpperCase());

      if (requiresConsent && resolvedMethod) {
        const methodUpper = resolvedMethod.toUpperCase();
        const resolvedAllow = await elicitAllow(mcpServer, allow, {
          message: `Do you allow this ${methodUpper} API request?`,
          description: `Whether the user allows this ${methodUpper} API request.`,
          errorNotAllowedMessage: `User did not allow this ${methodUpper} API request.`,
        });

        if (!resolvedAllow.success) {
          const result = RunApisOutputSchema.parse({
            error: {
              message: resolvedAllow.error,
            },
          });
          return {
            content: [{ type: "text", text: JSON.stringify(result) }],
            structuredContent: result,
          };
        }
      }

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
