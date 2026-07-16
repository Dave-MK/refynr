import type { CleanseResult, EngineOptions, Table } from "./types.js";
import { cleanse } from "./index.js";
import { applyPatches } from "./table.js";

/**
 * A saved, re-runnable cleaning configuration — the answer to the loudest
 * practitioner pain: the export → clean → re-import loop that has "no feedback
 * loop", so data rots again next month. A recipe captures exactly which fixes
 * a user accepted (engine options + the finding rules they chose to skip) so
 * the same decisions can be replayed against next month's export in one click.
 *
 * A recipe is pure config — it never contains any cell data. That keeps it
 * safe to store in the browser, export as a file, or share, without leaking
 * the spreadsheet it was created from.
 */
export const RECIPE_VERSION = 1 as const;

export interface Recipe {
  version: typeof RECIPE_VERSION;
  /** User-facing label, e.g. "Monthly CRM export". */
  name: string;
  /** ISO timestamp; optional so recipes stay deterministic in tests. */
  createdAt?: string;
  /** Engine options to run with (date handling, disabled rules, constraints, duplicate key). */
  options: EngineOptions;
  /**
   * Finding rules the user chose NOT to accept (un-ticked). Their fixers still
   * run and still surface findings, but their patches are left un-applied —
   * mirroring the review UI, where un-ticking a finding keeps it visible but
   * excludes its fix. Distinct from `options.disabledRules`, which stops a
   * fixer running at all.
   */
  skipRules: string[];
}

/** Build a recipe from the current review state. */
export function createRecipe(
  name: string,
  options: EngineOptions = {},
  skipRules: string[] = [],
  createdAt?: string,
): Recipe {
  return {
    version: RECIPE_VERSION,
    name: name.trim() || "Untitled recipe",
    ...(createdAt ? { createdAt } : {}),
    options: {
      ...(options.dateOrder ? { dateOrder: options.dateOrder } : {}),
      ...(options.dateOutput ? { dateOutput: options.dateOutput } : {}),
      disabledRules: [...(options.disabledRules ?? [])],
      ...(options.constraints?.length ? { constraints: options.constraints } : {}),
      ...(options.dedupeKey?.length
        ? { dedupeKey: options.dedupeKey.filter((k) => typeof k === "string") }
        : {}),
    },
    skipRules: [...skipRules],
  };
}

/** Serialise to a stable, pretty JSON string suitable for a downloaded file. */
export function serializeRecipe(recipe: Recipe): string {
  return JSON.stringify(recipe, null, 2);
}

/** True if a value is a structurally-valid recipe of a supported version. */
export function isRecipe(value: unknown): value is Recipe {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    r.version === RECIPE_VERSION &&
    typeof r.name === "string" &&
    typeof r.options === "object" &&
    r.options !== null &&
    Array.isArray(r.skipRules) &&
    r.skipRules.every((x) => typeof x === "string")
  );
}

/**
 * Parse a recipe from JSON text (an imported file or stored string).
 * Throws a human-readable error rather than returning a malformed recipe, so
 * shells can surface exactly what's wrong.
 */
export function parseRecipe(json: string): Recipe {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new Error("That file isn't valid JSON, so it can't be a recipe.");
  }
  if (typeof value === "object" && value !== null) {
    const v = (value as Record<string, unknown>).version;
    if (v !== undefined && v !== RECIPE_VERSION) {
      throw new Error(
        `This recipe was made with a newer version of refynr (v${String(v)}). Update to use it.`,
      );
    }
  }
  if (!isRecipe(value)) {
    throw new Error("That file doesn't look like a refynr recipe.");
  }
  // Normalise through createRecipe so downstream code sees a clean shape.
  return createRecipe(value.name, value.options, value.skipRules, value.createdAt);
}

export interface RecipeRun {
  /** Full analysis of the table under the recipe's options. */
  result: CleanseResult;
  /** Patch ids the recipe accepts (every fixable finding whose rule isn't skipped). */
  acceptedIds: Set<string>;
  /** The cleaned table with exactly those patches applied. */
  cleaned: Table;
}

/**
 * Replay a recipe against a table: analyse under its options, accept every
 * fixable finding except those whose rule the recipe skips, and return the
 * cleaned copy. Deterministic and non-destructive — `table` is never touched.
 */
export function runRecipe(table: Table, recipe: Recipe): RecipeRun {
  const result = cleanse(table, recipe.options);
  const skip = new Set(recipe.skipRules);
  const acceptedIds = new Set<string>();
  for (const finding of result.findings) {
    if (finding.patchIds.length === 0 || skip.has(finding.rule)) continue;
    for (const id of finding.patchIds) acceptedIds.add(id);
  }
  const cleaned = applyPatches(table, result.patches, acceptedIds);
  return { result, acceptedIds, cleaned };
}
