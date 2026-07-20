import type {
  ColumnProfile,
  ColumnType,
  Table,
  TableProfile,
} from "./types.js";
import { cellText, isEmptyCell, isMissingSentinel } from "./table.js";

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** UK postcode, tolerant of missing/misplaced space. */
export const UK_POSTCODE_RE =
  /^([A-Za-z]{1,2}\d[A-Za-z\d]?)\s*(\d[A-Za-z]{2})$/;

/** Phone-ish: digits with optional +, spaces, dashes, dots, parens. */
export const PHONE_RE = /^\+?[\d\s\-().]{7,20}$/;

export const URL_RE = /^https?:\/\/\S+$/i;

const BOOL_VALUES = new Set([
  "true", "false", "yes", "no", "y", "n", "1", "0",
]);

/** Date-ish shapes we can recognise before deciding day/month order. */
export const DATE_PATTERNS: RegExp[] = [
  /^\d{4}-\d{1,2}-\d{1,2}([T ].*)?$/, // ISO
  /^\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}$/, // 03/04/2024, 3-4-24
  /^\d{1,2}\s+[A-Za-z]{3,9}\.?,?\s+\d{2,4}$/, // 3 Apr 2024
  /^[A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{2,4}$/, // Apr 3, 2024
];

export function looksLikeDate(s: string): boolean {
  return DATE_PATTERNS.some((re) => re.test(s.trim()));
}

function classify(raw: string): ColumnType {
  const s = raw.trim();
  if (s === "") return "empty";
  if (EMAIL_RE.test(s)) return "email";
  if (URL_RE.test(s)) return "url";
  if (UK_POSTCODE_RE.test(s)) return "postcode";
  if (looksLikeDate(s)) return "date";
  if (/^-?[\d,]+(\.\d+)?%?$/.test(s) || /^[£$€]\s?-?[\d,]+(\.\d+)?$/.test(s)) {
    return "number";
  }
  if (BOOL_VALUES.has(s.toLowerCase())) return "boolean";
  // IPv4 addresses satisfy the phone shape (digits + dots) — keep them out of
  // "phone" so the phone fixer and PII labelling can't misread them.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(s)) return "string";
  // Phone last among pattern types: plain integers already matched number.
  if (PHONE_RE.test(s) && /\d{7,}/.test(s.replace(/\D/g, ""))) return "phone";
  return "string";
}

function inferColumnType(
  values: string[],
): { type: ColumnType; confidence: number } {
  if (values.length === 0) return { type: "empty", confidence: 1 };

  const counts = new Map<ColumnType, number>();
  for (const v of values) {
    const t = classify(v);
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }

  // "number" votes can hide phones; "boolean" votes can hide 0/1 numerics.
  // Pick the dominant specific type if it clears 60% of non-empty values.
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const [topType, topCount] = ranked[0]!;
  const share = topCount / values.length;

  if (share >= 0.6) return { type: topType, confidence: share };
  return { type: "mixed", confidence: share };
}

export function profileTable(table: Table): TableProfile {
  const columns: ColumnProfile[] = table.headers.map((name, index) => {
    const nonEmptyValues: string[] = [];
    let empty = 0;
    let sentinels = 0;
    const distinct = new Set<string>();

    for (const row of table.rows) {
      const v = row[index] ?? null;
      if (isEmptyCell(v)) {
        empty++;
      } else if (isMissingSentinel(v)) {
        // Placeholder "values" (NA, NULL, -, …) are missing data wearing a
        // costume: counting them as present would overstate completeness and
        // pollute type inference and samples.
        empty++;
        sentinels++;
      } else {
        const s = cellText(v);
        nonEmptyValues.push(s);
        distinct.add(s.trim().toLowerCase());
      }
    }

    const { type, confidence } = inferColumnType(nonEmptyValues);

    return {
      index,
      name,
      type,
      typeConfidence: Number(confidence.toFixed(3)),
      nonEmpty: nonEmptyValues.length,
      empty,
      sentinels,
      distinct: distinct.size,
      samples: nonEmptyValues.slice(0, 5),
    };
  });

  return {
    rowCount: table.rows.length,
    columnCount: table.headers.length,
    columns,
  };
}
