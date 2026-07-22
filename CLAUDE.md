# refynr — working notes

Non-destructive spreadsheet data-quality tool ("Grammarly for spreadsheets").
UK-first market. pnpm + Turborepo monorepo.

## Commands

```sh
pnpm install
pnpm build                              # turbo build, all packages
pnpm test                               # engine unit tests (vitest)
pnpm typecheck                          # all packages
pnpm --filter @refynr/web dev           # web app on :3000
pnpm --filter @refynr/extension dev     # extension dev mode
pnpm --filter @refynr/engine test       # engine tests only
pnpm --filter @refynr/cli build         # build the headless CLI
node packages/cli/dist/cli.js --help    # CLI: `clean` + `diff`, CI gates
```

## Engine invariants added by the Jul-2026 audit fixes (don't regress)

- **Sentinel nulls** (`isMissingSentinel` in `table.ts`): NA/N-A/NULL/None/
  nan/nil/-/-- count as missing everywhere — profile (`empty` includes them,
  `sentinels` counts them), completeness score, and reviewable blank-out
  patches (`normalize-missing`, info severity, deliberately NOT score-mapped
  to avoid double-counting with `missing-values`).
- **Delimiter sniffing** (`fromDelimitedText`): tab/comma/semicolon/pipe by
  modal-width consistency; tab wins ties (spreadsheet paste). Non-empty rows
  whose field count ≠ header's land in `Table.parseIssues.raggedRows` → the
  advisory `ragged-rows` finding (carried through to the projected score —
  no patch can fix source structure).
- **Near-dup typo evidence** (`duplicates.ts`): identifier-ish columns
  (distinct/nonEmpty ≥ 0.9 with ≥10 rows, or id-named + all-distinct) and
  digit-only tokens are EXCLUDED from the context fingerprint; identical
  contexts never union (ID-differs = distinct records, dedupeKey territory);
  fingerprints under 6 chars carry no typo evidence. Full-fingerprint
  collision clustering (word reorder/punctuation) is unchanged.
- **Date honesty** (`dates.ts`): a value parseable only in the opposite order
  gets confidence 0.7 + a "mixes date locales" reason; in auto mode a column
  with unambiguous evidence of BOTH orders flags its ambiguous cells
  (`ambiguous-date`, advisory) instead of guessing; offset-bearing timestamps
  convert to the UTC calendar day before truncation.
- **Scoring** (`score.ts`): dimensions use the smooth penalty
  `100·(1−rate)^sensitivity` (no min(1,…) cliff — monotone, rankable);
  the composite is a weighted GEOMETRIC mean (scores floored at 1) so a
  cratered dimension can't be averaged away; `near-duplicate-rows` carries a
  0.4 rule-weight dampener (probabilistic signal, not confirmed defect).
- **`EngineOptions.projection: "none"`** skips the projected-score second
  pass (CLI residual checks use it; the web UI needs "full").
- **Audit counts distinct units**: `buildReport` counts distinct cells/rows
  touched, never patches (two rules can patch one cell).
- Recipes carry `engineVersion` (`ENGINE_VERSION` in `recipe.ts` — bump it
  when fixer behaviour changes; `parseRecipe` preserves the original).

## Engine capabilities beyond fixers

The engine (`packages/engine`) also exports, all pure and deterministic:
- **Recipes** (`recipe.ts`): `createRecipe` / `serializeRecipe` / `parseRecipe`
  / `runRecipe`. A recipe is re-runnable config (options + skipped rules +
  constraints) with **no cell data** — safe to store/share. Web shell keeps a
  browser-local library (`apps/web/lib/recipes.ts`); the CLI replays them.
  **`RECIPE_VERSION` is 2** (added optional `join`). `parseRecipe` migrates
  anything from `OLDEST_READABLE_VERSION` (1) forward and only rejects recipes
  from a *newer* build — bumping the version must never orphan saved recipes,
  since `loadRecipes` silently drops entries that fail to parse. A recipe's
  `join` stores the join's SHAPE only (key names + type + a `with` label), never
  the other dataset, so the "no cell data" guarantee holds; the dataset is
  supplied at replay (`runRecipe(table, recipe, joinWith)`, `--join-with` on the
  CLI). `runRecipe` THROWS when a join recipe gets no dataset rather than
  quietly cleaning an unjoined table.
- **Expectations** (`expectations.ts`): `checkConstraints` — user-defined
  pass/fail rules (`Constraint`: not-null/unique/regex/range/allowed-values),
  threaded via `EngineOptions.constraints`. Advisory only (never auto-fix).
  `suggestConstraints(table, profile, existing)` mines candidate rules that
  already hold (unique/not-null for id-ish columns, allowed-values for small
  categorical sets, ≤5 suggestions) — the web shell offers them as one-click
  chips under the expectations editor.
- **Key-column dedupe** (`EngineOptions.dedupeKey`): column **names** that
  define "duplicate" — rows matching on just those columns are removal
  patches; empty = whole-row. Names (resolved to indices inside the engine,
  unknown names ignored) so keys survive recipes, reshapes, and reordered
  re-exports. Saved in recipes. UI is the "duplicates match on" chip row.
- **Dataset diff** (`diff.ts`): `diffTables(before, after, key?)` — value-level
  added/removed/changed/unchanged, key inferred or given. The "what changed
  since last export?" wedge.
- **Relational join** (`join.ts`): `joinTables(left, right, options)` →
  `{ table, diagnostics, findings }`, plus `inferJoinKeys`. Shape change, so a
  NEW table (like `transform.ts`), never patches. The value is the **diagnosis**,
  not the join: every unmatched left row is retested against progressively laxer
  right-hand keys, so a miss is labelled `zero-padding` / `numeric-format` /
  `punctuation` (fixable formatting difference, with the key it *would* have
  matched) rather than lumped in with `absent` (genuinely missing record) or
  `empty-key` (blank/sentinel key). Fan-out (1:many row multiplication) and
  matches that only survived case/whitespace folding are reported too. All
  findings are `patchIds: []` — a join problem is fixed by better keys or a
  cleaner key column, never by inventing a match; and they are deliberately NOT
  score-mapped (an unmatched row's empty cells are already counted by
  completeness). Key inference ranks shared columns by overlap measured on a
  LOOSE form, so a column pair that only lines up once formatting noise is
  ignored is still chosen — letting the join explain the mismatch instead of
  refusing with "no column to join on". Composite keys join on NUL
  (`String.fromCharCode(0)`) so parts can't run together.
- **Run report** (`report.ts`): `buildReport` / `reportToMarkdown` — shareable
  audit of what changed, from patch metadata.
- **NL commands** (`nl.ts`): `parseInstruction` — deterministic, in-browser
  plain-English → `EngineOptions` (no network). **No longer surfaced in the web
  UI** (replaced by explicit date selects + the findings checkboxes — small,
  enumerable option space is better served by visible controls). Still exported
  and tested; reintroduce only for parameterised commands if ever needed.
- **Column transforms** (`transform.ts`): `splitColumn` / `mergeColumns` /
  `unpivot` (wide→long: fold chosen columns into Field/Value rows) — pure
  shape changes returning a NEW table (can't be cell patches). The web shell
  applies them as a new base (manual edits baked in, re-analysed) and makes
  them undoable by snapshotting the base table on the undo stack. Undo
  snapshots carry a human label; the toolbar's "history · N" panel lists them
  (Power Query applied-steps style) with per-step rewind.
- **JSON input** (`table.ts`): `fromJson` alongside `fromDelimitedText`.
- **Parquet input** (web shell only): the cleanse worker reads Parquet via
  `hyparquet` (pure JS, no WASM) → `Table`, capped at 100k rows/session with a
  disclosed banner. Not in the engine — engine stays zero-dep.
- **`@refynr/cli`**: headless `clean` (recipes, `--join-with`, `--min-score` CI
  gate, `--report`, `--json`) and `diff` (`--key`, `--fail-on-change`). Reads CSV/TSV/
  JSON/Parquet (`--limit` caps rows). Its only deps are the engine + hyparquet;
  Node types are local ambient decls (`node-min.d.ts`), no `@types/node`.
- **Web diff view** (`DatasetDiff.tsx`): the browser shell for `diffTables` —
  load a dataset, hit **⇄ Compare**, pick a second file; the worker parses it
  with a `tag: "compare"` (no re-cleanse) and the diff renders row/cell-level.
- **Python wrapper** (`packages/refynr-py`): thin subprocess shell over the CLI
  (`refynr.clean` / `clean_to_rows` / `clean_to_dataframe` / `diff`) for
  notebooks. Not in the pnpm workspace (no package.json). Needs Node + built CLI;
  override discovery with `REFYNR_CLI` / `REFYNR_NODE`.

## Architecture rules (locked in — don't relitigate)

1. **One engine, many shells.** All cleansing logic lives in `packages/engine`
   (pure TS, zero dependencies, no DOM/React/Node APIs). The web app,
   extension, and API routes are thin shells. Never put detection or fixing
   logic in a shell.
2. **Everything is a patch, nothing is a mutation.** Fixers emit `Patch`
   objects (`before`, `after`, `rule`, `reason`, `confidence`); the cleaned
   table is always `applyPatches(original, patches, acceptedIds)`. The engine
   never edits the input table.
3. **Deterministic rules first, AI second.** Fixers are regex/parsers/stats —
   reproducible and free. The AI layer (`/api/insights`) receives only column
   profiles, finding summaries, and scores — never raw rows. Sample values
   (up to 5 per column) are the only cell data that leaves the browser, and
   the UI discloses this.
4. **Advisory findings never auto-fix.** If a value can't be fixed with
   confidence (invalid email, impossible date), flag it (`patchIds: []`) —
   never guess.

## Adding a fixer

Create `packages/engine/src/fixers/<name>.ts` implementing `Fixer` from
`fixer.ts`, register it in the `FIXERS` array in `src/index.ts` (order =
display order), map its rule(s) to a dimension in `src/score.ts`
`RULE_DIMENSION`, and add tests in `test/engine.test.ts`. Every patch needs a
human-readable `reason` (powers the "why did this change?" UI) and every
finding copy must be grammatical for count 1 (use `n()`/`verb()` helpers).

## Gotchas

- **Never run `next build` while the dev server is running** — they share
  `.next` and the dev server corrupts (webpack module errors). Stop dev first.
- **Never `push(...bigArray)` / `Math.max(...bigArray)` on row-sized arrays** —
  the engine now handles 100k+ rows (Parquet), and spreading a per-row array
  into a call overflows the stack (`Maximum call stack size exceeded`). Use a
  loop or `reduce`. There's a 60k-row regression test guarding this.
- `xlsx` is pinned to the SheetJS CDN tarball (npm's 0.18.5 has known CVEs).
- Engine builds to `dist/` via tsc; the web app and extension consume the
  built output — rebuild the engine (`pnpm --filter @refynr/engine build`)
  after engine changes, or run its `dev` watcher.
- The extension's `tsconfig.json` extends generated `.wxt/tsconfig.json`
  (created by `wxt prepare` on install) and adds `jsx: react-jsx`.
- **Auth + insight metering** (Supabase). `/api/insights` requires a signed-in
  user and enforces a per-user daily quota + a global daily cap (the wallet
  kill-switch) via the atomic `consume_insight` Postgres function; failed AI
  calls `refund_insight`. Quotas live in `apps/web/lib/plans.ts` (code, not the
  DB) so paywalling later is a config change. `/api/clean` is a bearer-token
  dev API (`REFYNR_API_KEY`), disabled (404) when the key is unset. Schema is
  `apps/web/supabase/migrations/0001_auth_metering.sql`. **Shared recipe
  library** (`0002_shared_recipes.sql` + `lib/recipes-cloud.ts` +
  `CloudRecipes.tsx`): signed-in users sync recipes to `cloud_recipes` and can
  mark them `shared` (visible instance-wide = team library). CRUD is client-side
  under RLS (recipes are pure config); the cloud UI only shows when
  `supabaseConfigured && user`, else the browser-local library is the whole
  story. **Without the Supabase
  env vars the gate is skipped** so local dev works offline — production must
  set them (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY`). Only AI insights are gated; in-browser
  cleansing needs no account (it's the activation funnel).
- **AI insights are TEMPORARILY DISABLED** (pending a free/paywalled model).
  The "AI insights" tab is commented out in `AnalysisPanel.tsx`, related copy is
  removed from `Landing`/`login`/`account`, and `/api/insights` returns 503
  unless `REFYNR_INSIGHTS_ENABLED=1` (off by default, so it can't incur cost).
  The full implementation (`AiSummary.tsx`, the route, `/api/usage`, `plans.ts`)
  is preserved intact — re-enable by reversing those comments + setting the env
  var. AI insights need `ANTHROPIC_API_KEY` in `apps/web/.env.local`
  (see `.env.example`) when re-enabled; everything else works without it.

## Style

- Findings/patch copy: UK English for domain terms (capitalised, postcode),
  concrete and specific, explains *why it matters* not just what changed.
- Health score is deterministic (see `score.ts`) — same input always scores
  the same. Both current and projected scores share one `basis` (the original
  table's denominator) so accepting fixes can only raise the score, never
  lower it. Weights lean toward fixable dimensions (consistency/completeness/
  uniqueness) so remediation yields a meaningful gain; don't reweight so
  validity (advisory-dominated) anchors the composite.
