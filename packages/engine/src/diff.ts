import type { CellValue, Table } from "./types.js";
import { cellText, isEmptyCell } from "./table.js";

/** One cell that differs between two versions of a row. */
export interface DiffCell {
  col: number;
  column: string;
  before: CellValue;
  after: CellValue;
}

export interface ChangedRow {
  key: string;
  beforeRow: number;
  afterRow: number;
  cells: DiffCell[];
}

export interface KeyedRow {
  key: string;
  row: number;
  values: CellValue[];
}

export interface TableDiff {
  /** Header name used to match rows across versions, or null for positional. */
  keyColumn: string | null;
  /** Columns present only in the new / only in the old version. */
  addedColumns: string[];
  removedColumns: string[];
  added: KeyedRow[];
  removed: KeyedRow[];
  changed: ChangedRow[];
  unchanged: number;
}

/** Column names that plausibly identify records. */
const ID_ISH_RE =
  /(^|[^a-z])(id|ids|uid|ref|reference|code|sku|key|account|acct|no|number|email)([^a-z]|$)/i;

/** True when the column's values are distinct within `table` (empties allowed
 *  beyond the first check the caller does). */
function distinctIn(table: Table, name: string): boolean {
  const idx = table.headers.indexOf(name);
  if (idx < 0) return false;
  const seen = new Set<string>();
  for (const row of table.rows) {
    const v = row[idx];
    if (isEmptyCell(v)) continue;
    const k = cellText(v).trim().toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
  }
  return true;
}

/** Pick a stable key column: prefer identifier-named columns, and require the
 *  values to be present + distinct in `before` AND distinct in `after` — a
 *  key that collapses on either side silently merges rows in the diff. */
function inferKey(before: Table, after: Table, shared: string[]): string | null {
  const ranked = [...shared].sort(
    (a, b) => (ID_ISH_RE.test(b) ? 1 : 0) - (ID_ISH_RE.test(a) ? 1 : 0),
  );
  for (const name of ranked) {
    const idx = before.headers.indexOf(name);
    const seen = new Set<string>();
    let ok = true;
    for (const row of before.rows) {
      const v = row[idx];
      if (isEmptyCell(v)) { ok = false; break; }
      const k = cellText(v).trim().toLowerCase();
      if (seen.has(k)) { ok = false; break; }
      seen.add(k);
    }
    if (
      ok &&
      seen.size === before.rows.length &&
      before.rows.length > 0 &&
      distinctIn(after, name)
    )
      return name;
  }
  return null;
}

/**
 * Compare two versions of a dataset — last export vs this one — and return a
 * reviewable, value-level diff: which rows were added, removed, or changed, and
 * exactly which cells moved. This is refynr's patch/review model pointed at
 * "what changed since last time?" instead of "raw vs cleaned" — the local-first,
 * human-in-the-loop answer to a question the pipeline-test tools don't ask.
 *
 * Rows are matched on a key column (given, or inferred as the first distinct
 * shared column). With no usable key it falls back to positional comparison.
 * Non-destructive: neither table is mutated.
 */
export function diffTables(
  before: Table,
  after: Table,
  keyColumnName?: string,
): TableDiff {
  const beforeSet = new Set(before.headers);
  const afterSet = new Set(after.headers);
  const shared = before.headers.filter((h) => afterSet.has(h));
  const addedColumns = after.headers.filter((h) => !beforeSet.has(h));
  const removedColumns = before.headers.filter((h) => !afterSet.has(h));

  const key =
    keyColumnName && shared.includes(keyColumnName)
      ? keyColumnName
      : inferKey(before, after, shared);

  // Column index lookups for the shared columns in each table.
  const cols = shared.map((name) => ({
    name,
    b: before.headers.indexOf(name),
    a: after.headers.indexOf(name),
  }));

  const added: KeyedRow[] = [];
  const removed: KeyedRow[] = [];
  const changed: ChangedRow[] = [];
  let unchanged = 0;

  const cellsDiffer = (
    bRow: CellValue[],
    aRow: CellValue[],
  ): DiffCell[] => {
    const diffs: DiffCell[] = [];
    for (const c of cols) {
      if (cellText(bRow[c.b] ?? null) !== cellText(aRow[c.a] ?? null)) {
        diffs.push({ col: c.a, column: c.name, before: bRow[c.b] ?? null, after: aRow[c.a] ?? null });
      }
    }
    return diffs;
  };

  if (key) {
    const kb = before.headers.indexOf(key);
    const ka = after.headers.indexOf(key);
    const keyOf = (v: CellValue) => cellText(v).trim().toLowerCase();

    const beforeByKey = new Map<string, number>();
    before.rows.forEach((row, r) => {
      const v = row[kb];
      if (!isEmptyCell(v)) beforeByKey.set(keyOf(v), r);
    });
    const afterKeys = new Set<string>();

    after.rows.forEach((aRow, ar) => {
      const v = aRow[ka];
      // A row with no key value can't be matched to a baseline row, so it
      // counts as added rather than silently vanishing from the diff.
      if (isEmptyCell(v)) {
        added.push({ key: "(no key)", row: ar, values: aRow });
        return;
      }
      const k = keyOf(v);
      afterKeys.add(k);
      const br = beforeByKey.get(k);
      if (br === undefined) {
        added.push({ key: cellText(v), row: ar, values: aRow });
      } else {
        const diffs = cellsDiffer(before.rows[br]!, aRow);
        if (diffs.length > 0) changed.push({ key: cellText(v), beforeRow: br, afterRow: ar, cells: diffs });
        else unchanged++;
      }
    });

    before.rows.forEach((bRow, br) => {
      const v = bRow[kb];
      // Likewise, an unmatchable keyless baseline row counts as removed.
      if (isEmptyCell(v)) {
        removed.push({ key: "(no key)", row: br, values: bRow });
        return;
      }
      if (!afterKeys.has(keyOf(v))) removed.push({ key: cellText(v), row: br, values: bRow });
    });
  } else {
    // Positional fallback.
    const min = Math.min(before.rows.length, after.rows.length);
    for (let i = 0; i < min; i++) {
      const diffs = cellsDiffer(before.rows[i]!, after.rows[i]!);
      if (diffs.length > 0) changed.push({ key: `row ${i + 2}`, beforeRow: i, afterRow: i, cells: diffs });
      else unchanged++;
    }
    for (let i = min; i < after.rows.length; i++)
      added.push({ key: `row ${i + 2}`, row: i, values: after.rows[i]! });
    for (let i = min; i < before.rows.length; i++)
      removed.push({ key: `row ${i + 2}`, row: i, values: before.rows[i]! });
  }

  return { keyColumn: key, addedColumns, removedColumns, added, removed, changed, unchanged };
}
