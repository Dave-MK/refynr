import type { CellPatch, DateOrder, Finding } from "../types.js";
import { isEmptyCell } from "../table.js";
import { looksLikeDate } from "../profile.js";
import { cleanWhitespace } from "./whitespace.js";
import { cellPatchId, n, verb, type Fixer, type FixerOutput } from "./fixer.js";

const FIX_RULE = "normalize-date";
const FLAG_RULE = "impossible-date";
const AMBIGUOUS_RULE = "ambiguous-date";

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
  /** True when the value only parsed in the OPPOSITE order to the one asked
   *  for (e.g. 12/25/2024 in a day-first column) — evidence the file mixes
   *  date locales, so the patch must say so and carry lower confidence. */
  swapped?: boolean;
  /** True when the value carried a time with an explicit UTC offset that was
   *  converted to the UTC calendar day before the time was dropped. */
  tzConverted?: boolean;
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

  // ISO: 2024-04-03 (optionally with time — time is discarded). When the time
  // carries an explicit UTC offset, the instant is converted to UTC first:
  // 2024-03-01T01:15:00+05:00 is 2024-02-29 in UTC, and truncating without
  // converting would silently move events across a calendar day.
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})([T ].*)?$/);
  if (m) {
    const time = m[4] ?? "";
    if (/(?:Z|[+-]\d{2}:?\d{2})\s*$/i.test(time)) {
      const instant = new Date(t.replace(" ", "T"));
      if (!Number.isNaN(instant.getTime())) {
        return {
          y: instant.getUTCFullYear(),
          m: instant.getUTCMonth() + 1,
          d: instant.getUTCDate(),
          ambiguous: false,
          tzConverted: true,
        };
      }
    }
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
      // Only parseable in the opposite order — a mixed-locale signal, so the
      // result is marked `swapped` rather than passed off as routine.
      const [d2, mo2] = [mo, d];
      return validDate(y, mo2, d2)
        ? { y, m: mo2, d: d2, ambiguous: false, swapped: true }
        : null;
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
 * refynr's initial market is UK. Also reports whether the column contains
 * unambiguous evidence of BOTH orders — a mixed-locale export, where the
 * inferred order can't be trusted for ambiguous cells.
 */
function inferOrder(values: string[]): {
  order: "DMY" | "MDY";
  mixed: boolean;
} {
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
  return { order: mdy > dmy ? "MDY" : "DMY", mixed: dmy > 0 && mdy > 0 };
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
    const unresolved: { row: number; col: number; value: string }[] = [];
    let ambiguousCount = 0;
    let swappedCount = 0;
    let tzCount = 0;
    let mixedColumns = 0;
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

      const auto = options.dateOrder === "auto";
      const inferred = inferOrder(columnValues);
      const order: DateOrder = auto ? inferred.order : options.dateOrder;
      // A column with unambiguous evidence of BOTH orders is a mixed-locale
      // export: the inferred order is a coin toss for ambiguous cells, so
      // those are flagged for the user instead of guessed. (An explicit
      // dateOrder from the user overrides this — they've made the call.)
      const mixed = auto && inferred.mixed;
      if (mixed) mixedColumns++;

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
        if (mixed && parsed.ambiguous) {
          unresolved.push({ row: r, col: col.index, value: v });
          return;
        }
        const formatted = format(parsed, out);
        if (formatted === cleanWhitespace(v)) return;
        if (parsed.ambiguous) ambiguousCount++;
        if (parsed.swapped) swappedCount++;
        if (parsed.tzConverted) tzCount++;

        let reason: string;
        let confidence: number;
        if (parsed.swapped) {
          reason = `Read as ${order === "DMY" ? "month/day" : "day/month"} — the digits are impossible in the ${order === "DMY" ? "day/month" : "month/day"} order the rest of "${col.name}" uses (a month can't exceed 12). This usually means the file mixes date locales; check the source before trusting this cell.`;
          confidence = 0.7;
        } else if (parsed.tzConverted) {
          reason = `Timestamp converted to its UTC calendar day, then the time and timezone were removed for ${OUTPUT_LABEL[out]}. The original carried a UTC offset, so truncating without converting could have landed on the wrong day.`;
          confidence = 0.9;
        } else if (parsed.ambiguous) {
          reason = `Date read as ${order === "DMY" ? "day/month" : "month/day"} (inferred from other values in "${col.name}") and converted to ${OUTPUT_LABEL[out]}. Both readings were possible — worth a glance.`;
          confidence = 0.75;
        } else {
          reason = `Date converted to ${OUTPUT_LABEL[out]} for consistency across the column.`;
          confidence = 0.98;
        }
        patches.push({
          kind: "cell",
          id: cellPatchId(FIX_RULE, r, col.index),
          rule: FIX_RULE,
          cell: { row: r, col: col.index },
          before: v,
          after: formatted,
          reason,
          confidence,
        });
      });
    }

    const findings: Finding[] = [];
    if (patches.length > 0) {
      const extras: string[] = [];
      if (ambiguousCount > 0) {
        extras.push(
          `${ambiguousCount} were ambiguous (day and month both ≤ 12) — the day/month order was inferred from unambiguous dates in the same column, but review them before relying on the data.`,
        );
      }
      if (swappedCount > 0) {
        extras.push(
          `${n(swappedCount, "value was", "values were")} written in the OPPOSITE day/month order to the rest of the column — the file likely mixes locales (e.g. a US export edited in the UK). These carry lower confidence; check them.`,
        );
      }
      if (tzCount > 0) {
        extras.push(
          `${n(tzCount, "timestamp")} carried a timezone offset and ${verb(tzCount, "was", "were")} converted to the UTC calendar day before the time was removed.`,
        );
      }
      findings.push({
        rule: FIX_RULE,
        severity: "warning",
        title: `${n(patches.length, "date")} normalized`,
        detail:
          extras.length > 0
            ? `${patches.length} dates were written in mixed formats and converted to ${OUTPUT_LABEL[out]}. ${extras.join(" ")}`
            : `${patches.length} dates were written in mixed formats and converted to ${OUTPUT_LABEL[out]}. Mixed date formats are the single most common cause of wrong analysis: Excel silently misreads them.`,
        count: patches.length,
        patchIds: patches.map((p) => p.id),
      });
    }
    if (unresolved.length > 0) {
      const samples = unresolved
        .slice(0, 3)
        .map((c) => `"${c.value}" (row ${c.row + 2})`)
        .join(", ");
      findings.push({
        rule: AMBIGUOUS_RULE,
        severity: "warning",
        title: `${n(unresolved.length, "date")} left unresolved — column mixes day-first and month-first`,
        count: unresolved.length,
        detail: `${mixedColumns === 1 ? "A date column contains" : "Date columns contain"} unambiguous dates in BOTH day-first and month-first order, so the order of ${n(unresolved.length, "ambiguous value", "ambiguous values")} (day and month both ≤ 12, e.g. ${samples}) can't be inferred safely. Refynr never guesses when the evidence conflicts — set the date order explicitly in settings, or fix the source export's locale.`,
        column: unresolved[0]!.col,
        cells: unresolved.map((c) => ({ row: c.row, col: c.col })),
        patchIds: [],
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
