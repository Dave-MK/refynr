import { describe, expect, it } from "vitest";
import {
  createRecipe,
  inferJoinKeys,
  joinTables,
  parseRecipe,
  runRecipe,
  serializeRecipe,
} from "../src/index.js";
import type { Table } from "../src/index.js";

/** Small helper — builds a Table from a header row plus data rows. */
function t(headers: string[], ...rows: (string | number | null)[][]): Table {
  return { headers, rows };
}

const customers = t(
  ["customer_id", "name"],
  ["C001", "Ann Lee"],
  ["C002", "Bob Ray"],
  ["C003", "Cly Fox"],
);

describe("joinTables — basics", () => {
  it("joins on a shared key and keeps left rows", () => {
    const orders = t(["customer_id", "total"], ["C001", 10], ["C002", 20]);
    const { table, diagnostics } = joinTables(customers, orders);

    expect(table.headers).toEqual(["customer_id", "name", "total"]);
    expect(diagnostics.keys).toEqual([{ left: "customer_id", right: "customer_id" }]);
    expect(diagnostics.matched).toBe(2);
    expect(table.rows.length).toBe(3);
    // C003 matched nothing but survives a left join with a null total.
    expect(table.rows[2]).toEqual(["C003", "Cly Fox", null]);
  });

  it("drops unmatched left rows on an inner join", () => {
    const orders = t(["customer_id", "total"], ["C001", 10]);
    const { table } = joinTables(customers, orders, { type: "inner" });
    expect(table.rows.length).toBe(1);
    expect(table.rows[0]).toEqual(["C001", "Ann Lee", 10]);
  });

  it("keeps orphaned right rows on a full join, with their key values", () => {
    const orders = t(["customer_id", "total"], ["C001", 10], ["C999", 99]);
    const { table, diagnostics } = joinTables(customers, orders, { type: "full" });

    expect(table.rows.length).toBe(4);
    const orphan = table.rows[3]!;
    // The key lands in the left key column, not a null — otherwise the row is
    // unidentifiable in the output.
    expect(orphan[0]).toBe("C999");
    expect(orphan[1]).toBe(null);
    expect(orphan[2]).toBe(99);
    expect(diagnostics.unmatchedRight.length).toBe(1);
  });

  it("never mutates either input", () => {
    const orders = t(["customer_id", "total"], ["C001", 10]);
    const before = JSON.stringify([customers, orders]);
    joinTables(customers, orders, { type: "full" });
    expect(JSON.stringify([customers, orders])).toBe(before);
  });

  it("suffixes colliding non-key column names", () => {
    const left = t(["id", "status"], ["1", "active"]);
    const right = t(["id", "status"], ["1", "shipped"]);
    const { table } = joinTables(left, right);
    expect(table.headers).toEqual(["id", "status (left)", "status (right)"]);
    expect(table.rows[0]).toEqual(["1", "active", "shipped"]);
  });
});

describe("joinTables — the diagnosis is the point", () => {
  it("reports zero-padding as the reason for a miss, not an absent record", () => {
    // The classic: one side kept the zero-padded code, the other lost it in Excel.
    const orders = t(["customer_id", "total"], ["1", 10], ["2", 20]);
    const left = t(["customer_id", "name"], ["001", "Ann"], ["002", "Bob"]);
    const { diagnostics, findings } = joinTables(left, orders);

    expect(diagnostics.matched).toBe(0);
    expect(diagnostics.unmatchedLeft.map((u) => u.reason)).toEqual([
      "zero-padding",
      "zero-padding",
    ]);
    expect(diagnostics.unmatchedLeft[0]!.wouldMatch).toBe("1");

    const format = findings.find((f) => f.rule === "join-key-format");
    expect(format).toBeDefined();
    expect(format!.count).toBe(2);
    expect(format!.title).toContain("leading zeros");
    // Advisory only — refynr never invents the match.
    expect(format!.patchIds).toEqual([]);
  });

  it("reports punctuation differences", () => {
    const left = t(["code", "v"], ["AB-12 3CD", 1]);
    const right = t(["code", "w"], ["ab123cd", 2]);
    const { diagnostics } = joinTables(left, right, {
      keys: [{ left: "code", right: "code" }],
    });
    expect(diagnostics.unmatchedLeft[0]!.reason).toBe("punctuation");
  });

  it("reports number formatting differences", () => {
    const left = t(["ref", "v"], ["1.0", 1], ["2,000", 2]);
    const right = t(["ref", "w"], ["1", 9], ["2000", 8]);
    const { diagnostics } = joinTables(left, right, {
      keys: [{ left: "ref", right: "ref" }],
    });
    expect(diagnostics.unmatchedLeft.map((u) => u.reason)).toEqual([
      "numeric-format",
      "numeric-format",
    ]);
  });

  it("calls a genuinely missing record absent, not a formatting problem", () => {
    const orders = t(["customer_id", "total"], ["C001", 10]);
    const { diagnostics, findings } = joinTables(customers, orders);
    expect(diagnostics.unmatchedLeft.every((u) => u.reason === "absent")).toBe(true);
    expect(findings.find((f) => f.rule === "join-key-format")).toBeUndefined();
  });

  it("separates rows with no key at all from rows that simply missed", () => {
    const left = t(
      ["customer_id", "name"],
      ["C001", "Ann"],
      ["", "Blank"],
      ["NA", "Sentinel"],
    );
    const orders = t(["customer_id", "total"], ["C001", 10]);
    const { diagnostics, findings } = joinTables(left, orders);

    const reasons = diagnostics.unmatchedLeft.map((u) => u.reason);
    expect(reasons).toEqual(["empty-key", "empty-key"]);
    expect(findings.find((f) => f.rule === "join-empty-key")!.count).toBe(2);
  });

  it("catches the fan-out that silently inflates totals", () => {
    const orders = t(
      ["customer_id", "total"],
      ["C001", 10],
      ["C001", 20],
      ["C001", 30],
      ["C002", 5],
    );
    const { table, diagnostics, findings } = joinTables(customers, orders);

    // 3 left rows became 5: C001 tripled, C002 matched once, C003 stayed null.
    expect(table.rows.length).toBe(5);
    expect(diagnostics.resultRows).toBe(5);
    expect(diagnostics.expansion).toBeCloseTo(5 / 3);
    expect(diagnostics.fanOut).toEqual([{ row: 0, key: "C001", matches: 3 }]);

    const fan = findings.find((f) => f.rule === "join-fan-out")!;
    expect(fan.severity).toBe("warning");
    expect(fan.detail).toContain("3 rows");
  });

  it("flags matches that only worked because case was ignored", () => {
    const left = t(["email", "v"], ["Ann@Example.COM", 1]);
    const right = t(["email", "w"], ["ann@example.com", 2]);
    const { diagnostics, findings } = joinTables(left, right, {
      keys: [{ left: "email", right: "email" }],
    });

    expect(diagnostics.matched).toBe(1);
    expect(diagnostics.matchedVia.caseOnly).toBe(1);
    expect(diagnostics.matchedVia.exact).toBe(0);
    expect(findings.find((f) => f.rule === "join-key-inconsistent")!.severity).toBe("info");
  });

  it("counts an exactly-equal key as exact, raising no consistency finding", () => {
    const orders = t(["customer_id", "total"], ["C001", 10]);
    const { diagnostics, findings } = joinTables(customers, orders);
    expect(diagnostics.matchedVia.exact).toBe(1);
    expect(diagnostics.matchedVia.caseOnly).toBe(0);
    expect(findings.find((f) => f.rule === "join-key-inconsistent")).toBeUndefined();
  });
});

describe("joinTables — composite keys", () => {
  it("matches on several columns at once", () => {
    const left = t(["first", "last", "v"], ["Ann", "Lee", 1], ["Ann", "Fox", 2]);
    const right = t(["first", "last", "w"], ["Ann", "Fox", 9]);
    const { table, diagnostics } = joinTables(left, right, {
      keys: [
        { left: "first", right: "first" },
        { left: "last", right: "last" },
      ],
    });
    expect(diagnostics.matched).toBe(1);
    expect(table.rows[1]).toEqual(["Ann", "Fox", 2, 9]);
    expect(table.rows[0]![3]).toBe(null);
  });

  it("does not let composite parts run together across the separator", () => {
    // "ab"+"c" must not equal "a"+"bc" — a printable separator would collide.
    const left = t(["a", "b", "v"], ["ab", "c", 1]);
    const right = t(["a", "b", "w"], ["a", "bc", 2]);
    const { diagnostics } = joinTables(left, right, {
      keys: [
        { left: "a", right: "a" },
        { left: "b", right: "b" },
      ],
    });
    expect(diagnostics.matched).toBe(0);
  });

  it("treats a partly-empty composite key as unusable", () => {
    const left = t(["first", "last", "v"], ["Ann", "", 1]);
    const right = t(["first", "last", "w"], ["Ann", "Lee", 9]);
    const { diagnostics } = joinTables(left, right, {
      keys: [
        { left: "first", right: "first" },
        { left: "last", right: "last" },
      ],
    });
    expect(diagnostics.unmatchedLeft[0]!.reason).toBe("empty-key");
  });
});

describe("inferJoinKeys", () => {
  it("prefers the column whose values actually overlap over the id-looking one", () => {
    const left = t(["id", "email"], ["1", "a@x.com"], ["2", "b@x.com"]);
    const right = t(["id", "email"], ["77", "a@x.com"], ["88", "b@x.com"]);
    expect(inferJoinKeys(left, right)).toEqual([{ left: "email", right: "email" }]);
  });

  it("returns nothing when a shared name is a coincidence", () => {
    const left = t(["code", "v"], ["AAA", 1], ["BBB", 2]);
    const right = t(["code", "w"], ["ZZZ", 1], ["YYY", 2]);
    expect(inferJoinKeys(left, right)).toEqual([]);
  });

  it("makes joinTables refuse rather than guess when there is no key", () => {
    const left = t(["a"], ["1"]);
    const right = t(["b"], ["2"]);
    const { table, findings } = joinTables(left, right);
    // Returns the left table untouched and says why.
    expect(table).toBe(left);
    expect(findings[0]!.rule).toBe("join-no-key");
    expect(findings[0]!.severity).toBe("error");
  });
});

describe("joinTables — scale", () => {
  it("handles a 60k-row join without blowing the stack", () => {
    const bigLeft: Table = { headers: ["id", "v"], rows: [] };
    const bigRight: Table = { headers: ["id", "w"], rows: [] };
    for (let i = 0; i < 60_000; i++) {
      bigLeft.rows.push([`K${i}`, i]);
      bigRight.rows.push([`K${i}`, i * 2]);
    }
    const { table, diagnostics } = joinTables(bigLeft, bigRight);
    expect(table.rows.length).toBe(60_000);
    expect(diagnostics.matched).toBe(60_000);
    expect(diagnostics.unmatchedLeft.length).toBe(0);
  });
});

describe("recipes carrying a join", () => {
  const left = t(["id", "name"], ["1", "Ann"], ["2", "Bob"]);
  const right = t(["id", "total"], ["1", 10], ["2", 20]);
  const join = {
    with: "orders.csv",
    keys: [{ left: "id", right: "id" }],
    type: "left" as const,
  };

  it("round-trips the join through serialise/parse, carrying no cell data", () => {
    const recipe = createRecipe("Monthly", {}, [], undefined, join);
    const json = serializeRecipe(recipe);
    expect(json).not.toContain("Ann"); // no cell data ever
    const back = parseRecipe(json);
    expect(back.join).toEqual(join);
  });

  it("replays the join before cleaning", () => {
    const recipe = createRecipe("Monthly", {}, [], undefined, join);
    const run = runRecipe(left, recipe, right);
    expect(run.cleaned.headers).toEqual(["id", "name", "total"]);
    expect(run.cleaned.rows.length).toBe(2);
    expect(run.joinFindings).toEqual([]);
  });

  it("refuses to clean without the dataset the join needs", () => {
    const recipe = createRecipe("Monthly", {}, [], undefined, join);
    // Silently cleaning the unjoined table would score a different table as
    // if it were the one the recipe describes.
    expect(() => runRecipe(left, recipe)).toThrow(/orders\.csv/);
  });

  it("still runs join-less recipes with no second table", () => {
    const recipe = createRecipe("Plain");
    expect(recipe.join).toBeUndefined();
    expect(() => runRecipe(left, recipe)).not.toThrow();
  });

  it("migrates a v1 recipe forward instead of rejecting it", () => {
    const v1 = JSON.stringify({
      version: 1,
      name: "Old one",
      options: { disabledRules: [] },
      skipRules: ["normalize-date"],
    });
    const parsed = parseRecipe(v1);
    expect(parsed.version).toBe(2);
    expect(parsed.skipRules).toEqual(["normalize-date"]);
  });

  it("still rejects a recipe from a newer refynr", () => {
    const future = JSON.stringify({
      version: 99,
      name: "From the future",
      options: {},
      skipRules: [],
    });
    expect(() => parseRecipe(future)).toThrow(/newer version/);
  });

  it("rejects a malformed join rather than dropping it", () => {
    const bad = JSON.stringify({
      version: 2,
      name: "Broken",
      options: {},
      skipRules: [],
      join: { with: "x.csv", type: "sideways", keys: [] },
    });
    expect(() => parseRecipe(bad)).toThrow(/doesn't look like/);
  });
});
