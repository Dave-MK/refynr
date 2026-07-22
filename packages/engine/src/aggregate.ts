import type { CellValue, Finding, Table } from "./types.js";
import { cellText, isEmptyCell, isMissingSentinel } from "./table.js";
import { parseDecoratedNumber } from "./fixers/numbers.js";
import { n, verb } from "./fixers/fixer.js";

/**
 * Group-and-summarise, with the same refusal to guess as the rest of the engine.
 *
 * Summarising is where dirty data stops being visibly dirty: a total is a
 * single number, and it looks equally confident whether it added up every row
 * or silently skipped a third of them. The three ways that happens are all
 * invisible in the output —
 *
 *  - values that aren't numbers get dropped from a sum,
 *  - rows with no group key get dropped entirely (the default in most tools),
 *  - and a group with nothing to add up reports 0, which reads as "zero" when
 *    it means "nothing to go on".
 *
 * So `groupBy` reports all three, and refuses the third outright: the sum of no
 * values is blank, never 0. A blank makes someone ask; a 0 gets shipped.
 */

export type AggFn =
  | "count"
  | "count-distinct"
  | "sum"
  | "mean"
  | "median"
  | "min"
  | "max";

export interface Aggregation {
  fn: AggFn;
  /** Column to summarise, by header name. Not needed for "count". */
  column?: string;
  /** Output header. Generated from the function and column when omitted. */
  as?: string;
}

export interface GroupByOptions {
  /** Column header names to group by. Empty = one group over the whole table. */
  by: string[];
  aggregations: Aggregation[];
}

export interface GroupByDiagnostics {
  rowsIn: number;
  groups: number;
  /** Rows whose group key was blank or a sentinel — grouped, never dropped. */
  blankKeyRows: number;
  /** Values skipped because they weren't numeric, per numeric aggregation. */
  ignored: { label: string; column: string; count: number }[];
  /** Groups with no usable value, reported blank rather than 0, per aggregation. */
  emptyGroups: { label: string; column: string; groups: number }[];
}

export interface GroupByResult {
  table: Table;
  diagnostics: GroupByDiagnostics;
  findings: Finding[];
}

/** Composite group keys join on NUL so parts can't run together ("a b"+"c" vs
 *  "a"+"b c"). Built via fromCharCode — an escape would land literally. */
const SEP = String.fromCharCode(0);

/** Label used for a group whose key is blank or a placeholder. */
const BLANK_LABEL = "(blank)";

const NUMERIC_FNS = new Set<AggFn>(["sum", "mean", "median", "min", "max"]);

function defaultLabel(agg: Aggregation): string {
  const col = agg.column ?? "";
  switch (agg.fn) {
    case "count": return "Rows";
    case "count-distinct": return `Distinct ${col}`;
    case "sum": return `Sum of ${col}`;
    case "mean": return `Average of ${col}`;
    case "median": return `Median of ${col}`;
    case "min": return `Min of ${col}`;
    case "max": return `Max of ${col}`;
  }
}

/**
 * The numeric value of a cell, or null when there isn't one. Reuses the
 * number fixer's decoration stripping so "£1,200" and "(300)" count, while
 * "N/A" and "12 apples" are left out — and reported, never coerced to 0.
 */
export function numericValue(v: CellValue): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "boolean" || v === null) return null;
  const text = cellText(v).trim();
  if (text === "") return null;
  // parseDecoratedNumber returns null both for non-numbers AND for values that
  // needed no cleaning ("42"), so fall back to the raw text before parsing.
  const candidate = parseDecoratedNumber(text) ?? text;
  const num = Number(candidate);
  return Number.isFinite(num) ? num : null;
}

function median(sorted: number[]): number {
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

interface Group {
  /** Display values for the grouping columns, in `by` order. */
  key: CellValue[];
  rows: number;
  /** Numeric values collected per aggregation index (numeric fns only). */
  values: number[][];
  /** Distinct text values per aggregation index (count-distinct only). */
  distinct: (Set<string> | null)[];
}

/**
 * Group `table` by the given columns and summarise each group.
 *
 * Returns a NEW table — a shape change, like the joins and reshapes, so it
 * can't be expressed as cell patches. Pure and deterministic; the input is
 * never mutated. Groups come out in first-appearance order, which is stable
 * and keeps the original data's ordering legible.
 */
export function groupBy(table: Table, options: GroupByOptions): GroupByResult {
  const byCols = options.by
    .map((name) => ({ name, index: table.headers.indexOf(name) }))
    .filter((c) => c.index >= 0);

  const aggs = options.aggregations.filter(
    (a) => a.fn === "count" || (a.column !== undefined && table.headers.includes(a.column)),
  );

  if (aggs.length === 0) {
    return {
      table,
      diagnostics: {
        rowsIn: table.rows.length,
        groups: 0,
        blankKeyRows: 0,
        ignored: [],
        emptyGroups: [],
      },
      findings: [
        {
          rule: "group-no-aggregation",
          severity: "error",
          title: "Nothing to summarise",
          detail:
            "Choose at least one summary — a row count, or a total or average " +
            "of a column that exists in this data.",
          count: 1,
          patchIds: [],
        },
      ],
    };
  }

  const aggCols = aggs.map((a) =>
    a.column === undefined ? -1 : table.headers.indexOf(a.column),
  );

  const groups = new Map<string, Group>();
  const ignoredCounts = aggs.map(() => 0);
  let blankKeyRows = 0;

  for (let r = 0; r < table.rows.length; r++) {
    const row = table.rows[r]!;

    // Build the group key. A blank or placeholder key is its own group rather
    // than a dropped row — silently discarding keyless rows is how a total
    // ends up quietly short.
    const keyParts: string[] = [];
    const keyValues: CellValue[] = [];
    let rowHasBlankKey = false;
    for (const c of byCols) {
      const v = row[c.index] ?? null;
      if (isEmptyCell(v) || isMissingSentinel(v)) {
        rowHasBlankKey = true;
        keyParts.push(BLANK_LABEL);
        keyValues.push(null);
      } else {
        keyParts.push(cellText(v).trim().toLowerCase());
        keyValues.push(v);
      }
    }
    if (rowHasBlankKey) blankKeyRows++;

    const key = keyParts.join(SEP);
    let group = groups.get(key);
    if (!group) {
      group = {
        key: keyValues,
        rows: 0,
        values: aggs.map(() => []),
        distinct: aggs.map((a) => (a.fn === "count-distinct" ? new Set<string>() : null)),
      };
      groups.set(key, group);
    }
    group.rows++;

    for (let a = 0; a < aggs.length; a++) {
      const agg = aggs[a]!;
      if (agg.fn === "count") continue;
      const col = aggCols[a]!;
      const v = row[col] ?? null;

      if (agg.fn === "count-distinct") {
        if (!isEmptyCell(v) && !isMissingSentinel(v)) {
          group.distinct[a]!.add(cellText(v).trim().toLowerCase());
        }
        continue;
      }

      // Numeric functions: an empty cell is simply absent, but a NON-EMPTY
      // value that isn't a number is a data problem worth reporting.
      if (isEmptyCell(v) || isMissingSentinel(v)) continue;
      const num = numericValue(v);
      if (num === null) ignoredCounts[a]!++;
      else group.values[a]!.push(num);
    }
  }

  // ── Build the output table. ───────────────────────────────────────────────
  const headers = byCols.map((c) => c.name);
  for (const agg of aggs) headers.push(agg.as?.trim() || defaultLabel(agg));

  const emptyGroupCounts = aggs.map(() => 0);
  const rows: CellValue[][] = [];

  for (const group of groups.values()) {
    const out: CellValue[] = [];
    for (const v of group.key) out.push(v);

    for (let a = 0; a < aggs.length; a++) {
      const agg = aggs[a]!;
      if (agg.fn === "count") {
        out.push(group.rows);
        continue;
      }
      if (agg.fn === "count-distinct") {
        out.push(group.distinct[a]!.size);
        continue;
      }
      const values = group.values[a]!;
      if (values.length === 0) {
        // The honest answer. A 0 here would be indistinguishable from a real
        // zero total and would sail through every downstream check.
        emptyGroupCounts[a]!++;
        out.push(null);
        continue;
      }
      switch (agg.fn) {
        case "sum": {
          let total = 0;
          for (const v of values) total += v;
          out.push(total);
          break;
        }
        case "mean": {
          let total = 0;
          for (const v of values) total += v;
          out.push(total / values.length);
          break;
        }
        case "median": {
          const sorted = values.slice().sort((x, y) => x - y);
          out.push(median(sorted));
          break;
        }
        case "min": {
          let m = values[0]!;
          for (const v of values) if (v < m) m = v;
          out.push(m);
          break;
        }
        case "max": {
          let m = values[0]!;
          for (const v of values) if (v > m) m = v;
          out.push(m);
          break;
        }
      }
    }
    rows.push(out);
  }

  const ignored: GroupByDiagnostics["ignored"] = [];
  const emptyGroups: GroupByDiagnostics["emptyGroups"] = [];
  for (let a = 0; a < aggs.length; a++) {
    const agg = aggs[a]!;
    if (!NUMERIC_FNS.has(agg.fn)) continue;
    const label = agg.as?.trim() || defaultLabel(agg);
    if (ignoredCounts[a]! > 0) {
      ignored.push({ label, column: agg.column ?? "", count: ignoredCounts[a]! });
    }
    if (emptyGroupCounts[a]! > 0) {
      emptyGroups.push({ label, column: agg.column ?? "", groups: emptyGroupCounts[a]! });
    }
  }

  const diagnostics: GroupByDiagnostics = {
    rowsIn: table.rows.length,
    groups: groups.size,
    blankKeyRows,
    ignored,
    emptyGroups,
  };

  return { table: { headers, rows }, diagnostics, findings: buildFindings(diagnostics, byCols) };
}

/** Advisory findings only — a summary that ignored values is fixed by cleaning
 *  the column, never by refynr deciding what those values ought to have been. */
function buildFindings(
  d: GroupByDiagnostics,
  byCols: { name: string }[],
): Finding[] {
  const findings: Finding[] = [];

  for (const ig of d.ignored) {
    findings.push({
      rule: "group-ignored-values",
      severity: "warning",
      title: `${n(ig.count, "value")} left out of ${ig.label}`,
      detail:
        `${n(ig.count, "value", "values")} in "${ig.column}" ${verb(ig.count, "isn't", "aren't")} ` +
        `a number, so ${verb(ig.count, "it was", "they were")} left out of the summary. ` +
        `The total below is therefore of FEWER rows than the group contains — the single ` +
        `most common way a summary comes out quietly short. Clean that column and summarise again.`,
      count: ig.count,
      patchIds: [],
    });
  }

  for (const eg of d.emptyGroups) {
    findings.push({
      rule: "group-empty-result",
      severity: "warning",
      title: `${n(eg.groups, "group has", "groups have")} no value for ${eg.label}`,
      detail:
        `${verb(eg.groups, "This group", "These groups")} contained nothing usable to ` +
        `summarise in "${eg.column}", so the result is blank rather than 0. A zero here ` +
        `would be indistinguishable from a real zero total and would pass every check ` +
        `downstream — blank makes it obvious there was nothing to go on.`,
      count: eg.groups,
      patchIds: [],
    });
  }

  if (d.blankKeyRows > 0) {
    const names = byCols.map((c) => c.name).join(" + ");
    findings.push({
      rule: "group-blank-key",
      severity: "warning",
      title: `${n(d.blankKeyRows, "row has", "rows have")} no group`,
      detail:
        `"${names}" is blank or a placeholder in ${n(d.blankKeyRows, "row")}, so ` +
        `${verb(d.blankKeyRows, "it is", "they are")} shown together as "${BLANK_LABEL}" ` +
        `rather than dropped. Most tools discard these silently, which is why summarised ` +
        `totals so often fail to match the source.`,
      count: d.blankKeyRows,
      patchIds: [],
    });
  }

  return findings;
}
