import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { createDashboardBinder } from "../../../../src/v2/renderer/chrome/binder.js";
import type { DashboardHostBridge } from "../../../../src/v2/renderer/views/dashboard.js";

type Call = { name: string; arguments?: Record<string, unknown> };

function recordingBridge(calls: Call[]): DashboardHostBridge {
  return {
    callServerTool: async (params) => {
      calls.push(params);
      return { isError: false, structuredContent: { ok: true } };
    },
  };
}

describe("createDashboardBinder — action → server tool table", () => {
  // The single source of truth for "which intent calls which tool".
  const cases: Array<{ action: keyof ReturnType<typeof createDashboardBinder>; tool: string }> = [
    { action: "pin", tool: "pin_query" },
    { action: "refresh", tool: "refresh_pinned_query" },
    { action: "remove", tool: "unpin_query" },
    { action: "refreshAll", tool: "refresh_all_pinned" },
    { action: "quotaRefresh", tool: "get_quota_usage" },
    { action: "update", tool: "update_pinned_query" },
  ];

  for (const { action, tool } of cases) {
    test(`${String(action)} → ${tool}, forwards args, returns result`, async () => {
      const calls: Call[] = [];
      const binder = createDashboardBinder(recordingBridge(calls));
      const payload = { pin_id: "p1", namespace: "studioalpha" };

      const result = await binder[action](payload);

      assert.equal(calls.length, 1);
      assert.equal(calls[0]?.name, tool);
      assert.deepEqual(calls[0]?.arguments, payload);
      assert.deepEqual(result, { isError: false, structuredContent: { ok: true } });
    });
  }

  test("rejects when the host cannot call server tools", async () => {
    const binder = createDashboardBinder({});
    await assert.rejects(binder.pin({}), /cannot call server tools/);
  });
});
