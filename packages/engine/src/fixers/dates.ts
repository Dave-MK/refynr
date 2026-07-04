import type { CellPatch, DateOrder, Finding } from "../types.js";
import { isEmptyCell } from "../table.js";
import { looksLikeDate } from "../profile.js";
import { cleanWhitespace } from "./whitespace.js";
import { cellPatchId, n, type Fixer, type FixerOutput } from "./fixer.js";

const FIX_RULE = "normalize-date";
const FLAG_RULE = "impossible-date";

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
  january: 1, february: 2, march: 3, april: 4, june: 6, july: 7,
  august: 8, september: 9, october: 10, november: 11, december: 12,
};

interface ParsedDate {
  y: number;
  m: number;
  d: number;
  /** True when day/month could be swapped (both ≤ 12). */
  ambiguous: boolean;
}

function expandYear(y: number): number {
  if (y >= 100) return y;
  return y >= 70 ? 1900 + y : 2000 + y;
}

function validDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1) return false;
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return d <= daysInMonth;
}

/** Parse one value under an assumed day/month order. */
function parseDate(s: string, order: "DMY" | "MDY"): ParsedDate | null {
  const t = cleanWhitespace(s);

  // ISO: 2024-04-03 (optionally with time — time is discarded).
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})([T ].*)?$/);
  if (m) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    return validDate(y, mo, d) ? { y, m: mo, d, ambiguous: false } : null;
  }

  // Numeric with separators: 03/04/2024, 3-4-24, 03.04.2024
  m = t.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const y = expandYear(Number(m[3]));
    const [d, mo] = order === "DMY" ? [a, b] : [b, a];
    if (!validDate(y, mo, d)) {
      // Try the swap — the stated order may simply be wrong for this cell.
      const [d2, mo2] = [mo, d];
      return validDate(y, mo2, d2) ? { y, m: mo2, d: d2, ambiguous: false } : null;
    }
    return { y, m: mo, d, ambiguous: a <= 12 && b <= 12 && a !== b };
  }

  // "3 Apr 2024" / "3 April 24"
  m = t.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{2,4})$/);
  if (m) {
    const mo = MONTHS[m[2]!.toLowerCase()];
    if (!mo) return null;
    const d = Number(m[1]);
    const y = expandYear(Number(m[3]));
    return validDate(y, mo, d) ? { y, m: mo, d, ambiguous: false } : null;
  }

  // "Apr 3, 2024"
  m = t.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{2,4})$/);
  if (m) {
    const mo = MONTHS[m[1]!.toLowerCase()];
    if (!mo) return null;
    const d = Number(m[2]);
    const y = expandYear(Number(m[3]));
    return validDate(y, mo, d) ? { y, m: mo, d, ambiguous: false } : null;
  }

  return null;
}

/**
 * Infer day/month order for a column by counting unambiguous numeric dates
 * (any with a component > 12). Defaults to DMY when nothing disambiguates —
 * refynr's initial market is UK.
 */
function inferOrder(values: string[]): "DMY" | "MDY" {
  let dmy = 0;
  let mdy = 0;
  for (const v of values) {
    const m = cleanWhitespace(v).match(
      /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/,
    );
    if (!m) continue;
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a > 12 && b <= 12) dmy++;
    else if (b > 12 && a <= 12) mdy++;
  }
  if (mdy > dmy) return "MDY";
  return "DMY";
}

function format(p: ParsedDate, out: "iso" | "uk" | "us"): string {
  const dd = String(p.d).padStart(2, "0");
  const mm = String(p.m).padStart(2, "0");
  if (out === "uk") return `${dd}/${mm}/${p.y}`;
  if (out === "us") return `${mm}/${dd}/${p.y}`;
  return `${p.y}-${mm}-${dd}`;
}

const OUTPUT_LABEL: Record<"iso" | "uk" | "us", string> = {
  iso: "ISO 8601 (YYYY-MM-DD)",
  uk: "UK format (DD/MM/YYYY)",
  us: "US format (MM/DD/YYYY)",
};

/**
 * Normalizes every recognisable date in date columns to one output format,
 * inferring day/month order per column from unambiguous values. Ambiguous
 * cells (e.g. 03/04/2024) get lower confidence so the UI can highlight them.
 * Unparseable values in date columns are flagged, never changed.
 */
export const dateFixer: Fixer = {
  rule: FIX_RULE,
  run({ table, profile, options }): FixerOutput {
    const patches: CellPatch[] = [];
    const impossible: { row: number; col: number; value: string }[] = [];
    let ambiguousCount = 0;
    const out = options.dateOutput;

    for (const col of profile.columns) {
      const nameHints = /date|dob|created|updated|joined/i.test(col.name);
      if (col.type !== "date" && !nameHints) continue;

      const columnValues: string[] = [];
      for (const row of table.rows) {
        const v = row[col.index];
        if (!isEmptyCell(v)) columnValues.push(String(v));
      }
      // Skip name-hinted columns that don't actually contain dates.
      if (col.type !== "date" && !columnValues.some((v) => looksLikeDate(v))) {
        continue;
      }

      const order: DateOrder =
        options.dateOrder === "auto" ? inferOrder(columnValues) : options.dateOrder;

      table.rows.forEach((row, r) => {
        const v = row[col.index];
        if (isEmptyCell(v) || typeof v !== "string") return;
        if (!looksLikeDate(v)) {
          impossible.push({ row: r, col: col.index, value: v });
          return;
        }
        const parsed = parseDate(v, order as "DMY" | "MDY");
        if (!parsed) {
          impossible.push({ row: r, col: col.index, value: v });
          return;
        }
        const formatted = format(parsed, out);
        if (formatted === cleanWhitespace(v)) return;
        if (parsed.ambiguous) ambiguousCount++;
        patches.push({
          kind: "cell",
          id: cellPatchId(FIX_RULE, r, col.index),
          rule: FIX_RULE,
          cell: { row: r, col: col.index },
          before: v,
          after: formatted,
          reason: parsed.ambiguous
            ? `Date read as ${order === "DMY" ? "day/month" : "month/day"} (inferred from other values in "${col.name}") and converted to ${OUTPUT_LABEL[out]}. Both readings were possible — worth a glance.`
            : `Date converted to ${OUTPUT_LABEL[out]} for consistency across the column.`,
          confidence: parsed.ambiguous ? 0.75 : 0.98,
        });
      });
    }

    const findings: Finding[] = [];
    if (patches.length > 0) {
      findings.push({
        rule: FIX_RULE,
        severity: "warning",
        title: `${n(patches.length, "date")} normalized`,
        detail:
          ambiguousCount > 0
            ? `${patches.length} dates were written in mixed formats and converted to ${OUTPUT_LABEL[out]}. ${ambiguousCount} were ambiguous (day and month both ≤ 12) — the day/month order was inferred from unambiguous dates in the same column, but review them before relying on the data.`
            : `${patches.length} dates were written in mixed formats and converted to ${OUTPUT_LABEL[out]}. Mixed date formats are the single most common cause of wrong analysis: Excel silently misreads them.`,
        count: patches.length,
        patchIds: patches.map((p) => p.id),
      });
    }
    if (impossible.length > 0) {
      const samples = impossible
        .slice(0, 3)
        .map((c) => `"${c.value}" (row ${c.row + 2})`)
        .join(", ");
      findings.push({
        rule: FLAG_RULE,
        severity: "error",
        title: `${n(impossible.length, "unreadable or impossible date")}`,
        detail: `${impossible.length} values in date columns could not be read as real dates (e.g. ${samples}). These may be typos (31/02/2024), placeholder text, or column drift. Refynr never guesses a date — review manually.`,
        count: impossible.length,
        column: impossible[0]!.col,
        cells: impossible.map((c) => ({ row: c.row, col: c.col })),
        patchIds: [],
      });
    }

    return { findings, patches };
  },
};
