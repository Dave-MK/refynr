#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import process from "node:process";
import {
  applyPatches,
  buildReport,
  cellText,
  cleanse,
  diffTables,
  fromDelimitedText,
  fromJson,
  parseRecipe,
  reportToMarkdown,
  runRecipe,
  type CellValue,
  type Table,
} from "@refynr/engine";
import { parquetMetadataAsync, parquetReadObjects } from "hyparquet";

/**
 * refynr headless CLI — "recipes as code". Runs the exact same deterministic
 * engine the browser uses against a file, so a saved cleaning recipe can be
 * replayed in a script or a CI pipeline. Non-destructive: it reads the input
 * and writes a separate clean copy; the original file is never modified.
 *
 *   refynr clean data.csv --recipe crm.json --out clean.csv
 *   refynr clean export.json --min-score 90        # exit 1 if health < 90
 */

const out = (s: string) => process.stdout.write(s);
const err = (s: string) => process.stderr.write(s + "\n");

const HELP = `refynr — non-destructive data cleaning, headless

Usage:
  refynr clean <file> [options]
  refynr diff <before> <after> [options]

clean — analyse a file and write a cleaned copy:
  --recipe <file>        Apply a saved recipe (.json) instead of all default fixes
  --join-with <file>     Dataset to join before cleaning, when the recipe has a
                         join step (a recipe stores the join's shape, not its data)
  --out <file>           Write the cleaned copy here (default: stdout as CSV)
  --report <file>        Write a Markdown audit report of what changed
  --min-score <0-100>    Exit non-zero if the cleaned data scores below this (CI gate)
  --json                 Print a machine-readable JSON summary to stdout

diff — compare two versions of a dataset (row/cell level):
  --key <column>         Column to match rows on (default: inferred)
  --json                 Print the full diff as JSON
  --fail-on-change       Exit non-zero if anything changed (CI gate)

Common:
  --limit <n>            Read at most n rows (useful for previewing huge files)
  -h, --help             Show this help

Inputs: CSV, TSV, JSON, and Parquet. Input files are never modified.`;

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}
function has(args: string[], name: string): boolean {
  return args.includes(name);
}

function csvField(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}
function toCsv(table: Table): string {
  const lines = [table.headers.map(csvField).join(",")];
  for (const row of table.rows) lines.push(row.map((v) => csvField(cellText(v))).join(","));
  return lines.join("\n");
}

/** Coerce a Parquet value (BigInt, Date, nested object) to a flat CellValue. */
function toCell(v: unknown): CellValue {
  if (v === null || v === undefined) return null;
  if (typeof v === "bigint") return Number.isSafeInteger(Number(v)) ? Number(v) : v.toString();
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") return JSON.stringify(v);
  if (typeof v === "number" || typeof v === "boolean" || typeof v === "string") return v;
  return String(v);
}

async function parquetToTable(path: string, rowLimit?: number): Promise<Table> {
  const fb = readFileSync(path);
  const ab = fb.buffer.slice(fb.byteOffset, fb.byteOffset + fb.byteLength);
  const meta = await parquetMetadataAsync(ab);
  const total = Number(meta.num_rows);
  const rowEnd = rowLimit && rowLimit > 0 ? Math.min(total, rowLimit) : total;
  const records = (await parquetReadObjects({ file: ab, rowEnd })) as Record<string, unknown>[];
  const headerSet = new Set<string>();
  for (const rec of records.slice(0, 50)) for (const k of Object.keys(rec)) headerSet.add(k);
  const headers = [...headerSet];
  const rows: CellValue[][] = records.map((rec) => headers.map((h) => toCell(rec[h])));
  return { headers, rows };
}

async function loadTable(path: string, rowLimit?: number): Promise<Table> {
  if (/\.parquet$/i.test(path)) return parquetToTable(path, rowLimit);
  const text = readFileSync(path, "utf8");
  return /\.json$/i.test(path) ? fromJson(text) : fromDelimitedText(text);
}

async function runDiff(argv: string[], positional: string[]): Promise<number> {
  const beforePath = positional[1];
  const afterPath = positional[2];
  if (!beforePath || !afterPath) {
    err("Error: diff needs two files.\n\n  refynr diff <before> <after>");
    return 1;
  }
  for (const p of [beforePath, afterPath]) {
    if (!existsSync(p)) {
      err(`Error: file not found: ${p}`);
      return 1;
    }
  }
  const limit = flag(argv, "--limit") ? Number(flag(argv, "--limit")) : undefined;
  let before: Table;
  let after: Table;
  try {
    before = await loadTable(beforePath, limit);
    after = await loadTable(afterPath, limit);
  } catch (e) {
    err(`Error: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }

  const d = diffTables(before, after, flag(argv, "--key"));

  if (has(argv, "--json")) {
    out(JSON.stringify(d, null, 2) + "\n");
  } else {
    err("");
    err(`  Matched on: ${d.keyColumn ?? "row position"}`);
    err(`  Added:      ${d.added.length}`);
    err(`  Removed:    ${d.removed.length}`);
    err(`  Changed:    ${d.changed.length}`);
    err(`  Unchanged:  ${d.unchanged}`);
    if (d.addedColumns.length) err(`  New columns: ${d.addedColumns.join(", ")}`);
    if (d.removedColumns.length) err(`  Dropped columns: ${d.removedColumns.join(", ")}`);
    err("");
    for (const c of d.changed.slice(0, 20)) {
      const cells = c.cells.map((x) => `${x.column}: ${cellText(x.before)} -> ${cellText(x.after)}`).join("; ");
      err(`  ~ ${c.key}: ${cells}`);
    }
    if (d.changed.length > 20) err(`  … and ${d.changed.length - 20} more changed rows`);
  }

  if (has(argv, "--fail-on-change")) {
    const changes = d.added.length + d.removed.length + d.changed.length;
    if (changes > 0) {
      err(`FAIL: ${changes} row-level change${changes === 1 ? "" : "s"} detected.`);
      return 1;
    }
    err("PASS: no changes.");
  }
  return 0;
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || has(argv, "-h") || has(argv, "--help")) {
    err(HELP);
    return argv.length === 0 ? 1 : 0;
  }

  // Tolerate both "refynr clean file" and "refynr file".
  const positional = argv.filter((a, i) => !a.startsWith("-") && argv[i - 1]?.startsWith("--") !== true);

  if (positional[0] === "diff") return runDiff(argv, positional);

  const file = positional[0] === "clean" ? positional[1] : positional[0];
  if (!file) {
    err("Error: no input file given.\n\n" + HELP);
    return 1;
  }
  if (!existsSync(file)) {
    err(`Error: file not found: ${file}`);
    return 1;
  }

  const limit = flag(argv, "--limit") ? Number(flag(argv, "--limit")) : undefined;
  let table: Table;
  try {
    table = await loadTable(file, limit);
  } catch (e) {
    err(`Error reading ${file}: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
  if (table.rows.length === 0) {
    err("Error: no data rows found (need a header row and at least one data row).");
    return 1;
  }

  // A recipe carrying a join needs the other dataset supplied here — it stores
  // the join's shape, never its data.
  const joinPath = flag(argv, "--join-with");
  let joinTable: Table | undefined;
  if (joinPath) {
    if (!existsSync(joinPath)) {
      err(`Error: file not found: ${joinPath}`);
      return 1;
    }
    try {
      joinTable = await loadTable(joinPath, limit);
    } catch (e) {
      err(`Error reading ${joinPath}: ${e instanceof Error ? e.message : String(e)}`);
      return 1;
    }
  }

  const recipePath = flag(argv, "--recipe");
  let cleaned: Table;
  let result: ReturnType<typeof cleanse>;
  let acceptedIds: Set<string>;

  try {
    if (recipePath) {
      const recipe = parseRecipe(readFileSync(recipePath, "utf8"));
      const run = runRecipe(table, recipe, joinTable);
      result = run.result;
      acceptedIds = run.acceptedIds;
      cleaned = run.cleaned;
      err(`Applied recipe "${recipe.name}".`);
      // The join's diagnosis is the part a CI log most needs to see: an
      // unmatched-rows spike is how a broken upstream key shows up.
      for (const f of run.joinFindings ?? []) {
        err(`  ${f.severity === "info" ? "note" : "warn"}: ${f.title}`);
      }
    } else {
      result = cleanse(table);
      acceptedIds = new Set(result.patches.map((p) => p.id));
      cleaned = applyPatches(table, result.patches, acceptedIds);
    }
  } catch (e) {
    err(`Error: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }

  const report = buildReport(result, acceptedIds);
  // Residual health of the actual output — the number a CI gate should judge.
  // NOTE: scored on the cleaned file with its own basis, so it can differ
  // from the web UI's shared-basis projection; --json exposes both.
  // projection: "none" skips the projected-score pass this call never uses.
  const afterScore = cleanse(cleaned, { projection: "none" }).score.overall;

  // Human summary always goes to stderr, so stdout stays pipe-clean.
  err("");
  err(`  Health:  ${report.scoreBefore} -> ${afterScore} (residual, scored on the output file)`);
  err(`  Rows:    ${report.rowsBefore} -> ${report.rowsAfter} (${report.rowsRemoved} removed)`);
  err(`  Cells:   ${report.cellsChanged} changed`);
  err(`  Flagged: ${report.advisories.reduce((n, a) => n + a.count, 0)} for review`);
  err("");

  const reportPath = flag(argv, "--report");
  if (reportPath) {
    writeFileSync(reportPath, reportToMarkdown(report, { title: `refynr report — ${file}` }));
    err(`Wrote report to ${reportPath}`);
  }

  if (has(argv, "--json")) {
    out(JSON.stringify({ file, afterScore, ...report }, null, 2) + "\n");
  } else {
    const outPath = flag(argv, "--out");
    if (outPath) {
      writeFileSync(outPath, toCsv(cleaned));
      err(`Wrote cleaned data to ${outPath}`);
    } else {
      out(toCsv(cleaned) + "\n");
    }
  }

  const minScore = flag(argv, "--min-score");
  if (minScore !== undefined) {
    const threshold = Number(minScore);
    if (afterScore < threshold) {
      err(`FAIL: health ${afterScore} is below the required ${threshold}.`);
      return 1;
    }
    err(`PASS: health ${afterScore} meets the required ${threshold}.`);
  }

  return 0;
}

main().then(
  (code) => process.exit(code),
  (e) => {
    err(`Unexpected error: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  },
);
