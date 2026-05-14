import assert from "node:assert/strict";
import { describe, test } from "node:test";

import "../../jsdom.js";
import { renderStateTimeline } from "../../../../../src/v2/renderer/views/charts/state-timeline.js";
import { toRows } from "../../../../../src/v2/renderer/views/coerce.js";

describe("renderStateTimeline", () => {
  test("returns a chart element for valid timeline intervals", () => {
    const rows = toRows(
      [
        { name: "server", type: "varchar" },
        { name: "started_at", type: "timestamp" },
        { name: "ended_at", type: "timestamp" },
        { name: "state", type: "varchar" },
      ],
      [
        ["alpha", "2026-05-14T00:00:00Z", "2026-05-14T01:00:00Z", "healthy"],
        ["alpha", "2026-05-14T01:00:00Z", "2026-05-14T02:30:00Z", "degraded"],
        ["beta", "2026-05-14T00:15:00Z", "2026-05-14T02:00:00Z", "healthy"],
      ],
    );

    const chart = renderStateTimeline(rows, {
      entity: "server",
      start: "started_at",
      end: "ended_at",
      state: "state",
    });

    assert.ok(
      chart instanceof SVGElement || chart instanceof HTMLElement,
      "expected an SVGElement or HTMLElement",
    );
  });

  test("throws when required timeline columns are missing", () => {
    const rows = toRows(
      [
        { name: "entity", type: "varchar" },
        { name: "start", type: "timestamp" },
        { name: "end", type: "timestamp" },
        { name: "state", type: "varchar" },
      ],
      [["alpha", "2026-05-14T00:00:00Z", "2026-05-14T01:00:00Z", "online"]],
    );

    assert.throws(() => {
      renderStateTimeline(rows, {
        entity: "entity",
        start: "start",
        end: "missing",
        state: "state",
      });
    }, /Unknown column/);
  });
});
