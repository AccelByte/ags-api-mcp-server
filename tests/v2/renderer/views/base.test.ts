import assert from "node:assert/strict";
import { describe, test } from "node:test";

import "../jsdom.js";
import {
  pickAxes,
  pickCategoryKey,
  pickColorKey,
  pickNumericKey,
  validateColumns,
} from "../../../../src/v2/renderer/views/base.js";
import { toRows } from "../../../../src/v2/renderer/views/coerce.js";

describe("renderer view helpers", () => {
  test("pickAxes prefers category x and numeric y", () => {
    const rows = toRows(
      [
        { name: "team", type: "varchar" },
        { name: "score", type: "bigint" },
      ],
      [["alpha", "10"]],
    );

    assert.deepEqual(pickAxes(rows), { x: "team", y: "score" });
  });

  test("pickColorKey rejects categories above cardinality threshold", () => {
    const rows = toRows(
      [
        { name: "segment", type: "varchar" },
        { name: "value", type: "bigint" },
      ],
      Array.from({ length: 21 }, (_, index) => [`segment-${index}`, String(index)]),
    );

    assert.equal(pickColorKey(rows, "segment"), undefined);
  });

  test("pickNumericKey and pickCategoryKey follow inferred types", () => {
    const rows = toRows(
      [
        { name: "bucket", type: "varchar" },
        { name: "revenue", type: "double" },
        { name: "active", type: "boolean" },
      ],
      [["north", "12.5", "true"]],
    );

    assert.equal(pickNumericKey(rows), "revenue");
    assert.equal(pickCategoryKey(rows), "bucket");
  });

  test("validateColumns throws on unknown keys", () => {
    const rows = toRows(
      [{ name: "value", type: "bigint" }],
      [["7"]],
    );

    assert.doesNotThrow(() => {
      validateColumns(rows, "value");
    });

    assert.throws(() => {
      validateColumns(rows, "missing");
    }, /Unknown column/);
  });
});
