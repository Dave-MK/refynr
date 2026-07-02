# refynr

Non-destructive spreadsheet quality and repair. Paste data or upload a CSV, get a
data health score, explained findings, and a before/after diff of every proposed
fix — nothing changes until you accept it, and your data never leaves the browser.

## Architecture

One engine, many shells. All cleansing logic lives in a pure TypeScript package
with no DOM or framework dependencies, so the same core powers the web app today
and the browser extension, Excel/Sheets add-ins, and API later.

```
packages/engine   @refynr/engine — profiling, findings, patches, health score
apps/web          @refynr/web — Next.js app (paste/upload → score → diff → export)
                  + POST /api/clean (developer API) + POST /api/insights (AI layer)
apps/extension    @refynr/extension — Chrome side panel (WXT): paste → review → copy back
```

Core principles:

- **Everything is a patch, nothing is a mutation.** The engine emits
  `Patch` objects (before, after, rule, reason, confidence); the cleaned table
  is always `original + accepted patches`. Diff view, per-cell "why did this
  change?", selective apply, and audit trail all fall out of this model.
- **Deterministic rules first, AI second.** Regexes, parsers, and statistics do
  the detection and fixing — instant, free, reproducible, private. AI insight
  (planned) receives only column profiles, never raw data.
- **Client-side processing.** Parsing and cleansing run in the browser.

## Current rules

whitespace/invisible characters · exact + near duplicate rows · blank rows ·
inconsistent casing · mixed date formats (with day/month order inference) ·
email normalization/validation · UK phone normalization · UK postcode
normalization/validation · missing-value analysis

## Development

```sh
pnpm install
pnpm build          # build all packages (turbo)
pnpm test           # engine unit tests
pnpm --filter @refynr/web dev         # web app on :3000
pnpm --filter @refynr/extension dev   # extension dev mode (opens Chrome)
pnpm --filter @refynr/extension zip   # package for Chrome Web Store
```

**AI insights** need a key: copy `apps/web/.env.example` to `apps/web/.env.local`
and set `ANTHROPIC_API_KEY`. Everything else works without it. The endpoint
sends only column profiles (names, types, stats, a few sample values) and
finding summaries to Claude — never the dataset.

**Developer API:** `POST /api/clean` with `{headers, rows, options?, apply?}`
returns `{health_score, projected_score, findings, patches, cleaned_data?}`.

**Extension:** `pnpm --filter @refynr/extension build`, then load
`apps/extension/.output/chrome-mv3` via chrome://extensions → Load unpacked.
Flow: copy cells in Sheets/Excel Online → paste in the side panel → review →
"Copy cleaned data" → paste back. See [apps/extension/README.md](apps/extension/README.md).

**Engine internals:** see [packages/engine/README.md](packages/engine/README.md)
for the patch model, rule list, and options. Contributor conventions live in
[CLAUDE.md](CLAUDE.md).

## Before deploying publicly

- `/api/clean` and `/api/insights` are **unauthenticated**. Insights spends
  Anthropic API credits per call — add rate limiting (e.g. Vercel WAF /
  Upstash) or auth before exposing them.
- Input caps exist (`/api/clean` 500k cells; insights prompt is bounded) but
  there is no per-IP throttling yet.
- Don't run `pnpm build` while the dev server is running — they share `.next`.

## Roadmap

1. Glide Data Grid for 100k+ row rendering (current HTML grid caps display at 300 rows)
2. Excel add-in (Office.js taskpane) + Google Workspace add-on (Apps Script)
3. Per-user preference memory (date format, casing style, leading-zero IDs)
4. Auth + billing (Supabase + Stripe) and hosted deployment
