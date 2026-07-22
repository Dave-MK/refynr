import type { Recipe, Table } from "@refynr/engine";

/**
 * Deciding what to do when a recipe carries a join step.
 *
 * This lives outside the page component because it is the one piece of the
 * join flow with a wrong answer that wouldn't be obvious: quietly applying a
 * recipe's options WITHOUT its join produces a narrower table than the recipe
 * describes and then scores it as though that were fine. Keeping the decision
 * pure means it can be tested directly rather than only through the UI.
 */

export interface LoadedDatasetRef {
  name: string;
  table: Table;
}

export type RecipeJoinPlan =
  /** No join step — apply the recipe's options straight away. */
  | { kind: "no-join" }
  /** The dataset the join needs is already loaded; join with it, then apply. */
  | { kind: "ready"; dataset: LoadedDatasetRef; exactName: boolean }
  /** Nothing usable is loaded — ask for the file before applying anything. */
  | { kind: "needs-dataset"; expected: string };

/**
 * Work out how to apply `recipe` given the datasets currently loaded.
 *
 * Matching is by name, because that is what the recipe recorded and what the
 * user will recognise. A single loaded dataset is NOT silently assumed to be
 * the right one when the name doesn't match: joining against the wrong file
 * produces a plausible table full of wrong numbers, which is precisely the
 * failure this feature exists to prevent. Ask instead.
 */
export function planRecipeJoin(
  recipe: Recipe,
  datasets: readonly LoadedDatasetRef[],
): RecipeJoinPlan {
  if (!recipe.join) return { kind: "no-join" };

  const expected = recipe.join.with;
  const exact = datasets.find((d) => d.name === expected);
  if (exact) return { kind: "ready", dataset: exact, exactName: true };

  return { kind: "needs-dataset", expected };
}

/**
 * The dataset a user just supplied in answer to a `needs-dataset` plan.
 * Returns null when the pick can't satisfy the recipe, so the caller keeps
 * waiting rather than joining against nothing.
 */
export function resolveSuppliedDataset(
  datasets: readonly LoadedDatasetRef[],
): LoadedDatasetRef | null {
  // The most recently loaded one is the answer to the prompt that was just
  // shown. Its name need not match the recipe's — the user may well have
  // renamed this month's export — so the pick is taken at face value, and the
  // join's own findings report whether the keys actually line up.
  return datasets.length > 0 ? datasets[datasets.length - 1]! : null;
}
