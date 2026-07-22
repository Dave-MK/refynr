import type { CleanseResult, EngineOptions, Finding, Table } from "./types.js";
import { cleanse } from "./index.js";
import { applyPatches } from "./table.js";
import { joinTables, type JoinKey, type JoinType } from "./join.js";

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
export const RECIPE_VERSION = 2 as const;

/** Versions this build can still read. Older recipes are migrated forward on
 *  parse (every field added since has been optional), so a recipe saved months
 *  ago keeps working — the version gate exists to reject recipes from a NEWER
 *  refynr, whose fields this build would silently ignore. */
const OLDEST_READABLE_VERSION = 1;

/** Engine behaviour version recorded in recipes. Bump when fixer behaviour
 *  changes so a replayed recipe can disclose "made with a different engine"
 *  — the reproducibility breadcrumb pipeline tools solve with lockfiles.
 *  Keep in sync with packages/engine/package.json. */
export const ENGINE_VERSION = "0.2.0";

/**
 * A join the recipe replays before cleaning. Carries only the SHAPE of the
 * join — which columns to match on and which rows to keep — never the other
 * dataset. That preserves the "no cell data" guarantee: the recipe describes a
 * slot, and whoever replays it supplies the file (`--join-with` on the CLI, a
 * file picker in the browser). `with` is only a label, so the prompt can say
 * which dataset the recipe expects.
 */
export interface RecipeJoin {
  /** Label of the dataset this recipe was built against, e.g. "orders.csv". */
  with: string;
  keys: JoinKey[];
  type: JoinType;
}

export interface Recipe {
  version: typeof RECIPE_VERSION;
  /** Engine version the recipe was created under (informational). */
  engineVersion?: string;
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
  /** A join to replay before cleaning. The dataset itself is supplied at
   *  replay time — see `RecipeJoin`. */
  join?: RecipeJoin;
}

/** Build a recipe from the current review state. */
export function createRecipe(
  name: string,
  options: EngineOptions = {},
  skipRules: string[] = [],
  createdAt?: string,
  join?: RecipeJoin,
): Recipe {
  return {
    version: RECIPE_VERSION,
    engineVersion: ENGINE_VERSION,
    name: name.trim() || "Untitled recipe",
    ...(createdAt ? { createdAt } : {}),
    ...(join && join.keys.length > 0
      ? {
          join: {
            with: join.with,
            type: join.type,
            keys: join.keys.map((k) => ({ left: k.left, right: k.right })),
          },
        }
      : {}),
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

const JOIN_TYPES = new Set(["inner", "left", "full"]);

/** True if a value is a structurally-valid join block. A malformed one is
 *  rejected rather than dropped: silently cleaning WITHOUT a join the recipe
 *  called for would produce a different table than the user saved. */
function isRecipeJoin(value: unknown): value is RecipeJoin {
  if (typeof value !== "object" || value === null) return false;
  const j = value as Record<string, unknown>;
  return (
    typeof j.with === "string" &&
    typeof j.type === "string" &&
    JOIN_TYPES.has(j.type) &&
    Array.isArray(j.keys) &&
    j.keys.length > 0 &&
    j.keys.every(
      (k) =>
        typeof k === "object" &&
        k !== null &&
        typeof (k as Record<string, unknown>).left === "string" &&
        typeof (k as Record<string, unknown>).right === "string",
    )
  );
}

/** True if a value is a structurally-valid recipe of a readable version. */
export function isRecipe(value: unknown): value is Recipe {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.version === "number" &&
    r.version >= OLDEST_READABLE_VERSION &&
    r.version <= RECIPE_VERSION &&
    typeof r.name === "string" &&
    typeof r.options === "object" &&
    r.options !== null &&
    Array.isArray(r.skipRules) &&
    r.skipRules.every((x) => typeof x === "string") &&
    (r.join === undefined || isRecipeJoin(r.join))
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
    if (typeof v === "number" && v > RECIPE_VERSION) {
      throw new Error(
        `This recipe was made with a newer version of refynr (v${String(v)}). Update to use it.`,
      );
    }
  }
  if (!isRecipe(value)) {
    throw new Error("That file doesn't look like a refynr recipe.");
  }
  // Normalise through createRecipe so downstream code sees a clean shape (and
  // an older recipe is migrated forward to the current version) — but keep the
  // ORIGINAL engineVersion: it records what the recipe was made with, not
  // what's parsing it.
  const normalised = createRecipe(
    value.name,
    value.options,
    value.skipRules,
    value.createdAt,
    value.join,
  );
  if (typeof value.engineVersion === "string") {
    normalised.engineVersion = value.engineVersion;
  }
  return normalised;
}

export interface RecipeRun {
  /** Full analysis of the table under the recipe's options. */
  result: CleanseResult;
  /** Patch ids the recipe accepts (every fixable finding whose rule isn't skipped). */
  acceptedIds: Set<string>;
  /** The cleaned table with exactly those patches applied. */
  cleaned: Table;
  /** Advisory findings from the recipe's join, if it had one. */
  joinFindings?: Finding[];
}

/**
 * Replay a recipe against a table: replay its join (if any), analyse under its
 * options, accept every fixable finding except those whose rule the recipe
 * skips, and return the cleaned copy. Deterministic and non-destructive —
 * neither input table is touched.
 *
 * A recipe carrying a join REQUIRES `joinWith`. Cleaning without it would
 * silently produce a narrower table than the recipe describes and score it as
 * if that were fine, so this throws instead.
 */
export function runRecipe(table: Table, recipe: Recipe, joinWith?: Table): RecipeRun {
  let subject = table;
  let joinFindings: Finding[] | undefined;

  if (recipe.join) {
    if (!joinWith) {
      throw new Error(
        `This recipe joins with "${recipe.join.with}" before cleaning, so it needs that dataset supplied. Provide it and run again.`,
      );
    }
    const joined = joinTables(table, joinWith, {
      keys: recipe.join.keys,
      type: recipe.join.type,
    });
    subject = joined.table;
    joinFindings = joined.findings;
  }

  const result = cleanse(subject, recipe.options);
  const skip = new Set(recipe.skipRules);
  const acceptedIds = new Set<string>();
  for (const finding of result.findings) {
    if (finding.patchIds.length === 0 || skip.has(finding.rule)) continue;
    for (const id of finding.patchIds) acceptedIds.add(id);
  }
  // Patches are indexed against `subject` (the joined table when there is a
  // join), so they must be applied to it — applying them to `table` would
  // write joined-table coordinates into the unjoined one.
  const cleaned = applyPatches(subject, result.patches, acceptedIds);
  return { result, acceptedIds, cleaned, ...(joinFindings ? { joinFindings } : {}) };
}
