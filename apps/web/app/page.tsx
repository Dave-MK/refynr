"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent } from "react";
import {
  applyPatches,
  buildReport,
  cleanse,
  findReplace,
  mergeColumns,
  reportToMarkdown,
  splitColumn,
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
  WorkerMessage,
} from "@/workers/cleanse.worker";
import { AuthNav } from "@/components/AuthNav";
import { Landing } from "@/components/Landing";
import { AnalysisPanel } from "@/components/AnalysisPanel";
import { RecipeBar } from "@/components/RecipeBar";
import { DatasetDiff } from "@/components/DatasetDiff";
import { DataTable, type EditableCell, type ViewMode } from "@/components/DataTable";
import { downloadCsv, toTsv } from "@/lib/csv";
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
  // Set when a large source (e.g. Parquet) was loaded as a capped preview.
  const [truncated, setTruncated] = useState<{ shown: number; total: number } | null>(null);
  // Version-comparison state — a second file to diff the loaded one against.
  const [baseName, setBaseName] = useState("data");
  const [compareTable, setCompareTable] = useState<Table | null>(null);
  const [compareName, setCompareName] = useState("");
  // "Copy" button feedback, drag-over highlight, and finding→cell locating.
  const [copied, setCopied] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [highlightKeys, setHighlightKeys] = useState<Set<string>>(new Set());
  const [scrollToKey, setScrollToKey] = useState<string | null>(null);
  const [scrollNonce, setScrollNonce] = useState(0);
  // Live stage line while the worker chews a big file ("Analysing 100,000 rows…").
  const [progressStage, setProgressStage] = useState<string | null>(null);
  // Multi-sheet workbooks: names + which one is loaded, and the File so a
  // different sheet can be re-read on demand.
  const [sheets, setSheets] = useState<string[]>([]);
  const [sheetName, setSheetName] = useState<string | null>(null);
  const xlsxFile = useRef<File | null>(null);
  // Find & replace state.
  const [findText, setFindText] = useState("");
  const [replaceText, setReplaceText] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  // Undo: snapshots of the review state — including the base table, so shape
  // transforms (split/merge) are undoable too — restored by Ctrl+Z or the toast.
  const undoStack = useRef<
    {
      base: { table: Table; result: CleanseResult } | null;
      baseName: string;
      disabled: Set<string>;
      skipRules: Set<string>;
      options: EngineOptions;
      manualEdits: Map<string, CellValue>;
    }[]
  >([]);
  const [undoDepth, setUndoDepth] = useState(0);
  const [toast, setToast] = useState<{ message: string; undoable: boolean } | null>(null);
  const toastTimer = useRef<number | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const compareInput = useRef<HTMLInputElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const pendingName = useRef("data");
  const pendingCompareName = useRef("comparison");

  useEffect(() => {
    const worker = new Worker(
      new URL("../workers/cleanse.worker.ts", import.meta.url),
    );
    worker.onmessage = (e: MessageEvent<WorkerMessage>) => {
      const msg = e.data;
      if ("kind" in msg) {
        setProgressStage(msg.stage);
        return;
      }
      setBusy(false);
      setProgressStage(null);
      if (!msg.ok) {
        setError(
          msg.tag === "compare"
            ? `Couldn't read the comparison file: ${msg.error}`
            : `Couldn't read that data: ${msg.error}`,
        );
        return;
      }
      if (msg.tag === "compare") {
        setCompareTable(msg.table);
        setCompareName(pendingCompareName.current);
        setError(null);
        return;
      }
      setBase({ table: msg.table, result: msg.result });
      setBaseName(pendingName.current);
      setManualEdits(new Map());
      setDisabled(new Set());
      setOptions({});
      setSkipRules(new Set());
      setTruncated(msg.truncated ?? null);
      setSheets(msg.sheets ?? []);
      setSheetName(msg.sheetName ?? null);
      setCompareTable(null); // a fresh dataset invalidates any prior comparison
      setCompareName("");
      setHighlightKeys(new Set());
      setScrollToKey(null);
      undoStack.current = [];
      setUndoDepth(0);
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
    (text: string, name = "pasted data") => {
      pendingName.current = name;
      submit({ kind: "text", text });
    },
    [submit],
  );

  const onFile = useCallback(
    async (file: File) => {
      pendingName.current = file.name;
      if (/\.(xlsx|xls)$/i.test(file.name)) {
        xlsxFile.current = file; // kept so a different sheet can be loaded later
        const buffer = await file.arrayBuffer();
        submit({ kind: "xlsx", buffer, name: file.name }, [buffer]);
      } else if (/\.parquet$/i.test(file.name)) {
        const buffer = await file.arrayBuffer();
        submit({ kind: "parquet", buffer, name: file.name }, [buffer]);
      } else if (/\.json$/i.test(file.name)) {
        submit({ kind: "json", text: await file.text() });
      } else {
        analyse(await file.text(), file.name);
      }
    },
    [analyse, submit],
  );

  // Load a second file to compare the current dataset against (version diff).
  const onCompareFile = useCallback(
    async (file: File) => {
      pendingCompareName.current = file.name;
      if (/\.(xlsx|xls)$/i.test(file.name)) {
        const buffer = await file.arrayBuffer();
        submit({ kind: "xlsx", buffer, name: file.name, tag: "compare" }, [buffer]);
      } else if (/\.parquet$/i.test(file.name)) {
        const buffer = await file.arrayBuffer();
        submit({ kind: "parquet", buffer, name: file.name, tag: "compare" }, [buffer]);
      } else if (/\.json$/i.test(file.name)) {
        submit({ kind: "json", text: await file.text(), tag: "compare" });
      } else {
        submit({ kind: "text", text: await file.text(), tag: "compare" });
      }
    },
    [submit],
  );

  // original + manual edits — the working table everything derives from.
  const working = useMemo(
    () => (base ? applyManualEdits(base.table, manualEdits) : null),
    [base, manualEdits],
  );

  // Whether non-default engine options are in play (from a recipe, command, or
  // an expectation rule) — any of these means we must re-cleanse on the main thread.
  const hasOptions = !!(
    options.dateOrder ||
    options.dateOutput ||
    options.disabledRules?.length ||
    options.constraints?.length
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

  // ── Undo ──────────────────────────────────────────────────────────────────
  // Every mutating review action pushes a snapshot first; Ctrl+Z (or the
  // toast's Undo) pops one. State snapshots are simpler and safer than
  // per-action inverse logic, and the sets/maps involved are small.
  const snapshot = useCallback(() => {
    undoStack.current.push({
      base,
      baseName,
      disabled: new Set(disabled),
      skipRules: new Set(skipRules),
      options,
      manualEdits: new Map(manualEdits),
    });
    if (undoStack.current.length > 50) undoStack.current.shift();
    setUndoDepth(undoStack.current.length);
  }, [base, baseName, disabled, skipRules, options, manualEdits]);

  const undo = useCallback(() => {
    const prev = undoStack.current.pop();
    if (!prev) return;
    setBase(prev.base);
    setBaseName(prev.baseName);
    setDisabled(prev.disabled);
    setSkipRules(prev.skipRules);
    setOptions(prev.options);
    setManualEdits(prev.manualEdits);
    setHighlightKeys(new Set());
    setScrollToKey(null);
    setUndoDepth(undoStack.current.length);
    setToast(null);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "z") return;
      const el = document.activeElement;
      // Leave native undo alone inside text fields.
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return;
      e.preventDefault();
      undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo]);

  const showToast = useCallback((message: string, undoable = true) => {
    setToast({ message, undoable });
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 6000);
  }, []);

  // ── Column transforms (split / merge) ─────────────────────────────────────
  // Shape changes can't be cell patches, so a transform bakes the current
  // manual edits into a NEW base table (via the pure engine functions) and
  // re-analyses it. The pre-transform state — table included — sits on the
  // undo stack, so Ctrl+Z reverses the whole operation.
  const applyTransform = useCallback(
    (make: (t: Table) => Table, label: string, noopMessage: string) => {
      if (!working) return;
      const next = make(working);
      if (next === working) {
        showToast(noopMessage, false);
        return;
      }
      snapshot();
      setBase({ table: next, result: cleanse(next, options) });
      setManualEdits(new Map());
      setHighlightKeys(new Set());
      setScrollToKey(null);
      showToast(label);
    },
    [working, options, snapshot, showToast],
  );

  const onSplit = useCallback(
    (col: number, separator: string) => {
      const name = base?.table.headers[col] ?? "column";
      applyTransform(
        (t) => splitColumn(t, col, { separator }),
        `Split "${name}"`,
        `Nothing to split — "${separator || " "}" doesn't appear in "${name}".`,
      );
    },
    [applyTransform, base],
  );

  const onMerge = useCallback(
    (cols: number[], separator: string) => {
      applyTransform(
        (t) => mergeColumns(t, cols, { separator }),
        `Merged ${cols.length} columns`,
        "Pick at least two different columns to merge.",
      );
    },
    [applyTransform],
  );

  // ── Find & replace ────────────────────────────────────────────────────────
  // Matches are computed by the engine (pure, non-mutating); replacements are
  // applied through the manual-edit pipeline, so they're re-scored live,
  // visible in the Changes view, and undoable like any other edit.
  const matches = useMemo(
    () => (working && findText ? findReplace(working, findText, replaceText, { matchCase }) : []),
    [working, findText, replaceText, matchCase],
  );

  const replaceAll = useCallback(() => {
    if (matches.length === 0 || !base) return;
    snapshot();
    setManualEdits((prev) => {
      const next = new Map(prev);
      for (const m of matches) {
        const key = `${m.cell.row}:${m.cell.col}`;
        const original = base.table.rows[m.cell.row]?.[m.cell.col] ?? null;
        if (m.after === original) next.delete(key);
        else next.set(key, m.after === "" ? null : m.after);
      }
      return next;
    });
    showToast(`Replaced ${matches.length} value${matches.length === 1 ? "" : "s"}`);
    setFindText("");
    setReplaceText("");
  }, [matches, base, snapshot, showToast]);

  // ── Multi-sheet workbooks ─────────────────────────────────────────────────
  const selectSheet = useCallback(
    async (index: number) => {
      const file = xlsxFile.current;
      if (!file) return;
      pendingName.current = file.name;
      const buffer = await file.arrayBuffer();
      submit({ kind: "xlsx", buffer, name: file.name, sheet: index }, [buffer]);
    },
    [submit],
  );

  const onEditCell = useCallback(
    (row: number, col: number, value: CellValue) => {
      if (!base) return;
      snapshot();
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
    [base, snapshot],
  );

  const toggleFinding = useCallback(
    (index: number) => {
      const f = result?.findings[index];
      if (!f) return;
      snapshot();
      const key = findingKey(f);
      setDisabled((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
    },
    [result, snapshot],
  );

  // Apply engine options. Constraints are preserved across a plain-English
  // command (which doesn't set them) so typed rules aren't wiped by a command.
  const onApplyOptions = useCallback(
    (next: EngineOptions) => {
      snapshot();
      setOptions((prev) => ({ ...next, constraints: next.constraints ?? prev.constraints }));
    },
    [snapshot],
  );

  // Apply a full recipe: its options plus which fixes to leave un-accepted.
  const onApplyRecipe = useCallback(
    (recipe: Recipe) => {
      snapshot();
      setOptions(recipe.options);
      setSkipRules(new Set(recipe.skipRules));
      setDisabled(new Set()); // recipe defines the accept/skip state
    },
    [snapshot],
  );

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

  // Download a Markdown audit report of exactly what was changed and what's
  // left for review — the shareable "show me what you did" artefact.
  const downloadReport = useCallback(() => {
    if (!result) return;
    const report = buildReport(result, accepted.ids);
    const md = reportToMarkdown(report, {
      title: "refynr cleaning report",
      timestamp: new Date().toLocaleString("en-GB"),
    });
    const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "refynr-report.md";
    a.click();
    URL.revokeObjectURL(url);
  }, [result, accepted]);

  // Copy the cleaned table to the clipboard as TSV — paste straight back into
  // Excel or Google Sheets, no file download needed.
  const copyCleaned = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(toTsv(cleaned));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setError("Couldn't access the clipboard — use Download CSV instead.");
    }
  }, [cleaned]);

  // Accept every fixable fix at once, or clear them all.
  const onSetAll = useCallback(
    (accept: boolean) => {
      if (!result) return;
      snapshot();
      if (accept) {
        setDisabled(new Set());
        setSkipRules(new Set());
      } else {
        const all = new Set<string>();
        result.findings.forEach((f) => {
          if (f.patchIds.length > 0) all.add(findingKey(f));
        });
        setDisabled(all);
      }
      showToast(accept ? "Accepted all fixes" : "Cleared all fixes");
    },
    [result, snapshot, showToast],
  );

  // Jump to and highlight the cells a finding refers to.
  const onLocate = useCallback(
    (index: number) => {
      const f = result?.findings[index];
      if (!f || !result) return;
      const keys = new Set<string>();
      if (f.patchIds.length > 0) {
        for (const p of result.patches) {
          if (p.rule !== f.rule) continue;
          if (p.kind === "cell") keys.add(`${p.cell.row}:${p.cell.col}`);
          else if (p.kind === "remove-row") keys.add(`${p.row}:0`);
        }
      }
      if (f.cells) for (const c of f.cells) keys.add(`${c.row}:${c.col}`);
      if (keys.size === 0) return;

      let target: string | null = null;
      let minRow = Infinity;
      for (const k of keys) {
        const r = Number(k.split(":")[0]);
        if (r < minRow) { minRow = r; target = k; }
      }
      setMode("diff"); // the Changes view is where patches / advisories render
      setHighlightKeys(keys);
      setScrollToKey(target);
      setScrollNonce((n) => n + 1);
    },
    [result],
  );

  // Drag-and-drop a file anywhere onto the page.
  const onDrop = useCallback(
    (e: ReactDragEvent) => {
      e.preventDefault();
      setDragActive(false);
      const file = e.dataTransfer.files?.[0];
      if (file) void onFile(file);
    },
    [onFile],
  );

  // Paste tabular data with Ctrl/Cmd+V anywhere (when nothing's loaded and the
  // focus isn't already in a text field).
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (base) return;
      const el = document.activeElement;
      if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) return;
      const text = e.clipboardData?.getData("text");
      if (text && text.trim()) {
        e.preventDefault();
        analyse(text, "pasted data");
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [base, analyse]);

  return (
    <main
      className="relative mx-auto max-w-[960px] px-5 py-8"
      onDragOver={(e) => {
        e.preventDefault();
        if (!dragActive) setDragActive(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragActive(false);
      }}
      onDrop={onDrop}
    >
      {dragActive && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-ink/70 backdrop-blur-sm">
          <div className="rounded-2xl border-2 border-dashed border-teal/60 bg-card px-10 py-8 text-center">
            <p className="text-lg font-semibold text-hi">Drop your file to clean it</p>
            <p className="mt-1 font-mono text-xs text-mut">CSV · Excel · JSON · Parquet</p>
          </div>
        </div>
      )}
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
                setCompareTable(null);
                setCompareName("");
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
              Upload CSV / Excel / JSON / Parquet
            </button>
            <input
              ref={fileInput}
              type="file"
              accept=".csv,.tsv,.txt,.xlsx,.xls,.json,.parquet"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onFile(f);
                e.target.value = "";
              }}
            />
            <button
              onClick={() => analyse(SAMPLE_DATA, "sample data")}
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
          {busy && progressStage && (
            <p className="mt-4 animate-pulse font-mono text-sm text-teal">
              › {progressStage}
            </p>
          )}
        </section>
        </Landing>
      )}

      {base && working && result && (
        <div className="space-y-5">
          <p className="font-mono text-[12px] text-mut">
            <span className="text-body">{baseName}</span> ·{" "}
            <span className="tabular-nums text-hi">
              {base.table.rows.length.toLocaleString("en-GB")}
            </span>{" "}
            rows ×{" "}
            <span className="tabular-nums text-hi">{base.table.headers.length}</span>{" "}
            columns
          </p>

          {error && (
            <p className="rounded-lg border border-coral/25 bg-coral/10 px-4 py-3 text-sm text-coral">
              {error}
            </p>
          )}

          {busy && progressStage && (
            <p className="animate-pulse rounded-lg border border-line bg-card px-4 py-3 font-mono text-sm text-teal">
              › {progressStage}
            </p>
          )}

          {sheets.length > 1 && (
            <p className="flex flex-wrap items-center gap-2 rounded-lg border border-amber/30 bg-amber/10 px-4 py-3 text-sm text-body">
              <span>
                This workbook has{" "}
                <span className="font-mono font-semibold text-hi">{sheets.length}</span>{" "}
                sheets — showing{" "}
                <span className="font-mono font-semibold text-hi">"{sheetName}"</span>.
              </span>
              <label className="inline-flex items-center gap-2 font-mono text-[12px] text-mut">
                Switch:
                <select
                  value={sheets.indexOf(sheetName ?? "")}
                  onChange={(e) => void selectSheet(Number(e.target.value))}
                  className="rounded-md border border-line bg-inset px-2 py-1 text-[12px] text-body outline-none focus:border-teal/60"
                >
                  {sheets.map((s, i) => (
                    <option key={s} value={i}>{s}</option>
                  ))}
                </select>
              </label>
            </p>
          )}

          {truncated && (
            <p className="rounded-lg border border-amber/30 bg-amber/10 px-4 py-3 text-sm text-body">
              This file has{" "}
              <span className="font-mono font-semibold text-hi">
                {truncated.total.toLocaleString("en-GB")}
              </span>{" "}
              rows — refynr loaded the first{" "}
              <span className="font-mono font-semibold text-hi">
                {truncated.shown.toLocaleString("en-GB")}
              </span>{" "}
              for this session. The cleaned export will contain those rows.
            </p>
          )}

          <RecipeBar
            currentOptions={options}
            currentSkipRules={currentSkipRules}
            columns={base.table.headers}
            onApplyOptions={onApplyOptions}
            onApplyRecipe={onApplyRecipe}
            onSplit={onSplit}
            onMerge={onMerge}
          />

          <AnalysisPanel
            score={result.score}
            projected={result.projectedScore}
            findings={result.findings}
            enabled={enabledIndices}
            onToggle={toggleFinding}
            onSetAll={onSetAll}
            onLocate={onLocate}
            profile={result.profile}
            result={result}
          />

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
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
            {undoDepth > 0 && (
              <button
                onClick={undo}
                title="Undo last review action (Ctrl+Z)"
                className="rounded-lg border border-line2 bg-card2 px-3 py-1.5 font-mono text-[11px] text-mut transition hover:text-body"
              >
                ↶ undo
              </button>
            )}
            </div>
            <div className="flex gap-2.5">
              <button
                onClick={() => void copyCleaned()}
                title="Copy the cleaned data — paste straight into Excel or Google Sheets"
                className="rounded-lg bg-gradient-to-r from-teal to-cyan px-5 py-2 text-sm font-semibold text-ink shadow-[0_0_18px_rgba(45,212,191,0.35)] transition hover:brightness-110"
              >
                {copied ? "✓ Copied" : "Copy"}
              </button>
              <button
                onClick={() => downloadCsv(cleaned, "refynr-cleaned.csv")}
                className="rounded-lg border border-line2 bg-card2 px-5 py-2 text-sm font-medium text-body transition hover:border-mut"
              >
                Download CSV
              </button>
              <button
                onClick={() => void downloadXlsx(cleaned, "refynr-cleaned.xlsx")}
                className="rounded-lg border border-line2 bg-card2 px-5 py-2 text-sm font-medium text-body transition hover:border-mut"
              >
                Download Excel
              </button>
              <button
                onClick={downloadReport}
                title="Download a Markdown audit report of what changed"
                className="rounded-lg border border-line2 bg-card2 px-5 py-2 text-sm font-medium text-body transition hover:border-mut"
              >
                Report
              </button>
              <button
                onClick={() => compareInput.current?.click()}
                title="Compare this dataset against another version"
                className="rounded-lg border border-line2 bg-card2 px-5 py-2 text-sm font-medium text-body transition hover:border-mut"
              >
                ⇄ Compare
              </button>
              <input
                ref={compareInput}
                type="file"
                accept=".csv,.tsv,.txt,.xlsx,.xls,.json,.parquet"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void onCompareFile(f);
                  e.target.value = "";
                }}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-card2 px-4 py-3">
            <span className="label text-teal!">Find &amp; replace</span>
            <input
              value={findText}
              onChange={(e) => setFindText(e.target.value)}
              placeholder="Find…"
              className="min-w-[130px] flex-1 rounded-lg border border-line bg-inset px-3 py-1.5 text-[13px] text-body outline-none placeholder:text-dim focus:border-teal/60"
            />
            <span className="text-dim" aria-hidden>→</span>
            <input
              value={replaceText}
              onChange={(e) => setReplaceText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && replaceAll()}
              placeholder="Replace with…"
              className="min-w-[130px] flex-1 rounded-lg border border-line bg-inset px-3 py-1.5 text-[13px] text-body outline-none placeholder:text-dim focus:border-teal/60"
            />
            <label className="inline-flex cursor-pointer items-center gap-1.5 font-mono text-[11px] text-mut">
              <input
                type="checkbox"
                checked={matchCase}
                onChange={(e) => setMatchCase(e.target.checked)}
                className="h-3.5 w-3.5 accent-teal"
              />
              match case
            </label>
            {findText && (
              <span className="font-mono text-[11px] tabular-nums text-mut">
                {matches.length} match{matches.length === 1 ? "" : "es"}
              </span>
            )}
            <button
              onClick={replaceAll}
              disabled={matches.length === 0}
              className="rounded-lg border border-line2 bg-card px-3 py-1.5 font-mono text-[11px] font-semibold text-body transition hover:border-mut disabled:opacity-40"
            >
              Replace all
            </button>
          </div>

          {compareTable && (
            <DatasetDiff
              before={base.table}
              after={compareTable}
              beforeName={baseName}
              afterName={compareName}
              onClose={() => {
                setCompareTable(null);
                setCompareName("");
              }}
            />
          )}

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
            highlightKeys={highlightKeys}
            scrollToKey={scrollToKey}
            scrollNonce={scrollNonce}
          />

          <p className="pb-8 text-center font-mono text-[11px] leading-relaxed text-dim">
            {manualCount > 0
              ? `${manualCount} manual edit${manualCount === 1 ? "" : "s"} applied and re-scored live. `
              : "Amber cells in Changes are advisory — edit them to fix by hand and watch the score update. "}
            Your original data is never modified — refynr only ever exports a copy.
          </p>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2">
          <div className="flex items-center gap-4 rounded-xl border border-line2 bg-card px-5 py-3 shadow-[0_8px_30px_rgba(0,0,0,0.4)]">
            <span className="text-sm text-hi">{toast.message}</span>
            {toast.undoable && (
              <button
                onClick={undo}
                className="rounded-md bg-teal/15 px-3 py-1 font-mono text-[11px] font-semibold text-teal transition hover:bg-teal/25"
              >
                Undo
              </button>
            )}
            <button
              onClick={() => setToast(null)}
              aria-label="Dismiss"
              className="font-mono text-[11px] text-dim transition hover:text-body"
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
