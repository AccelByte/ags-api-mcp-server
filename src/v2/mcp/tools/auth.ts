// Copyright (c) 2025 AccelByte Inc. All Rights Reserved.
// This is licensed software from AccelByte Inc, for limitations
// and restrictions contact your company contract manager.

/**
 * MCP v2 Auth Tools: get_token_info
 *
 * Ported from src/tools/static-tools.ts with V2 design changes.
 * See docs/V2_ARCHITECTURE.md for architectural rationale and V1 comparison.
 *
 * Key V2 differences from V1:
 * - Stateless: no session-based refresh token info, no cache status, no userContext
 * - Zod schema validation for all outputs
 * - Structured MCP responses (content + structuredContent)
 * - Simplified field names (claims, headers, metadata instead of tokenClaims, etc.)
 * - Structured hints section for agent guidance (namespace usage, etc.)
 * - Masked token display (start + end) instead of prefix-only
 * - Both numeric timestamps and ISO strings for date fields
 * - Conditional field inclusion (omits empty sections)
 */

import jwt from "jsonwebtoken";
import { z } from "zod/v3";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";

import log from "../../logger.js";
import { maskToken } from "../../utils.js";

// #region Schemas

const ClaimsSchema = z
  .object({
    // Registered Claims
    issuer: z.string().optional().describe("The issuer of the token"),
    subject: z.string().optional().describe("The subject of the token"),
    audience: z.string().optional().describe("The audience of the token"),
    expiresAt: z
      .number()
      .optional()
      .describe("The timestamp of the token's expiration"),
    expiresAtISO: z
      .string()
      .optional()
      .describe("The ISO 8601 formatted expiration date of the token"),
    notBefore: z
      .number()
      .optional()
      .describe("The timestamp of the token's not before"),
    notBeforeISO: z
      .string()
      .optional()
      .describe("The ISO 8601 formatted not before date of the token"),
    issuedAt: z
      .number()
      .optional()
      .describe("The timestamp of the token's issuance"),
    issuedAtISO: z
      .string()
      .optional()
      .describe("The ISO 8601 formatted issuance date of the token"),
    jwtId: z.string().optional().describe("The JWT ID of the token"),
    emailVerified: z
      .boolean()
      .optional()
      .describe("Whether the email is verified"),
    clientId: z.string().optional().describe("The client ID of the token"),
    scope: z.string().optional().describe("The scope of the token"),
    roles: z.array(z.any()).describe("The roles of the token"),
    // Custom Claims
    country: z.string().optional().describe("The country of the token"),
    dateOfBirth: z
      .string()
      .optional()
      .describe("The date of birth of the token"),
    displayName: z
      .string()
      .optional()
      .describe("The display name of the token"),
    expiresIn: z.number().optional().describe("The expires in of the token"),
    grantType: z.string().optional().describe("The grant type of the token"),
    isComply: z.boolean().optional().describe("Whether the token is compliant"),
    namespace: z.string().optional().describe("The namespace of the token"),
    permissions: z.array(z.any()).describe("The permissions of the token"),
    phoneVerified: z
      .boolean()
      .optional()
      .describe("Whether the phone is verified"),
    refreshExpiresIn: z
      .number()
      .optional()
      .describe("The refresh expires in of the token"),
    userId: z.string().optional().describe("The user ID of the token"),
  })
  .describe("Claims information about the token");

const HeaderSchema = z
  .object({
    algorithm: z.string().optional().describe("The algorithm of the token"),
    keyId: z.string().optional().describe("The key ID of the token"),
    type: z.string().optional().describe("The type of the token"),
  })
  .describe("Header information about the token");

const MetadataSchema = z
  .object({
    type: z.string().optional().describe("The type of the token"),
    length: z.number().optional().describe("The length of the token"),
    masked: z.string().optional().describe("The masked token"),
    isExpired: z.boolean().optional().describe("Whether the token is expired"),
    timeUntilExpiry: z
      .string()
      .optional()
      .describe("The time until the token expires"),
    lengthRefresh: z
      .number()
      .default(0)
      .describe("The length of the refresh token"),
    maskedRefresh: z.string().optional().describe("The masked refresh token"),
  })
  .describe("Metadata information about the token");

function createHintSchema(key: string) {
  return z.object({
    value: z.string().describe(`The "${key}" value from the token`),
    message: z
      .string()
      .describe(`Instruction for the agent on how to use this "${key}" value`),
  });
}

const HintsSchema = z
  .object({
    namespace: createHintSchema("namespace").optional(),
  })
  .describe("Hints and recommendations for using the token information");

const GetTokenInfoOutputSchema = z.object({
  message: z
    .string()
    .optional()
    .describe(
      "A short summary for the agent explaining the purpose and recommended use of the returned data fields.",
    ),
  claims: ClaimsSchema.optional(),
  headers: HeaderSchema.optional(),
  hints: HintsSchema.optional(),
  metadata: MetadataSchema.optional(),
});

// #endregion Schemas

function setupAuthTools(mcpServer: McpServer) {
  mcpServer.registerTool(
    "get_token_info",
    {
      description:
        "Get information about the authenticated token and user from the access token. Returns the namespace that should be used as the implicit default namespace for all subsequent API requests when a namespace parameter is not explicitly specified.",
      inputSchema: {},
      outputSchema: GetTokenInfoOutputSchema.shape,
    },
    async (
      _: Record<string, unknown>,
      extra: { authInfo?: { token?: string } },
    ) => {
      const token = extra.authInfo?.token;

      if (!token) {
        throw new McpError(
          ErrorCode.InvalidRequest,
          "Authorization header is required",
        );
      }

      const claims: Record<string, unknown> = {};
      const headers: Record<string, unknown> = {};
      const hints: Record<string, unknown> = {};
      const metadata: Record<string, unknown> = {
        type: "unknown",
        length: token.length,
        masked: maskToken(token, 10),
        isExpired: false,
        timeUntilExpiry: "unknown",
        isRefreshExpired: false,
        lengthRefresh: 0,
        maskedRefresh: undefined,
      };

      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const decodedToken: any = jwt.decode(token, { complete: true });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { headers: h, payload: p }: { headers: any; payload: any } =
          decodedToken;

        if (h) {
          headers.algorithm = h.alg;
          headers.keyId = h.kid;
          headers.type = h.typ;
        }

        if (p) {
          const now = new Date();

          // Registered Claims
          if (p.iss) {
            claims.issuer = p.iss;
          }
          if (p.sub) {
            claims.subject = p.sub;
          }
          if (p.aud) {
            claims.audience = p.aud;
          }
          if (p.exp) {
            const expiryDate = new Date(p.exp * 1000);
            const isExpired = expiryDate < now;

            claims.expiresAt = p.exp;
            claims.expiresAtISO = expiryDate.toISOString();
            metadata.isExpired = isExpired;

            if (!isExpired) {
              const diffMs = expiryDate.getTime() - now.getTime();
              const diffMins = Math.floor(diffMs / 60000);
              const diffHours = Math.floor(diffMins / 60);
              const diffDays = Math.floor(diffHours / 24);

              if (diffDays > 0) {
                metadata.timeUntilExpiry = `${diffDays} day(s) ${diffHours % 24} hour(s)`;
              } else if (diffHours > 0) {
                metadata.timeUntilExpiry = `${diffHours} hour(s) ${diffMins % 60} minute(s)`;
              } else {
                metadata.timeUntilExpiry = `${diffMins} minute(s)`;
              }
            } else {
              metadata.timeUntilExpiry = "expired";
            }
          }
          if (p.nbf) {
            claims.notBefore = p.nbf;
            claims.notBeforeISO = new Date(p.nbf * 1000).toISOString();
          }
          if (p.iat) {
            claims.issuedAt = p.iat;
            claims.issuedAtISO = new Date(p.iat * 1000).toISOString();
          }
          if (p.jti) {
            claims.jwtId = p.jti;
          }
          if (p.email_verified) {
            claims.emailVerified = p.email_verified;
          }
          if (p.client_id) {
            claims.clientId = p.client_id;
          }
          if (p.scope) {
            claims.scope = p.scope;
          }
          if (p.roles) {
            claims.roles = p.roles;
          }

          // Custom Claims
          if (p.country) {
            claims.country = p.country;
          }
          if (p.date_of_birth) {
            claims.dateOfBirth = p.date_of_birth;
          }
          if (p.display_name) {
            claims.displayName = p.display_name;
          }
          if (p.expires_in) {
            claims.expiresIn = p.expires_in;
          }
          if (p.grant_type) {
            claims.grantType = p.grant_type;
            if (
              p.grant_type === "client_credentials" ||
              (p.sub && p.sub.includes("client:")) ||
              (!p.display_name && p.client_id)
            ) {
              metadata.type = "client_credentials";
            } else if (
              p.grant_type === "authorization_code" ||
              p.display_name
            ) {
              metadata.type = "user_token";
            } else if (p.grant_type === "refresh_token") {
              metadata.type = "refresh_token";
            }
          }
          if (p.is_comply) {
            claims.isComply = p.is_comply;
          }
          if (p.namespace) {
            claims.namespace = p.namespace;
            hints.namespace = {
              value: p.namespace,
              message: `Use namespace "${p.namespace}" as the implicit default namespace for all subsequent API requests when a namespace parameter is not explicitly specified.`,
            };
          }
          if (p.permissions) {
            claims.permissions = p.permissions;
          }
          if (p.phone_verified) {
            claims.phoneVerified = p.phone_verified;
          }
          if (p.refresh_expires_in) {
            claims.refreshExpiresIn = p.refresh_expires_in;
          }
          if (p.refresh_token) {
            metadata.lengthRefresh = p.refresh_token.length;
            metadata.maskedRefresh = maskToken(p.refresh_token, 10);
          }
          if (p.user_id) {
            claims.userId = p.user_id;
          }
        }
      } catch (error) {
        log.warn({ error }, "Failed to decode JWT token");
      }

      const rawResult: Record<string, unknown> = {
        message: "Token information from authenticated token.",
      };
      if (Object.keys(claims).length > 0) {
        rawResult.claims = claims;
      }
      if (Object.keys(headers).length > 0) {
        rawResult.headers = headers;
      }
      if (Object.keys(hints).length > 0) {
        rawResult.hints = hints;
      }
      if (Object.keys(metadata).length > 0) {
        rawResult.metadata = metadata;
      }

      const validatedResult = GetTokenInfoOutputSchema.safeParse(rawResult);

      if (!validatedResult.success) {
        throw new McpError(
          ErrorCode.InternalError,
          `Get token info result validation failed: ${validatedResult.error.message}`,
        );
      }

      return {
        content: [{ type: "text", text: JSON.stringify(validatedResult.data) }],
        structuredContent: validatedResult.data,
      };
    },
  );
}

export default setupAuthTools;
