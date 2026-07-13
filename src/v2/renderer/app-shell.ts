// Copyright (c) 2025 AccelByte Inc.
// SPDX-License-Identifier: Apache-2.0

import {
  App,
  applyDocumentTheme,
  applyHostFonts,
  applyHostStyleVariables,
  type McpUiDisplayMode,
  type McpUiHostContext,
  type McpUiToolInputNotification,
  type McpUiToolResultNotification,
} from "@modelcontextprotocol/ext-apps";
import {
  BUNDLE_VERSION,
  RenderOutputSchema,
} from "../shared/render-schemas.js";
import {
  clearDashboardMode,
  type DashboardHostBridge,
  maybeAddPinAffordance,
  refreshDashboardMode,
  renderDashboard,
  renderResolvedOutput,
} from "./views/dashboard.js";
import {
  type EditorHostBridge,
  refreshTextEditorMode,
  renderTextEditor,
} from "./views/text-editor.js";

export interface RendererHostStyleAppliers {
  applyTheme(theme: McpUiHostContext["theme"]): void;
  applyStyleVariables(
    variables: NonNullable<McpUiHostContext["styles"]>["variables"],
  ): void;
  applyFonts(
    fonts: NonNullable<NonNullable<McpUiHostContext["styles"]>["css"]>["fonts"],
  ): void;
}

export interface RendererToolResultLike {
  structuredContent?: unknown;
  isError?: boolean;
  content?: Array<{ type?: string; text?: string }>;
}

export interface RendererAppLike {
  connect(): Promise<void>;
  getHostContext(): McpUiHostContext | undefined;
  onerror?: ((error: Error) => void) | undefined;
  onhostcontextchanged?: ((context: McpUiHostContext) => void) | undefined;
  ontoolinput?:
    | ((params: McpUiToolInputNotification["params"]) => void)
    | undefined;
  ontoolresult?:
    | ((result: McpUiToolResultNotification["params"]) => void)
    | undefined;
}

export interface BootstrapRendererOptions {
  root?: HTMLElement;
  styleAppliers?: RendererHostStyleAppliers;
}

export const defaultHostStyleAppliers: RendererHostStyleAppliers = {
  applyTheme: (theme) => {
    if (theme) {
      applyDocumentTheme(theme);
    }
  },
  applyStyleVariables: (variables) => {
    if (variables) {
      applyHostStyleVariables(variables);
    }
  },
  applyFonts: (fonts) => {
    if (fonts) {
      applyHostFonts(fonts);
    }
  },
};

function appRoot(root?: HTMLElement): HTMLElement {
  if (root) {
    return root;
  }

  const element = document.getElementById("app");
  if (!element) {
    throw new Error('Renderer root element "#app" was not found.');
  }

  return element;
}

export function showError(message: string, root?: HTMLElement): void {
  const element = appRoot(root);
  element.replaceChildren();

  const container = document.createElement("div");
  container.className = "render-error";
  container.textContent = message;
  element.appendChild(container);
}

export function showLoading(root?: HTMLElement): void {
  const element = appRoot(root);
  element.replaceChildren();

  const container = document.createElement("div");
  container.className = "render-loading";
  container.textContent = "Loading…";
  element.appendChild(container);
}

export function applyHostContext(
  context: McpUiHostContext,
  styleAppliers: RendererHostStyleAppliers = defaultHostStyleAppliers,
): void {
  if (context.theme) {
    styleAppliers.applyTheme(context.theme);
  }
  if (context.styles?.variables) {
    styleAppliers.applyStyleVariables(context.styles.variables);
  }
  if (context.styles?.css?.fonts) {
    styleAppliers.applyFonts(context.styles.css.fonts);
  }
}

export function assertBundleVersion(
  context: McpUiHostContext | undefined,
  root?: HTMLElement,
): void {
  const resourceMeta =
    context?.resource &&
    typeof context.resource === "object" &&
    "_meta" in context.resource &&
    context.resource._meta &&
    typeof context.resource._meta === "object"
      ? (context.resource._meta as Record<string, unknown>)
      : undefined;
  const advertisedVersion = resourceMeta?.["ags/bundleVersion"];
  if (
    typeof advertisedVersion === "string" &&
    advertisedVersion !== BUNDLE_VERSION
  ) {
    showError(
      `Renderer bundle is out of date (host ${advertisedVersion} vs. bundle ${BUNDLE_VERSION}). Refresh the page to load the latest version.`,
      root,
    );
    throw new Error("BUNDLE_VERSION mismatch");
  }
}

function extractErrorText(result: RendererToolResultLike): string {
  const firstText = result.content?.find(
    (item) => item.type === "text" && typeof item.text === "string",
  );

  return firstText?.text ?? "Could not render this result.";
}

export interface EditorHost {
  bridge: EditorHostBridge;
  displayMode: McpUiDisplayMode | undefined;
}

export interface DashboardHost {
  bridge: DashboardHostBridge;
  displayMode: McpUiDisplayMode | undefined;
}

export function renderToolResult(
  result: RendererToolResultLike,
  root?: HTMLElement,
  editorHost?: EditorHost,
  dashboardHost?: DashboardHost,
): void {
  const element = appRoot(root);

  if (result.isError) {
    showError(extractErrorText(result), element);
    return;
  }

  const parsed = RenderOutputSchema.parse(result.structuredContent);

  if (parsed.chart_type === "dashboard") {
    if (!dashboardHost) {
      showError("The dashboard requires an interactive host.", element);
      return;
    }
    renderDashboard(
      element,
      parsed,
      dashboardHost.bridge,
      dashboardHost.displayMode,
    );
    return;
  }

  // Any non-dashboard result tears down dashboard-specific document styling so
  // a reused webview doesn't keep the fixed-height/no-padding layout.
  clearDashboardMode();

  if (parsed.chart_type === "text_editor") {
    if (!editorHost) {
      showError("This editor requires an interactive host.", element);
      return;
    }
    renderTextEditor(
      element,
      parsed,
      editorHost.bridge,
      editorHost.displayMode,
    );
    return;
  }

  renderResolvedOutput(element, parsed);
  maybeAddPinAffordance(element, parsed, dashboardHost?.bridge);
}

export async function bootstrapRenderer(
  app: RendererAppLike = new App(
    {
      name: "AGS Renderer",
      version: BUNDLE_VERSION,
    },
    // Declare the display modes the renderer supports so hosts expose the
    // inline ⇄ fullscreen toggle the text-editor and dashboard rely on.
    { availableDisplayModes: ["inline", "fullscreen"] },
  ),
  options: BootstrapRendererOptions = {},
): Promise<RendererAppLike> {
  const root = appRoot(options.root);
  const styleAppliers = options.styleAppliers ?? defaultHostStyleAppliers;

  app.onerror = (error) => {
    showError(error instanceof Error ? error.message : String(error), root);
  };

  const editorBridge = app as unknown as EditorHostBridge;
  const dashboardBridge = app as unknown as DashboardHostBridge;

  app.onhostcontextchanged = (context) => {
    applyHostContext(context, styleAppliers);
    // `context` is a partial (changed fields only); read the merged mode so an
    // unrelated update (theme/size) can't reset the editor/dashboard layout.
    const mode = app.getHostContext()?.displayMode;
    refreshTextEditorMode(mode);
    refreshDashboardMode(mode);
  };

  app.ontoolinput = () => {
    showLoading(root);
  };

  app.ontoolresult = (result) => {
    try {
      renderToolResult(
        result,
        root,
        {
          bridge: editorBridge,
          displayMode: app.getHostContext()?.displayMode,
        },
        {
          bridge: dashboardBridge,
          displayMode: app.getHostContext()?.displayMode,
        },
      );
    } catch (error) {
      showError(
        error instanceof Error
          ? `Could not render this result: ${error.message}`
          : "Could not render this result.",
        root,
      );
    }
  };

  await app.connect();

  const context = app.getHostContext();
  if (context) {
    applyHostContext(context, styleAppliers);
    assertBundleVersion(context, root);
  }

  return app;
}
