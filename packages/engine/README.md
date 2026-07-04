# @refynr/engine

The refynr core: pure TypeScript, zero runtime dependencies, no DOM or Node
APIs — runs identically in the browser, a Web Worker, an extension side panel,
and on the server.

## Usage

```ts
import { cleanse, applyPatches, fromDelimitedText } from "@refynr/engine";

const table = fromDelimitedText(pastedText); // or build {headers, rows} yourself
const result = cleanse(table, { dateOutput: "iso" });

result.score.overall;        // 0–100 health score, deterministic
result.projectedScore;       // score if every patch were accepted
result.findings;             // human-readable issues, severity, counts
result.patches;              // proposed changes — nothing is applied yet

// The cleaned table is always original + accepted patches:
const acceptedIds = new Set(result.patches.map((p) => p.id));
const cleaned = applyPatches(table, result.patches, acceptedIds);
```

The input table is never mutated. Every patch carries `before`, `after`,
`rule`, a human-readable `reason`, and a `confidence` (0–1) — deterministic
fixes are 1.0, inferred fixes (e.g. ambiguous date order) are lower so UIs can
highlight them.

## Rules

| Rule | Fixes | Flags (advisory, never guessed) |
|---|---|---|
| `fix-encoding` | mojibake (UTF-8 read as CP1252: "â€™", "Ã©", "Â£") via validated reverse-decode | |
| `trim-whitespace` | leading/trailing/repeated/invisible whitespace | |
| `remove-duplicate-rows` | exact duplicates (case/space-insensitive) | `near-duplicate-rows` (punctuation-only differences) |
| `remove-blank-rows` | fully empty rows | `missing-values` (gappy columns) |
| `consistent-casing` | case-only variants → most frequent spelling | |
| `normalize-date` | mixed formats → ISO/UK/US, per-column DMY/MDY inference | `impossible-date` (31/02/2024 etc.) |
| `normalize-email` | case, spaces, mailto: | `invalid-email` |
| `normalize-phone` | UK numbers → +44 conventional grouping | `invalid-phone` |
| `normalize-postcode` | UK postcodes → Royal Mail format | `invalid-postcode` |
| `suspect-leading-zeros` | | ID columns where Excel likely stripped leading zeros |
| `numeric-outliers` | | values outside 3× IQR (unit mix-ups, stray decimals, placeholders) |

## Options

```ts
interface EngineOptions {
  dateOrder?: "auto" | "DMY" | "MDY";   // "auto" infers per column, defaults DMY (UK)
  dateOutput?: "iso" | "uk" | "us";     // default "iso"
  disabledRules?: string[];
}
```

## Scoring

Four DAMA-DMBOK dimensions, each an honest pass rate (clean units ÷ total
units) with a severity weighting and a sensitivity factor so a few bad cells
in a wide sheet still register (`src/score.ts`):

| Dimension | Weight | Basis | Scored from |
|---|---|---|---|
| Consistency | 30% | cells | whitespace, casing, encoding, format normalisation |
| Completeness | 25% | cells | blank rows, missing values |
| Validity | 25% | cells | invalid emails/phones/postcodes, impossible dates, outliers |
| Uniqueness | 20% | rows | exact + near-duplicate rows |

Two properties make the score honest and useful:

- **Weighted toward what's fixable.** Consistency, completeness, and
  uniqueness (75% between them) are the dimensions refynr can remediate, so a
  messy sheet scores low *because of fixable problems* — and accepting the
  fixes produces a large, real gain (the deliberately-filthy sample data goes
  62 → 95). Validity failures are advisory (never auto-guessed), so they
  inform the score without anchoring the ceiling out of reach.
- **Stable basis → remediation only ever raises the score.** Both the current
  and projected scores use the *original* table's denominator. Deriving it
  from the cleaned table would shrink it as rows are removed, making the
  surviving advisory issues penalise harder — cleaning the data would
  paradoxically lower the score. `scoreTable(profile, findings, basis?)` takes
  an explicit `basis`; `cleanse()` pins it to the original for both scores.

Deterministic: the same file always scores the same.

## Adding a fixer

See the "Adding a fixer" section in the repo root `CLAUDE.md`.

```sh
pnpm --filter @refynr/engine test    # vitest
pnpm --filter @refynr/engine build   # tsc → dist/
```
