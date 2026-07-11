import type { CellPatch, Finding } from "../types.js";
import { isEmptyCell } from "../table.js";
import { cleanWhitespace } from "./whitespace.js";
import { cellPatchId, n, type Fixer, type FixerOutput } from "./fixer.js";

/**
 * UK-specific business-identifier validators. These are the details US-centric
 * tools get wrong on British data, and that services like Data8 charge per
 * record to clean. Each follows the postcode pattern: detect the column by
 * name, normalise values that parse to their canonical form, and flag — never
 * guess — values that don't.
 *
 * They're gated on column-name hints (there's no reliable content-only
 * signature for a bare 9-digit VAT number vs any other number), so they only
 * ever act on columns a human labelled as that identifier.
 */

const VAT_FIX = "normalize-vat";
const VAT_FLAG = "invalid-vat";
const SORT_FIX = "normalize-sort-code";
const SORT_FLAG = "invalid-sort-code";
const CRN_FIX = "normalize-company-number";
const CRN_FLAG = "invalid-company-number";

/** Standard UK VAT checksum (accepts both the pre-2010 "97" and the newer
 *  "9755" modulus methods). `digits` is 9 or 12 digits (12 = branch trader). */
function validVatChecksum(digits: string): boolean {
  const core = digits.length === 12 ? digits.slice(0, 9) : digits;
  if (core.length !== 9) return false;
  const d = core.split("").map(Number);
  let sum = 0;
  for (let i = 0; i < 7; i++) sum += d[i]! * (8 - i); // weights 8,7,6,5,4,3,2
  const check = d[7]! * 10 + d[8]!;
  return (sum + check) % 97 === 0 || (sum + check + 55) % 97 === 0;
}

function makeFinding(
  rule: string,
  severity: Finding["severity"],
  title: string,
  detail: string,
  count: number,
  column?: number,
  cells?: { row: number; col: number }[],
): Finding {
  return { rule, severity, title, detail, count, column, cells, patchIds: [] };
}

/** UK VAT registration numbers → "GB123456789", with checksum validation. */
export const vatFixer: Fixer = {
  rule: VAT_FIX,
  run({ table, profile }): FixerOutput {
    const patches: CellPatch[] = [];
    const invalid: { row: number; col: number; value: string }[] = [];

    for (const col of profile.columns) {
      if (!/\bvat\b|vat\s?(no|number|reg)/i.test(col.name)) continue;

      table.rows.forEach((row, r) => {
        const v = row[col.index];
        if (isEmptyCell(v)) return;
        const raw = cleanWhitespace(String(v)).toUpperCase();
        const digits = raw.replace(/^GB/, "").replace(/[\s-]/g, "");
        if (/^\d{9}(\d{3})?$/.test(digits) && validVatChecksum(digits)) {
          const canonical = `GB${digits}`;
          if (canonical !== String(v)) {
            patches.push({
              kind: "cell",
              id: cellPatchId(VAT_FIX, r, col.index),
              rule: VAT_FIX,
              cell: { row: r, col: col.index },
              before: v,
              after: canonical,
              reason:
                "UK VAT number normalised to the canonical GB-prefixed form (spacing and hyphens removed); the checksum is valid.",
              confidence: 1,
            });
          }
        } else {
          invalid.push({ row: r, col: col.index, value: String(v) });
        }
      });
    }

    const findings: Finding[] = [];
    if (patches.length > 0)
      findings.push(
        makeFinding(
          VAT_FIX,
          "warning",
          `${n(patches.length, "VAT number")} reformatted`,
          `${n(patches.length, "valid UK VAT number")} had inconsistent spacing or prefix and ${patches.length === 1 ? "was" : "were"} normalised to "GB…" form.`,
          patches.length,
        ),
      );
    if (invalid.length > 0) {
      const samples = invalid.slice(0, 3).map((c) => `"${c.value}" (row ${c.row + 2})`).join(", ");
      findings.push(
        makeFinding(
          VAT_FLAG,
          "error",
          `${n(invalid.length, "invalid UK VAT number")}`,
          `${n(invalid.length, "value")} in VAT columns ${invalid.length === 1 ? "doesn't pass" : "don't pass"} the UK VAT checksum, e.g. ${samples}. These may be typos, non-UK numbers, or transposed digits — verify before reclaiming VAT.`,
          invalid.length,
          invalid[0]!.col,
          invalid.map((c) => ({ row: c.row, col: c.col })),
        ),
      );
    }
    return { findings, patches: patches as CellPatch[] };
  },
};

/** UK bank sort codes → "NN-NN-NN". */
export const sortCodeFixer: Fixer = {
  rule: SORT_FIX,
  run({ table, profile }): FixerOutput {
    const patches: CellPatch[] = [];
    const invalid: { row: number; col: number; value: string }[] = [];

    for (const col of profile.columns) {
      if (!/sort\s?code|sortcode/i.test(col.name)) continue;

      table.rows.forEach((row, r) => {
        const v = row[col.index];
        if (isEmptyCell(v)) return;
        const digits = String(v).replace(/[\s-]/g, "");
        if (/^\d{6}$/.test(digits)) {
          const canonical = `${digits.slice(0, 2)}-${digits.slice(2, 4)}-${digits.slice(4, 6)}`;
          if (canonical !== String(v)) {
            patches.push({
              kind: "cell",
              id: cellPatchId(SORT_FIX, r, col.index),
              rule: SORT_FIX,
              cell: { row: r, col: col.index },
              before: v,
              after: canonical,
              reason:
                "Sort code normalised to the hyphenated NN-NN-NN format banks expect.",
              confidence: 1,
            });
          }
        } else {
          invalid.push({ row: r, col: col.index, value: String(v) });
        }
      });
    }

    const findings: Finding[] = [];
    if (patches.length > 0)
      findings.push(
        makeFinding(
          SORT_FIX,
          "warning",
          `${n(patches.length, "sort code")} reformatted`,
          `${n(patches.length, "six-digit sort code")} ${patches.length === 1 ? "was" : "were"} converted to hyphenated NN-NN-NN format (e.g. "560036" → "56-00-36").`,
          patches.length,
        ),
      );
    if (invalid.length > 0) {
      const samples = invalid.slice(0, 3).map((c) => `"${c.value}" (row ${c.row + 2})`).join(", ");
      findings.push(
        makeFinding(
          SORT_FLAG,
          "error",
          `${n(invalid.length, "invalid sort code")}`,
          `${n(invalid.length, "value")} in sort-code columns ${invalid.length === 1 ? "isn't" : "aren't"} six digits, e.g. ${samples}. A UK sort code is exactly six digits — these may be truncated (Excel drops leading zeros) or mistyped.`,
          invalid.length,
          invalid[0]!.col,
          invalid.map((c) => ({ row: c.row, col: c.col })),
        ),
      );
    }
    return { findings, patches: patches as CellPatch[] };
  },
};

/** Companies House registration numbers → 8 chars (zero-padded, uppercased). */
export const companyNumberFixer: Fixer = {
  rule: CRN_FIX,
  run({ table, profile }): FixerOutput {
    const patches: CellPatch[] = [];
    const invalid: { row: number; col: number; value: string }[] = [];

    for (const col of profile.columns) {
      if (!/compan(y|ies)\s?(house\s?)?(no|number|reg|registration)|\bcrn\b/i.test(col.name)) continue;

      table.rows.forEach((row, r) => {
        const v = row[col.index];
        if (isEmptyCell(v)) return;
        const raw = cleanWhitespace(String(v)).toUpperCase().replace(/\s/g, "");
        let canonical: string | null = null;
        if (/^\d{1,8}$/.test(raw)) {
          canonical = raw.padStart(8, "0"); // Excel strips the leading zeros
        } else if (/^[A-Z]{2}\d{6}$/.test(raw)) {
          canonical = raw; // prefixed (SC, NI, OC, FC, …)
        }
        if (canonical) {
          if (canonical !== String(v)) {
            patches.push({
              kind: "cell",
              id: cellPatchId(CRN_FIX, r, col.index),
              rule: CRN_FIX,
              cell: { row: r, col: col.index },
              before: v,
              after: canonical,
              reason:
                "Company number normalised to the 8-character Companies House format (zero-padded; Excel silently drops the leading zeros).",
              confidence: 1,
            });
          }
        } else {
          invalid.push({ row: r, col: col.index, value: String(v) });
        }
      });
    }

    const findings: Finding[] = [];
    if (patches.length > 0)
      findings.push(
        makeFinding(
          CRN_FIX,
          "warning",
          `${n(patches.length, "company number")} reformatted`,
          `${n(patches.length, "Companies House number")} ${patches.length === 1 ? "was" : "were"} normalised to 8 characters (e.g. "123456" → "00123456"). Excel strips leading zeros, which breaks lookups against the register.`,
          patches.length,
        ),
      );
    if (invalid.length > 0) {
      const samples = invalid.slice(0, 3).map((c) => `"${c.value}" (row ${c.row + 2})`).join(", ");
      findings.push(
        makeFinding(
          CRN_FLAG,
          "error",
          `${n(invalid.length, "invalid company number")}`,
          `${n(invalid.length, "value")} in company-number columns ${invalid.length === 1 ? "doesn't" : "don't"} match a Companies House number (8 digits, or 2 letters + 6 digits), e.g. ${samples}. Verify against the register before relying on ${invalid.length === 1 ? "it" : "them"}.`,
          invalid.length,
          invalid[0]!.col,
          invalid.map((c) => ({ row: c.row, col: c.col })),
        ),
      );
    }
    return { findings, patches: patches as CellPatch[] };
  },
};
