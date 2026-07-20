import type { CellPatch, Finding, Patch } from "../types.js";
import { cellText, isMissingSentinel } from "../table.js";
import { cellPatchId, n, verb, type Fixer, type FixerOutput } from "./fixer.js";

const BLANK_RULE = "remove-blank-rows";
const MISSING_RULE = "missing-values";
const SENTINEL_RULE = "normalize-missing";

/**
 * Fully blank rows become removal patches. Columns with a meaningful share
 * of missing values get an advisory finding — refynr never invents data.
 * Missing-value sentinels ("NA", "NULL", "-", …) become blank-out patches:
 * clearing a placeholder to a true blank is the one "fix" for missing data
 * that invents nothing, and it makes COUNTA, filters, and imports honest.
 */
export const completenessFixer: Fixer = {
  rule: BLANK_RULE,
  run({ table, profile }): FixerOutput {
    const patches: Patch[] = [];
    const sentinelPatches: CellPatch[] = [];

    table.rows.forEach((row, r) => {
      row.forEach((v, c) => {
        if (!isMissingSentinel(v)) return;
        sentinelPatches.push({
          kind: "cell",
          id: cellPatchId(SENTINEL_RULE, r, c),
          rule: SENTINEL_RULE,
          cell: { row: r, col: c },
          before: v,
          after: null,
          reason: `"${cellText(v)}" is placeholder text for a missing value. Spreadsheets treat it as real data — it matches lookups and inflates counts — so it's cleared to a true blank.`,
          confidence: 0.9,
        });
      });
    });

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
    const blankRowCount = patches.length;

    if (blankRowCount > 0) {
      findings.push({
        rule: BLANK_RULE,
        severity: "warning",
        title: n(blankRowCount, "blank row"),
        detail: `${n(blankRowCount, "row")} ${verb(blankRowCount, "is", "are")} completely empty. Blank rows silently truncate sort ranges and pivot tables in Excel.`,
        count: blankRowCount,
        patchIds: patches.map((p) => p.id),
      });
    }

    if (sentinelPatches.length > 0) {
      findings.push({
        rule: SENTINEL_RULE,
        // Info severity, and deliberately NOT score-mapped: the missing-values
        // finding below already counts these cells, so scoring this rule too
        // would penalise the same gap twice.
        severity: "info",
        title: `${n(sentinelPatches.length, "placeholder blank")} standardised`,
        detail: `${n(sentinelPatches.length, "cell contains", "cells contain")} placeholder text for missing data ("NA", "N/A", "NULL", "-", …). These read as real values to lookups, counts, and imports. Cleared to true blanks so the gaps are honest — no data is invented.`,
        count: sentinelPatches.length,
        patchIds: sentinelPatches.map((p) => p.id),
      });
    }

    const rowCount = table.rows.length - blankRowCount;
    if (rowCount > 0) {
      const gappy = profile.columns.filter(
        (c) => c.nonEmpty > 0 && c.empty - blankRowCount > 0 &&
          (c.empty - blankRowCount) / rowCount >= 0.05,
      );
      for (const col of gappy) {
        const missing = col.empty - blankRowCount;
        const pct = Math.round((missing / rowCount) * 100);
        const sentinelNote =
          col.sentinels > 0
            ? ` (${col.sentinels} of them written as placeholders like "NA")`
            : "";
        findings.push({
          rule: MISSING_RULE,
          severity: pct >= 25 ? "error" : "warning",
          title: `"${col.name}": ${missing} missing values (${pct}%)`,
          detail: `The "${col.name}" column is missing ${missing} of ${rowCount} values${sentinelNote}. Refynr never fabricates data — decide whether these rows should be excluded, back-filled from a source system, or are legitimately blank.`,
          count: missing,
          column: col.index,
          patchIds: [],
        });
      }
    }

    for (const p of sentinelPatches) patches.push(p);
    return { findings, patches };
  },
};
