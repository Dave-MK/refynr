import type { Finding } from "../types.js";
import { cellText, isEmptyCell } from "../table.js";
import { n, type Fixer, type FixerOutput } from "./fixer.js";

const RULE = "pii-present";

/** UK National Insurance number (two letters, six digits, suffix A–D). */
const NI_RE = /^[A-CEGHJ-PR-TW-Z]{2}\s?\d{2}\s?\d{2}\s?\d{2}\s?[A-D]$/i;

const NAME_HINTS: Array<[RegExp, string]> = [
  [/(^|[^a-z])(dob|date of birth|birth ?date)([^a-z]|$)/i, "dates of birth"],
  [/(^|[^a-z])(ni|nino|national insurance)([^a-z]|$)/i, "National Insurance numbers"],
  [/(^|[^a-z])(address|addr|street|city|town)([^a-z]|$)/i, "addresses"],
  [/(^|[^a-z])(salary|pay|wage)([^a-z]|$)/i, "salary details"],
];

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

    const add = (label: string, colName: string): void => {
      const cols = kinds.get(label);
      if (cols) cols.push(colName);
      else kinds.set(label, [colName]);
    };

    for (const col of profile.columns) {
      const typeLabel = TYPE_LABEL[col.type];
      if (typeLabel) {
        add(typeLabel, col.name);
        continue;
      }
      const hint = NAME_HINTS.find(([re]) => re.test(col.name));
      if (hint) {
        add(hint[1], col.name);
        continue;
      }
      // Content check for NI numbers (they type as plain strings).
      if (col.type === "string" || col.type === "mixed") {
        let matches = 0;
        let seen = 0;
        for (const row of table.rows) {
          const v = row[col.index];
          if (isEmptyCell(v)) continue;
          seen++;
          if (NI_RE.test(cellText(v).trim())) matches++;
          if (seen >= 200) break; // a sample is plenty for a yes/no signal
        }
        if (seen >= 4 && matches >= seen * 0.6) {
          add("National Insurance numbers", col.name);
        }
      }
    }

    if (kinds.size === 0) return { findings: [], patches: [] };

    const parts = [...kinds.entries()].map(
      ([label, cols]) => `${label} (${cols.map((c) => `"${c}"`).join(", ")})`,
    );
    const colCount = [...kinds.values()].reduce((s, c) => s + c.length, 0);

    return {
      findings: [
        {
          rule: RULE,
          severity: "info",
          title: `Personal data in ${n(colCount, "column")}`,
          detail: `This data contains ${parts.join("; ")}. Refynr processes everything in your browser — nothing has left this device — but the cleaned export carries that personal data with it, and UK GDPR applies wherever it's shared next. Worth checking the export only goes where it should, and dropping columns you don't need.`,
          count: colCount,
          patchIds: [],
        },
      ],
      patches: [],
    };
  },
};
