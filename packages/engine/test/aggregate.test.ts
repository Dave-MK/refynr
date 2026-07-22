import { describe, expect, it } from "vitest";
import { groupBy, numericValue } from "../src/index.js";
import type { Table } from "../src/index.js";

function t(headers: string[], ...rows: (string | number | null)[][]): Table {
  return { headers, rows };
}

const sales = t(
  ["region", "rep", "amount"],
  ["North", "Ann", 100],
  ["North", "Bob", 200],
  ["South", "Cly", 300],
  ["South", "Ann", 50],
  ["South", "Ann", 50],
);

describe("groupBy — basics", () => {
  it("groups and sums, in first-appearance order", () => {
    const { table, diagnostics } = groupBy(sales, {
      by: ["region"],
      aggregations: [{ fn: "sum", column: "amount" }],
    });
    expect(table.headers).toEqual(["region", "Sum of amount"]);
    expect(table.rows).toEqual([
      ["North", 300],
      ["South", 400],
    ]);
    expect(diagnostics.groups).toBe(2);
    expect(diagnostics.rowsIn).toBe(5);
  });

  it("supports several summaries at once", () => {
    const { table } = groupBy(sales, {
      by: ["region"],
      aggregations: [
        { fn: "count" },
        { fn: "mean", column: "amount" },
        { fn: "min", column: "amount" },
        { fn: "max", column: "amount" },
        { fn: "count-distinct", column: "rep" },
      ],
    });
    expect(table.headers).toEqual([
      "region", "Rows", "Average of amount", "Min of amount", "Max of amount", "Distinct rep",
    ]);
    // North: 2 rows, mean 150, min 100, max 200, 2 distinct reps (Ann, Bob).
    expect(table.rows[0]).toEqual(["North", 2, 150, 100, 200, 2]);
    // South: 3 rows, mean 400/3, min 50, max 300, 2 distinct reps (Cly, Ann).
    expect(table.rows[1]![1]).toBe(3);
    expect(table.rows[1]![5]).toBe(2);
  });

  it("computes a median, including the even-length midpoint", () => {
    const nums = t(["g", "v"], ["a", 1], ["a", 2], ["a", 3], ["a", 4]);
    const { table } = groupBy(nums, {
      by: ["g"],
      aggregations: [{ fn: "median", column: "v" }],
    });
    expect(table.rows[0]).toEqual(["a", 2.5]);
  });

  it("groups on several columns without letting the parts run together", () => {
    // "ab"+"c" must not collide with "a"+"bc".
    const odd = t(["x", "y", "v"], ["ab", "c", 1], ["a", "bc", 2]);
    const { table } = groupBy(odd, {
      by: ["x", "y"],
      aggregations: [{ fn: "count" }],
    });
    expect(table.rows.length).toBe(2);
  });

  it("honours a custom output label", () => {
    const { table } = groupBy(sales, {
      by: ["region"],
      aggregations: [{ fn: "sum", column: "amount", as: "Revenue" }],
    });
    expect(table.headers).toEqual(["region", "Revenue"]);
  });

  it("never mutates the input", () => {
    const before = JSON.stringify(sales);
    groupBy(sales, { by: ["region"], aggregations: [{ fn: "count" }] });
    expect(JSON.stringify(sales)).toBe(before);
  });

  it("refuses when there is nothing valid to summarise", () => {
    const { findings, table } = groupBy(sales, {
      by: ["region"],
      aggregations: [{ fn: "sum", column: "no-such-column" }],
    });
    expect(table).toBe(sales);
    expect(findings[0]!.rule).toBe("group-no-aggregation");
    expect(findings[0]!.severity).toBe("error");
  });
});

describe("groupBy — the summary tells the truth", () => {
  it("reports non-numeric values rather than treating them as zero", () => {
    const messy = t(
      ["region", "amount"],
      ["North", 100],
      ["North", "n/a"],
      ["North", "pending"],
    );
    const { table, diagnostics, findings } = groupBy(messy, {
      by: ["region"],
      aggregations: [{ fn: "sum", column: "amount" }],
    });
    // "pending" is not a number; "n/a" is a recognised missing sentinel, so it
    // counts as absent rather than as a data problem.
    expect(table.rows[0]).toEqual(["North", 100]);
    expect(diagnostics.ignored).toEqual([
      { label: "Sum of amount", column: "amount", count: 1 },
    ]);
    const f = findings.find((x) => x.rule === "group-ignored-values")!;
    expect(f.severity).toBe("warning");
    expect(f.count).toBe(1);
    expect(f.patchIds).toEqual([]);
  });

  it("reports a group with nothing to sum as blank, NOT as zero", () => {
    const messy = t(
      ["region", "amount"],
      ["North", 100],
      ["South", ""],
      ["South", "NULL"],
    );
    const { table, diagnostics, findings } = groupBy(messy, {
      by: ["region"],
      aggregations: [{ fn: "sum", column: "amount" }],
    });
    // The whole point: a 0 here is indistinguishable from a real zero total.
    expect(table.rows[1]).toEqual(["South", null]);
    expect(diagnostics.emptyGroups).toEqual([
      { label: "Sum of amount", column: "amount", groups: 1 },
    ]);
    expect(findings.some((f) => f.rule === "group-empty-result")).toBe(true);
  });

  it("keeps rows with no group key instead of dropping them", () => {
    const messy = t(
      ["region", "amount"],
      ["North", 100],
      ["", 25],
      ["NA", 25],
    );
    const { table, diagnostics, findings } = groupBy(messy, {
      by: ["region"],
      aggregations: [{ fn: "sum", column: "amount" }],
    });
    // Both keyless rows land in one group — and their money is still counted.
    expect(diagnostics.blankKeyRows).toBe(2);
    expect(table.rows.length).toBe(2);
    expect(table.rows[1]).toEqual([null, 50]);
    expect(findings.find((f) => f.rule === "group-blank-key")!.count).toBe(2);

    // Nothing vanished: every input row is represented somewhere.
    const totalRows = table.rows.reduce((s, _r, i) => s + (i === 0 ? 1 : 2), 0);
    expect(totalRows).toBe(3);
  });

  it("counts money written with currency symbols and separators", () => {
    const money = t(["g", "amount"], ["a", "£1,200"], ["a", "(300)"], ["a", "50"]);
    const { table, diagnostics } = groupBy(money, {
      by: ["g"],
      aggregations: [{ fn: "sum", column: "amount" }],
    });
    expect(table.rows[0]).toEqual(["a", 950]); // 1200 - 300 + 50
    expect(diagnostics.ignored).toEqual([]);
  });

  it("raises no warnings on clean data", () => {
    const { findings } = groupBy(sales, {
      by: ["region"],
      aggregations: [{ fn: "sum", column: "amount" }],
    });
    expect(findings).toEqual([]);
  });
});

describe("numericValue", () => {
  it("reads plain, decorated and negative numbers", () => {
    expect(numericValue(42)).toBe(42);
    expect(numericValue("42")).toBe(42);
    expect(numericValue("£1,200")).toBe(1200);
    expect(numericValue("(300)")).toBe(-300);
    expect(numericValue("-7.5")).toBe(-7.5);
  });

  it("returns null for anything that isn't cleanly a number", () => {
    for (const v of ["", "  ", "N/A", "12 apples", "3-4", null, true]) {
      expect(numericValue(v as never)).toBeNull();
    }
  });
});

describe("groupBy — scale", () => {
  it("summarises 60k rows without blowing the stack", () => {
    const big: Table = { headers: ["g", "v"], rows: [] };
    for (let i = 0; i < 60_000; i++) big.rows.push([`g${i % 100}`, i]);
    const { table, diagnostics } = groupBy(big, {
      by: ["g"],
      aggregations: [{ fn: "sum", column: "v" }, { fn: "median", column: "v" }],
    });
    expect(table.rows.length).toBe(100);
    expect(diagnostics.groups).toBe(100);
  });
});
