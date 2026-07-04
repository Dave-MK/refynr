import type { CellPatch, Finding } from "../types.js";
import { isEmptyCell } from "../table.js";
import { cleanWhitespace } from "../text.js";
import { cellPatchId, n, type Fixer, type FixerOutput } from "./fixer.js";

const RULE = "normalize-number";

const CURRENCY_RE = /[£$€¥]/;

/**
 * Parse a "number wearing text clothes" — currency symbols, thousands
 * separators, surrounding spaces, or accountancy parens-negatives — into its
 * plain numeric string. Returns null if the value isn't cleanly numeric once
 * the decoration is stripped (so "N/A", "12 apples", "3-4" are left alone).
 */
export function parseDecoratedNumber(raw: string): string | null {
  let s = cleanWhitespace(raw);
  if (s === "") return null;

  // Accountancy negative: (1,200) -> -1200
  let negative = false;
  const parens = s.match(/^\((.*)\)$/);
  if (parens) {
    negative = true;
    s = parens[1]!.trim();
  }
  if (s.startsWith("-")) {
    negative = !negative;
    s = s.slice(1).trim();
  }

  s = s.replace(CURRENCY_RE, "").replace(/,/g, "").trim();

  // Must be a plain number once decoration is gone.
  if (!/^\d+(\.\d+)?$/.test(s)) return null;

  // Preserve the numeric value exactly (don't reformat decimals). If nothing
  // actually changed (a bare "42" or "-42"), there's no fix to make — the
  // whitespace fixer owns pure-whitespace differences.
  const out = negative ? `-${s}` : s;
  return out === cleanWhitespace(raw) ? null : out;
}

/**
 * In numeric-dominant columns, strips currency symbols, thousands separators
 * and accountancy parens so the values are real numbers Excel/Sheets will sum
 * instead of text. Fires only where a clear majority of the column already
 * parses as a number, so a stray "£" in a notes field is never touched.
 */
export const numberFixer: Fixer = {
  rule: RULE,
  run({ table, profile }): FixerOutput {
    const patches: CellPatch[] = [];
    const affected = new Set<string>();

    for (const col of profile.columns) {
      // Count how many non-empty values are numbers-with-or-without decoration.
      let numericish = 0;
      let nonEmpty = 0;
      for (const row of table.rows) {
        const v = row[col.index];
        if (isEmptyCell(v)) continue;
        nonEmpty++;
        const s = cleanWhitespace(String(v));
        if (/^-?\d+(\.\d+)?$/.test(s) || parseDecoratedNumber(s) !== null) {
          numericish++;
        }
      }
      if (nonEmpty < 3 || numericish / nonEmpty < 0.7) continue;

      table.rows.forEach((row, r) => {
        const v = row[col.index];
        if (isEmptyCell(v) || typeof v !== "string") return;
        const fixed = parseDecoratedNumber(v);
        if (fixed === null) return;
        affected.add(col.name);
        patches.push({
          kind: "cell",
          id: cellPatchId(RULE, r, col.index),
          rule: RULE,
          cell: { row: r, col: col.index },
          before: v,
          after: fixed,
          reason:
            "Number stored as text: currency symbols, thousands separators, or accountancy brackets removed so the value is a real number your spreadsheet will sum and chart.",
          confidence: 0.92,
        });
      });
    }

    if (patches.length === 0) return { findings: [], patches: [] };

    const findings: Finding[] = [
      {
        rule: RULE,
        severity: "warning",
        title: `${n(patches.length, "number")} stored as text`,
        detail: `${n(patches.length, "value", "values")} in ${[...affected].map((c) => `"${c}"`).join(", ")} carry currency symbols, thousands commas, or brackets that make Excel treat them as text — so SUM, AVERAGE and charts silently ignore them. Stripped to plain numbers.`,
        count: patches.length,
        patchIds: patches.map((p) => p.id),
      },
    ];

    return { findings, patches };
  },
};
