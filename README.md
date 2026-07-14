# refynr.

**Clean messy spreadsheets in your browser — with every change explained, reviewable, and undoable.**

Paste data or drop a CSV/Excel/JSON/Parquet file. refynr profiles it, scores its
health, and proposes fixes as individual patches — trimmed whitespace, merged
duplicates, normalised dates, standardised spellings, validated UK postcodes and
VAT numbers. Nothing changes until you accept it, and you can accept fixes one
by one, un-tick the ones you don't want, and rewind any step. Your data never
leaves your device: parsing, analysis, and cleaning all run client-side.

## Why refynr

Most cleaning tools make you choose between power and trust:

- **Spreadsheet AI assistants** (Excel Copilot, Sheets cleanup) are one-click
  but narrow, probabilistic, and often behind a licence.
- **Prep tools** (OpenRefine, Power Query) are powerful but edit in place, live
  on the desktop, or need a data team to drive them.
- **Cloud services** want your data uploaded first.

refynr's bet: **deterministic rules + human review beats AI guessing** for data
you have to stand behind. Every fix is a regex, parser, or statistic — same
input, same output, every time — with a plain-English reason attached. The
state of the art in probabilistic repair gets ~90% precision; that's 1 in 10
automated changes wrong. refynr never guesses: what can't be fixed with
confidence is flagged for you instead.

## What it does

**Fixes (as reviewable patches)** — whitespace and invisible characters ·
mojibake/encoding repair · header hygiene · exact and key-column duplicates ·
inconsistent casing · variant spellings ("Acme Ltd." vs "Acme Ltd") · date
formats (with day/month order inference) · numbers stored as text · boolean
variants · email, UK phone, and UK postcode normalisation · UK VAT, sort code,
and company-number validation (with checksums)

**Flags (advisory, never auto-fixed)** — invalid emails/dates · fuzzy
near-duplicate rows · statistical outliers · Excel-stripped leading zeros ·
cross-column inconsistencies (the one row where a postcode maps to a different
city) · personal data present (UK GDPR reminder before you share the export)

**Beyond fixes** — deterministic 0–100 health score (current + projected) ·
per-column profiling · pass/fail expectations (not-null/unique/regex/range/
allowed-values) with rules auto-suggested from the data · column split, merge,
and unpivot · find & replace · dataset diff ("what changed since last
export?") · shareable Markdown audit report · saved cleaning recipes (config
only, no cell data) that replay on next month's export

## Try it

```sh
pnpm install
pnpm build
pnpm --filter @refynr/web dev   # → http://localhost:3000
```

Paste anything tabular, or click "try sample data".

## Monorepo

```
packages/engine     @refynr/engine — pure TS, zero deps: profiling, fixers,
                    patches, scoring, recipes, diff, constraints, transforms
packages/cli        @refynr/cli — headless clean/diff for CI (--min-score gate)
packages/refynr-py  Python wrapper (subprocess → CLI) for notebooks
apps/web            @refynr/web — Next.js shell: the product
apps/extension      @refynr/extension — Chrome side panel (WXT)
```

One engine, many shells: all cleaning logic lives in `@refynr/engine`
(no DOM, no Node APIs, no dependencies). Shells only render results.

```sh
pnpm test                             # engine unit tests (vitest)
pnpm typecheck                        # all packages
node packages/cli/dist/cli.js --help  # CLI: clean + diff, CI gates
```

## CI / automation

```sh
refynr clean data.csv --recipe monthly.json --min-score 90 --report report.md
refynr diff before.csv after.csv --key "Customer ID" --fail-on-change
```

The CLI reads CSV/TSV/JSON/Parquet and exits non-zero when the score gate or
diff gate fails — same deterministic engine, so CI and browser always agree.

## Deployment notes

- Cleaning needs no account and no server — it's all client-side.
- Optional Supabase (auth + shared recipe library + AI-insight metering):
  set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY`, and run the migrations in
  `apps/web/supabase/migrations/`. Without them the app runs fully offline.
- AI insights are currently disabled by default (`REFYNR_INSIGHTS_ENABLED=1`
  + `ANTHROPIC_API_KEY` to enable). When enabled, only column profiles and
  finding summaries leave the browser — never rows, and the UI discloses this.
- `POST /api/clean` (developer API) is off unless `REFYNR_API_KEY` is set.

Engine internals: [packages/engine/README.md](packages/engine/README.md).
Contributor conventions: [CLAUDE.md](CLAUDE.md).
