import type {
  Finding,
  HealthScore,
  ScoreDimension,
  TableProfile,
} from "./types.js";

type DimensionKey = ScoreDimension["key"];

const RULE_DIMENSION: Record<string, DimensionKey> = {
  "fix-encoding": "consistency",
  "suspect-leading-zeros": "validity",
  "numeric-outliers": "validity",
  "invalid-email": "validity",
  "invalid-postcode": "validity",
  "invalid-phone": "validity",
  "invalid-vat": "validity",
  "invalid-sort-code": "validity",
  "invalid-company-number": "validity",
  "impossible-date": "validity",
  "trim-whitespace": "consistency",
  "consistent-casing": "consistency",
  "normalize-email": "consistency",
  "normalize-postcode": "consistency",
  "normalize-vat": "consistency",
  "normalize-sort-code": "consistency",
  "normalize-company-number": "consistency",
  "normalize-phone": "consistency",
  "normalize-date": "consistency",
  "normalize-number": "consistency",
  "normalize-boolean": "consistency",
  "header-hygiene": "consistency",
  "remove-blank-rows": "completeness",
  "missing-values": "completeness",
  "remove-duplicate-rows": "uniqueness",
  "near-duplicate-rows": "uniqueness",
  "constraint-not-null": "completeness",
  "constraint-unique": "uniqueness",
  "constraint-regex": "validity",
  "constraint-range": "validity",
  "constraint-allowed-values": "validity",
};

/**
 * Four DAMA-DMBOK data-quality dimensions. Each is scored as an honest
 * pass rate — (clean units / total units) — with a `sensitivity` factor
 * that amplifies the penalty (a handful of bad cells in a wide sheet should
 * still visibly dent the score, the way Soda/Great Expectations surface a
 * failing check rather than rounding it away).
 *
 * `basis` is the denominator scale: uniqueness is a *row*-level property
 * (a duplicate is a whole bad row), the others are *cell*-level.
 *
 * Weights lean toward the dimensions refynr can actually remediate
 * (consistency, completeness, uniqueness = 75% between them) so that a
 * messy sheet scores low *because of fixable problems* — and accepting the
 * fixes therefore produces a large, honest gain. Validity carries real but
 * minority weight: its failures (invalid emails, impossible dates) are
 * advisory and never auto-guessed, so they should inform the score without
 * anchoring the ceiling out of remediation's reach.
 */
const DIMENSION_META: Record<
  DimensionKey,
  { label: string; weight: number; sensitivity: number; basis: "cells" | "rows" }
> = {
  validity: { label: "Validity", weight: 0.25, sensitivity: 3, basis: "cells" },
  consistency: { label: "Consistency", weight: 0.3, sensitivity: 4, basis: "cells" },
  completeness: { label: "Completeness", weight: 0.25, sensitivity: 4, basis: "cells" },
  uniqueness: { label: "Uniqueness", weight: 0.2, sensitivity: 5, basis: "rows" },
};

const SEVERITY_WEIGHT = { error: 1, warning: 0.5, info: 0.2 } as const;

/** Denominator scale for a score. Pass the ORIGINAL table's counts when
 *  scoring a cleaned/patched table so the two scores share one basis and
 *  remediation can only ever raise the score (never shrink the denominator). */
export interface ScoreBasis {
  cells: number;
  rows: number;
}

export function basisOf(profile: TableProfile): ScoreBasis {
  return {
    cells: Math.max(1, profile.rowCount * profile.columnCount),
    rows: Math.max(1, profile.rowCount),
  };
}

/**
 * Deterministic 0–100 health score. Same input always scores the same, and
 * — crucially — a score computed on the patched table with the ORIGINAL
 * basis is directly comparable to the score on the original table: every
 * accepted fix moves a failing unit to passing, so the score can only rise.
 */
export function scoreTable(
  profile: TableProfile,
  findings: Finding[],
  basis: ScoreBasis = basisOf(profile),
): HealthScore {
  const dimensions: ScoreDimension[] = (
    Object.keys(DIMENSION_META) as DimensionKey[]
  ).map((key) => {
    const meta = DIMENSION_META[key];
    const denom = meta.basis === "rows" ? basis.rows : basis.cells;
    let weighted = 0;
    let issues = 0;
    for (const f of findings) {
      if (RULE_DIMENSION[f.rule] !== key) continue;
      issues += f.count;
      weighted += f.count * SEVERITY_WEIGHT[f.severity];
    }
    const penalty = Math.min(1, (weighted / denom) * meta.sensitivity);
    return {
      key,
      label: meta.label,
      score: Math.round((1 - penalty) * 100),
      issues,
    };
  });

  const overall = Math.round(
    dimensions.reduce(
      (sum, d) => sum + d.score * DIMENSION_META[d.key].weight,
      0,
    ),
  );

  return { overall, dimensions };
}
