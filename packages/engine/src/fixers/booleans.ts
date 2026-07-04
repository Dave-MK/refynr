import type { CellPatch, Finding } from "../types.js";
import { isEmptyCell } from "../table.js";
import { cleanWhitespace } from "../text.js";
import { cellPatchId, n, type Fixer, type FixerOutput } from "./fixer.js";

const RULE = "normalize-boolean";

const TRUE_TOKENS = new Set(["true", "yes", "y", "t"]);
const FALSE_TOKENS = new Set(["false", "no", "n", "f"]);
// 1/0 only count as boolean when the column also uses word tokens, so a
// genuine numeric 0/1 column is never mistaken for booleans.
const TRUE_NUMERIC = "1";
const FALSE_NUMERIC = "0";

type Bool = "true" | "false" | null;

function classify(s: string, includeNumeric: boolean): Bool {
  const t = s.trim().toLowerCase();
  if (TRUE_TOKENS.has(t)) return "true";
  if (FALSE_TOKENS.has(t)) return "false";
  if (includeNumeric && t === TRUE_NUMERIC) return "true";
  if (includeNumeric && t === FALSE_NUMERIC) return "false";
  return null;
}

/**
 * Standardises boolean-ish columns to one consistent pair of tokens. The
 * winning true/false spelling is whichever the column already uses most
 * ("Yes"/"No" stays "Yes"/"No"; "TRUE"/"FALSE" stays that) — refynr never
 * imposes a vocabulary the data doesn't already contain.
 */
export const booleanFixer: Fixer = {
  rule: RULE,
  run({ table, profile }): FixerOutput {
    const patches: CellPatch[] = [];
    const affected = new Set<string>();

    for (const col of profile.columns) {
      // First pass: does this column use word tokens at all? (Gates 1/0.)
      let usesWords = false;
      for (const row of table.rows) {
        const v = row[col.index];
        if (isEmptyCell(v)) continue;
        const t = String(v).trim().toLowerCase();
        if (TRUE_TOKENS.has(t) || FALSE_TOKENS.has(t)) {
          usesWords = true;
          break;
        }
      }
      if (!usesWords) continue;

      // Tally exact spellings of each polarity to find the winners.
      const trueSpellings = new Map<string, number>();
      const falseSpellings = new Map<string, number>();
      let nonEmpty = 0;
      let boolean = 0;
      for (const row of table.rows) {
        const v = row[col.index];
        if (isEmptyCell(v)) continue;
        nonEmpty++;
        const cleaned = cleanWhitespace(String(v));
        const kind = classify(cleaned, true);
        if (kind === "true") {
          boolean++;
          trueSpellings.set(cleaned, (trueSpellings.get(cleaned) ?? 0) + 1);
        } else if (kind === "false") {
          boolean++;
          falseSpellings.set(cleaned, (falseSpellings.get(cleaned) ?? 0) + 1);
        }
      }
      if (nonEmpty < 3 || boolean / nonEmpty < 0.8) continue;

      const winner = (m: Map<string, number>, fallback: string): string => {
        let best = fallback;
        let bestCount = 0;
        for (const [spelling, count] of m) {
          // Prefer word tokens over bare 1/0 even on a tie.
          const better =
            count > bestCount ||
            (count === bestCount && /[a-z]/i.test(spelling) && !/[a-z]/i.test(best));
          if (better) {
            best = spelling;
            bestCount = count;
          }
        }
        return best;
      };
      const trueToken = winner(trueSpellings, "Yes");
      const falseToken = winner(falseSpellings, "No");

      table.rows.forEach((row, r) => {
        const v = row[col.index];
        if (isEmptyCell(v) || typeof v !== "string") return;
        const cleaned = cleanWhitespace(v);
        const kind = classify(cleaned, true);
        if (kind === null) return;
        const target = kind === "true" ? trueToken : falseToken;
        if (cleaned === target) return;
        affected.add(col.name);
        patches.push({
          kind: "cell",
          id: cellPatchId(RULE, r, col.index),
          rule: RULE,
          cell: { row: r, col: col.index },
          before: v,
          after: target,
          reason: `Boolean value standardised to "${target}", the spelling this column already uses most. Mixed yes/y/true forms split filters and pivot tables.`,
          confidence: 0.9,
        });
      });
    }

    if (patches.length === 0) return { findings: [], patches: [] };

    const findings: Finding[] = [
      {
        rule: RULE,
        severity: "warning",
        title: `${n(patches.length, "inconsistent yes/no value")}`,
        detail: `${n(patches.length, "value", "values")} in ${[...affected].map((c) => `"${c}"`).join(", ")} mix boolean spellings (Yes/Y/TRUE/1). Standardised to the column's most common pair so filters and pivots group them as one.`,
        count: patches.length,
        patchIds: patches.map((p) => p.id),
      },
    ];

    return { findings, patches };
  },
};
