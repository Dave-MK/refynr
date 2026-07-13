import type { CellValue, Table } from "./types.js";
import { cellText } from "./table.js";

/**
 * Column shape transforms — split one column into several, or merge several
 * into one. Unlike fixers these change the table's shape, so they can't be
 * expressed as cell patches; instead each returns a NEW table (the input is
 * never mutated) which the shell re-analyses as a fresh base. Both are pure
 * and deterministic.
 */

/** Cap on how many parts a split can produce, however messy the data. */
const MAX_PARTS = 8;

export interface SplitOptions {
  /** Separator to split on (plain text, not regex). Default: single space. */
  separator?: string;
  /** Names for the new columns; auto-generated from the source name if omitted. */
  names?: string[];
}

/**
 * Split `col` on a separator into as many columns as the data needs (the
 * widest row wins, capped at 8). Rows with fewer parts get nulls; the split
 * never throws data away — a row with MORE parts than the cap keeps the
 * remainder, separator included, in the last column.
 */
export function splitColumn(
  table: Table,
  col: number,
  options: SplitOptions = {},
): Table {
  if (col < 0 || col >= table.headers.length) return table;
  const separator = options.separator === undefined || options.separator === ""
    ? " "
    : options.separator;

  // First pass: how many columns does the widest row need?
  let parts = 1;
  const splitRows = table.rows.map((row) => {
    const text = cellText(row[col] ?? null);
    if (text === "") return [null] as CellValue[];
    const pieces = text.split(separator);
    if (pieces.length > MAX_PARTS) {
      // Keep the overflow, separator included, in the final part.
      const head = pieces.slice(0, MAX_PARTS - 1);
      head.push(pieces.slice(MAX_PARTS - 1).join(separator));
      pieces.length = 0;
      pieces.push(...head);
    }
    if (pieces.length > parts) parts = pieces.length;
    return pieces.map((p) => (p.trim() === "" ? null : p.trim())) as CellValue[];
  });

  if (parts === 1) return table; // nothing to split — leave the table alone

  const sourceName = table.headers[col] ?? `Column ${col + 1}`;
  const newNames = Array.from(
    { length: parts },
    (_, i) => options.names?.[i]?.trim() || `${sourceName} ${i + 1}`,
  );

  const headers = [
    ...table.headers.slice(0, col),
    ...newNames,
    ...table.headers.slice(col + 1),
  ];
  const rows = table.rows.map((row, r) => {
    const pieces = splitRows[r]!;
    const filled: CellValue[] = Array.from({ length: parts }, (_, i) => pieces[i] ?? null);
    return [...row.slice(0, col), ...filled, ...row.slice(col + 1)];
  });

  return { headers, rows };
}

export interface MergeOptions {
  /** Text placed between the merged values. Default: single space. */
  separator?: string;
  /** Name of the merged column; defaults to the source names joined. */
  name?: string;
}

/**
 * Merge the given columns (in the order supplied) into one, placed at the
 * position of the first. Empty cells are skipped rather than leaving doubled
 * separators ("Ann", "", "Lee" → "Ann Lee").
 */
export function mergeColumns(
  table: Table,
  cols: number[],
  options: MergeOptions = {},
): Table {
  const valid = [...new Set(cols)].filter((c) => c >= 0 && c < table.headers.length);
  if (valid.length < 2) return table;
  const separator = options.separator ?? " ";
  const target = valid[0]!;
  const dropped = new Set(valid.slice(1));

  const name =
    options.name?.trim() ||
    valid.map((c) => table.headers[c]).join(" ");

  const headers = table.headers
    .map((h, i) => (i === target ? name : h))
    .filter((_, i) => !dropped.has(i));

  const rows = table.rows.map((row) => {
    const merged = valid
      .map((c) => cellText(row[c] ?? null))
      .filter((s) => s !== "")
      .join(separator);
    return row
      .map((v, i) => (i === target ? (merged === "" ? null : merged) : v))
      .filter((_, i) => !dropped.has(i));
  });

  return { headers, rows };
}
