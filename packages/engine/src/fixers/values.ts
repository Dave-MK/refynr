import type { CellPatch, Finding } from "../types.js";
import { cellText, isEmptyCell } from "../table.js";
import { cleanWhitespace } from "./whitespace.js";
import { cellPatchId, n, type Fixer, type FixerOutput } from "./fixer.js";

const RULE = "standardise-values";

/** Free-text guard: a column with this many distinct values isn't categorical
 *  and shouldn't have its entries canonicalised toward each other. */
const MAX_DISTINCT = 1000;

/** Key-collision fingerprint for a single value: lowercased, punctuation
 *  stripped, tokens sorted — so "Smith, John" / "John Smith" and
 *  "Acme Ltd." / "Acme Ltd" collide (OpenRefine's fingerprint method). */
function valueFingerprint(s: string): string {
  const cleaned = cleanWhitespace(s)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}@]+/gu, " ")
    .trim();
  if (!cleaned) return "";
  return cleaned.split(" ").sort().join(" ");
}

/**
 * Standardises representation variants of the same value within a column —
 * "Acme Ltd." vs "Acme Ltd", "Smith, John" vs "John Smith" — to the most
 * frequent spelling already present. This is OpenRefine's key-collision
 * clustering recast as patches: every proposed change is individually
 * reviewable, and nothing is invented that the user hasn't already typed.
 *
 * Case-only and whitespace-only variants are deliberately left to the
 * casing/whitespace fixers so a cell is never patched twice for one problem.
 */
export const valueFixer: Fixer = {
  rule: RULE,
  run({ table, profile }): FixerOutput {
    const patches: CellPatch[] = [];
    const affectedColumns = new Set<string>();

    for (const col of profile.columns) {
      if (col.type !== "string" && col.type !== "mixed") continue;
      if (col.distinct > MAX_DISTINCT) continue; // free text, not categories

      // fingerprint -> cleaned variant -> count
      const groups = new Map<string, Map<string, number>>();
      // cleaned value -> fingerprint, so the patching pass below reuses the
      // work instead of re-fingerprinting every cell (bounded by MAX_DISTINCT).
      const fpByCleaned = new Map<string, string>();
      for (const row of table.rows) {
        const v = row[col.index];
        if (isEmptyCell(v) || typeof v !== "string") continue;
        const cleaned = cleanWhitespace(v);
        let fp = fpByCleaned.get(cleaned);
        if (fp === undefined) {
          fp = valueFingerprint(cleaned);
          fpByCleaned.set(cleaned, fp);
        }
        if (!fp) continue;
        let m = groups.get(fp);
        if (!m) groups.set(fp, (m = new Map()));
        m.set(cleaned, (m.get(cleaned) ?? 0) + 1);
      }

      // A group is actionable only if its variants differ by more than letter
      // case (those belong to the casing fixer). Winner = most frequent
      // variant; ties keep the first seen, so the result is deterministic.
      const winners = new Map<string, string>();
      for (const [fp, m] of groups) {
        if (m.size < 2) continue;
        const caseFolded = new Set([...m.keys()].map((v) => v.toLowerCase()));
        if (caseFolded.size < 2) continue; // pure casing variants
        let best = "";
        let bestCount = -1;
        for (const [variant, count] of m) {
          if (count > bestCount) {
            best = variant;
            bestCount = count;
          }
        }
        winners.set(fp, best);
      }
      if (winners.size === 0) continue;

      table.rows.forEach((row, r) => {
        const v = row[col.index];
        if (isEmptyCell(v) || typeof v !== "string") return;
        const cleaned = cleanWhitespace(v);
        const winner = winners.get(fpByCleaned.get(cleaned) ?? "");
        if (winner === undefined || winner === cleaned) return;
        // Case-only difference from the winner is the casing fixer's job.
        if (winner.toLowerCase() === cleaned.toLowerCase()) return;
        affectedColumns.add(col.name);
        patches.push({
          kind: "cell",
          id: cellPatchId(RULE, r, col.index),
          rule: RULE,
          cell: { row: r, col: col.index },
          before: v,
          after: winner,
          reason: `"${cellText(v)}" and "${winner}" are the same value written differently (punctuation or word order); standardised to the most frequent spelling in the "${col.name}" column`,
          confidence: 0.85,
        });
      });
    }

    if (patches.length === 0) return { findings: [], patches: [] };

    const findings: Finding[] = [
      {
        rule: RULE,
        severity: "warning",
        title: `${n(patches.length, "inconsistently written value")}`,
        detail: `Values in ${[...affectedColumns].map((c) => `"${c}"`).join(", ")} are the same entry written differently — extra punctuation or reordered words (e.g. "Acme Ltd." vs "Acme Ltd"). Variant spellings split groups in pivot tables and lookups. Each variant is standardised to the most frequent spelling already present in the column.`,
        count: patches.length,
        patchIds: patches.map((p) => p.id),
      },
    ];

    return { findings, patches };
  },
};
