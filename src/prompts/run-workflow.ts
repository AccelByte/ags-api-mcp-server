import { readFile } from "fs/promises";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { logger } from "../logger.js";
import { Prompt, MCPServer } from "../mcp-server.js";
import { StdioMCPServer } from "../stdio-server.js";

// Cache for workflows loaded from YAML file
let workflowsCache: any = null;

/**
 * Load workflows from YAML file and cache them
 */
export async function loadWorkflows(): Promise<void> {
  try {
    const filePath = "dist/assets/workflows/workflows.yaml";
    const content = await readFile(filePath, "utf-8");
    const parsed = parseYaml(content);
    workflowsCache = parsed?.workflows || {};
    logger.info(
      {
        workflowCount: Object.keys(workflowsCache).length,
        workflows: Object.keys(workflowsCache),
      },
      "Workflows loaded and cached",
    );
  } catch (error) {
    logger.error({ error }, "Failed to load workflows.yaml");
    workflowsCache = {};
  }
}

/**
 * Compose a prompt that describes a workflow and how to run it
 */
function composeWorkflowPrompt(workflowName: string, workflow: any): string {
  return `# Workflow: ${workflowName}

## Workflow Definition

\`\`\`yaml
${stringifyYaml(workflow)}
\`\`\`

## Instructions

You are the workflow runner. Follow these directions exactly when executing "${workflowName}" with this MCP server's "run-apis" tool.

### Preparation
- Read the workflow's \`inputs\` section.
- Ask the user for every required input value (optional inputs can use defaults if present).
- Confirm you have all values before moving to the steps.

### Step Execution Loop
For each item in \`steps\` (in order, waiting for declared dependencies):

1. **Decide how to run the step**
   - \`operationId\`: call \`run-apis\` with that operation (e.g., \`iam.createUser\`).
   - \`method\` + \`path\`: call \`run-apis\` with the HTTP method, path template, and payload described in the step. If the workflow defines multiple \`sourceDescriptions\`, include the step's \`source\` so the call targets the correct API (see Section 3.2 of the Technical Specification).
   - \`workflowRef\`: recursively execute the referenced workflow before continuing. Provide the nested workflow with the inputs it declares, using the same \`workflow/*\` and \`step/*\` mapping rules used elsewhere.

2. **Resolve inputs**
   - Replace every \`workflow/*\` reference with the user-provided value collected earlier (or the workflow default).
   - Replace every \`step/*\` reference with the captured output from the referenced step.

3. **Respect dependencies**
   - Only run the step after every \`dependencies\` entry (e.g., \`step/create-user\`) has completed successfully.

4. **Capture outputs**
   - Use the JSONPath, redirect, header, or status instructions defined in the step to store outputs for downstream steps and final workflow outputs.

### Reference Material
- Workflow Technical Specification — \`fetch_mcp_resource\` with \`uri="resource://workflows/technical-specification"\` (behavior, data flow, composition rules).
- Workflow Schema — \`fetch_mcp_resource\` with \`uri="resource://workflows/schema"\` (exact JSON Schema).
`;
}

/**
 * Get the run-workflow prompt definition
 */
function getRunWorkflowPrompt(): Prompt {
  return {
    name: "run-workflow",
    description: "Run a workflow",
    arguments: [
      {
        name: "workflow",
        description: "The workflow to run",
        required: true,
      },
    ],
  };
}

/**
 * Get the run-workflow prompt handler
 */
function getRunWorkflowHandler(): (args: any, userContext?: any) => Promise<string> {
  return async (args: any, userContext?: any) => {
    const workflowName = args?.workflow;
    if (!workflowName) {
      throw new Error("Workflow name is required");
    }

    // Ensure workflows are loaded
    if (!workflowsCache) {
      await loadWorkflows();
    }

    // Search for the workflow in the workflows object
    const workflow = workflowsCache[workflowName];
    if (!workflow) {
      const availableWorkflows = Object.keys(workflowsCache);
      throw new Error(
        `Workflow '${workflowName}' not found. Available workflows: ${availableWorkflows.join(", ") || "none"}`,
      );
    }

    // Compose a prompt to run the workflow
    const prompt = composeWorkflowPrompt(workflowName, workflow);

    return prompt;
  };
}

/**
 * Register the run-workflow prompt with an MCP server
 */
export function registerRunWorkflowPrompt(
  mcpServer: MCPServer | StdioMCPServer,
): void {
  mcpServer.registerPrompt(getRunWorkflowPrompt(), getRunWorkflowHandler());
}

