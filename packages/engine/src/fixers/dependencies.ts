import type { Finding } from "../types.js";
import { cellText, isEmptyCell } from "../table.js";
import { cleanWhitespace } from "./whitespace.js";
import { n, verb, type Fixer, type FixerOutput } from "./fixer.js";

const RULE = "inconsistent-mapping";

/** Column-pair sweep is quadratic in candidate columns; cap it. */
const MAX_CANDIDATE_COLUMNS = 12;
/** A determinant value needs this many rows before a minority reading counts. */
const MIN_GROUP = 3;
/** Dominant value must cover at least this share of a group to call the rest violations. */
const DOMINANT_SHARE = 0.8;
/** Pair-level: violations above this share mean the columns just aren't related. */
const MAX_VIOLATION_SHARE = 0.05;

interface Violation {
  row: number;
  key: string;
  expected: string;
  actual: string;
  expectedCount: number;
}

/**
 * Cross-column dependency check (Rahm & Do's "attribute dependency"
 * validation). When one column almost-determines another — the same postcode
 * always naming the same city, the same product code the same description —
 * the handful of rows that disagree are usually typos or stale edits.
 * Advisory only: which reading is correct is the user's call, so refynr
 * flags the disagreement and shows the majority value, never rewrites it.
 */
export const dependencyFixer: Fixer = {
  rule: RULE,
  run({ table, profile }): FixerOutput {
    const findings: Finding[] = [];
    const rowCount = table.rows.length;
    if (rowCount < 20) return { findings: [], patches: [] };

    // Candidate columns: categorical-ish (repeating values, not near-unique,
    // not constant). Deterministic selection order = column order.
    const candidates = profile.columns
      .filter(
        (c) =>
          c.distinct >= 2 &&
          c.distinct <= 500 &&
          c.nonEmpty >= rowCount * 0.5 &&
          c.nonEmpty / c.distinct >= 2,
      )
      .slice(0, MAX_CANDIDATE_COLUMNS);

    const norm = (v: unknown): string =>
      cleanWhitespace(cellText(v as never)).toLowerCase();

    for (const a of candidates) {
      for (const b of candidates) {
        if (a.index === b.index) continue;
        // A determinant should be at least as specific as what it determines
        // (postcode -> city, not city -> postcode).
        if (a.distinct < b.distinct) continue;

        // key(A) -> value(B) -> { count, firstDisplay, rows }
        const map = new Map<
          string,
          Map<string, { count: number; display: string; rows: number[] }>
        >();
        let paired = 0;
        for (let r = 0; r < rowCount; r++) {
          const va = table.rows[r]![a.index];
          const vb = table.rows[r]![b.index];
          if (isEmptyCell(va) || isEmptyCell(vb)) continue;
          paired++;
          const ka = norm(va);
          const kb = norm(vb);
          let inner = map.get(ka);
          if (!inner) map.set(ka, (inner = new Map()));
          const entry = inner.get(kb);
          if (entry) {
            entry.count++;
            entry.rows.push(r);
          } else {
            inner.set(kb, { count: 1, display: cleanWhitespace(cellText(vb as never)), rows: [r] });
          }
        }
        if (paired < 20) continue;

        const violations: Violation[] = [];
        let supported = 0; // rows in groups large enough to judge
        for (const [ka, inner] of map) {
          let total = 0;
          let dominant: { count: number; display: string } | null = null;
          for (const e of inner.values()) {
            total += e.count;
            if (!dominant || e.count > dominant.count) dominant = e;
          }
          if (total < MIN_GROUP || inner.size < 2) {
            if (total >= MIN_GROUP) supported += total;
            continue;
          }
          supported += total;
          if (dominant!.count / total < DOMINANT_SHARE) continue;
          for (const e of inner.values()) {
            if (e === dominant) continue;
            for (const r of e.rows) {
              violations.push({
                row: r,
                key: ka,
                expected: dominant!.display,
                actual: e.display,
                expectedCount: dominant!.count,
              });
            }
          }
        }

        if (violations.length === 0) continue;
        if (supported < paired * 0.5) continue; // too few judgeable groups
        if (violations.length > paired * MAX_VIOLATION_SHARE) continue; // not really dependent

        const ex = violations[0]!;
        findings.push({
          rule: RULE,
          severity: "warning",
          title: `"${b.name}": ${n(violations.length, "value")} ${verb(violations.length, "disagrees", "disagree")} with "${a.name}"`,
          detail: `Rows with the same "${a.name}" almost always share one "${b.name}", but ${n(violations.length, "row breaks", "rows break")} the pattern — e.g. row ${ex.row + 2} has "${ex.actual}" where ${ex.expectedCount} matching ${verb(ex.expectedCount, "row has", "rows have")} "${ex.expected}". Disagreements like this are usually typos or stale edits. Refynr can't know which reading is right, so this is flagged for review rather than fixed.`,
          count: violations.length,
          column: b.index,
          cells: violations.map((v) => ({ row: v.row, col: b.index })),
          patchIds: [],
        });
      }
    }

    return { findings, patches: [] };
  },
};
