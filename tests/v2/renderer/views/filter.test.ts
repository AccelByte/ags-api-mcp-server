import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { filterRows } from "../../../../src/v2/renderer/views/filter.js";
import { toRows } from "../../../../src/v2/renderer/views/coerce.js";

const rows = toRows(
  [
    { name: "segment", type: "varchar" },
    { name: "value", type: "bigint" },
    { name: "ratio", type: "double" },
    { name: "active", type: "boolean" },
  ],
  [
    ["alpha", "5", "0.1", "true"],
    ["beta", "10", "0.5", "false"],
    ["gamma", "20", "0.9", "true"],
  ],
);

describe("filterRows", () => {
  test("supports eq and neq", () => {
    assert.equal(
      filterRows(rows, [{ column: "segment", op: "eq", value: "beta" }]).length,
      1,
    );
    assert.equal(
      filterRows(rows, [{ column: "segment", op: "neq", value: "beta" }]).length,
      2,
    );
  });

  test("supports gt gte lt and lte", () => {
    assert.equal(
      filterRows(rows, [{ column: "value", op: "gt", value: 10 }]).length,
      1,
    );
    assert.equal(
      filterRows(rows, [{ column: "value", op: "gte", value: 10 }]).length,
      2,
    );
    assert.equal(
      filterRows(rows, [{ column: "value", op: "lt", value: 10 }]).length,
      1,
    );
    assert.equal(
      filterRows(rows, [{ column: "value", op: "lte", value: 10 }]).length,
      2,
    );
  });

  test("supports in and not_in arrays", () => {
    assert.equal(
      filterRows(rows, [
        { column: "segment", op: "in", value: ["alpha", "gamma"] },
      ]).length,
      2,
    );
    assert.equal(
      filterRows(rows, [
        { column: "segment", op: "not_in", value: ["alpha", "gamma"] },
      ]).length,
      1,
    );
  });

  test("coerces string filter values to the row type when possible", () => {
    assert.equal(
      filterRows(rows, [{ column: "value", op: "eq", value: "20" }]).length,
      1,
    );
    assert.equal(
      filterRows(rows, [{ column: "active", op: "eq", value: "true" }]).length,
      2,
    );
  });

  test("type mismatches do not throw and simply exclude the row", () => {
    assert.doesNotThrow(() => {
      filterRows(rows, [{ column: "value", op: "gt", value: "not-a-number" }]);
    });
    assert.equal(
      filterRows(rows, [{ column: "value", op: "gt", value: "not-a-number" }]).length,
      0,
    );
  });
});
