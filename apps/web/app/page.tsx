"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  applyPatches,
  cleanse,
  type CellPatch,
  type CellValue,
  type CleanseResult,
  type EngineOptions,
  type Finding,
  type Recipe,
  type Table,
} from "@refynr/engine";
import type {
  CleanseRequest,
  CleanseResponse,
} from "@/workers/cleanse.worker";
import { AuthNav } from "@/components/AuthNav";
import { Landing } from "@/components/Landing";
import { AnalysisPanel } from "@/components/AnalysisPanel";
import { RecipeBar } from "@/components/RecipeBar";
import { DataTable, type EditableCell, type ViewMode } from "@/components/DataTable";
import { downloadCsv } from "@/lib/csv";
import { downloadXlsx } from "@/lib/xlsx";
import { SAMPLE_DATA } from "@/lib/sample";

/** Stable identity for a finding across re-cleanses (rule + optional column). */
const findingKey = (f: Finding): string => `${f.rule}:${f.column ?? ""}`;

function applyManualEdits(base: Table, edits: Map<string, CellValue>): Table {
  if (edits.size === 0) return base;
  const rows = base.rows.map((r) => [...r]);
  for (const [key, value] of edits) {
    const [r, c] = key.split(":").map(Number);
    const row = rows[r!];
    if (row && c! < row.length) row[c!] = value;
  }
  return { headers: base.headers, rows };
}

export default function Home() {
  const [pasted, setPasted] = useState("");
  const [base, setBase] = useState<{ table: Table; result: CleanseResult } | null>(null);
  const [manualEdits, setManualEdits] = useState<Map<string, CellValue>>(new Map());
  // Findings the user has un-ticked, keyed stably so choices survive re-cleanse.
  const [disabled, setDisabled] = useState<Set<string>>(new Set());
  // Engine options (date handling, disabled fixers) — driven by recipes / NL commands.
  const [options, setOptions] = useState<EngineOptions>({});
  // Fixer rules whose fixes a recipe leaves un-accepted (findings still shown).
  const [skipRules, setSkipRules] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<ViewMode>("diff");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const workerRef = useRef<Worker | null>(null);

  useEffect(() => {
    const worker = new Worker(
      new URL("../workers/cleanse.worker.ts", import.meta.url),
    );
    worker.onmessage = (e: MessageEvent<CleanseResponse>) => {
      setBusy(false);
      if (!e.data.ok) {
        setError(`Couldn't read that data: ${e.data.error}`);
        return;
      }
      setBase({ table: e.data.table, result: e.data.result });
      setManualEdits(new Map());
      setDisabled(new Set());
      setOptions({});
      setSkipRules(new Set());
      setMode("diff");
      setError(null);
    };
    workerRef.current = worker;
    return () => worker.terminate();
  }, []);

  const submit = useCallback((request: CleanseRequest, transfer?: Transferable[]) => {
    setBusy(true);
    setError(null);
    workerRef.current?.postMessage(request, transfer ?? []);
  }, []);

  const analyse = useCallback(
    (text: string) => submit({ kind: "text", text }),
    [submit],
  );

  const onFile = useCallback(
    async (file: File) => {
      if (/\.(xlsx|xls)$/i.test(file.name)) {
        const buffer = await file.arrayBuffer();
        submit({ kind: "xlsx", buffer, name: file.name }, [buffer]);
      } else {
        analyse(await file.text());
      }
    },
    [analyse, submit],
  );

  // original + manual edits — the working table everything derives from.
  const working = useMemo(
    () => (base ? applyManualEdits(base.table, manualEdits) : null),
    [base, manualEdits],
  );

  // Whether non-default engine options are in play (from a recipe or command).
  const hasOptions = !!(
    options.dateOrder ||
    options.dateOutput ||
    options.disabledRules?.length
  );

  // Re-cleanse on the main thread once the user has made manual edits or set
  // engine options, so the score, findings and cleaned output all update live.
  // The initial (unedited, default-options) result comes from the worker so
  // large files never block the first paint.
  const result = useMemo(() => {
    if (!base) return null;
    return manualEdits.size === 0 && !hasOptions
      ? base.result
      : cleanse(working!, options);
  }, [base, manualEdits, working, options, hasOptions]);

  // Which finding indices are currently accepted (fixable, not un-ticked, and
  // not left un-accepted by a recipe's skip list).
  const enabledIndices = useMemo(() => {
    const set = new Set<number>();
    result?.findings.forEach((f, i) => {
      if (
        f.patchIds.length > 0 &&
        !disabled.has(findingKey(f)) &&
        !skipRules.has(f.rule)
      )
        set.add(i);
    });
    return set;
  }, [result, disabled, skipRules]);

  const accepted = useMemo(() => {
    const ids = new Set<string>();
    const cellPatches = new Map<string, CellPatch>();
    const removedRows = new Set<number>();
    const headerPatches = new Map<number, { before: string; after: string }>();
    if (!result) return { ids, cellPatches, removedRows, headerPatches };

    result.findings.forEach((f, i) => {
      if (enabledIndices.has(i)) for (const id of f.patchIds) ids.add(id);
    });
    for (const p of result.patches) {
      if (!ids.has(p.id)) continue;
      if (p.kind === "cell") cellPatches.set(`${p.cell.row}:${p.cell.col}`, p);
      else if (p.kind === "remove-row") removedRows.add(p.row);
      else if (p.kind === "header")
        headerPatches.set(p.col, { before: p.before, after: p.after });
    }
    return { ids, cellPatches, removedRows, headerPatches };
  }, [result, enabledIndices]);

  // Advisory cells (still flagged) + any cell the user has manually edited —
  // both render as inline editors in the Changes view.
  const editableCells = useMemo(() => {
    const map = new Map<string, EditableCell>();
    if (!result) return map;
    for (const f of result.findings) {
      if (f.patchIds.length > 0 || !f.cells) continue;
      for (const cell of f.cells) {
        map.set(`${cell.row}:${cell.col}`, { label: f.title, flagged: true });
      }
    }
    for (const key of manualEdits.keys()) {
      if (!map.has(key)) map.set(key, { label: "Edited manually", flagged: false });
    }
    return map;
  }, [result, manualEdits]);

  const cleaned = useMemo(
    () =>
      working && result
        ? applyPatches(working, result.patches, accepted.ids)
        : { headers: [], rows: [] },
    [working, result, accepted],
  );

  const onEditCell = useCallback(
    (row: number, col: number, value: CellValue) => {
      if (!base) return;
      const key = `${row}:${col}`;
      const originalValue = base.table.rows[row]?.[col] ?? null;
      setManualEdits((prev) => {
        const next = new Map(prev);
        // Reverting to the original value drops the manual edit entirely.
        if (value === originalValue) next.delete(key);
        else next.set(key, value);
        return next;
      });
    },
    [base],
  );

  const toggleFinding = useCallback(
    (index: number) => {
      const f = result?.findings[index];
      if (!f) return;
      const key = findingKey(f);
      setDisabled((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
    },
    [result],
  );

  // Apply engine options only (from the plain-English command box).
  const onApplyOptions = useCallback((next: EngineOptions) => {
    setOptions(next);
  }, []);

  // Apply a full recipe: its options plus which fixes to leave un-accepted.
  const onApplyRecipe = useCallback((recipe: Recipe) => {
    setOptions(recipe.options);
    setSkipRules(new Set(recipe.skipRules));
    setDisabled(new Set()); // recipe defines the accept/skip state
  }, []);

  // The rules currently left un-accepted — a recipe's skips plus any finding
  // the user has since un-ticked by hand — so "Save current" captures both.
  const currentSkipRules = useMemo(() => {
    const rules = new Set(skipRules);
    if (result) {
      result.findings.forEach((f) => {
        if (f.patchIds.length > 0 && disabled.has(findingKey(f))) rules.add(f.rule);
      });
    }
    return [...rules];
  }, [skipRules, disabled, result]);

  const acceptedCount = accepted.cellPatches.size + accepted.removedRows.size + accepted.headerPatches.size;
  const manualCount = manualEdits.size;

  return (
    <main className="mx-auto max-w-[960px] px-5 py-8">
      <header className="mb-8 flex items-center justify-between">
        <h1 className="text-[22px] font-bold tracking-tight text-hi">
          refynr<span className="text-teal">.</span>
        </h1>
        <div className="flex items-center gap-5">
          <span className="hidden rounded-full border border-line2 bg-card px-3.5 py-1.5 font-mono text-[11px] text-mut sm:inline-flex">
            runs in your browser
          </span>
          {base && (
            <button
              onClick={() => {
                setBase(null);
                setPasted("");
              }}
              className="font-mono text-xs text-dim transition hover:text-body"
            >
              start over
            </button>
          )}
          <AuthNav />
        </div>
      </header>

      {!base && (
        <Landing>
        <section className="rounded-2xl border border-line bg-card p-8">
          <h2 className="text-lg font-semibold text-hi">
            Paste data or upload a spreadsheet
          </h2>
          <p className="mt-1 text-sm text-mut">
            Everything runs in your browser — your data never leaves this device.
          </p>
          <textarea
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            placeholder={"Paste from Excel or Google Sheets (Ctrl+V)…\n\nName\tEmail\tJoined\nJohn Smith\tjohn@acme.com\t15/01/2024"}
            className="mt-5 h-48 w-full resize-y rounded-xl border border-line bg-inset p-4 font-mono text-[13px] text-body outline-none placeholder:text-dim focus:border-teal/60 focus:ring-2 focus:ring-teal/20"
          />
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button
              onClick={() => analyse(pasted)}
              disabled={!pasted.trim() || busy}
              className="rounded-lg bg-gradient-to-r from-teal to-cyan px-5 py-2.5 text-sm font-semibold text-ink shadow-[0_0_18px_rgba(45,212,191,0.35)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
            >
              {busy ? "Analysing…" : "Analyse data"}
            </button>
            <button
              onClick={() => fileInput.current?.click()}
              disabled={busy}
              className="rounded-lg border border-line2 bg-card2 px-5 py-2.5 text-sm font-medium text-body transition hover:border-mut disabled:opacity-40"
            >
              Upload CSV / Excel
            </button>
            <input
              ref={fileInput}
              type="file"
              accept=".csv,.tsv,.txt,.xlsx,.xls"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onFile(f);
                e.target.value = "";
              }}
            />
            <button
              onClick={() => analyse(SAMPLE_DATA)}
              className="font-mono text-xs font-semibold text-teal transition hover:text-cyan"
            >
              › try sample data
            </button>
          </div>
          {error && (
            <p className="mt-4 rounded-lg border border-coral/25 bg-coral/10 px-4 py-3 text-sm text-coral">
              {error}
            </p>
          )}
        </section>
        </Landing>
      )}

      {base && working && result && (
        <div className="space-y-5">
          <RecipeBar
            currentOptions={options}
            currentSkipRules={currentSkipRules}
            onApplyOptions={onApplyOptions}
            onApplyRecipe={onApplyRecipe}
          />

          <AnalysisPanel
            score={result.score}
            projected={result.projectedScore}
            findings={result.findings}
            enabled={enabledIndices}
            onToggle={toggleFinding}
            profile={result.profile}
            result={result}
          />

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="inline-flex rounded-xl border border-line bg-inset p-1">
              {(
                [
                  ["original", "Original"],
                  ["diff", `Changes · ${acceptedCount}`],
                  ["cleaned", "Cleaned"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => setMode(value)}
                  className={`rounded-lg px-4 py-1.5 font-mono text-xs font-semibold transition ${
                    mode === value
                      ? "bg-gradient-to-r from-teal to-cyan text-ink shadow-[0_0_14px_rgba(45,212,191,0.35)]"
                      : "text-mut hover:text-body"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="flex gap-2.5">
              <button
                onClick={() => downloadCsv(cleaned, "refynr-cleaned.csv")}
                className="rounded-lg bg-gradient-to-r from-teal to-cyan px-5 py-2 text-sm font-semibold text-ink shadow-[0_0_18px_rgba(45,212,191,0.35)] transition hover:brightness-110"
              >
                Download CSV
              </button>
              <button
                onClick={() => void downloadXlsx(cleaned, "refynr-cleaned.xlsx")}
                className="rounded-lg border border-line2 bg-card2 px-5 py-2 text-sm font-medium text-body transition hover:border-mut"
              >
                Download Excel
              </button>
            </div>
          </div>

          <DataTable
            original={base.table}
            working={working}
            cleaned={cleaned}
            cellPatches={accepted.cellPatches}
            removedRows={accepted.removedRows}
            editableCells={editableCells}
            headerPatches={accepted.headerPatches}
            mode={mode}
            onEditCell={onEditCell}
          />

          <p className="pb-8 text-center font-mono text-[11px] leading-relaxed text-dim">
            {manualCount > 0
              ? `${manualCount} manual edit${manualCount === 1 ? "" : "s"} applied and re-scored live. `
              : "Amber cells in Changes are advisory — edit them to fix by hand and watch the score update. "}
            Your original data is never modified — refynr only ever exports a copy.
          </p>
        </div>
      )}
    </main>
  );
}
