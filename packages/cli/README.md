# @refynr/cli

Run refynr's deterministic cleaning engine against files, headless — in a
script or a CI pipeline. Same engine as the web app, so a recipe you save in
the browser replays identically here. **Non-destructive:** it reads the input
and writes a separate clean copy; the original file is never modified.

## Install

```sh
pnpm --filter @refynr/engine build   # the CLI consumes the built engine
pnpm --filter @refynr/cli build
node packages/cli/dist/cli.js --help
# (or `pnpm --filter @refynr/cli exec refynr --help` once linked)
```

## Clean a file

```sh
# Apply all default fixes, write a clean copy + an audit report
refynr clean data.csv --out clean.csv --report report.md

# Replay a recipe exported from the web app (recipes are pure config, no data)
refynr clean monthly-export.csv --recipe crm.json --out clean.csv

# JSON or Parquet in, machine-readable summary out
refynr clean api-dump.json --json
refynr clean events.parquet --out clean.csv

# Preview the first N rows of a huge file
refynr clean big.parquet --limit 100000 --min-score 85
```

CSV, TSV, JSON and **Parquet** inputs are supported (`.json` is parsed as an
array of records; Parquet is read with the pure-JS `hyparquet`, Snappy or
uncompressed). `--limit <n>` caps how many rows are read. With no `--out`, the
cleaned CSV goes to stdout, so summaries and diagnostics always go to stderr —
the output stays pipe-clean.

## Quality gate for CI

`--min-score` exits non-zero when the cleaned data's health score falls below a
threshold — a shift-left check at the *file* boundary, before data enters your
warehouse or app.

```sh
refynr clean incoming.csv --min-score 90
# PASS: health 94 meets the required 90.   -> exit 0
# FAIL: health 71 is below the required 90. -> exit 1
```

### GitHub Actions

```yaml
name: data-quality
on: [pull_request]
jobs:
  refynr:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @refynr/engine build && pnpm --filter @refynr/cli build
      # Fail the PR if an incoming data file drops below a health threshold,
      # applying the team's shared cleaning recipe.
      - run: node packages/cli/dist/cli.js clean data/customers.csv --recipe recipes/crm.json --min-score 85
```

## Diff two versions of a dataset

Point refynr's review model at "last export vs this one" — a reviewable,
value-level diff, matched on an inferred (or given) key column.

```sh
refynr diff last-month.csv this-month.csv
#   Matched on: id
#   Added: 12   Removed: 3   Changed: 40   Unchanged: 908
#   ~ 1042: spend: 100 -> 150; status: active -> churned

refynr diff v1.csv v2.csv --key customer_id --json     # full diff as JSON
refynr diff v1.csv v2.csv --fail-on-change             # exit 1 if anything moved
```

All commands leave the input files untouched.
