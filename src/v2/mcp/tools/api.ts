// Copyright (c) 2025 AccelByte Inc. All Rights Reserved.
// This is licensed software from AccelByte Inc, for limitations
// and restrictions contact your company contract manager.

/**
 * MCP v2 API Tools: search-apis, describe-apis, run-apis
 *
 * Ported from src/tools/openapi-tools.ts with V2 design changes.
 * See docs/V2_ARCHITECTURE.md for architectural rationale and V1 comparison.
 *
 * Key V2 differences from V1:
 * - Stateless auth: tokens via extra.authInfo.token, no server-side sessions
 * - Zod schemas for input/output validation (replaces inline JSON Schema)
 * - Structured MCP responses (content + structuredContent)
 * - Configurable max limits for search results and request timeouts
 * - User consent via MCP elicitation for write operations (POST/PUT/PATCH/DELETE)
 * - OpenApiTools instance caching (specs don't change at runtime)
 *
 * KNOWN ISSUE: Some LLM agents (Auto agent, Composer 1) incorrectly serialize
 * nested objects as "[object Object]" in the `body` parameter. Use Claude
 * Opus 4.5 or Sonnet 4.5 which handle this correctly.
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
      headers: z
        .record(z.string(), z.union([z.string(), z.array(z.string())]))
        .optional(),
      data: z.unknown().optional(),
      durationMs: z.number().optional(),
    })
    .optional(),
  error: z
    .object({
      message: z.string().optional(),
      code: z.string().optional(),
      status: z.number().optional(),
      headers: z
        .record(z.string(), z.union([z.string(), z.array(z.string())]))
        .optional(),
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

async function getOrCreateOpenApiTools(config: Config): Promise<OpenApiTools> {
  const configKey = getConfigKey(config);

  // Reuse cached instance if config matches
  if (cachedOpenApiTools && cachedConfigKey === configKey) {
    return cachedOpenApiTools;
  }

  // Create new instance without loading specs synchronously
  cachedOpenApiTools = new OpenApiTools({
    specsDir: config.openapi.specsDir,
    defaultSearchLimit: config.openapi.searchLimit,
    maxSearchLimit: config.openapi.maxSearchLimit,
    defaultRunTimeoutMs: config.openapi.runTimeoutMs,
    maxRunTimeoutMs: config.openapi.maxRunTimeoutMs,
    defaultServerUrl: config.openapi.serverUrl,
    includeWriteRequests: config.openapi.includeWriteRequests,
    loadSpecs: false, // Don't load specs in constructor
  });

  // Load specs asynchronously
  await cachedOpenApiTools.loadSpecsAsync();

  cachedConfigKey = configKey;

  return cachedOpenApiTools;
}

async function setupApiTools(mcpServer: McpServer, config: Config) {
  // Create schemas with config values
  const SearchApisInputSchema = createSearchApisInputSchema(config);
  const RunApisInputSchema = createRunApisInputSchema(config);

  // Reuse cached OpenApiTools instance to avoid reloading specs
  const openApiTools = await getOrCreateOpenApiTools(config);

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
