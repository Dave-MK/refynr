import type { Finding, RowRemovalPatch } from "../types.js";
import { cellText } from "../table.js";
import { n, verb, type Fixer, type FixerOutput } from "./fixer.js";

const BLANK_RULE = "remove-blank-rows";
const MISSING_RULE = "missing-values";

/**
 * Fully blank rows become removal patches. Columns with a meaningful share
 * of missing values get an advisory finding — refynr never invents data.
 */
export const completenessFixer: Fixer = {
  rule: BLANK_RULE,
  run({ table, profile }): FixerOutput {
    const patches: RowRemovalPatch[] = [];

    table.rows.forEach((row, r) => {
      if (row.length > 0 && row.every((v) => cellText(v).trim() === "")) {
        patches.push({
          kind: "remove-row",
          id: `${BLANK_RULE}:${r}`,
          rule: BLANK_RULE,
          row: r,
          reason: `Row ${r + 2} is completely empty. Blank rows break sorting, filtering, and pivot table ranges.`,
          confidence: 1,
        });
      }
    });

    const findings: Finding[] = [];

    if (patches.length > 0) {
      findings.push({
        rule: BLANK_RULE,
        severity: "warning",
        title: n(patches.length, "blank row"),
        detail: `${n(patches.length, "row")} ${verb(patches.length, "is", "are")} completely empty. Blank rows silently truncate sort ranges and pivot tables in Excel.`,
        count: patches.length,
        patchIds: patches.map((p) => p.id),
      });
    }

    const rowCount = table.rows.length - patches.length;
    if (rowCount > 0) {
      const gappy = profile.columns.filter(
        (c) => c.nonEmpty > 0 && c.empty - patches.length > 0 &&
          (c.empty - patches.length) / rowCount >= 0.05,
      );
      for (const col of gappy) {
        const missing = col.empty - patches.length;
        const pct = Math.round((missing / rowCount) * 100);
        findings.push({
          rule: MISSING_RULE,
          severity: pct >= 25 ? "error" : "warning",
          title: `"${col.name}": ${missing} missing values (${pct}%)`,
          detail: `The "${col.name}" column is missing ${missing} of ${rowCount} values. Refynr never fabricates data — decide whether these rows should be excluded, back-filled from a source system, or are legitimately blank.`,
          count: missing,
          column: col.index,
          patchIds: [],
        });
      }
    }

    return { findings, patches };
  },
};
