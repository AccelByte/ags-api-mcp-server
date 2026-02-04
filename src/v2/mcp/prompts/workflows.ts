// Copyright (c) 2025 AccelByte Inc. All Rights Reserved.
// This is licensed software from AccelByte Inc, for limitations
// and restrictions contact your company contract manager.

/**
 * MCP v2 Workflows: run-workflow prompt and workflow resources
 *
 * Ported from src/prompts/run-workflow.ts with V2 design changes.
 * See docs/V2_ARCHITECTURE.md for architectural rationale and V1 comparison.
 *
 * This module provides:
 * - PROMPT: run-workflow - generates structured execution instructions for agents
 * - RESOURCES: workflow schema, technical specification, and definitions (YAML)
 *
 * Key V2 differences from V1:
 * - Stateless: no session-based user context; auth via Authorization header
 * - Unified setup: single setupWorkflows() handles resources + prompt registration
 * - In-memory caching: workflows cached per-process to avoid repeated file I/O
 * - Autocomplete: MCP completable() API for workflow name suggestions
 * - McpError: structured error codes instead of generic Error objects
 *
 * Related files:
 * - dist/assets/workflows/ (schema.yaml, SPECIFICATION.md, workflows.yaml)
 * - src/v2/mcp/tools/api.ts (search-apis, describe-apis, run-apis)
 */

import { readFile } from "fs/promises";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { completable } from "@modelcontextprotocol/sdk/server/completable.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod/v3";

import log from "../../logger.js";

// Type definition for workflow data structure
interface WorkflowData {
  inputs?: Record<string, unknown>;
  steps?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

// Cache for workflows loaded from YAML file to avoid reloading on every setupWorkflows call
// Since the MCP server is stateless, setupWorkflows is called frequently, but the
// workflows file doesn't change, so we can cache the loaded workflows.
let cachedFilePath: string | null = null;
let cachedWorkflows: Record<string, WorkflowData> | null = null;

function getFilePath(): string {
  return "dist/assets/workflows/workflows.yaml";
}

async function getOrCreateWorkflows(): Promise<Record<string, WorkflowData>> {
  const filePath = getFilePath();

  // Reuse cached workflows if file path matches
  if (cachedWorkflows && cachedFilePath === filePath) {
    return cachedWorkflows;
  }

  // Load workflows and cache them
  try {
    const content = await readFile(filePath, "utf-8");
    const parsed = parseYaml(content);
    cachedWorkflows = (parsed?.workflows ?? {}) as Record<string, WorkflowData>;
    cachedFilePath = filePath;

    log.info(
      {
        workflowCount: Object.keys(cachedWorkflows).length,
        workflows: Object.keys(cachedWorkflows),
      },
      "Workflows loaded and cached",
    );
  } catch (error) {
    log.error({ error }, "Failed to load workflows.yaml");
    cachedWorkflows = {};
    cachedFilePath = filePath;
  }

  return cachedWorkflows;
}

/**
 * Compose a prompt that describes a workflow and how to run it
 */
function composeWorkflowPrompt(
  workflowName: string,
  workflow: WorkflowData,
): string {
  return `# Workflow: ${workflowName}
  
  ## Workflow Definition
  
  \`\`\`yaml
  ${stringifyYaml(workflow)}
  \`\`\`
  
  ## Instructions
  
  You are the workflow runner. Follow these directions exactly when executing "${workflowName}" with this MCP server's tools.
  
  ### Preparation
  - Read the workflow's \`inputs\` section.
  - Ask the user for every required input value (optional inputs can use defaults if present).
  - Confirm you have all values before moving to the steps.
  
  ### Step Execution Loop
  For each item in \`steps\` (in order, waiting for declared dependencies):
  
  1. **Understand the operation**
     - If the step specifies \`operationId\`: use \`search-apis\` with the operationId to locate the operation.
     - If the step specifies \`method\` + \`path\`: use \`search-apis\` with the method and path to find the operation.
     - Use \`describe-apis\` to get detailed information about the operation (parameters, required fields, request/response schemas).
  
  2. **Decide how to run the step**
     - \`operationId\`: call \`run-apis\` with that operation (e.g., \`iam.createUser\`).
     - \`method\` + \`path\`: call \`run-apis\` with the HTTP method, path template, and payload described in the step. If the workflow defines multiple \`sourceDescriptions\`, include the step's \`source\` so the call targets the correct API (see Section 3.2 of the Technical Specification).
     - \`workflowRef\`: recursively execute the referenced workflow before continuing. Provide the nested workflow with the inputs it declares, using the same \`workflow/*\` and \`step/*\` mapping rules used elsewhere.
  
  3. **Resolve inputs**
     - Replace every \`workflow/*\` reference with the user-provided value collected earlier (or the workflow default).
     - Replace every \`step/*\` reference with the captured output from the referenced step.
  
  4. **Respect dependencies**
     - Only run the step after every \`dependencies\` entry (e.g., \`step/create-user\`) has completed successfully.
  
  5. **Capture outputs**
     - Use the JSONPath, redirect, header, or status instructions defined in the step to store outputs for downstream steps and final workflow outputs.
  
  ### Reference Material
  - Workflow Technical Specification — \`fetch_mcp_resource\` with \`uri="resource://workflows/technical-specification"\` (behavior, data flow, composition rules).
  - Workflow Schema — \`fetch_mcp_resource\` with \`uri="resource://workflows/schema"\` (exact JSON Schema).
  `;
}

/**
 * Get the run-workflow prompt definition-
 */
const workflowArgumentCompletable = completable(
  z.string(),
  async (value: string = "") => {
    const workflows = await getOrCreateWorkflows();
    const normalized = value.toLowerCase();
    return Object.keys(workflows)
      .filter((name) => name.toLowerCase().startsWith(normalized))
      .sort()
      .slice(0, 100);
  },
);

async function setupWorkflows(mcpServer: McpServer) {
  // Register workflow-related resources
  mcpServer.registerResource(
    "Workflow Schema",
    "resource://workflows/schema",
    {
      description: "JSON schema for workflow definitions in YAML format",
      mimeType: "application/x-yaml",
    },
    async () => {
      const filePath = "dist/assets/workflows/schema.yaml";
      const content = await readFile(filePath, "utf-8");
      return {
        contents: [
          {
            uri: "resource://workflows/schema",
            mimeType: "application/x-yaml",
            text: content,
          },
        ],
      };
    },
  );

  mcpServer.registerResource(
    "Workflow Specification",
    "resource://workflows/technical-specification",
    {
      description: "Specification document for workflow system",
      mimeType: "text/markdown",
    },
    async () => {
      const filePath = "dist/assets/workflows/SPECIFICATION.md";
      const content = await readFile(filePath, "utf-8");
      return {
        contents: [
          {
            uri: "resource://workflows/technical-specification",
            mimeType: "text/markdown",
            text: content,
          },
        ],
      };
    },
  );

  mcpServer.registerResource(
    "Workflows",
    "resource://workflows",
    {
      description: "AGS Workflow Definitions",
      mimeType: "application/x-yaml",
    },
    async () => {
      const filePath = "dist/assets/workflows/workflows.yaml";
      const content = await readFile(filePath, "utf-8");
      return {
        contents: [
          {
            uri: "resource://workflows",
            mimeType: "application/x-yaml",
            text: content,
          },
        ],
      };
    },
  );

  // Load and cache workflows on setup to avoid reloading on every request
  const workflows = await getOrCreateWorkflows();

  mcpServer.registerPrompt(
    "run-workflow",
    {
      title: "Run a workflow",
      description: "Run a workflow",
      argsSchema: {
        workflow: workflowArgumentCompletable,
      },
    },
    async ({ workflow: workflowName }: { workflow: string }) => {
      if (!workflowName) {
        throw new McpError(
          ErrorCode.InvalidRequest,
          `Workflow '${workflowName}' not found`,
        );
      }

      const workflowData = workflows[workflowName];
      if (!workflowData) {
        throw new McpError(
          ErrorCode.InvalidRequest,
          `Workflow '${workflowName}' not found`,
        );
      }

      const prompt = composeWorkflowPrompt(workflowName, workflowData);

      return {
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: prompt,
            },
          },
        ],
      };
    },
  );
}

export default setupWorkflows;
