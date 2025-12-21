// Copyright (c) 2025 AccelByte Inc. All Rights Reserved.
// This is licensed software from AccelByte Inc, for limitations
// and restrictions contact your company contract manager.

/**
 * MCP v2 Workflows Prompt and Resources Implementation
 *
 * This file implements the run-workflow prompt and related MCP resources for the
 * MCP v2 server. It has been ported from src/prompts/run-workflow.ts with several
 * intentional design changes to align with the MCP v2 architecture.
 *
 * ============================================================================
 * OVERVIEW
 * ============================================================================
 *
 * This module provides:
 *
 * 1. PROMPT: run-workflow
 *    - Generates structured instructions for LLM agents to execute workflows
 *    - Includes workflow definition, execution guide, and resource references
 *    - Supports autocomplete for workflow names with fuzzy matching
 *
 * 2. RESOURCES: Workflow documentation and definitions
 *    - resource://workflows/schema - JSON schema for workflow YAML format
 *    - resource://workflows/technical-specification - Full specification document
 *    - resource://workflows - All workflow definitions (workflows.yaml)
 *
 * Workflows enable complex task automation by orchestrating multiple API calls
 * with dependency management, data flow, input/output mapping, and error handling.
 *
 * ============================================================================
 * WORKFLOW EXECUTION MODEL
 * ============================================================================
 *
 * When an agent uses the run-workflow prompt, it receives:
 *
 * 1. WORKFLOW DEFINITION (YAML)
 *    - Full workflow specification including inputs, steps, and dependencies
 *    - Rendered as formatted YAML for easy parsing
 *
 * 2. EXECUTION INSTRUCTIONS
 *    - Preparation: How to collect required inputs from the user
 *    - Step Execution: How to run each step in order with proper dependencies
 *    - Input Resolution: How to replace workflow/* and step/* references
 *    - Output Capture: How to extract and store outputs for downstream steps
 *
 * 3. REFERENCE MATERIALS
 *    - Technical specification (via fetch_mcp_resource)
 *    - JSON Schema definition (via fetch_mcp_resource)
 *
 * The agent is expected to:
 * - Use search-apis and describe-apis to understand operations before execution
 * - Use run-apis to execute API calls with proper parameters
 * - Manage dependencies and data flow between steps
 * - Handle nested workflows via workflowRef recursion
 *
 * ============================================================================
 * REGISTERED RESOURCES
 * ============================================================================
 *
 * Three MCP resources are registered to provide workflow documentation:
 *
 * 1. resource://workflows/schema
 *    - Name: "Workflow Schema"
 *    - MIME Type: application/x-yaml
 *    - Source: dist/assets/workflows/schema.yaml
 *    - Purpose: JSON Schema definition for validating workflow YAML structure
 *
 * 2. resource://workflows/technical-specification
 *    - Name: "Workflow Specification"
 *    - MIME Type: text/markdown
 *    - Source: dist/assets/workflows/SPECIFICATION.md
 *    - Purpose: Complete technical specification with behavior rules, data flow,
 *      composition patterns, and best practices
 *
 * 3. resource://workflows
 *    - Name: "Workflows"
 *    - MIME Type: application/x-yaml
 *    - Source: dist/assets/workflows/workflows.yaml
 *    - Purpose: All workflow definitions available for execution
 *
 * Resources are loaded on-demand when accessed via fetch_mcp_resource and are
 * not cached by this module (caching is the responsibility of the MCP client).
 *
 * ============================================================================
 * WORKFLOW CACHING STRATEGY
 * ============================================================================
 *
 * Since the MCP v2 server is stateless, setupWorkflows() is called on every
 * server initialization. To avoid expensive file I/O on every call, workflows
 * are cached in memory using two module-level variables:
 *
 * - cachedFilePath: Tracks which file was loaded
 * - cachedWorkflows: Stores the parsed workflow definitions
 *
 * The cache is invalidated only when the file path changes (which should never
 * happen in production, but could occur in tests or during development). This
 * design balances statelessness with performance.
 *
 * IMPORTANT: The cache is per-process, not per-request. In a clustered
 * deployment, each process maintains its own cache. File changes require
 * process restart to take effect.
 *
 * ============================================================================
 * AUTOCOMPLETE SUPPORT
 * ============================================================================
 *
 * The workflow argument uses MCP's completable() API to provide autocomplete
 * suggestions as the user types:
 *
 * - Filters workflow names by prefix (case-insensitive)
 * - Returns up to 100 matching workflows (sorted alphabetically)
 * - Loads workflows on-demand for suggestion generation
 *
 * Example: Typing "user" might suggest:
 *   - user-creation
 *   - user-deletion
 *   - user-profile-update
 *
 * ============================================================================
 * FEATURES NOT PORTED (and reasons):
 * ============================================================================
 *
 * 1. SESSION-BASED USER CONTEXT
 *    - NOT PORTED: userContext parameter with session-based token information
 *    - REASON: The v2 architecture is stateless and does not store sessions or
 *      tokens. All authentication is handled via the Authorization header passed
 *      by the MCP client on each request. Workflow instructions reference the
 *      run-apis tool which automatically uses tokens from extra.authInfo.
 *
 * 2. EXPLICIT WORKFLOW PRELOADING
 *    - NOT PORTED: Separate loadWorkflows() export function called explicitly
 *    - REASON: V2 integrates workflow loading into setupWorkflows() with automatic
 *      caching, eliminating the need for manual preloading. The cache persists
 *      across setupWorkflows() calls within the same process, maintaining efficiency
 *      while simplifying the API surface.
 *
 * 3. SEPARATE registerRunWorkflowPrompt() FUNCTION
 *    - NOT PORTED: Separate function for registering the prompt
 *    - REASON: V2 uses a single setupWorkflows() function that handles both
 *      resource registration and prompt registration, providing a cleaner API
 *      and ensuring resources are always registered alongside the prompt.
 *
 * ============================================================================
 * FEATURES IMPROVED:
 * ============================================================================
 *
 * 1. Resource Registration: Registers three workflow-related MCP resources
 *    (schema, specification, definitions) alongside the prompt, enabling agents
 *    to access comprehensive documentation on-demand without external file access.
 *
 * 2. Completable Workflow Names: Uses MCP's completable() API for rich
 *    autocomplete support, enabling agents and IDEs to suggest workflow names
 *    as users type. Supports prefix matching and returns sorted results.
 *
 * 3. File-Based Caching: Implements smart caching strategy that avoids repeated
 *    file I/O while maintaining stateless architecture. Cache is keyed by file
 *    path and persists across prompt invocations within the same process.
 *
 * 4. Structured Prompt Format: Generates well-formatted markdown prompts with
 *    clear sections (Definition, Instructions, Reference Material) that guide
 *    agents through workflow execution with minimal ambiguity.
 *
 * 5. Error Handling: Uses McpError with proper error codes (ErrorCode) instead
 *    of generic Error objects, providing structured error information that
 *    clients can handle programmatically.
 *
 * 6. Enhanced Instructions: Adds explicit guidance to use search-apis and
 *    describe-apis before executing operations, ensuring agents understand
 *    API parameters and schemas before making requests.
 *
 * 7. Step-by-Step Execution Guide: Provides detailed instructions for each phase
 *    of workflow execution (preparation, operation lookup, input resolution,
 *    dependency management, output capture) with clear action items.
 *
 * 8. Nested Workflow Support: Documents workflowRef execution pattern, enabling
 *    recursive workflow composition with proper input/output mapping across
 *    workflow boundaries.
 *
 * 9. Logging Integration: Logs workflow loading events with workflow count and
 *    names for observability, helping debug configuration issues and monitor
 *    workflow availability.
 *
 * ============================================================================
 * USAGE EXAMPLES
 * ============================================================================
 *
 * Example 1: Load a simple workflow
 *   Prompt: run-workflow
 *   Arguments: { workflow: "create-user" }
 *   Result: Generates prompt with workflow definition and execution instructions
 *
 * Example 2: Use autocomplete to find workflows
 *   Start typing: "user"
 *   Autocomplete suggestions: ["user-creation", "user-deletion", "user-profile"]
 *   Select: "user-creation"
 *
 * Example 3: Execute workflow with dependencies
 *   Workflow: has steps with dependencies: ["step/create-user", "step/assign-role"]
 *   Agent behavior:
 *     1. Run create-user step
 *     2. Wait for success
 *     3. Run assign-role step using output from create-user
 *
 * Example 4: Handle nested workflows
 *   Workflow: step with workflowRef: "setup-user-permissions"
 *   Agent behavior:
 *     1. Load setup-user-permissions workflow
 *     2. Collect nested workflow inputs
 *     3. Execute nested workflow steps
 *     4. Continue with parent workflow steps
 *
 * Example 5: Access workflow documentation
 *   fetch_mcp_resource("resource://workflows/schema")
 *   fetch_mcp_resource("resource://workflows/technical-specification")
 *   fetch_mcp_resource("resource://workflows")
 *
 * ============================================================================
 * RELATED RESOURCES
 * ============================================================================
 *
 * - Workflow definitions: dist/assets/workflows/workflows.yaml
 * - Technical specification: dist/assets/workflows/SPECIFICATION.md
 * - JSON Schema: dist/assets/workflows/schema.yaml
 * - API tools: src/v2/mcp/tools/api.ts (search-apis, describe-apis, run-apis)
 * - V1 implementation: src/prompts/run-workflow.ts
 *
 * ============================================================================
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
