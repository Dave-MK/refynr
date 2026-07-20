import type { Finding } from "../types.js";
import { isEmptyCell } from "../table.js";
import { n, verb, type Fixer, type FixerOutput } from "./fixer.js";

const ZEROS_RULE = "suspect-leading-zeros";
const OUTLIER_RULE = "numeric-outliers";
const EXCEL_DATE_RULE = "excel-date-artifact";
const EXCEL_SCI_RULE = "excel-scientific-notation";

/** Classic placeholder constants that masquerade as measurements. */
const PLACEHOLDER_NUMBERS = new Set([
  9999, 99999, 999999, 9999999, 99999999, -1, -99, -999, -9999,
]);

/** "2-Sep" / "Sep-24" — the shape Excel leaves after eating an identifier
 *  like the gene symbol SEPT2 or a code like MAR1. */
const EXCEL_DATE_ARTIFACT_RE =
  /^(\d{1,2}-(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)|(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)-\d{2})$/i;

/** "2.31E+13" — an identifier/barcode Excel converted to scientific notation. */
const EXCEL_SCI_RE = /^\d(\.\d+)?E\+\d{1,3}$/i;

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
          // Right-skewed all-positive data (salaries, revenues, durations)
          // has a legitimate long tail that raw IQR mislabels as outliers.
          // Fence on log-scale instead: a real tail survives, a unit mix-up
          // or placeholder still doesn't.
          const mid = sorted[Math.floor((sorted.length - 1) * 0.5)]!;
          const mean = sorted.reduce((s, x) => s + x, 0) / sorted.length;
          const useLog = sorted[0]! > 0 && mid > 0 && mean > mid * 1.5;
          const xs = useLog ? sorted.map((x) => Math.log10(x)) : sorted;
          const q = (p: number) => xs[Math.floor((xs.length - 1) * p)]!;
          const q1 = q(0.25);
          const q3 = q(0.75);
          const iqr = q3 - q1;
          if (iqr > 0) {
            const lo = q1 - 3 * iqr;
            const hi = q3 + 3 * iqr;
            const outliers: number[] = [];
            for (let i = 0; i < xs.length; i++) {
              if (xs[i]! < lo || xs[i]! > hi) outliers.push(sorted[i]!);
            }
            const placeholders = outliers.filter((x) =>
              PLACEHOLDER_NUMBERS.has(x),
            );
            const genuine = outliers.filter(
              (x) => !PLACEHOLDER_NUMBERS.has(x),
            );
            const q1d = useLog ? Math.pow(10, q1) : q1;
            const q3d = useLog ? Math.pow(10, q3) : q3;

            // Placeholder constants get their own, louder finding: 99999 in a
            // measurement column is almost never a measurement.
            if (placeholders.length > 0) {
              const samples = [...new Set(placeholders)]
                .slice(0, 3)
                .map((x) => x.toLocaleString("en-GB"))
                .join(", ");
              findings.push({
                rule: OUTLIER_RULE,
                severity: "warning",
                title: `"${col.name}": ${n(placeholders.length, "placeholder-like value")}`,
                detail: `${n(placeholders.length, "value")} in "${col.name}" ${verb(placeholders.length, "equals", "equal")} a classic missing-data placeholder (${samples}) and ${verb(placeholders.length, "sits", "sit")} far outside the column's typical range. Placeholder numbers silently poison averages and charts — replace them with blanks or the real values before analysing.`,
                count: placeholders.length,
                column: col.index,
                patchIds: [],
              });
            }

            // If more than ~10% of values are "outliers" the distribution is
            // just wide — stay quiet. Small samples get an allowance of 2.
            const cap = Math.max(2, sorted.length * 0.1);
            if (genuine.length > 0 && genuine.length <= cap) {
              const samples = [...new Set(genuine)]
                .slice(0, 3)
                .map((x) => x.toLocaleString("en-GB"))
                .join(", ");
              findings.push({
                rule: OUTLIER_RULE,
                severity: "info",
                title: `"${col.name}": ${n(genuine.length, "possible outlier")}`,
                detail: `${n(genuine.length, "value sits", "values sit")} far outside the typical range of "${col.name}" (${q1d.toLocaleString("en-GB", { maximumFractionDigits: 2 })}–${q3d.toLocaleString("en-GB", { maximumFractionDigits: 2 })} for the middle half): ${samples}. ${verb(genuine.length, "It", "They")} may be legitimate — or a unit mix-up, a missing decimal point, or a data-entry slip. Worth a look before averaging or charting this column.`,
                count: genuine.length,
                column: col.index,
                patchIds: [],
              });
            }
          }
        }
      }

      // --- Excel-mangled identifiers ---
      // Only in mostly-non-date text columns: a handful of "2-Sep" / "Sep-24"
      // shapes among codes is the signature of Excel eating identifiers
      // (SEPT2 → 2-Sep); a column that is MOSTLY that shape is just dates.
      if (col.type === "string" || col.type === "mixed") {
        const dateArtifacts = values.filter((v) =>
          EXCEL_DATE_ARTIFACT_RE.test(v),
        );
        if (
          dateArtifacts.length > 0 &&
          dateArtifacts.length <= values.length * 0.2
        ) {
          const samples = [...new Set(dateArtifacts)].slice(0, 3).join('", "');
          findings.push({
            rule: EXCEL_DATE_RULE,
            severity: "warning",
            title: `"${col.name}": ${n(dateArtifacts.length, "value looks", "values look")} Excel-date-converted`,
            detail: `"${samples}" in "${col.name}" ${verb(dateArtifacts.length, "has", "have")} the shape Excel leaves after silently converting an identifier to a date (the classic SEPT2 → "2-Sep" gene-symbol injury). The original value is unrecoverable from the file — restore it from the source system and format the column as Text before the next export.`,
            count: dateArtifacts.length,
            column: col.index,
            patchIds: [],
          });
        }

      }

      // Scientific-notation artifacts live in ID-named columns of any type —
      // a barcode column that's mostly plain digits types as "number", and
      // that's exactly where Excel's conversion does the damage.
      if (
        (col.type === "string" || col.type === "mixed" || col.type === "number") &&
        ID_NAME_RE.test(col.name)
      ) {
        const sciArtifacts = values.filter((v) => EXCEL_SCI_RE.test(v));
        if (sciArtifacts.length > 0) {
          const samples = [...new Set(sciArtifacts)].slice(0, 3).join('", "');
          findings.push({
            rule: EXCEL_SCI_RULE,
            severity: "warning",
            title: `"${col.name}": ${n(sciArtifacts.length, "identifier")} in scientific notation`,
            detail: `"${samples}" in "${col.name}" ${verb(sciArtifacts.length, "looks", "look")} like a long identifier or barcode that Excel converted to scientific notation, destroying its exact digits. The true value can't be recovered from this file — re-export with the column formatted as Text.`,
            count: sciArtifacts.length,
            column: col.index,
            patchIds: [],
          });
        }
      }
    }

    return { findings, patches: [] };
  },
};
