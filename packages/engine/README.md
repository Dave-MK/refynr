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
| `trim-whitespace` | leading/trailing/repeated/invisible whitespace | |
| `remove-duplicate-rows` | exact duplicates (case/space-insensitive) | `near-duplicate-rows` (punctuation-only differences) |
| `remove-blank-rows` | fully empty rows | `missing-values` (gappy columns) |
| `consistent-casing` | case-only variants → most frequent spelling | |
| `normalize-date` | mixed formats → ISO/UK/US, per-column DMY/MDY inference | `impossible-date` (31/02/2024 etc.) |
| `normalize-email` | case, spaces, mailto: | `invalid-email` |
| `normalize-phone` | UK numbers → +44 conventional grouping | `invalid-phone` |
| `normalize-postcode` | UK postcodes → Royal Mail format | `invalid-postcode` |

## Options

```ts
interface EngineOptions {
  dateOrder?: "auto" | "DMY" | "MDY";   // "auto" infers per column, defaults DMY (UK)
  dateOutput?: "iso" | "uk" | "us";     // default "iso"
  disabledRules?: string[];
}
```

## Scoring

Four dimensions (validity 35%, consistency 25%, completeness 25%,
uniqueness 15%), each degraded in proportion to severity-weighted issues per
cell with a per-dimension multiplier (`src/score.ts`). Deterministic by
design: the same file always scores the same, and before/after scores are
directly comparable.

## Adding a fixer

See the "Adding a fixer" section in the repo root `CLAUDE.md`.

```sh
pnpm --filter @refynr/engine test    # vitest
pnpm --filter @refynr/engine build   # tsc → dist/
```
