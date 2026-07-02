import type { CleanseResult, EngineOptions, Table } from "./types.js";
import { profileTable } from "./profile.js";
import { scoreTable } from "./score.js";
import { applyPatches } from "./table.js";
import type { Fixer } from "./fixers/fixer.js";
import { whitespaceFixer } from "./fixers/whitespace.js";
import { casingFixer } from "./fixers/casing.js";
import { emailFixer } from "./fixers/emails.js";
import { postcodeFixer } from "./fixers/postcodes.js";
import { phoneFixer } from "./fixers/phones.js";
import { dateFixer } from "./fixers/dates.js";
import { duplicateFixer } from "./fixers/duplicates.js";
import { completenessFixer } from "./fixers/completeness.js";

export * from "./types.js";
export { profileTable } from "./profile.js";
export { scoreTable } from "./score.js";
export { applyPatches, fromDelimitedText, cellText, isEmptyCell } from "./table.js";

const DEFAULT_OPTIONS: Required<EngineOptions> = {
  dateOrder: "auto",
  dateOutput: "iso",
  disabledRules: [],
};

/** Registration order = execution order = display order of findings. */
const FIXERS: Fixer[] = [
  whitespaceFixer,
  duplicateFixer,
  completenessFixer,
  casingFixer,
  dateFixer,
  emailFixer,
  phoneFixer,
  postcodeFixer,
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
    findings.push(...out.findings);
    patches.push(...out.patches);
  }

  const score = scoreTable(profile, findings);

  // Projected score: re-run analysis on the fully-patched table.
  const cleanedTable = applyPatches(table, patches);
  const cleanedProfile = profileTable(cleanedTable);
  const remainingFindings = FIXERS.filter((f) => !disabled.has(f.rule)).flatMap(
    (f) => f.run({ table: cleanedTable, profile: cleanedProfile, options: opts }).findings,
  );
  const projectedScore = scoreTable(cleanedProfile, remainingFindings);

  return { profile, findings, patches, score, projectedScore };
}
