import type { CellPatch, Finding } from "../types.js";
import { cleanWhitespace, INVISIBLE_TEST_RE } from "../text.js";
import { demojibake } from "./encoding.js";
import { cellPatchId, n, type Fixer, type FixerOutput } from "./fixer.js";

const RULE = "trim-whitespace";

// Re-exported for the fixers that build their patches on cleaned text.
export { cleanWhitespace };

/**
 * Trims leading/trailing whitespace, collapses runs of internal spaces,
 * and removes invisible characters (non-breaking spaces, zero-width chars)
 * — the classic "why doesn't my VLOOKUP match?" culprits.
 *
 * Cells with encoding corruption are skipped here: the encoding fixer owns
 * them and its patch already includes the whitespace cleanup, so the two
 * patches never fight over the same cell.
 */
export const whitespaceFixer: Fixer = {
  rule: RULE,
  run({ table }): FixerOutput {
    const patches: CellPatch[] = [];
    let invisible = 0;

    table.rows.forEach((row, r) => {
      row.forEach((v, c) => {
        if (typeof v !== "string") return;
        if (demojibake(v) !== null) return; // owned by fix-encoding
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
