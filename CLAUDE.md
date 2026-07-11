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

## Engine capabilities beyond fixers

The engine (`packages/engine`) also exports, all pure and deterministic:
- **Recipes** (`recipe.ts`): `createRecipe` / `serializeRecipe` / `parseRecipe`
  / `runRecipe`. A recipe is re-runnable config (options + skipped rules +
  constraints) with **no cell data** — safe to store/share. Web shell keeps a
  browser-local library (`apps/web/lib/recipes.ts`); the CLI replays them.
- **Expectations** (`expectations.ts`): `checkConstraints` — user-defined
  pass/fail rules (`Constraint`: not-null/unique/regex/range/allowed-values),
  threaded via `EngineOptions.constraints`. Advisory only (never auto-fix).
- **Dataset diff** (`diff.ts`): `diffTables(before, after, key?)` — value-level
  added/removed/changed/unchanged, key inferred or given. The "what changed
  since last export?" wedge.
- **Run report** (`report.ts`): `buildReport` / `reportToMarkdown` — shareable
  audit of what changed, from patch metadata.
- **NL commands** (`nl.ts`): `parseInstruction` — deterministic, in-browser
  plain-English → `EngineOptions` (no network).
- **JSON input** (`table.ts`): `fromJson` alongside `fromDelimitedText`.
- **`@refynr/cli`**: headless `clean` (recipes, `--min-score` CI gate,
  `--report`, `--json`) and `diff` (`--key`, `--fail-on-change`). Keeps the
  engine pure — its only dep is the engine; Node types are local ambient decls.

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
  `apps/web/supabase/migrations/0001_auth_metering.sql`. **Without the Supabase
  env vars the gate is skipped** so local dev works offline — production must
  set them (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY`). Only AI insights are gated; in-browser
  cleansing needs no account (it's the activation funnel).
- AI insights need `ANTHROPIC_API_KEY` in `apps/web/.env.local`
  (see `.env.example`); everything else works without it.

## Style

- Findings/patch copy: UK English for domain terms (capitalised, postcode),
  concrete and specific, explains *why it matters* not just what changed.
- Health score is deterministic (see `score.ts`) — same input always scores
  the same. Both current and projected scores share one `basis` (the original
  table's denominator) so accepting fixes can only raise the score, never
  lower it. Weights lean toward fixable dimensions (consistency/completeness/
  uniqueness) so remediation yields a meaningful gain; don't reweight so
  validity (advisory-dominated) anchors the composite.
