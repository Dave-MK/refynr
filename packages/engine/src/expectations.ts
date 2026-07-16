import type { CellRef, Constraint, Finding, Table, TableProfile } from "./types.js";
import { cellText, isEmptyCell } from "./table.js";
import { n, verb } from "./fixers/fixer.js";

/** Constraint kind → the rule string used for scoring and display. */
const RULE: Record<Constraint["type"], string> = {
  "not-null": "constraint-not-null",
  unique: "constraint-unique",
  regex: "constraint-regex",
  range: "constraint-range",
  "allowed-values": "constraint-allowed-values",
};

function describe(c: Constraint): string {
  switch (c.type) {
    case "not-null":
      return "must not be blank";
    case "unique":
      return "must be unique";
    case "regex":
      return `must match /${c.pattern ?? ""}/`;
    case "range": {
      const lo = c.min !== undefined ? `≥ ${c.min}` : "";
      const hi = c.max !== undefined ? `≤ ${c.max}` : "";
      return `must be ${[lo, hi].filter(Boolean).join(" and ")}`;
    }
    case "allowed-values":
      return `must be one of: ${(c.values ?? []).join(", ")}`;
  }
}

const ID_ISH_RE =
  /(^|[^a-z])(id|ids|ref|reference|code|sku|key|account|acct|no|number)([^a-z]|$)/i;

/** Most suggestions beyond this are noise — keep the list glanceable. */
const MAX_SUGGESTIONS = 5;

/**
 * Mine candidate constraints from what already holds in the data — the
 * "rule discovery" step the literature says shouldn't be left entirely to
 * hand-authoring. Each suggestion is true of the current table (so adding it
 * passes today and guards future exports) and is only ever *suggested*: the
 * user reviews and adds it, refynr never asserts a rule on its own.
 *
 * Deterministic, and deliberately conservative: unique only for columns that
 * plausibly identify records (id-ish names, emails), allowed-values only for
 * small categorical sets, not-null only for key-like columns that are 100%
 * filled. Pass the user's existing constraints to avoid re-suggesting them.
 */
export function suggestConstraints(
  table: Table,
  profile: TableProfile,
  existing: Constraint[] = [],
): Constraint[] {
  const out: Constraint[] = [];
  const has = (column: string, type: Constraint["type"]): boolean =>
    existing.some((c) => c.column === column && c.type === type) ||
    out.some((c) => c.column === column && c.type === type);
  const rows = profile.rowCount;
  if (rows < 10) return out;

  for (const col of profile.columns) {
    if (out.length >= MAX_SUGGESTIONS) break;
    const keyish = ID_ISH_RE.test(col.name) || col.type === "email";

    // unique: every non-empty value is distinct, the column is mostly filled,
    // and it plausibly identifies records.
    if (
      keyish &&
      col.nonEmpty >= 10 &&
      col.distinct === col.nonEmpty &&
      col.nonEmpty >= rows * 0.9 &&
      !has(col.name, "unique")
    ) {
      out.push({ column: col.name, type: "unique" });
    }

    // allowed-values: a small categorical set used repeatedly.
    if (
      out.length < MAX_SUGGESTIONS &&
      (col.type === "string" || col.type === "boolean") &&
      col.distinct >= 2 &&
      col.distinct <= 6 &&
      col.nonEmpty >= col.distinct * 3 &&
      !has(col.name, "allowed-values")
    ) {
      // Collect the distinct display values (first-seen casing), capped.
      const values: string[] = [];
      const seen = new Set<string>();
      for (const row of table.rows) {
        const v = row[col.index];
        if (isEmptyCell(v)) continue;
        const display = cellText(v).trim();
        const key = display.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        values.push(display);
        if (values.length > 6) break;
      }
      if (values.length >= 2 && values.length <= 6) {
        out.push({ column: col.name, type: "allowed-values", values });
      }
    }

    // not-null: a key-like column that is completely filled today.
    if (
      out.length < MAX_SUGGESTIONS &&
      keyish &&
      col.empty === 0 &&
      col.nonEmpty >= 10 &&
      !has(col.name, "not-null")
    ) {
      out.push({ column: col.name, type: "not-null" });
    }
  }

  return out;
}

/**
 * Evaluate user-defined constraints against a table and return advisory
 * findings — the "expectations-lite" layer that lets refynr assert simple
 * data-quality rules (not-null, unique, regex, range, allowed-values) the way
 * Great Expectations / Soda do, but no-code and non-destructive. A violation
 * is flagged for the user to resolve; refynr never invents a value to satisfy
 * a rule (that would break the "advisory findings never auto-fix" contract).
 */
export function checkConstraints(
  table: Table,
  profile: TableProfile,
  constraints: Constraint[],
): Finding[] {
  const findings: Finding[] = [];
  const byName = new Map(profile.columns.map((c) => [c.name, c.index]));

  for (const c of constraints) {
    const col = byName.get(c.column);
    if (col === undefined) {
      findings.push({
        rule: RULE[c.type],
        severity: "warning",
        title: `Constraint refers to a missing column "${c.column}"`,
        detail: `The rule "${c.column} ${describe(c)}" can't be checked — there's no column named "${c.column}" in this data. Rename the column or update the rule.`,
        count: 0,
        patchIds: [],
      });
      continue;
    }

    const bad: CellRef[] = [];
    let re: RegExp | null = null;
    if (c.type === "regex" && c.pattern) {
      try {
        re = new RegExp(c.pattern);
      } catch {
        findings.push({
          rule: RULE.regex,
          severity: "warning",
          title: `Invalid pattern in constraint for "${c.column}"`,
          detail: `"${c.pattern}" isn't a valid regular expression, so the rule couldn't run.`,
          count: 0,
          column: col,
          patchIds: [],
        });
        continue;
      }
    }

    const seen = new Map<string, number>();
    // Allowed-values compares trimmed + case-folded (like the unique rule):
    // whitespace/case drift is a defect the fixers already handle, and the
    // suggestion miner dedupes values the same way — a suggested rule must
    // keep passing on the very data it was mined from.
    const allowed =
      c.type === "allowed-values"
        ? new Set((c.values ?? []).map((v) => v.trim().toLowerCase()))
        : null;
    table.rows.forEach((row, r) => {
      const v = row[col];
      const empty = isEmptyCell(v);
      switch (c.type) {
        case "not-null":
          if (empty) bad.push({ row: r, col });
          break;
        case "unique": {
          if (empty) break;
          const key = cellText(v).trim().toLowerCase();
          const first = seen.get(key);
          if (first !== undefined) bad.push({ row: r, col });
          else seen.set(key, r);
          break;
        }
        case "regex":
          if (!empty && re && !re.test(cellText(v))) bad.push({ row: r, col });
          break;
        case "range": {
          if (empty) break;
          const num = Number(cellText(v).replace(/[£$€,%\s]/g, ""));
          if (
            Number.isNaN(num) ||
            (c.min !== undefined && num < c.min) ||
            (c.max !== undefined && num > c.max)
          )
            bad.push({ row: r, col });
          break;
        }
        case "allowed-values":
          if (!empty && !allowed!.has(cellText(v).trim().toLowerCase()))
            bad.push({ row: r, col });
          break;
      }
    });

    if (bad.length > 0) {
      const rows = bad.slice(0, 3).map((b) => b.row + 2).join(", ");
      findings.push({
        rule: RULE[c.type],
        severity: "error",
        title: `"${c.column}" ${describe(c)} — ${n(bad.length, "row fails", "rows fail")}`,
        detail: `${n(bad.length, "value")} in "${c.column}" ${verb(bad.length, "breaks", "break")} your rule that it ${describe(c)} (e.g. row ${rows}). This is your expectation, so refynr flags it for you to resolve rather than changing the data.`,
        count: bad.length,
        column: col,
        cells: bad,
        patchIds: [],
      });
    }
  }

  return findings;
}
