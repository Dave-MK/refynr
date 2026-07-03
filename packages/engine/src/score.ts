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
  "impossible-date": "validity",
  "trim-whitespace": "consistency",
  "consistent-casing": "consistency",
  "normalize-email": "consistency",
  "normalize-postcode": "consistency",
  "normalize-phone": "consistency",
  "normalize-date": "consistency",
  "remove-blank-rows": "completeness",
  "missing-values": "completeness",
  "remove-duplicate-rows": "uniqueness",
  "near-duplicate-rows": "uniqueness",
};

/**
 * `multiplier` controls how fast a dimension degrades as issues accumulate.
 * Validity errors are catastrophic (8× — ~12.5% bad cells zeroes it);
 * consistency issues are cosmetic-but-costly (3× — a sheet needs a third of
 * its cells inconsistent before hitting zero).
 */
const DIMENSION_META: Record<
  DimensionKey,
  { label: string; weight: number; multiplier: number }
> = {
  validity: { label: "Validity", weight: 0.35, multiplier: 8 },
  consistency: { label: "Consistency", weight: 0.25, multiplier: 3 },
  completeness: { label: "Completeness", weight: 0.25, multiplier: 6 },
  uniqueness: { label: "Uniqueness", weight: 0.15, multiplier: 8 },
};

const SEVERITY_WEIGHT = { error: 1, warning: 0.5, info: 0.15 } as const;

/**
 * Deterministic 0–100 score. Each dimension loses points in proportion to
 * (severity-weighted issues / total cells), so a 10-cell sheet with 5 bad
 * emails scores far worse than a 100k-cell sheet with the same 5.
 * Deterministic on purpose: the same file always gets the same score,
 * and the score after accepting patches is directly comparable.
 */
export function scoreTable(
  profile: TableProfile,
  findings: Finding[],
): HealthScore {
  const totalCells = Math.max(1, profile.rowCount * profile.columnCount);

  const dimensions: ScoreDimension[] = (
    Object.keys(DIMENSION_META) as DimensionKey[]
  ).map((key) => {
    const meta = DIMENSION_META[key];
    let weighted = 0;
    let issues = 0;
    for (const f of findings) {
      if (RULE_DIMENSION[f.rule] !== key) continue;
      issues += f.count;
      weighted += f.count * SEVERITY_WEIGHT[f.severity];
    }
    const penalty = Math.min(1, (weighted / totalCells) * meta.multiplier);
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
