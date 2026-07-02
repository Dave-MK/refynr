import type { CellPatch, Finding } from "../types.js";
import { cellPatchId, n, type Fixer, type FixerOutput } from "./fixer.js";

const RULE = "trim-whitespace";

/** Zero-width characters: remove entirely (ZWSP, ZWNJ, ZWJ, BOM). */
const ZERO_WIDTH_RE = new RegExp("[\\u200B\\u200C\\u200D\\uFEFF]", "g");

/** Space look-alikes: replace with a plain space (NBSP, en/em spaces, etc.). */
const ODD_SPACE_RE = new RegExp(
  "[\\u00A0\\u1680\\u2000-\\u200A\\u202F\\u205F\\u3000]",
  "g",
);

const INVISIBLE_TEST_RE = new RegExp(
  "[\\u200B\\u200C\\u200D\\uFEFF\\u00A0\\u1680\\u2000-\\u200A\\u202F\\u205F\\u3000]",
);

export function cleanWhitespace(s: string): string {
  return s
    .replace(ZERO_WIDTH_RE, "")
    .replace(ODD_SPACE_RE, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Trims leading/trailing whitespace, collapses runs of internal spaces,
 * and removes invisible characters (non-breaking spaces, zero-width chars)
 * — the classic "why doesn't my VLOOKUP match?" culprits.
 */
export const whitespaceFixer: Fixer = {
  rule: RULE,
  run({ table }): FixerOutput {
    const patches: CellPatch[] = [];
    let invisible = 0;

    table.rows.forEach((row, r) => {
      row.forEach((v, c) => {
        if (typeof v !== "string") return;
        const cleaned = cleanWhitespace(v);
        if (cleaned === v) return;
        const hadInvisible = INVISIBLE_TEST_RE.test(v);
        if (hadInvisible) invisible++;
        patches.push({
          kind: "cell",
          id: cellPatchId(RULE, r, c),
          rule: RULE,
          cell: { row: r, col: c },
          before: v,
          after: cleaned,
          reason: hadInvisible
            ? "Invisible characters (non-breaking or zero-width spaces) removed and whitespace trimmed"
            : "Leading/trailing whitespace trimmed and repeated spaces collapsed",
          confidence: 1,
        });
      });
    });

    if (patches.length === 0) return { findings: [], patches: [] };

    const findings: Finding[] = [
      {
        rule: RULE,
        severity: "warning",
        title: `${n(patches.length, "cell")} with stray whitespace`,
        detail:
          invisible > 0
            ? `${n(patches.length, "cell contains", "cells contain")} leading, trailing, or repeated whitespace — ${invisible} of them hide invisible characters (non-breaking or zero-width spaces). These are a common cause of failed VLOOKUP/XLOOKUP matches and broken imports.`
            : `${n(patches.length, "cell contains", "cells contain")} leading, trailing, or repeated whitespace. These are a common cause of failed VLOOKUP/XLOOKUP matches and broken imports.`,
        count: patches.length,
        patchIds: patches.map((p) => p.id),
      },
    ];

    return { findings, patches };
  },
};
