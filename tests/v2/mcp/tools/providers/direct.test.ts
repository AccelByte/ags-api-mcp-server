import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";

import { createDirectProvider } from "../../../../../src/v2/mcp/tools/providers/direct.js";

const originalFetch = globalThis.fetch;

describe("createDirectProvider", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("returns supplied inline data as provider data", async () => {
    const provider = createDirectProvider();
    const columns = [{ name: "score", type: "bigint" }];
    const rows = [["42"]];

    const result = await provider.resolve(
      {
        data_columns: columns,
        data_rows: rows,
      },
      "",
    );

    assert.deepEqual(result, { columns, rows });
  });

  test("throws when data_columns is missing", async () => {
    const provider = createDirectProvider();

    await assert.rejects(
      provider.resolve({ data_rows: [["42"]] }, ""),
      /provider="direct" requires both data_columns and data_rows\./,
    );
  });

  test("throws when data_rows is missing", async () => {
    const provider = createDirectProvider();

    await assert.rejects(
      provider.resolve(
        {
          data_columns: [{ name: "score", type: "bigint" }],
        },
        "",
      ),
      /provider="direct" requires both data_columns and data_rows\./,
    );
  });

  test("never calls fetch", async () => {
    let called = false;
    globalThis.fetch = async (): Promise<Response> => {
      called = true;
      throw new Error("fetch should not be called");
    };

    const provider = createDirectProvider();

    await provider.resolve(
      {
        data_columns: [{ name: "score", type: "bigint" }],
        data_rows: [["42"]],
      },
      "",
    );

    assert.equal(called, false);
  });
});
