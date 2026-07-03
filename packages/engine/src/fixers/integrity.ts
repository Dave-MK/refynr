import type { Finding } from "../types.js";
import { isEmptyCell } from "../table.js";
import { n, verb, type Fixer, type FixerOutput } from "./fixer.js";

const ZEROS_RULE = "suspect-leading-zeros";
const OUTLIER_RULE = "numeric-outliers";

const ID_NAME_RE =
  /(^|[^a-z])(id|ids|ref|reference|code|sku|account|acct|no|number|barcode|ean|upc)([^a-z]|$)/i;

/** Parse a display value as a number, tolerating £/$/€, commas, %. */
function toNumber(s: string): number | null {
  const cleaned = s.trim().replace(/^[£$€]\s?/, "").replace(/,/g, "").replace(/%$/, "");
  if (cleaned === "" || !/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  return Number(cleaned);
}

/**
 * Advisory-only integrity checks. Neither of these can be auto-fixed with
 * confidence — refynr never guesses — but both are classic silent data
 * corruption that analysts want surfaced:
 *
 * 1. Leading zeros: in an ID-like column where some digit-only values keep
 *    their leading zeros and others are shorter, the shorter ones were very
 *    likely zero-stripped by Excel ("00123" → 123).
 * 2. Outliers: numeric values far outside the column's interquartile range
 *    (3× IQR — deliberately conservative) — often unit mix-ups, missing
 *    decimal points, or placeholder values like 99999.
 */
export const integrityFixer: Fixer = {
  rule: ZEROS_RULE,
  run({ table, profile }): FixerOutput {
    const findings: Finding[] = [];

    for (const col of profile.columns) {
      const values: string[] = [];
      for (const row of table.rows) {
        const v = row[col.index];
        if (!isEmptyCell(v)) values.push(String(v).trim());
      }
      if (values.length < 4) continue;

      // --- Leading zeros ---
      if (ID_NAME_RE.test(col.name)) {
        const digitValues = values.filter((v) => /^\d+$/.test(v));
        if (digitValues.length >= values.length * 0.6) {
          const withZeros = digitValues.filter((v) => v.startsWith("0") && v.length > 1);
          if (withZeros.length > 0) {
            const zeroLength = withZeros[0]!.length;
            const stripped = digitValues.filter((v) => v.length < zeroLength);
            if (stripped.length > 0) {
              findings.push({
                rule: ZEROS_RULE,
                severity: "warning",
                title: `"${col.name}": ${n(stripped.length, "value")} may have lost leading zeros`,
                detail: `The "${col.name}" column has identifiers with leading zeros (e.g. "${withZeros[0]}") alongside ${n(stripped.length, "shorter value", "shorter values")} (e.g. "${stripped[0]}"). Excel silently strips leading zeros from anything it reads as a number — if these should all be ${zeroLength} digits, zero-pad them and format the column as Text before the next export. Refynr can't know the true value, so this is flagged rather than fixed.`,
                count: stripped.length,
                column: col.index,
                patchIds: [],
              });
            }
          }
        }
      }

      // --- Numeric outliers ---
      if (col.type === "number" || col.type === "mixed") {
        const numbers = values
          .map(toNumber)
          .filter((x): x is number => x !== null);
        if (numbers.length >= 8 && numbers.length >= values.length * 0.9) {
          const sorted = [...numbers].sort((a, b) => a - b);
          const q = (p: number) => sorted[Math.floor((sorted.length - 1) * p)]!;
          const q1 = q(0.25);
          const q3 = q(0.75);
          const iqr = q3 - q1;
          if (iqr > 0) {
            const lo = q1 - 3 * iqr;
            const hi = q3 + 3 * iqr;
            const outliers = sorted.filter((x) => x < lo || x > hi);
            // If more than ~10% of values are "outliers" the distribution is
            // just wide — stay quiet. Small samples get an allowance of 2.
            const cap = Math.max(2, sorted.length * 0.1);
            if (outliers.length > 0 && outliers.length <= cap) {
              const samples = [...new Set(outliers)]
                .slice(0, 3)
                .map((x) => x.toLocaleString("en-GB"))
                .join(", ");
              findings.push({
                rule: OUTLIER_RULE,
                severity: "info",
                title: `"${col.name}": ${n(outliers.length, "possible outlier")}`,
                detail: `${n(outliers.length, "value sits", "values sit")} far outside the typical range of "${col.name}" (${q1.toLocaleString("en-GB")}–${q3.toLocaleString("en-GB")} for the middle half): ${samples}. ${verb(outliers.length, "It", "They")} may be legitimate — or a unit mix-up, a missing decimal point, or a placeholder like 99999. Worth a look before averaging or charting this column.`,
                count: outliers.length,
                column: col.index,
                patchIds: [],
              });
            }
          }
        }
      }
    }

    return { findings, patches: [] };
  },
};
