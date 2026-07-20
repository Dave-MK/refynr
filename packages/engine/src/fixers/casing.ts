import type { CellPatch, Finding } from "../types.js";
import { cellText, isEmptyCell, isMissingSentinel } from "../table.js";
import { cleanWhitespace } from "./whitespace.js";
import { cellPatchId, n, type Fixer, type FixerOutput } from "./fixer.js";

const RULE = "consistent-casing";

/**
 * Finds values within a column that differ only by letter case (or stray
 * whitespace) — "Acme Ltd" vs "ACME LTD" vs "acme ltd" — and normalizes
 * every variant to the most frequent spelling. This is deliberately
 * conservative: it never invents a casing the user hasn't already typed.
 */
export const casingFixer: Fixer = {
  rule: RULE,
  run({ table, profile }): FixerOutput {
    const patches: CellPatch[] = [];
    const affectedColumns = new Set<string>();

    for (const col of profile.columns) {
      if (col.type !== "string" && col.type !== "mixed") continue;

      // canonical (lowercased, whitespace-cleaned) -> variant -> count
      const variants = new Map<string, Map<string, number>>();
      for (const row of table.rows) {
        const v = row[col.index];
        if (isEmptyCell(v) || typeof v !== "string" || isMissingSentinel(v)) continue;
        const cleaned = cleanWhitespace(v);
        const key = cleaned.toLowerCase();
        let m = variants.get(key);
        if (!m) variants.set(key, (m = new Map()));
        m.set(cleaned, (m.get(cleaned) ?? 0) + 1);
      }

      // Pick the winning variant per group: most frequent wins; ties prefer
      // mixed case ("Sarah Connor") over ALL CAPS over all lower, then first seen.
      const caseQuality = (s: string): number => {
        const hasUpper = /\p{Lu}/u.test(s);
        const hasLower = /\p{Ll}/u.test(s);
        if (hasUpper && hasLower) return 2;
        if (hasUpper) return 1;
        return 0;
      };
      const winners = new Map<string, string>();
      for (const [key, m] of variants) {
        if (m.size < 2) continue;
        let best = "";
        let bestCount = -1;
        let bestQuality = -1;
        for (const [variant, count] of m) {
          const quality = caseQuality(variant);
          if (count > bestCount || (count === bestCount && quality > bestQuality)) {
            best = variant;
            bestCount = count;
            bestQuality = quality;
          }
        }
        winners.set(key, best);
      }
      if (winners.size === 0) continue;

      table.rows.forEach((row, r) => {
        const v = row[col.index];
        if (isEmptyCell(v) || typeof v !== "string" || isMissingSentinel(v)) return;
        const cleaned = cleanWhitespace(v);
        const winner = winners.get(cleaned.toLowerCase());
        if (winner === undefined || winner === cleaned) return;
        affectedColumns.add(col.name);
        patches.push({
          kind: "cell",
          id: cellPatchId(RULE, r, col.index),
          rule: RULE,
          cell: { row: r, col: col.index },
          before: v,
          after: winner,
          reason: `"${cellText(v)}" matches "${winner}" apart from letter case; normalized to the most frequent spelling in the "${col.name}" column`,
          confidence: 0.9,
        });
      });
    }

    if (patches.length === 0) return { findings: [], patches: [] };

    const findings: Finding[] = [
      {
        rule: RULE,
        severity: "warning",
        title: `${n(patches.length, "inconsistently capitalised value")}`,
        detail: `Values in ${[...affectedColumns].map((c) => `"${c}"`).join(", ")} differ only by capitalisation. Inconsistent casing splits groups in pivot tables and creates false duplicates. Each variant is normalized to the most frequent spelling already present in the column.`,
        count: patches.length,
        patchIds: patches.map((p) => p.id),
      },
    ];

    return { findings, patches };
  },
};
