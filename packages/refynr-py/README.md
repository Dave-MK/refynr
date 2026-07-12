# refynr (Python)

A thin Python wrapper over the [`@refynr/cli`](../cli) — clean and diff tabular
data from a notebook or script, non-destructively. It does **not** re-implement
the engine; it shells out to the same CLI the web app is built on, so results
are identical everywhere.

## Requirements

- **Node.js** on the `PATH` (the engine is JavaScript).
- The CLI built once: `pnpm --filter @refynr/engine build && pnpm --filter @refynr/cli build`.

If the CLI lives elsewhere, point to it with `REFYNR_CLI=/path/to/cli.js`
(and `REFYNR_NODE=/path/to/node` if needed).

## Install

```sh
pip install -e packages/refynr-py      # editable, from the monorepo
```

## Use

```python
import refynr

# Clean a file -> summary dict (health before/after, rows removed, per-rule counts)
summary = refynr.clean("customers.csv")
print(summary["scoreBefore"], "->", summary["afterScore"])

# CI-style gate: `passed` is False if the cleaned health is below the threshold
gate = refynr.clean("incoming.csv", min_score=85)
assert gate["passed"], "data quality regressed"

# Get cleaned data back as rows, or a DataFrame
rows = refynr.clean_to_rows("customers.csv")            # list[dict]
df   = refynr.clean_to_dataframe("customers.csv")        # needs pandas

# Replay a saved recipe (exported from the web app), write a clean copy + report
refynr.clean("customers.csv", recipe="crm.json", out="clean.csv", report="audit.md")

# Diff two versions of a dataset (matched on an inferred or given key)
changes = refynr.diff("last_month.csv", "this_month.csv", key="id")
print(changes["added"], changes["removed"], changes["changed"])
```

CSV, TSV, JSON and Parquet inputs are supported. Input files are never modified.
