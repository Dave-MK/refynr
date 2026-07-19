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
export?") · shareable audit report · saved cleaning recipes (config only, no
cell data) that replay on next month's export

## The review workspace

- **Four views** — **Original** (the untouched upload, read-only), **Changes**
  (every staged fix shown as before → after in place), **Cleaned** (exactly
  what you'll export), and **Change history** (a timestamped log of every
  change, badged by who made it: `refynr` for app-applied fixes, `you` for
  manual edits).
- **Edit anything** — double-click any cell in the Changes or Cleaned view to
  edit it in place; double-clicking a staged fix opens the editor seeded with
  the fixed value so you can override it. Advisory cells (amber) are always
  editable. Edits re-score live.
- **Delete rows and columns** — hover any row number or column header in the
  Changes/Cleaned views for a ✕. Deletions are undoable like everything else.
- **Undo everything** — Ctrl+Z, the toast's Undo, or the applied-steps history
  panel with per-step rewind (Power Query style).
- **Settings & recipes modal** — date handling, the "duplicates match on" key,
  split/merge/unpivot, expectations, and the recipe library in one dialog,
  with a dot showing when custom settings are active.
- **Export your way** — **Copy** (paste straight into Excel/Sheets) · a
  **Download** chooser for the cleaned data (CSV, Excel, TSV, JSON) · a
  **Report** chooser for the audit report (PDF, web page, Markdown, JSON) ·
  **⇄ Compare** for a row/cell-level diff against another file. PDF and Excel
  generation happen entirely in the browser.
- **Big and awkward files** — multi-sheet workbooks (pick the sheet), Parquet
  (first 100k rows, disclosed), drag-and-drop or Ctrl+V anywhere, and a fully
  responsive full-width grid that scrolls internally instead of breaking the
  page.

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

## Changelog

### 2026-07-19

- **Export choosers.** One **Download** button for the cleaned data (CSV,
  Excel, TSV, JSON) and a **Report** chooser (PDF, web page, Markdown, JSON)
  instead of a silent `.md` download. PDF reports are generated in-browser
  (jsPDF, lazily loaded). Export actions now sit below the data grid.
- **Changes view is fully editable** — double-click any cell, including a
  staged fix to override it by hand.
- **Row/column deletion** in the Changes and Cleaned views (hover ✕), backed
  by new pure engine transforms `deleteRows`/`deleteColumn`.
- **Change history tab** — every change with date, time, and who made it
  (app-applied fix vs manual action); undoing removes the entry.
- **Settings & recipes modal** — options, transforms, recipes, and
  expectations moved out of the page into a centred dialog.
- Full-width responsive workspace (grid scrolls internally at every
  breakpoint; mobile export-row wrap fixed), Data health centred, Cleaned-view
  double-click editing. Validated against real UK government open data.

### 2026-07-16

- Pre-launch sweep: recipes store dedupe keys by column **name** (so they
  survive reshapes and reordered re-exports), dedupe/dependency fixer fixes,
  performance work, Supabase key naming compatibility.

### 2026-07-14

- Cloud recipe sync with a shared instance-wide team library (Supabase, RLS).
- Research-driven engine checks: value standardisation, cross-column
  dependency inconsistencies, key-column dedupe, personal-data (UK GDPR)
  notice.
- Review UX: per-column profiling panel, action history, findings filters,
  auto-suggested expectation rules. Vercel analytics.

### 2026-07-13

- Replaced the natural-language command bar with explicit controls (date
  selects + findings checkboxes); more sorting and cleansing options.

### 2026-07-12

- Shared recipe library (Supabase migrations + cloud UI), in-app dataset diff
  view (⇄ Compare), Python wrapper for notebooks. Full test-and-bug-hunt pass.

### 2026-07-10 → 2026-07-11

- Deployment prep: Supabase auth, per-user AI-insight metering with a global
  daily cap, `/api/clean` dev API. Engine and UI refinement.

### 2026-07-05

- Health score redesign: stable shared basis (accepting fixes can only raise
  the score), fixable-weighted dimensions. Engine optimisation.

### 2026-07-04

- Dark console UI for the web app and the Chrome side-panel extension.

### 2026-07-03

- Encoding repair (mojibake) and integrity advisories; CI workflow; sample
  data exercises all 13 rules.

### 2026-07-02

- Initial release: pure zero-dependency engine (profiling, 13 fixer rules,
  patches, deterministic scoring), Next.js web shell, AI summary
  (later gated), docs.

---

Engine internals: [packages/engine/README.md](packages/engine/README.md).
Contributor conventions: [CLAUDE.md](CLAUDE.md).
