import type { CellPatch, Finding } from "../types.js";
import { isEmptyCell } from "../table.js";
import { UK_POSTCODE_RE } from "../profile.js";
import { cleanWhitespace } from "./whitespace.js";
import { cellPatchId, n, type Fixer, type FixerOutput } from "./fixer.js";

const FIX_RULE = "normalize-postcode";
const FLAG_RULE = "invalid-postcode";

/**
 * In UK postcode columns: uppercases and fixes spacing to the canonical
 * "outward inward" format (SW1A 1AA). Values that don't parse as a UK
 * postcode are flagged, never altered.
 */
export const postcodeFixer: Fixer = {
  rule: FIX_RULE,
  run({ table, profile }): FixerOutput {
    const patches: CellPatch[] = [];
    const invalid: { row: number; col: number; value: string }[] = [];

    for (const col of profile.columns) {
      const nameHints = /post\s?code|postal/i.test(col.name);
      if (col.type !== "postcode" && !nameHints) continue;

      table.rows.forEach((row, r) => {
        const v = row[col.index];
        if (isEmptyCell(v) || typeof v !== "string") return;

        const compact = cleanWhitespace(v).toUpperCase();
        const m = compact.match(UK_POSTCODE_RE);
        if (m) {
          const canonical = `${m[1]} ${m[2]}`;
          if (canonical !== v) {
            patches.push({
              kind: "cell",
              id: cellPatchId(FIX_RULE, r, col.index),
              rule: FIX_RULE,
              cell: { row: r, col: col.index },
              before: v,
              after: canonical,
              reason:
                "Postcode converted to Royal Mail canonical format: uppercase with a single space before the final three characters.",
              confidence: 1,
            });
          }
        } else {
          invalid.push({ row: r, col: col.index, value: String(v) });
        }
      });
    }

    const findings: Finding[] = [];
    if (patches.length > 0) {
      findings.push({
        rule: FIX_RULE,
        severity: "warning",
        title: `${n(patches.length, "postcode")} reformatted`,
        detail: `${n(patches.length, "UK postcode")} had inconsistent case or spacing and ${patches.length === 1 ? "was" : "were"} converted to Royal Mail format (e.g. "sw1a1aa" → "SW1A 1AA").`,
        count: patches.length,
        patchIds: patches.map((p) => p.id),
      });
    }
    if (invalid.length > 0) {
      const samples = invalid
        .slice(0, 3)
        .map((c) => `"${c.value}" (row ${c.row + 2})`)
        .join(", ");
      findings.push({
        rule: FLAG_RULE,
        severity: "error",
        title: `${n(invalid.length, "invalid UK postcode")}`,
        detail: `${n(invalid.length, "value")} in postcode columns ${invalid.length === 1 ? "doesn't" : "don't"} match any valid UK postcode format, e.g. ${samples}. These may be typos or non-UK addresses — review manually.`,
        count: invalid.length,
        column: invalid[0]!.col,
        patchIds: [],
      });
    }

    return { findings, patches };
  },
};
