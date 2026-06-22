// Copyright (c) 2025 AccelByte Inc. All Rights Reserved.
// This is licensed software from AccelByte Inc, for limitations
// and restrictions contact your company contract manager.

import type {
  AnyChrome,
  Cancelled,
  ChromeView,
  Dispose,
  EffectHost,
  Region,
  ToolResult,
} from "./types.js";
import { REGION_ORDER } from "./types.js";
import type { Resolved } from "./resolve.js";

export interface FrameHeaderOptions {
  title?: string;
  description?: string;
  chartType?: string;
}

/** Drives a chrome intent into behavior; returns the tool result (or cancelled). */
export type BindFn = (
  type: string,
  payload?: Record<string, unknown>,
) => Promise<ToolResult | Cancelled>;

/**
 * A cleanup registry decoupled from any DOM. Surfaces that aren't a {@link Frame}
 * (e.g. the dashboard header) create one to own their chromes' effect disposers
 * and dispose them on re-mount / teardown.
 */
export interface MountScope {
  /** Register a cleanup. Runs immediately if already disposed. */
  addDispose(fn: Dispose): void;
  /** Whether {@link dispose} has run — effects guard re-renders on this. */
  isDisposed(): boolean;
  /** Run every registered cleanup (LIFO) once. Idempotent. */
  dispose(): void;
}

export function createMountScope(): MountScope {
  const disposers: Dispose[] = [];
  let disposed = false;
  return {
    addDispose(fn) {
      if (disposed) {
        fn();
        return;
      }
      disposers.push(fn);
    },
    isDisposed() {
      return disposed;
    },
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      for (const fn of disposers.splice(0).reverse()) {
        try {
          fn();
        } catch {
          // A cleanup throwing must not block the others.
        }
      }
    },
  };
}

/**
 * Build the {@link EffectHost} for an already-mounted chrome element within a
 * {@link MountScope} — element getter, `dispatch` via `bind`, in-place re-render,
 * `onDispose` → scope — run the chrome's `effect` (if any), register its disposer,
 * and RETURN the host. Most callers ({@link mountResolved}) ignore the return;
 * a surface that mounts chrome by hand (e.g. the dashboard header) keeps the host
 * to drive `host.update` from its own data flow.
 */
export function attachEffect(
  chrome: AnyChrome,
  slice: unknown,
  mountedEl: ChromeView,
  scope: MountScope,
  bind?: BindFn,
  onActivate?: () => void,
): EffectHost {
  let currentEl = mountedEl;
  const host: EffectHost = {
    get element() {
      return currentEl;
    },
    dispatch: (i) =>
      bind
        ? bind(i.type, i.payload)
        : Promise.reject(new Error("No binder available for dispatch.")),
    update: (newSlice) => {
      if (scope.isDisposed()) {
        return;
      }
      const next = chrome.render(newSlice);
      if (onActivate) {
        next.addEventListener("click", onActivate);
      }
      currentEl.replaceWith(next);
      currentEl = next;
    },
    onDispose: (fn) => scope.addDispose(fn),
  };
  if (chrome.effect) {
    const dispose = chrome.effect(slice, host);
    if (typeof dispose === "function") {
      scope.addDispose(dispose);
    }
  }
  return host;
}

/**
 * The shell frame: owns the `.renderer-shell` DOM and exposes named regions for
 * chrome to mount into. Extracted from `mountShell` so placement is a property
 * of the frame, not hand-wired per render branch. The DOM it builds is byte-for-
 * byte the legacy shell (header-text + actions slot, body, footer) so every
 * existing render stays pixel-identical.
 */
export interface Frame extends MountScope {
  readonly shell: HTMLElement;
  readonly body: HTMLDivElement;
  readonly footer: HTMLDivElement;
  /** Mount a chrome view into a region; wire `onActivate` if the chrome is actionable. */
  mount(region: Region, view: ChromeView, onActivate?: () => void): void;
}

/**
 * Several logical regions intentionally share one physical container today: the
 * header has a single `.renderer-header-actions` slot, and footer notes must
 * stay DIRECT children of `.renderer-footer` (its flex layout + `margin-left:auto`
 * on the stats note + `:empty{display:none}` all depend on that). Sub-wrapping
 * would change pixels; logical regions give us ordering without new DOM.
 */
function regionContainer(
  region: Region,
  headerActions: HTMLDivElement,
  footer: HTMLDivElement,
): HTMLElement {
  switch (region) {
    case "footer-start":
    case "footer-end":
      return footer;
    case "header-start":
    case "header-end":
    case "overflow": // generic frame has no separate kebab — map overflow into the actions row (the dashboard builds its own kebab via buildOverflowMenu)
      return headerActions;
    default:
      return headerActions;
  }
}

export function createFrame(
  root: HTMLElement,
  options: FrameHeaderOptions = {},
): Frame {
  const shell = document.createElement("section");
  shell.className = "renderer-shell";

  const header = document.createElement("div");
  header.className = "renderer-header";

  const headerText = document.createElement("div");
  headerText.className = "renderer-header-text";

  if (options.chartType) {
    const eyebrow = document.createElement("span");
    eyebrow.className = "renderer-eyebrow";
    eyebrow.textContent = options.chartType;
    headerText.appendChild(eyebrow);
  }

  const heading = document.createElement("h1");
  heading.className = "renderer-title";
  heading.textContent = options.title ?? "Analytics visualization";
  headerText.appendChild(heading);

  if (options.description) {
    const description = document.createElement("p");
    description.className = "renderer-description";
    description.textContent = options.description;
    headerText.appendChild(description);
  }

  const actions = document.createElement("div");
  actions.className = "renderer-header-actions";

  header.append(headerText, actions);

  const body = document.createElement("div");
  body.className = "renderer-chart-body";

  const footer = document.createElement("div");
  footer.className = "renderer-footer";

  shell.append(header, body, footer);
  root.appendChild(shell);

  const scope = createMountScope();

  return {
    ...scope,
    shell,
    body,
    footer,
    mount(region, view, onActivate) {
      if (onActivate) {
        view.addEventListener("click", onActivate);
      }
      regionContainer(region, actions, footer).appendChild(view);
    },
  };
}

/**
 * Mount a resolver result into the frame, region by region in canonical order,
 * each chrome in its resolved order. The frame never decides presence/order —
 * {@link resolve} already did; this just walks the result and renders.
 *
 * `bind` (optional) turns a chrome's intent into behavior; presentational chrome
 * has no `intent`. A chrome with an `effect` gets it run once after mount (via
 * {@link attachEffect}); its disposer is registered on the frame and runs on
 * `frame.dispose()`.
 */
export function mountResolved(
  frame: Frame,
  resolved: Resolved,
  bind?: BindFn,
): void {
  for (const region of REGION_ORDER) {
    for (const { chrome, slice } of resolved[region]) {
      const intent = chrome.intent?.(slice);
      const onActivate =
        intent && bind
          ? () => {
              void bind(intent.type, intent.payload);
            }
          : undefined;
      const view = chrome.render(slice);
      frame.mount(region, view, onActivate);
      attachEffect(chrome, slice, view, frame, bind, onActivate);
    }
  }
}
