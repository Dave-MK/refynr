import type { CellPatch, Finding } from "../types.js";
import { isEmptyCell } from "../table.js";
import { cleanWhitespace } from "./whitespace.js";
import { cellPatchId, n, type Fixer, type FixerOutput } from "./fixer.js";

const FIX_RULE = "normalize-phone";
const FLAG_RULE = "invalid-phone";

/**
 * Conventional grouping for a UK national significant number (10 digits):
 * mobiles 7xxx xxxxxx, London/big-city 2x xxxx xxxx, geographic 1xx xxx xxxx.
 */
function formatUkNsn(nsn: string): string {
  if (nsn.startsWith("7")) return `+44 ${nsn.slice(0, 4)} ${nsn.slice(4)}`;
  if (nsn.startsWith("2")) {
    return `+44 ${nsn.slice(0, 2)} ${nsn.slice(2, 6)} ${nsn.slice(6)}`;
  }
  return `+44 ${nsn.slice(0, 3)} ${nsn.slice(3, 6)} ${nsn.slice(6)}`;
}

/**
 * In phone columns: normalizes formatting to a consistent shape.
 * UK mobiles/landlines (07..., 01..., 02..., +44...) become +44 international
 * format; other plausible numbers just get consistent spacing stripped.
 * Numbers with impossible digit counts are flagged, not changed.
 */
export const phoneFixer: Fixer = {
  rule: FIX_RULE,
  run({ table, profile }): FixerOutput {
    const patches: CellPatch[] = [];
    const invalid: { row: number; col: number; value: string }[] = [];

    for (const col of profile.columns) {
      const nameHints = /phone|mobile|tel|contact\s?no/i.test(col.name);
      if (col.type !== "phone" && !nameHints) continue;

      table.rows.forEach((row, r) => {
        const v = row[col.index];
        if (isEmptyCell(v)) return;
        const raw = cleanWhitespace(String(v));
        if (!/\d/.test(raw)) return;

        const digits = raw.replace(/[^\d+]/g, "").replace(/(?!^)\+/g, "");
        let normalized: string | null = null;
        let reason = "";

        if (/^\+44\d{10}$/.test(digits)) {
          normalized = formatUkNsn(digits.slice(3));
          reason = "UK number reformatted to international +44 format.";
        } else if (/^44\d{10}$/.test(digits)) {
          normalized = formatUkNsn(digits.slice(2));
          reason =
            "Missing + prefix added and UK number reformatted to international +44 format.";
        } else if (/^0\d{10}$/.test(digits)) {
          normalized = formatUkNsn(digits.slice(1));
          reason =
            "UK number converted from national (0...) to international +44 format. Spreadsheets often strip the leading zero — the +44 form survives round-trips.";
        } else if (/^\+\d{7,15}$/.test(digits)) {
          normalized = digits;
          reason = "International number: formatting characters removed.";
        } else if (/^\d{7,15}$/.test(digits)) {
          // Plausible but ambiguous — leave value alone, don't flag.
          return;
        } else {
          invalid.push({ row: r, col: col.index, value: String(v) });
          return;
        }

        if (normalized !== null && normalized !== v) {
          patches.push({
            kind: "cell",
            id: cellPatchId(FIX_RULE, r, col.index),
            rule: FIX_RULE,
            cell: { row: r, col: col.index },
            before: v,
            after: normalized,
            reason,
            confidence: 0.9,
          });
        }
      });
    }

    const findings: Finding[] = [];
    if (patches.length > 0) {
      findings.push({
        rule: FIX_RULE,
        severity: "warning",
        title: `${n(patches.length, "phone number")} normalized`,
        detail: `${n(patches.length, "phone number")} had inconsistent formatting. UK numbers are converted to +44 international format, which survives CSV round-trips (Excel silently drops leading zeros from national numbers).`,
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
        title: `${n(invalid.length, "suspect phone number")}`,
        detail: `${n(invalid.length, "value has", "values have")} an impossible digit count or structure in phone columns, e.g. ${samples}. Review these manually.`,
        count: invalid.length,
        column: invalid[0]!.col,
        cells: invalid.map((c) => ({ row: c.row, col: c.col })),
        patchIds: [],
      });
    }

    return { findings, patches };
  },
};
