import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { toRows } from "../../../../src/v2/renderer/views/coerce.js";

describe("toRows", () => {
  test("coerces numeric columns to numbers", () => {
    const rows = toRows(
      [{ name: "score", type: "bigint" }],
      [["42"]],
    );

    assert.equal(rows[0]?.score, 42);
    assert.equal(typeof rows[0]?.score, "number");
  });

  test("coerces temporal columns to Date by default", () => {
    const rows = toRows(
      [{ name: "created_at", type: "timestamp" }],
      [["2026-05-14T12:30:00.000Z"]],
    );

    assert.ok(rows[0]?.created_at instanceof Date);
  });

  test("preserves formatted temporal strings when a format hint is present", () => {
    const rows = toRows(
      [{ name: "created_at", type: "timestamp" }],
      [["2026-05-14"]],
      {
        created_at: {
          type: "temporal",
          format: "date-only",
        },
      },
    );

    assert.equal(rows[0]?.created_at, "2026-05-14");
  });

  test("treats null-like strings as null", () => {
    const rows = toRows(
      [
        { name: "notes", type: "varchar" },
        { name: "comment", type: "varchar" },
      ],
      [["", "null"]],
    );

    assert.equal(rows[0]?.notes, null);
    assert.equal(rows[0]?.comment, null);
  });
});
