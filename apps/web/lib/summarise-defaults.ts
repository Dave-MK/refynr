import { numericValue, type Table } from "@refynr/engine";

/**
 * Sensible starting choices for the summarise panel.
 *
 * These are pure and live here rather than in the component because getting
 * them wrong is quiet rather than loud: a bad default doesn't throw, it just
 * produces a summary that looks like it did nothing (group by a name column
 * and every row is its own group) or one that's nonsense (total the very
 * column you grouped by). Both shipped once; hence the tests.
 */

/** Sampled rows when judging a column's cardinality — enough to characterise a
 *  column without walking a 100k-row table on every panel open. */
const SAMPLE = 500;

function distinctCount(table: Table, col: number, rows: number): number {
  const seen = new Set<string>();
  for (let r = 0; r < rows; r++) {
    const v = table.rows[r]?.[col] ?? null;
    const text = v === null ? "" : String(v).trim().toLowerCase();
    if (text !== "") seen.add(text);
  }
  return seen.size;
}

/**
 * The column most likely to be a category worth grouping by: the fewest
 * distinct values, while still splitting the data into more than one group and
 * not being near-unique per row. Falls back to the first column when nothing
 * qualifies (every column unique, or a single row).
 */
export function suggestGroupColumn(table: Table): string[] {
  const rows = Math.min(table.rows.length, SAMPLE);
  if (rows === 0 || table.headers.length === 0) return table.headers.slice(0, 1);

  let best: { header: string; distinct: number } | null = null;
  for (let c = 0; c < table.headers.length; c++) {
    const distinct = distinctCount(table, c, rows);
    // Must actually group: more than one bucket, comfortably fewer than rows.
    if (distinct < 2 || distinct > rows * 0.6) continue;
    if (!best || distinct < best.distinct) {
      best = { header: table.headers[c]!, distinct };
    }
  }
  return best ? [best.header] : table.headers.slice(0, 1);
}

/** Columns whose numbers are labels, not quantities. Same intent as the engine's
 *  identifier heuristic in diff.ts / join.ts. */
const ID_ISH_RE =
  /(^|[^a-z])(id|ids|uid|ref|reference|code|sku|key|account|acct|no|number|postcode|phone|year)([^a-z]|$)/i;

function looksNumeric(table: Table, header: string): boolean {
  const col = table.headers.indexOf(header);
  if (col < 0) return false;
  const rows = Math.min(table.rows.length, 20);
  let numeric = 0;
  let seen = 0;
  for (let r = 0; r < rows; r++) {
    const v = table.rows[r]?.[col] ?? null;
    if (v === null || String(v).trim() === "") continue;
    seen++;
    if (numericValue(v) !== null) numeric++;
  }
  return seen > 0 && numeric / seen >= 0.8;
}

/**
 * The column most likely to be worth totalling: numeric, not a grouping key,
 * and not an identifier. Both exclusions come from real wrong answers — without
 * the first the panel offers "Sum of region" (a total of the column you just
 * grouped by); without the second it offers "Sum of Account No", which adds up
 * account numbers. An id-ish column is still used as a last resort, since
 * totalling something is better than offering nothing.
 */
export function suggestValueColumn(table: Table, by: string[]): string {
  const candidates = table.headers.filter((h) => !by.includes(h));
  const numeric = candidates.filter((h) => looksNumeric(table, h));

  return (
    numeric.find((h) => !ID_ISH_RE.test(h)) ??
    numeric[0] ??
    candidates[0] ??
    table.headers[0] ??
    ""
  );
}
