import type { CellPatch, Finding } from "../types.js";
import { isEmptyCell } from "../table.js";
import { EMAIL_RE } from "../profile.js";
import { cleanWhitespace } from "./whitespace.js";
import { cellPatchId, n, verb, type Fixer, type FixerOutput } from "./fixer.js";

const FIX_RULE = "normalize-email";
const FLAG_RULE = "invalid-email";

/**
 * In email columns: lowercases addresses, strips internal spaces and
 * mailto: prefixes where the result is valid, and flags addresses that
 * remain invalid (advisory — nothing is guessed).
 */
export const emailFixer: Fixer = {
  rule: FIX_RULE,
  run({ table, profile }): FixerOutput {
    const patches: CellPatch[] = [];
    const invalidCells: { row: number; col: number; value: string }[] = [];

    for (const col of profile.columns) {
      const nameHints = /e-?mail/i.test(col.name);
      if (col.type !== "email" && !nameHints) continue;

      table.rows.forEach((row, r) => {
        const v = row[col.index];
        if (isEmptyCell(v) || typeof v !== "string") return;

        const normalized = cleanWhitespace(v)
          .replace(/^mailto:/i, "")
          .replace(/\s+/g, "")
          .toLowerCase();

        if (EMAIL_RE.test(normalized)) {
          if (normalized !== v) {
            patches.push({
              kind: "cell",
              id: cellPatchId(FIX_RULE, r, col.index),
              rule: FIX_RULE,
              cell: { row: r, col: col.index },
              before: v,
              after: normalized,
              reason:
                "Email normalized: lowercased and stray characters removed. Email addresses are case-insensitive, and mixed case creates false duplicates.",
              confidence: 0.95,
            });
          }
        } else {
          invalidCells.push({ row: r, col: col.index, value: String(v) });
        }
      });
    }

    const findings: Finding[] = [];
    if (patches.length > 0) {
      findings.push({
        rule: FIX_RULE,
        severity: "warning",
        title: `${n(patches.length, "email")} normalized`,
        detail: `${n(patches.length, "email address", "email addresses")} had mixed case, stray spaces, or mailto: prefixes. Normalizing them prevents false duplicates and failed CRM imports.`,
        count: patches.length,
        patchIds: patches.map((p) => p.id),
      });
    }
    if (invalidCells.length > 0) {
      const samples = invalidCells
        .slice(0, 3)
        .map((c) => `"${c.value}" (row ${c.row + 2})`)
        .join(", ");
      findings.push({
        rule: FLAG_RULE,
        severity: "error",
        title: `${n(invalidCells.length, "invalid email address", "invalid email addresses")}`,
        detail: `${n(invalidCells.length, "value", "values")} in email columns ${verb(invalidCells.length, "is not a valid address", "are not valid addresses")}, e.g. ${samples}. Refynr never guesses an email — review these manually or exclude them before import.`,
        count: invalidCells.length,
        column: invalidCells[0]!.col,
        patchIds: [],
      });
    }

    return { findings, patches };
  },
};
