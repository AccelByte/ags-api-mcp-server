import assert from "node:assert/strict";
import { describe, test } from "node:test";

import "./jsdom.js";
import { BUNDLE_VERSION } from "../../../src/v2/shared/render-schemas.js";
import {
  assertBundleVersion,
  bootstrapRenderer,
  type RendererAppLike,
  type RendererHostStyleAppliers,
} from "../../../src/v2/renderer/app-shell.js";

function resetRoot(): HTMLElement {
  const root = document.getElementById("app");
  assert.ok(root, "expected #app root");
  root.replaceChildren();
  return root;
}

function createFakeApp(
  resourceMeta?: Record<string, unknown>,
): RendererAppLike & { calls: { connect: number } } {
  return {
    calls: { connect: 0 },
    async connect() {
      this.calls.connect += 1;
    },
    getHostContext() {
      return {
        theme: "light",
        styles: {
          variables: {
            "--color-accent": "#0f766e",
          },
          css: {
            fonts: "@font-face { font-family: Test; src: local('Test'); }",
          },
        },
        resource: {
          _meta: resourceMeta,
        },
      };
    },
  };
}

describe("renderer app shell", () => {
  test("missing bundle version advertisement does not throw", () => {
    const root = resetRoot();
    assert.doesNotThrow(() => {
      assertBundleVersion(undefined, root);
    });
    assert.equal(root.textContent, "");
  });

  test("matching bundle version does not throw", () => {
    const root = resetRoot();
    assert.doesNotThrow(() => {
      assertBundleVersion(
        { resource: { _meta: { "ags/bundleVersion": BUNDLE_VERSION } } },
        root,
      );
    });
    assert.equal(root.textContent, "");
  });

  test("mismatched bundle version shows an error", () => {
    const root = resetRoot();

    assert.throws(
      () => {
        assertBundleVersion(
          { resource: { _meta: { "ags/bundleVersion": "0.0.1" } } },
          root,
        );
      },
      /BUNDLE_VERSION mismatch/,
    );

    assert.match(
      root.textContent ?? "",
      /Renderer bundle is out of date/,
    );
  });

  test("bootstrapRenderer wires handlers, applies host context, and renders results", async () => {
    const root = resetRoot();
    const app = createFakeApp({ "ags/bundleVersion": BUNDLE_VERSION });

    const applied: string[] = [];
    const styleAppliers: RendererHostStyleAppliers = {
      applyTheme(theme) {
        applied.push(`theme:${theme ?? "none"}`);
      },
      applyStyleVariables(variables) {
        applied.push(`vars:${Object.keys(variables).length}`);
      },
      applyFonts(fonts) {
        applied.push(`fonts:${fonts ? "yes" : "no"}`);
      },
    };

    await bootstrapRenderer(app, { root, styleAppliers });

    assert.equal(app.calls.connect, 1);
    assert.ok(app.ontoolinput);
    assert.ok(app.ontoolresult);
    assert.ok(app.onhostcontextchanged);
    assert.deepEqual(applied, ["theme:light", "vars:1", "fonts:yes"]);

    app.ontoolinput?.({});
    assert.match(root.textContent ?? "", /Loading/);

    app.ontoolresult?.({
      structuredContent: {
        chart_type: "metric",
        title: "Requests",
        data: {
          columns: [{ name: "value", type: "bigint" }],
          rows: [["42"]],
        },
        options: {
          value: "value",
        },
      },
    });

    assert.match(root.textContent ?? "", /42/);
  });
});
