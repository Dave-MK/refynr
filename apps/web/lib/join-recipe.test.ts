import { describe, expect, it } from "vitest";
import { createRecipe, type Recipe, type Table } from "@refynr/engine";
import { planRecipeJoin, resolveSuppliedDataset } from "./join-recipe";

const table = (name: string): Table => ({ headers: ["id"], rows: [[name]] });
const ds = (name: string) => ({ name, table: table(name) });

const joinSpec = {
  with: "orders.csv",
  keys: [{ left: "customer_id", right: "customer_id" }],
  type: "left" as const,
};

const withJoin = (): Recipe => createRecipe("Monthly", {}, [], undefined, joinSpec);
const withoutJoin = (): Recipe => createRecipe("Plain");

describe("planRecipeJoin", () => {
  it("applies a join-less recipe straight away", () => {
    expect(planRecipeJoin(withoutJoin(), [])).toEqual({ kind: "no-join" });
  });

  it("uses an already-loaded dataset of the expected name", () => {
    const plan = planRecipeJoin(withJoin(), [ds("other.csv"), ds("orders.csv")]);
    expect(plan.kind).toBe("ready");
    if (plan.kind !== "ready") throw new Error("expected ready");
    expect(plan.dataset.name).toBe("orders.csv");
    expect(plan.exactName).toBe(true);
  });

  it("asks for the file when nothing is loaded", () => {
    expect(planRecipeJoin(withJoin(), [])).toEqual({
      kind: "needs-dataset",
      expected: "orders.csv",
    });
  });

  it("asks rather than assuming a single mismatched dataset is the right one", () => {
    // The dangerous case: one file is loaded, it is NOT the one the recipe
    // names, and joining against it would yield a plausible table of wrong
    // numbers. Guessing here would undo the point of the feature.
    const plan = planRecipeJoin(withJoin(), [ds("invoices-2019.csv")]);
    expect(plan).toEqual({ kind: "needs-dataset", expected: "orders.csv" });
  });

  it("never reports ready without a dataset to join against", () => {
    for (const datasets of [[], [ds("a.csv")], [ds("a.csv"), ds("b.csv")]]) {
      const plan = planRecipeJoin(withJoin(), datasets);
      if (plan.kind === "ready") expect(plan.dataset).toBeTruthy();
      else expect(plan.kind).toBe("needs-dataset");
    }
  });
});

describe("resolveSuppliedDataset", () => {
  it("takes the most recently loaded dataset as the answer to the prompt", () => {
    const picked = resolveSuppliedDataset([ds("old.csv"), ds("just-picked.csv")]);
    expect(picked?.name).toBe("just-picked.csv");
  });

  it("accepts a differently-named file — this month's export may be renamed", () => {
    expect(resolveSuppliedDataset([ds("orders-july.csv")])?.name).toBe("orders-july.csv");
  });

  it("returns null rather than joining against nothing", () => {
    expect(resolveSuppliedDataset([])).toBeNull();
  });
});
