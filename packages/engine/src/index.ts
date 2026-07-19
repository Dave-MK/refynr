import type { CleanseResult, EngineOptions, Table } from "./types.js";
import { profileTable } from "./profile.js";
import { basisOf, scoreTable } from "./score.js";
import { applyPatches } from "./table.js";
import type { Fixer } from "./fixers/fixer.js";
import { whitespaceFixer } from "./fixers/whitespace.js";
import { casingFixer } from "./fixers/casing.js";
import { valueFixer } from "./fixers/values.js";
import { dependencyFixer } from "./fixers/dependencies.js";
import { emailFixer } from "./fixers/emails.js";
import { postcodeFixer } from "./fixers/postcodes.js";
import { phoneFixer } from "./fixers/phones.js";
import { dateFixer } from "./fixers/dates.js";
import { duplicateFixer } from "./fixers/duplicates.js";
import { completenessFixer } from "./fixers/completeness.js";
import { encodingFixer } from "./fixers/encoding.js";
import { integrityFixer } from "./fixers/integrity.js";
import { piiFixer } from "./fixers/pii.js";
import { numberFixer } from "./fixers/numbers.js";
import { booleanFixer } from "./fixers/booleans.js";
import { headerFixer } from "./fixers/headers.js";
import { vatFixer, sortCodeFixer, companyNumberFixer } from "./fixers/uk.js";
import { checkConstraints } from "./expectations.js";

export * from "./types.js";
export { profileTable } from "./profile.js";
export { scoreTable } from "./score.js";
export {
  applyPatches,
  fromDelimitedText,
  fromJson,
  findReplace,
  cellText,
  isEmptyCell,
  type FindReplaceOptions,
  type Replacement,
} from "./table.js";
export { checkConstraints, suggestConstraints } from "./expectations.js";
export {
  diffTables,
  type TableDiff,
  type DiffCell,
  type ChangedRow,
  type KeyedRow,
} from "./diff.js";
export {
  buildReport,
  reportToMarkdown,
  reportToHtml,
  type RunReport,
  type ReportRuleLine,
} from "./report.js";
export {
  RECIPE_VERSION,
  createRecipe,
  serializeRecipe,
  parseRecipe,
  isRecipe,
  runRecipe,
  type Recipe,
  type RecipeRun,
} from "./recipe.js";
export { parseInstruction, type Instruction } from "./nl.js";
export {
  splitColumn,
  mergeColumns,
  unpivot,
  deleteRows,
  deleteColumn,
  type SplitOptions,
  type MergeOptions,
  type UnpivotOptions,
} from "./transform.js";

const DEFAULT_OPTIONS: Required<EngineOptions> = {
  dateOrder: "auto",
  dateOutput: "iso",
  disabledRules: [],
  constraints: [],
  dedupeKey: [],
};

/** Registration order = execution order = display order of findings. */
const FIXERS: Fixer[] = [
  headerFixer,
  encodingFixer,
  whitespaceFixer,
  duplicateFixer,
  completenessFixer,
  casingFixer,
  valueFixer,
  dateFixer,
  numberFixer,
  booleanFixer,
  emailFixer,
  phoneFixer,
  postcodeFixer,
  vatFixer,
  sortCodeFixer,
  companyNumberFixer,
  integrityFixer,
  dependencyFixer,
  piiFixer,
];

/**
 * Analyse a table and propose fixes. Pure and non-destructive: the input
 * table is never touched; the result contains findings, patches, the
 * current health score, and the score the table would have if every
 * proposed patch were accepted.
 */
export function cleanse(
  table: Table,
  options: EngineOptions = {},
): CleanseResult {
  const opts: Required<EngineOptions> = { ...DEFAULT_OPTIONS, ...options };
  const disabled = new Set(opts.disabledRules);

  const profile = profileTable(table);
  const findings: CleanseResult["findings"] = [];
  const patches: CleanseResult["patches"] = [];

  for (const fixer of FIXERS) {
    if (disabled.has(fixer.rule)) continue;
    const out = fixer.run({ table, profile, options: opts });
    // Loops, not spread: a fixer can emit one patch per row, and
    // `push(...hugeArray)` overflows the call stack past ~100k elements.
    for (const f of out.findings) findings.push(f);
    for (const p of out.patches) patches.push(p);
  }

  // User-defined expectations run after the fixers: advisory pass/fail checks,
  // never auto-fixed.
  if (options.constraints?.length) {
    for (const f of checkConstraints(table, profile, options.constraints)) findings.push(f);
  }

  // The denominator is fixed to the ORIGINAL table for both scores. Accepting
  // fixes removes rows (duplicates, blanks), so re-deriving the basis from the
  // cleaned table would shrink the denominator and make the few unfixable
  // advisory issues penalise *harder* — cleaning the data would lower the
  // score. Sharing one basis guarantees remediation can only raise it.
  const basis = basisOf(profile);
  const score = scoreTable(profile, findings, basis);

  // Projected score: re-run analysis on the fully-patched table (captures
  // second-order effects, e.g. a casing fix collapsing a near-duplicate),
  // but score it against the original basis.
  const cleanedTable = applyPatches(table, patches);
  const cleanedProfile = profileTable(cleanedTable);
  const remainingFindings = FIXERS.filter((f) => !disabled.has(f.rule)).flatMap(
    (f) => f.run({ table: cleanedTable, profile: cleanedProfile, options: opts }).findings,
  );
  if (options.constraints?.length) {
    for (const f of checkConstraints(cleanedTable, cleanedProfile, options.constraints))
      remainingFindings.push(f);
  }
  const projectedScore = scoreTable(cleanedProfile, remainingFindings, basis);

  return { profile, findings, patches, score, projectedScore };
}
