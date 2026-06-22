// Copyright (c) 2025 AccelByte Inc. All Rights Reserved.
// This is licensed software from AccelByte Inc, for limitations
// and restrictions contact your company contract manager.

// Shared inline (CSP-safe) icon set + icon-button helper. Extracted from
// dashboard.ts so chrome entries (which live outside dashboard.ts) can reuse
// the exact same icons without importing the whole dashboard module.

const SVG_NS = "http://www.w3.org/2000/svg";

/** Build an inline (CSP-safe) stroke icon from one or more SVG path `d` values. */
export function strokeIcon(paths: string[]): SVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  for (const d of paths) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    svg.appendChild(path);
  }
  return svg;
}

/** Feather-style icon set used by the dashboard chrome (stroke paths / filled dots). */
export const ICONS = {
  refresh: (): SVGElement =>
    strokeIcon([
      "M23 4v6h-6",
      "M1 20v-6h6",
      "M3.51 9a9 9 0 0 1 14.85-3.36L23 10",
      "M20.49 15a9 9 0 0 1-14.85 3.36L1 14",
    ]),
  maximize: (): SVGElement =>
    strokeIcon([
      "M8 3H5a2 2 0 0 0-2 2v3",
      "M21 8V5a2 2 0 0 0-2-2h-3",
      "M3 16v3a2 2 0 0 0 2 2h3",
      "M16 21h3a2 2 0 0 0 2-2v-3",
    ]),
  minimize: (): SVGElement =>
    strokeIcon([
      "M8 3v3a2 2 0 0 1-2 2H3",
      "M21 8h-3a2 2 0 0 1-2-2V3",
      "M3 16h3a2 2 0 0 1 2 2v3",
      "M16 21v-3a2 2 0 0 1 2-2h3",
    ]),
  trash: (): SVGElement =>
    strokeIcon([
      "M3 6h18",
      "M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2",
      "M6 6l1 14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-14",
    ]),
  kebab: (): SVGElement => {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", "16");
    svg.setAttribute("height", "16");
    svg.setAttribute("fill", "currentColor");
    svg.setAttribute("aria-hidden", "true");
    for (const cy of [5, 12, 19]) {
      const dot = document.createElementNS(SVG_NS, "circle");
      dot.setAttribute("cx", "12");
      dot.setAttribute("cy", String(cy));
      dot.setAttribute("r", "1.8");
      svg.appendChild(dot);
    }
    return svg;
  },
};

/** An icon-only button with an accessible label (shown as a native tooltip). */
export function iconButton(
  label: string,
  className: string,
  icon: SVGElement,
  onClick: () => void | Promise<void>,
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `renderer-dashboard-iconbtn ${className}`;
  button.title = label;
  button.setAttribute("aria-label", label);
  button.appendChild(icon);
  button.addEventListener("click", () => {
    void onClick();
  });
  return button;
}
