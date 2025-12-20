// Copyright (c) 2025 AccelByte Inc. All Rights Reserved.
// This is licensed software from AccelByte Inc, for limitations
// and restrictions contact your company contract manager.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

type ElicitationResult<T> =
  | { success: true; value: T }
  | { success: false; error: string };

async function elicitOptionalValue<T>(
  server: McpServer,
  value: T | undefined,
  config: {
    message: string;
    fieldName: string;
    schema: {
      type: "object";
      properties: Record<string, unknown>;
      required?: string[];
    };
    errorNotImplementedMessage?: string;
    errorFailedMessage?: string;
  },
): Promise<ElicitationResult<T>> {
  if (value !== undefined) {
    return { success: true, value };
  }

  const capabilities = server.server.getClientCapabilities();
  if (!capabilities?.elicitation) {
    return {
      success: false,
      error:
        config.errorNotImplementedMessage ||
        `Elicitation is not supported by the MCP client. Please provide the "${config.fieldName}" argument by asking the user for it.`,
    };
  }

  const response = await server.server.elicitInput({
    message: config.message,
    requestedSchema: config.schema as never,
  });

  if (response.content) {
    const elicitedValue = response.content[config.fieldName] as T;
    return { success: true, value: elicitedValue };
  }

  return {
    success: false,
    error: config.errorFailedMessage || "Failed to elicit input from user.",
  };
}

async function elicitAllow(
  server: McpServer,
  value: boolean | undefined,
  config: {
    message?: string;
    description?: string;
    errorNotAllowedMessage?: string;
    errorNotImplementedMessage?: string;
    errorFailedMessage?: string;
  },
): Promise<ElicitationResult<boolean>> {
  const result = await elicitOptionalValue(server, value, {
    message: config.message || "Do you allow this action?",
    fieldName: "allow",
    schema: {
      type: "object",
      properties: {
        allow: {
          type: "boolean",
          description:
            config.description || "Whether the user allows this action.",
        },
      },
      required: ["allow"],
    },
    errorNotImplementedMessage: config.errorNotImplementedMessage,
    errorFailedMessage: config.errorFailedMessage,
  });

  if (!result.success) {
    return result;
  }

  if (!result.value) {
    return {
      success: false,
      error: config.errorNotAllowedMessage || "User did not allow this action.",
    };
  }

  return result;
}

export { type ElicitationResult, elicitOptionalValue, elicitAllow };
