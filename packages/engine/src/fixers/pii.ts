import type { CellRef, Finding } from "../types.js";
import { cellText, isEmptyCell } from "../table.js";
import { MAX_FINDING_CELLS, n, type Fixer, type FixerOutput } from "./fixer.js";

const RULE = "pii-present";

/** UK National Insurance number (two letters, six digits, suffix A–D). */
const NI_RE = /^[A-CEGHJ-PR-TW-Z]{2}\s?\d{2}\s?\d{2}\s?\d{2}\s?[A-D]$/i;

const NAME_HINTS: Array<[RegExp, string]> = [
  [/(^|[^a-z])(dob|date of birth|birth ?date)([^a-z]|$)/i, "dates of birth"],
  [/(^|[^a-z])(ni|nino|national insurance)([^a-z]|$)/i, "National Insurance numbers"],
  [/(^|[^a-z])(address|addr|street|city|town)([^a-z]|$)/i, "addresses"],
  [/(^|[^a-z])(salary|pay|wage)([^a-z]|$)/i, "salary details"],
  [/(^|[^a-z])(phone|mobile|tel|telephone)([^a-z]|$)/i, "phone numbers"],
  [/(^|[^a-z])(card ?(no|num|number)?|pan)([^a-z]|$)/i, "payment card numbers"],
  [/(^|[^a-z])(name|forename|surname|first ?name|last ?name|full ?name)([^a-z]|$)/i, "names"],
];

/** Column names where "name" doesn't mean a person. */
const NOT_PERSONAL_NAME_RE =
  /compan|business|organis|organiz|product|brand|item|file|sheet|host|domain|user ?name/i;

/** Luhn checksum — the card-number check every PAN passes. */
function luhnValid(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

const TYPE_LABEL: Partial<Record<string, string>> = {
  email: "email addresses",
  phone: "phone numbers",
  postcode: "postcodes",
};

/**
 * Informational-only sweep for personal data. Refynr never sends cell data
 * anywhere — everything runs in the browser — but the *export* is the user's
 * responsibility, and UK GDPR applies the moment a cleaned file containing
 * personal data is shared onward. One finding names the columns so the user
 * knows what they're holding before they hit Download. No patches, no score
 * impact — holding personal data isn't a data-quality defect.
 */
export const piiFixer: Fixer = {
  rule: RULE,
  run({ table, profile }): FixerOutput {
    const kinds = new Map<string, string[]>(); // label -> column names
    // Profile order, one entry per flagged column — each column can only be
    // added once below, so no dedupe is needed.
    const piiCols: number[] = [];

    const add = (label: string, colName: string, colIndex: number): void => {
      const cols = kinds.get(label);
      if (cols) cols.push(colName);
      else kinds.set(label, [colName]);
      piiCols.push(colIndex);
    };

    for (const col of profile.columns) {
      const typeLabel = TYPE_LABEL[col.type];
      if (typeLabel) {
        add(typeLabel, col.name, col.index);
        continue;
      }
      const hint = NAME_HINTS.find(([re]) => re.test(col.name));
      if (hint) {
        // "Company Name" / "Product name" isn't personal data.
        if (hint[1] !== "names" || !NOT_PERSONAL_NAME_RE.test(col.name)) {
          add(hint[1], col.name, col.index);
          continue;
        }
      }
      // Content checks: NI numbers type as plain strings; card PANs type as
      // numbers — both need a value-level look, on a sample.
      if (
        col.type === "string" ||
        col.type === "mixed" ||
        col.type === "number"
      ) {
        let niMatches = 0;
        let cardMatches = 0;
        let seen = 0;
        for (const row of table.rows) {
          const v = row[col.index];
          if (isEmptyCell(v)) continue;
          seen++;
          const text = cellText(v).trim();
          if (NI_RE.test(text)) niMatches++;
          const digits = text.replace(/[\s-]/g, "");
          if (/^\d{13,19}$/.test(digits) && luhnValid(digits)) cardMatches++;
          if (seen >= 200) break; // a sample is plenty for a yes/no signal
        }
        if (seen >= 4 && niMatches >= seen * 0.6) {
          add("National Insurance numbers", col.name, col.index);
        } else if (seen >= 4 && cardMatches >= seen * 0.6) {
          add("payment card numbers", col.name, col.index);
        }
      }
    }

    if (kinds.size === 0) return { findings: [], patches: [] };

    const parts = [...kinds.entries()].map(
      ([label, cols]) => `${label} (${cols.map((c) => `"${c}"`).join(", ")})`,
    );
    const colCount = [...kinds.values()].reduce((s, c) => s + c.length, 0);

    // This is a column-level finding — "these columns hold personal data" —
    // so the useful jump is to the columns, not to any one value. Rather than
    // enumerate every cell of every flagged column (unbounded, and pointless
    // for a highlight that only ever renders what's on screen), carry each
    // column's leading populated cells, sharing one budget between them. That
    // puts the locate target on the first personal value in the sheet and
    // rings the tops of the columns it names.
    const perCol = Math.max(1, Math.floor(MAX_FINDING_CELLS / piiCols.length));
    const cells: CellRef[] = [];
    for (const col of piiCols) {
      let taken = 0;
      for (let r = 0; r < table.rows.length && taken < perCol; r++) {
        const v = table.rows[r]?.[col] ?? null;
        if (isEmptyCell(v)) continue;
        cells.push({ row: r, col });
        taken++;
      }
    }

    return {
      findings: [
        {
          rule: RULE,
          severity: "info",
          title: `Personal data in ${n(colCount, "column")}`,
          detail: `This data contains ${parts.join("; ")}. Refynr processes everything in your browser — nothing has left this device — but the cleaned export carries that personal data with it, and UK GDPR applies wherever it's shared next. Worth checking the export only goes where it should, and dropping columns you don't need.`,
          count: colCount,
          cells,
          patchIds: [],
        },
      ],
      patches: [],
    };
  },
};
