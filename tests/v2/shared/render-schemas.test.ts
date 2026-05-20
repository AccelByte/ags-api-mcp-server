import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  BarChartOutputSchema,
  MetricOutputSchema,
  RenderOutputSchema,
  TableOutputSchema,
} from "../../../src/v2/shared/render-schemas.js";

describe("CommonEnvelopeFields.sql", () => {
  const baseChart = {
    chart_type: "bar" as const,
    data: {
      columns: [
        { name: "team", type: "varchar" },
        { name: "score", type: "bigint" },
      ],
      rows: [["alpha", "10"]],
    },
    options: { x: "team", y: "score" },
  };

  test("sql is optional on a chart envelope and round-trips", () => {
    const withoutSql = BarChartOutputSchema.parse(baseChart);
    assert.equal(withoutSql.sql, undefined);

    const withSql = BarChartOutputSchema.parse({
      ...baseChart,
      sql: "SELECT team, score FROM games",
    });
    assert.equal(withSql.sql, "SELECT team, score FROM games");
  });

  test("sql is optional on TableOutputSchema", () => {
    const parsed = TableOutputSchema.parse({
      chart_type: "table",
      data: { columns: [{ name: "a", type: "varchar" }], rows: [["x"]] },
      options: {},
      sql: "SELECT a FROM t",
    });
    assert.equal(parsed.sql, "SELECT a FROM t");
  });

  test("sql is optional on MetricOutputSchema", () => {
    const parsed = MetricOutputSchema.parse({
      chart_type: "metric",
      data: { columns: [{ name: "v", type: "bigint" }], rows: [["1"]] },
      options: { value: "v" },
      sql: "SELECT v FROM t",
    });
    assert.equal(parsed.sql, "SELECT v FROM t");
  });

  test("RenderOutputSchema accepts sql on any envelope", () => {
    const parsed = RenderOutputSchema.parse({
      ...baseChart,
      sql: "SELECT 1",
    });
    assert.equal(parsed.sql, "SELECT 1");
  });
});
