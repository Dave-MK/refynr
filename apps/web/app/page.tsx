"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent } from "react";
import {
  applyPatches,
  buildReport,
  cleanse,
  deleteColumn,
  deleteRows,
  findReplace,
  groupBy,
  joinTables,
  mergeColumns,
  reportToHtml,
  reportToMarkdown,
  splitColumn,
  suggestConstraints,
  unpivot,
  type CellPatch,
  type CellValue,
  type CleanseResult,
  type Aggregation,
  type EngineOptions,
  type Finding,
  type JoinKey,
  type JoinType,
  type Recipe,
  type RecipeJoin,
  type Table,
} from "@refynr/engine";
import type {
  CleanseRequest,
  WorkerMessage,
} from "@/workers/cleanse.worker";
import { AuthNav } from "@/components/AuthNav";
import { ChangeHistory } from "@/components/ChangeHistory";
import { Logo } from "@/components/Logo";
import { Landing } from "@/components/Landing";
import { AnalysisPanel } from "@/components/AnalysisPanel";
import { RecipeBar } from "@/components/RecipeBar";
import { DatasetDiff } from "@/components/DatasetDiff";
import { JoinPanel, type LoadedDataset } from "@/components/JoinPanel";
import { GroupPanel } from "@/components/GroupPanel";
import { planRecipeJoin, resolveSuppliedDataset } from "@/lib/join-recipe";
import { DataTable, type EditableCell, type ViewMode } from "@/components/DataTable";
import { downloadBlob, downloadCsv, downloadJson, downloadTsv, toTsv } from "@/lib/csv";
import { downloadXlsx } from "@/lib/xlsx";
import { downloadReportPdf } from "@/lib/pdf";
import { SAMPLE_DATA } from "@/lib/sample";

/** Stable identity for a finding across re-cleanses (rule + optional column). */
const findingKey = (f: Finding): string => `${f.rule}:${f.column ?? ""}`;

/** Above this row count, re-analysis after an edit/option/transform runs in
 *  the worker (async, UI stays live) instead of synchronously on the main
 *  thread — a 100k-row cleanse takes seconds and would freeze the page. */
const ASYNC_CLEANSE_ROWS = 20_000;

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

/** Landing-page section anchors — shared by the desktop header nav and the
 *  small-screen dropdown so the two can't drift apart. */
const NAV_LINKS = [
  ["#how", "How it works"],
  ["#catches", "What it catches"],
  ["#why", "Why refynr"],
  ["#privacy", "Privacy"],
] as const;

const DOWNLOAD_FORMATS = [
  ["csv", "CSV", ".csv — opens anywhere, keeps it simple"],
  ["xlsx", "Excel", ".xlsx — a ready-to-use workbook"],
  ["tsv", "TSV", ".tsv — tab-separated plain text"],
  ["json", "JSON", ".json — records for code and APIs"],
] as const;

const REPORT_FORMATS = [
  ["pdf", "PDF", ".pdf — print-ready, share anywhere"],
  ["html", "Web page", ".html — email or share as-is"],
  ["md", "Markdown", ".md — docs, GitHub, wikis"],
  ["json", "JSON", ".json — pipelines and tooling"],
] as const;

/** A ▾ button opening an upward format chooser — Download and Report share it. */
function ExportMenu<T extends string>({
  label,
  title,
  open,
  onToggle,
  options,
  onPick,
}: {
  label: string;
  title: string;
  open: boolean;
  onToggle: () => void;
  options: ReadonlyArray<readonly [T, string, string]>;
  onPick: (format: T) => void;
}) {
  return (
    <div className="relative">
      <button
        onClick={(e) => {
          e.stopPropagation(); // keep the outside-click closer from firing
          onToggle();
        }}
        title={title}
        className={`rounded-lg border px-5 py-2 text-sm font-medium transition ${
          open
            ? "border-teal/50 bg-teal/10 text-teal"
            : "border-line2 bg-card2 text-body hover:border-mut"
        }`}
      >
        {label} ▾
      </button>
      {open && (
        <div
          className="absolute bottom-full left-0 z-40 mb-2 w-56 overflow-hidden rounded-xl border border-line2 bg-card shadow-[0_8px_30px_rgba(0,0,0,0.4)]"
          onClick={(e) => e.stopPropagation()}
        >
          {options.map(([format, name, hint]) => (
            <button
              key={format}
              onClick={() => onPick(format)}
              className="block w-full px-4 py-2.5 text-left transition hover:bg-teal/10"
            >
              <span className="block text-sm font-medium text-body">{name}</span>
              <span className="block font-mono text-[10.5px] text-dim">{hint}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
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
  // When the current base table was analysed — the timestamp the Change
  // history tab stamps on app-applied fixes (they apply at analysis time).
  const [analysedAt, setAnalysedAt] = useState(0);
  // Async re-analysis for big tables (see ASYNC_CLEANSE_ROWS): the latest
  // worker result, the in-flight status line, and a nonce so a stale response
  // can never overwrite a newer edit's result.
  const [asyncResult, setAsyncResult] = useState<{ nonce: number; result: CleanseResult } | null>(null);
  const [recleansing, setRecleansing] = useState<string | null>(null);
  // JSON of the EngineOptions the current base.result was computed under —
  // when the active options match, the base result is already fresh and no
  // re-cleanse is needed (e.g. right after a transform, which analyses with
  // the active options baked in).
  const [baseOptionsKey, setBaseOptionsKey] = useState("{}");
  const recleanseNonce = useRef(0);
  const recleanseIntent = useRef<
    | null
    | { nonce: number; kind: "edit" }
    | {
        nonce: number;
        kind: "transform";
        table: Table;
        label: string;
        /** The history snapshot this transform pushed — removed if superseded. */
        snap: (typeof undoStack.current)[number];
        /** Options the worker is analysing with — becomes baseOptionsKey. */
        optionsKey: string;
        /** Advisory findings the transform produced (joins); [] for the rest. */
        joinFindings: Finding[];
        /** The join's reusable shape, for saving into a recipe. */
        join?: RecipeJoin;
      }
  >(null);
  const [baseName, setBaseName] = useState("data");
  // Secondary datasets loaded alongside the working one. One store serves both
  // the version diff ("which of these am I comparing against?") and the join
  // ("which of these am I joining to?") — a file loaded for one is available to
  // the other without loading it twice.
  const [datasets, setDatasets] = useState<LoadedDataset[]>([]);
  /** Mirrors `datasets.length` so a load can know its own index without
   *  reading state from inside a setState updater. */
  const datasetCount = useRef(0);
  // Index into `datasets` currently shown in the diff view, or null for none.
  const [compareIndex, setCompareIndex] = useState<number | null>(null);
  const [showJoin, setShowJoin] = useState(false);
  const [showGroup, setShowGroup] = useState(false);
  // Small-screen section-nav dropdown (the hamburger menu on the landing view).
  const [navOpen, setNavOpen] = useState(false);
  // Whether the page has scrolled at all — drives the header's translucent
  // treatment (transparent at the very top, frosted once you scroll).
  const [scrolled, setScrolled] = useState(false);
  // Why the pending secondary file is being loaded, so the right surface opens
  // when it lands.
  const secondaryIntent = useRef<"compare" | "join" | "recipe-join">("compare");
  // Advisory findings from the join that produced the current base table. Held
  // separately from the engine's result because they describe the OPERATION,
  // not the table's intrinsic quality — and so they survive the re-cleanse that
  // the join's new base triggers.
  const [joinFindings, setJoinFindings] = useState<Finding[]>([]);
  // The shape of the join that produced the current base, so "Save current" can
  // record it in a recipe. Config only — never the joined dataset.
  const [currentJoin, setCurrentJoin] = useState<RecipeJoin | undefined>(undefined);
  // A recipe waiting on its join dataset: applying a recipe with a join step
  // needs the second file, which the recipe deliberately doesn't carry.
  const pendingJoinRecipe = useRef<Recipe | null>(null);
  // "Copy" button feedback, drag-over highlight, and finding→cell locating.
  const [copied, setCopied] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  // Locate pins a highlight until the next action; hover previews on top of
  // it — separate states so mouseleave can't wipe a located highlight.
  const [pinnedKeys, setPinnedKeys] = useState<Set<string>>(new Set());
  const [hoverKeys, setHoverKeys] = useState<Set<string> | null>(null);
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
  // transforms (split/merge/unpivot) are undoable too — restored by Ctrl+Z,
  // the toast, or the visible history list (Power Query's applied-steps idea).
  const undoStack = useRef<
    {
      label: string;
      /** When the action happened — feeds the Change history tab. */
      at: number;
      base: { table: Table; result: CleanseResult } | null;
      baseName: string;
      analysedAt: number;
      baseOptionsKey: string;
      disabled: Set<string>;
      skipRules: Set<string>;
      options: EngineOptions;
      manualEdits: Map<string, CellValue>;
      /** Join diagnosis attached to this base table, so undoing a join takes
       *  its findings away with it. */
      joinFindings: Finding[];
      /** …and its saveable shape, so undo also forgets the join for recipes. */
      currentJoin: RecipeJoin | undefined;
    }[]
  >([]);
  const [undoDepth, setUndoDepth] = useState(0);
  const [showHistory, setShowHistory] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  // Which export chooser is open — the Download or Report format menu.
  const [openMenu, setOpenMenu] = useState<null | "download" | "report">(null);
  const [toast, setToast] = useState<{ message: string; undoable: boolean } | null>(null);
  const toastTimer = useRef<number | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const compareInput = useRef<HTMLInputElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const pendingName = useRef("data");
  const pendingCompareName = useRef("comparison");
  // Per-stream load nonces: a response from an older load that finishes after
  // a newer one started is dropped, so it can't clobber the newer data or
  // mislabel it with the newer file's name.
  const mainLoadNonce = useRef(0);
  const compareLoadNonce = useRef(0);

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
      if (msg.tag === "recleanse") {
        const intent = recleanseIntent.current;
        if (!msg.ok) {
          setRecleansing(null);
          setError(`Couldn't re-analyse the data: ${msg.error}`);
          return;
        }
        // A newer edit/transform superseded this response — drop it.
        if (!intent || msg.nonce !== intent.nonce) return;
        recleanseIntent.current = null;
        setRecleansing(null);
        if (intent.kind === "transform") {
          setBase({ table: intent.table, result: msg.result });
          setBaseOptionsKey(intent.optionsKey);
          setAnalysedAt(Date.now());
          setManualEdits(new Map());
          setJoinFindings(intent.joinFindings);
          if (intent.join) setCurrentJoin(intent.join);
          setAsyncResult(null);
          setPinnedKeys(new Set());
          setHoverKeys(null);
          setScrollToKey(null);
          showToast(intent.label);
        } else {
          setAsyncResult({ nonce: msg.nonce, result: msg.result });
        }
        return;
      }
      // Stale response from a superseded load — ignore it entirely.
      const expected =
        msg.tag === "compare" ? compareLoadNonce.current : mainLoadNonce.current;
      if (msg.nonce !== undefined && msg.nonce !== expected) return;
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
        // Lands in the shared dataset store; the intent decides what opens.
        // The index this dataset will occupy. Tracked in a ref rather than
        // read inside the setDatasets updater: calling other setState functions
        // from within an updater is unsupported, and React's dev-mode double
        // invocation made the panel open only intermittently.
        const index = datasetCount.current;
        datasetCount.current += 1;
        setDatasets((prev) => [...prev, { name: pendingCompareName.current, table: msg.table }]);
        if (secondaryIntent.current === "compare") setCompareIndex(index);
        else if (secondaryIntent.current === "join") setShowJoin(true);
        // "recipe-join": the effect below finishes the waiting recipe.
        setError(null);
        return;
      }
      setBase({ table: msg.table, result: msg.result });
      setBaseName(pendingName.current);
      setBaseOptionsKey("{}"); // fresh loads analyse with default options
      setAnalysedAt(Date.now());
      setAsyncResult(null);
      setRecleansing(null);
      recleanseIntent.current = null;
      setManualEdits(new Map());
      setDisabled(new Set());
      setOptions({});
      setSkipRules(new Set());
      setTruncated(msg.truncated ?? null);
      setSheets(msg.sheets ?? []);
      setSheetName(msg.sheetName ?? null);
      // A fresh dataset invalidates any prior comparison and join context.
      setDatasets([]);
      datasetCount.current = 0;
      setCompareIndex(null);
      setShowJoin(false);
      setJoinFindings([]);
      setPinnedKeys(new Set());
      setHoverKeys(null);
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
    const nonce =
      "tag" in request && request.tag === "compare"
        ? ++compareLoadNonce.current
        : ++mainLoadNonce.current;
    workerRef.current?.postMessage({ ...request, nonce }, transfer ?? []);
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

  // Load a second file into the shared dataset store. `secondaryIntent` (set by
  // whichever button opened the picker) decides whether the diff or the join
  // panel opens once it lands.
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

  // Re-cleanse once the user has made manual edits or the engine options
  // differ from the ones the CURRENT base result was computed under (tracked
  // as baseOptionsKey — a transform re-analyses with the active options, so
  // landing one must not trigger a second, redundant re-analysis). Small
  // tables re-cleanse synchronously (instant); big tables go through the
  // worker (the effect below) and serve the previous result until the fresh
  // one lands — a beat of staleness beats seconds of frozen UI.
  const isBig = (base?.table.rows.length ?? 0) > ASYNC_CLEANSE_ROWS;
  const optionsKey = JSON.stringify(options);
  const needsRecleanse = manualEdits.size > 0 || optionsKey !== baseOptionsKey;

  const engineResult = useMemo(() => {
    if (!base) return null;
    if (!needsRecleanse) return base.result;
    if (isBig) return asyncResult?.result ?? base.result;
    return cleanse(working!, options);
  }, [base, needsRecleanse, isBig, asyncResult, working, options]);

  // The join's diagnosis rides alongside the engine's own findings so it lands
  // in the findings list, the audit report and the score card's "left for
  // review" count without any of them needing to know joins exist. Safe because
  // every join finding is advisory (patchIds: []): the accept/patch machinery
  // skips them, and the score is untouched — a joined row that arrived empty is
  // already counted by the completeness dimension, so scoring the join as well
  // would penalise the same gap twice.
  const result = useMemo(() => {
    if (!engineResult) return null;
    if (joinFindings.length === 0) return engineResult;
    return { ...engineResult, findings: [...engineResult.findings, ...joinFindings] };
  }, [engineResult, joinFindings]);

  // A transform that never landed (superseded by a newer action before its
  // worker analysis returned) must not leave its snapshot in the history —
  // it would read as an applied step that did nothing.
  const cancelPendingTransform = useCallback(() => {
    const intent = recleanseIntent.current;
    if (intent?.kind === "transform") {
      const i = undoStack.current.indexOf(intent.snap);
      if (i !== -1) {
        undoStack.current.splice(i, 1);
        setUndoDepth(undoStack.current.length);
      }
    }
  }, []);

  // Drive the worker for big-table re-analysis. Debounced so a burst of quick
  // edits coalesces into one analysis; the nonce makes the latest request win
  // (a stale response is dropped in the worker handler above).
  useEffect(() => {
    if (!isBig || !working) return;
    if (!needsRecleanse) {
      cancelPendingTransform();
      recleanseIntent.current = null;
      setRecleansing(null);
      return;
    }
    const timer = window.setTimeout(() => {
      cancelPendingTransform();
      const nonce = ++recleanseNonce.current;
      recleanseIntent.current = { nonce, kind: "edit" };
      setRecleansing(
        `Re-analysing ${working.rows.length.toLocaleString("en-GB")} rows after your change…`,
      );
      workerRef.current?.postMessage({ kind: "recleanse", table: working, options, nonce });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [isBig, needsRecleanse, working, options, cancelPendingTransform]);

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
  const snapshot = useCallback(
    (label: string) => {
      undoStack.current.push({
        label,
        at: Date.now(),
        base,
        baseName,
        analysedAt,
        baseOptionsKey,
        disabled: new Set(disabled),
        skipRules: new Set(skipRules),
        options,
        manualEdits: new Map(manualEdits),
        joinFindings,
        currentJoin,
      });
      if (undoStack.current.length > 50) undoStack.current.shift();
      setUndoDepth(undoStack.current.length);
    },
    [base, baseName, analysedAt, baseOptionsKey, disabled, skipRules, options, manualEdits, joinFindings, currentJoin],
  );

  const restore = useCallback((prev: (typeof undoStack.current)[number]) => {
    // Invalidate any in-flight big-table re-analysis — its result would be
    // for a state that no longer exists.
    recleanseNonce.current++;
    recleanseIntent.current = null;
    setRecleansing(null);
    setAsyncResult(null);
    setBase(prev.base);
    setBaseName(prev.baseName);
    setAnalysedAt(prev.analysedAt);
    setBaseOptionsKey(prev.baseOptionsKey);
    setDisabled(prev.disabled);
    setSkipRules(prev.skipRules);
    setOptions(prev.options);
    setManualEdits(prev.manualEdits);
    setJoinFindings(prev.joinFindings);
    setCurrentJoin(prev.currentJoin);
    setPinnedKeys(new Set());
    setHoverKeys(null);
    setScrollToKey(null);
    setUndoDepth(undoStack.current.length);
    setToast(null);
  }, []);

  const undo = useCallback(() => {
    const prev = undoStack.current.pop();
    if (!prev) return;
    restore(prev);
  }, [restore]);

  // Rewind to the state BEFORE the history entry at `index` — i.e. undo that
  // action and everything after it, in one click from the history list.
  const undoTo = useCallback(
    (index: number) => {
      const target = undoStack.current[index];
      if (!target) return;
      undoStack.current = undoStack.current.slice(0, index);
      restore(target);
    },
    [restore],
  );

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
    (
      make: (t: Table) => Table,
      label: string,
      noopMessage: string,
      /** What a join contributes beyond the new table: its advisory findings,
       *  and the reusable shape of the join for saving into a recipe. Both
       *  REPLACE any previous values — they described the previous base. */
      produced: { findings?: Finding[]; join?: RecipeJoin } = {},
    ) => {
      if (!working) return;
      const next = make(working);
      if (next === working) {
        showToast(noopMessage, false);
        return;
      }
      cancelPendingTransform(); // a newer transform supersedes an unfinished one
      snapshot(label);
      if (next.rows.length > ASYNC_CLEANSE_ROWS) {
        // Big table: analyse the reshaped data in the worker; the base swaps
        // in when the result lands so the UI never freezes.
        const nonce = ++recleanseNonce.current;
        recleanseIntent.current = {
          nonce,
          kind: "transform",
          table: next,
          label,
          snap: undoStack.current[undoStack.current.length - 1]!,
          optionsKey: JSON.stringify(options),
          joinFindings: produced.findings ?? [],
          join: produced.join,
        };
        setRecleansing(
          `${label} — re-analysing ${next.rows.length.toLocaleString("en-GB")} rows…`,
        );
        workerRef.current?.postMessage({ kind: "recleanse", table: next, options, nonce });
        return;
      }
      setBase({ table: next, result: cleanse(next, options) });
      setBaseOptionsKey(JSON.stringify(options));
      setAnalysedAt(Date.now());
      setManualEdits(new Map());
      setJoinFindings(produced.findings ?? []);
      // Findings describe one table state, so a later transform clears them.
      // The join SPEC is provenance — how this data was built — so it survives
      // subsequent reshapes: dropping it would make a saved recipe quietly stop
      // reproducing the join, which is worse than recording a join the recipe
      // can't reproduce every later step of.
      if (produced.join) setCurrentJoin(produced.join);
      setPinnedKeys(new Set());
      setHoverKeys(null);
      setScrollToKey(null);
      showToast(label);
    },
    [working, options, snapshot, showToast, cancelPendingTransform],
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

  const onUnpivot = useCallback(
    (cols: number[]) => {
      applyTransform(
        (t) => unpivot(t, cols),
        `Unpivoted ${cols.length} columns`,
        "Pick at least two columns to fold, leaving at least one as the identifier.",
      );
    },
    [applyTransform],
  );

  // A join is a shape change like any other transform — it bakes manual edits
  // into a new base, re-analyses, and lands on the undo stack. What makes it
  // different is that the operation itself has something to say, so its
  // diagnosis rides along as advisory findings.
  const onJoin = useCallback(
    (rightTable: Table, rightName: string, keys: JoinKey[], type: JoinType) => {
      if (!working) return;
      const { findings } = joinTables(working, rightTable, { keys, type });
      setShowJoin(false);
      applyTransform(
        (t) => joinTables(t, rightTable, { keys, type }).table,
        `Joined with "${rightName}"`,
        "That join produced no change.",
        { findings, join: { with: rightName, keys, type } },
      );
    },
    [working, applyTransform],
  );

  // Summarising collapses many rows into one, taking whatever it left out with
  // them — so like the join, its diagnosis rides along as advisory findings.
  const onGroup = useCallback(
    (by: string[], aggregations: Aggregation[]) => {
      if (!working) return;
      const { findings } = groupBy(working, { by, aggregations });
      setShowGroup(false);
      applyTransform(
        (t) => groupBy(t, { by, aggregations }).table,
        `Summarised by ${by.join(" + ")}`,
        "That summary produced no change.",
        { findings },
      );
    },
    [working, applyTransform],
  );

  // Row/column deletion (from the ✕ buttons in the Changes and Cleaned views).
  // Shape changes like any other transform: baked into a new base, undoable.
  const onDeleteRow = useCallback(
    (row: number) => {
      applyTransform(
        (t) => deleteRows(t, [row]),
        `Deleted row ${row + 2}`,
        "That row no longer exists.",
      );
    },
    [applyTransform],
  );

  const onDeleteColumn = useCallback(
    (col: number) => {
      const name = base?.table.headers[col] ?? "column";
      applyTransform(
        (t) => deleteColumn(t, col),
        `Deleted column "${name}"`,
        "Can't delete the only remaining column.",
      );
    },
    [applyTransform, base],
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
    snapshot(`Replaced "${findText}" (${matches.length})`);
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
      snapshot(`Edited ${base.table.headers[col] ?? "cell"}, row ${row + 2}`);
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
      const key = findingKey(f);
      snapshot(`${disabled.has(key) ? "Re-accepted" : "Un-ticked"} "${f.title}"`);
      setDisabled((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
    },
    [result, disabled, snapshot],
  );

  // Apply engine options. Constraints are preserved across a plain-English
  // command (which doesn't set them) so typed rules aren't wiped by a command.
  const onApplyOptions = useCallback(
    (next: EngineOptions) => {
      const prevC = options.constraints?.length ?? 0;
      const label = next.constraints && next.constraints.length > prevC
        ? "Added expectation rule"
        : next.constraints && next.constraints.length < prevC
          ? "Removed expectation rule"
          : (next.dedupeKey ?? []).join() !== (options.dedupeKey ?? []).join()
            ? "Changed duplicate key"
            : next.dateOutput !== options.dateOutput || next.dateOrder !== options.dateOrder
              ? "Changed date handling"
              : "Changed options";
      snapshot(label);
      setOptions((prev) => ({ ...next, constraints: next.constraints ?? prev.constraints }));
    },
    [options, snapshot],
  );

  // Apply a full recipe: its options plus which fixes to leave un-accepted.
  // Apply a recipe's options and skip list. Kept separate from the join step so
  // both the immediate path and the "waited for the dataset" path share it.
  const applyRecipeOptions = useCallback(
    (recipe: Recipe) => {
      setOptions(recipe.options);
      setSkipRules(new Set(recipe.skipRules));
      setDisabled(new Set()); // recipe defines the accept/skip state
      showToast(`Applied recipe "${recipe.name}"`);
    },
    [showToast],
  );

  const onApplyRecipe = useCallback(
    (recipe: Recipe) => {
      // A recipe with a join step needs the second dataset, which the recipe
      // deliberately doesn't carry. Use an already-loaded one of that name if
      // it's there; otherwise ask for the file and finish once it lands.
      const plan = planRecipeJoin(recipe, datasets);
      if (plan.kind === "needs-dataset") {
        pendingJoinRecipe.current = recipe;
        secondaryIntent.current = "recipe-join";
        setError(
          `Recipe "${recipe.name}" joins with "${plan.expected}" before cleaning — choose that dataset to continue.`,
        );
        compareInput.current?.click();
        return;
      }
      snapshot(`Applied recipe "${recipe.name}"`);
      if (plan.kind === "ready" && recipe.join) {
        // The join runs under the CURRENT options; setting the recipe's options
        // right after re-cleanses the joined base through the normal path.
        onJoin(plan.dataset.table, plan.dataset.name, recipe.join.keys, recipe.join.type);
      }
      applyRecipeOptions(recipe);
    },
    [datasets, snapshot, onJoin, applyRecipeOptions],
  );

  // Finish a recipe that was blocked on its join dataset, now that the user has
  // supplied one. The ref guard makes this a no-op on every other change.
  useEffect(() => {
    const recipe = pendingJoinRecipe.current;
    if (!recipe?.join || !working) return;
    const supplied = resolveSuppliedDataset(datasets);
    if (!supplied) return;
    pendingJoinRecipe.current = null;
    secondaryIntent.current = "compare";
    setError(null);
    snapshot(`Applied recipe "${recipe.name}"`);
    onJoin(supplied.table, supplied.name, recipe.join.keys, recipe.join.type);
    applyRecipeOptions(recipe);
  }, [datasets, working, snapshot, onJoin, applyRecipeOptions]);

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

  // The accepted patches as a list — each is an app-applied change the
  // Change history tab logs (with the analysis timestamp).
  const acceptedPatches = useMemo(
    () => (result ? result.patches.filter((p) => accepted.ids.has(p.id)) : []),
    [result, accepted],
  );

  // Download an audit report of exactly what was changed and what's left for
  // review — the shareable "show me what you did" artefact. The user picks the
  // format from a chooser on the Report button (no silent default).
  const downloadReport = useCallback(
    (format: "pdf" | "html" | "md" | "json") => {
      if (!result) return;
      const report = buildReport(result, accepted.ids);
      const title = "refynr cleaning report";
      const timestamp = new Date().toLocaleString("en-GB");
      if (format === "pdf") {
        void downloadReportPdf(report, { title, timestamp }, "refynr-report.pdf");
      } else if (format === "html") {
        downloadBlob(
          reportToHtml(report, { title, timestamp }),
          "text/html;charset=utf-8",
          "refynr-report.html",
        );
      } else if (format === "md") {
        downloadBlob(
          reportToMarkdown(report, { title, timestamp }),
          "text/markdown;charset=utf-8",
          "refynr-report.md",
        );
      } else {
        downloadBlob(
          JSON.stringify({ title, generated: timestamp, ...report }, null, 2),
          "application/json;charset=utf-8",
          "refynr-report.json",
        );
      }
      setOpenMenu(null);
    },
    [result, accepted],
  );

  // Download the cleaned dataset — one button, every format it can export in.
  const downloadData = useCallback(
    (format: "csv" | "xlsx" | "tsv" | "json") => {
      if (format === "csv") downloadCsv(cleaned, "refynr-cleaned.csv");
      else if (format === "xlsx") void downloadXlsx(cleaned, "refynr-cleaned.xlsx");
      else if (format === "tsv") downloadTsv(cleaned, "refynr-cleaned.tsv");
      else downloadJson(cleaned, "refynr-cleaned.json");
      setOpenMenu(null);
    },
    [cleaned],
  );

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

  // Accept every fixable fix at once, or clear them all. When `scopeIndices`
  // is given (a column filter is active in the findings panel), only those
  // findings are affected — so "Accept all" can never touch findings the user
  // has filtered out of view.
  const onSetAll = useCallback(
    (accept: boolean, scopeIndices?: number[]) => {
      if (!result) return;
      const scoped = scopeIndices !== undefined;
      const scopeSet = scoped ? new Set(scopeIndices) : null;
      const verb = accept ? "Accepted" : "Cleared";
      const label = `${verb} ${scoped ? "shown" : "all"} fixes`;
      snapshot(label);

      // Keys of the fixable findings in scope (all fixable, or just the shown).
      const keys = new Set<string>();
      const rules = new Set<string>();
      result.findings.forEach((f, i) => {
        if (f.patchIds.length === 0) return;
        if (scopeSet && !scopeSet.has(i)) return;
        keys.add(findingKey(f));
        rules.add(f.rule);
      });

      setDisabled((prev) => {
        const next = new Set(prev);
        for (const k of keys) accept ? next.delete(k) : next.add(k);
        return next;
      });
      if (accept) {
        // Un-skip the affected rules so a recipe's skip list can't keep a
        // just-accepted finding un-applied.
        setSkipRules((prev) => {
          if (!scoped) return new Set();
          const next = new Set(prev);
          for (const r of rules) next.delete(r);
          return next;
        });
      }
      showToast(label);
    },
    [result, snapshot, showToast],
  );

  // The table cells each finding refers to, keyed "row:col", aligned with
  // result.findings — built ONCE per result so hover/locate are O(1) lookups
  // instead of an O(patches) scan per mouse event.
  const findingCellKeys = useMemo<Array<Set<string>>>(() => {
    if (!result) return [];
    const byRule = new Map<string, Set<string>>();
    for (const p of result.patches) {
      let keys = byRule.get(p.rule);
      if (!keys) byRule.set(p.rule, (keys = new Set()));
      if (p.kind === "cell") keys.add(`${p.cell.row}:${p.cell.col}`);
      else if (p.kind === "remove-row") keys.add(`${p.row}:0`);
    }
    return result.findings.map((f) => {
      const keys = new Set(
        f.patchIds.length > 0 ? (byRule.get(f.rule) ?? []) : [],
      );
      if (f.cells) for (const c of f.cells) keys.add(`${c.row}:${c.col}`);
      return keys;
    });
  }, [result]);

  // Jump to and highlight the cells a finding refers to. The highlight is
  // pinned: it stays put until the next locate/edit/reset, so the user can
  // move the pointer to the table without losing it.
  const onLocate = useCallback(
    (index: number) => {
      const keys = findingCellKeys[index];
      if (!keys || keys.size === 0) return;

      let target: string | null = null;
      let minRow = Infinity;
      for (const k of keys) {
        const r = Number(k.split(":")[0]);
        if (r < minRow) { minRow = r; target = k; }
      }
      setMode("diff"); // the Changes view is where patches / advisories render
      setPinnedKeys(keys);
      setHoverKeys(null);
      setScrollToKey(target);
      setScrollNonce((n) => n + 1);
    },
    [findingCellKeys],
  );

  // Preview a finding's cells while the pointer rests on it — no scrolling,
  // just the ring highlight; leaving reverts to any pinned (located) cells.
  const onHoverFinding = useCallback(
    (index: number | null) => {
      setHoverKeys(index === null ? null : (findingCellKeys[index] ?? null));
    },
    [findingCellKeys],
  );

  // Column indices each finding touches, aligned with result.findings — feeds
  // the findings panel's column filter.
  const findingColumns = useMemo<Array<Set<number>>>(() => {
    if (!result) return [];
    const byRule = new Map<string, Set<number>>();
    for (const p of result.patches) {
      if (p.kind !== "cell" && p.kind !== "header") continue;
      let cols = byRule.get(p.rule);
      if (!cols) byRule.set(p.rule, (cols = new Set()));
      cols.add(p.kind === "cell" ? p.cell.col : p.col);
    }
    return result.findings.map((f) => {
      const cols = new Set(byRule.get(f.rule) ?? []);
      if (f.column !== undefined) cols.add(f.column);
      if (f.cells) for (const c of f.cells) cols.add(c.col);
      return cols;
    });
  }, [result]);

  // Constraints mined from the data (rule discovery) — already-added rules
  // are filtered out inside the engine helper.
  const suggestions = useMemo(
    () =>
      working && result
        ? suggestConstraints(working, result.profile, options.constraints ?? [])
        : [],
    [working, result, options.constraints],
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

  // Close the open export chooser on any outside click.
  useEffect(() => {
    if (!openMenu) return;
    const close = () => setOpenMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [openMenu]);

  // Same for the small-screen section-nav dropdown.
  useEffect(() => {
    if (!navOpen) return;
    const close = () => setNavOpen(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [navOpen]);

  // Track whether the page has scrolled, so the sticky header can turn frosted.
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Close the settings modal on Escape.
  useEffect(() => {
    if (!showSettings) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowSettings(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showSettings]);

  return (
    <main
      className="relative px-4 py-6 sm:px-6 sm:py-8 lg:px-8"
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
      {/* Landing and workspace both use the full viewport; focused elements
          (hero copy, the paste card) keep their own comfortable max-widths. */}
      <div className="w-full">
      <header
        className={`sticky top-0 z-30 -mx-4 mb-8 flex items-center justify-between border-b px-4 py-3 transition-colors duration-200 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8 ${
          scrolled
            ? "border-line bg-ink/70 backdrop-blur-md"
            : "border-transparent"
        }`}
      >
        <h1 className="flex items-center gap-1.5 text-[22px] font-bold tracking-tight text-hi">
          <Logo size={30} />
          <span>refynr<span className="text-teal">.</span></span>
        </h1>
        {/* Section nav — only on the landing view, where the sections exist.
            Inline links from md up; a dropdown below that (see the ☰ button). */}
        {!base && (
          <nav className="hidden items-center gap-5 font-mono text-[12px] text-mut md:flex">
            {NAV_LINKS.map(([href, label]) => (
              <a key={href} href={href} className="transition hover:text-body">
                {label}
              </a>
            ))}
          </nav>
        )}
        <div className="flex items-center gap-5">
          {!base && (
            <div className="relative md:hidden">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setNavOpen((v) => !v);
                }}
                aria-label="Sections"
                aria-expanded={navOpen}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-line2 bg-card2 text-mut transition hover:text-body"
              >
                <span aria-hidden className="text-[15px] leading-none">
                  {navOpen ? "✕" : "☰"}
                </span>
              </button>
              {navOpen && (
                <div
                  className="absolute right-0 top-full z-40 mt-2 w-48 overflow-hidden rounded-xl border border-line2 bg-card shadow-[0_8px_30px_rgba(0,0,0,0.4)]"
                  onClick={(e) => e.stopPropagation()}
                >
                  {NAV_LINKS.map(([href, label]) => (
                    <a
                      key={href}
                      href={href}
                      onClick={() => setNavOpen(false)}
                      className="block px-4 py-2.5 font-mono text-[12px] text-body transition hover:bg-teal/10 hover:text-teal"
                    >
                      {label}
                    </a>
                  ))}
                </div>
              )}
            </div>
          )}
          {base && (
            <button
              onClick={() => {
                setBase(null);
                setPasted("");
                setDatasets([]);
                datasetCount.current = 0;
                setCompareIndex(null);
                setShowJoin(false);
                setJoinFindings([]);
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
        <section className="rounded-2xl border border-line bg-card p-6 shadow-[0_8px_40px_rgba(0,0,0,0.25)]">
          <textarea
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            placeholder={"Paste from Excel or Google Sheets (Ctrl+V)…\n\nName\tEmail\tJoined\nJohn Smith\tjohn@acme.com\t15/01/2024"}
            className="h-44 w-full resize-y rounded-xl border border-line bg-inset p-4 font-mono text-[13px] text-body outline-none placeholder:text-dim focus:border-teal/60 focus:ring-2 focus:ring-teal/20"
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
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <p className="font-mono text-[12px] text-mut">
              <span className="text-body">{baseName}</span> ·{" "}
              <span className="tabular-nums text-hi">
                {base.table.rows.length.toLocaleString("en-GB")}
              </span>{" "}
              rows ×{" "}
              <span className="tabular-nums text-hi">{base.table.headers.length}</span>{" "}
              columns
            </p>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-teal/25 bg-teal/5 px-2.5 py-1 font-mono text-[11px] text-teal">
              <span className="h-1.5 w-1.5 rounded-full bg-teal" aria-hidden />
              runs in your browser
            </span>
          </div>

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

          {recleansing && !busy && (
            <p className="animate-pulse rounded-lg border border-line bg-card px-4 py-3 font-mono text-sm text-teal">
              › {recleansing} — you can keep working, the score and findings will
              refresh in a moment.
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

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setShowSettings(true)}
              className="inline-flex items-center gap-2 rounded-lg border border-line2 bg-card2 px-3.5 py-2 font-mono text-[12px] font-semibold text-body transition hover:border-mut"
            >
              <span aria-hidden>⚙</span>
              Settings &amp; recipes
              {(options.dedupeKey?.length ||
                options.constraints?.length ||
                options.dateOutput ||
                options.dateOrder) && (
                <span
                  className="h-1.5 w-1.5 rounded-full bg-teal"
                  title="Custom settings are active"
                  aria-label="Custom settings active"
                />
              )}
            </button>
            <span className="font-mono text-[11px] text-dim">
              date handling · duplicate key · column tools · recipes · expectations
            </span>
          </div>

          {/* Two-pane on wide screens: analysis (sticky) beside the data area.
              Below xl the columns would crowd the grid, so they stack. */}
          <div className="space-y-5 xl:grid xl:grid-cols-[440px_minmax(0,1fr)] xl:items-start xl:gap-6 xl:space-y-0">
          <div className="space-y-5 xl:sticky xl:top-6 xl:max-h-[calc(100vh-3rem)] xl:overflow-y-auto">
          <AnalysisPanel
            score={result.score}
            projected={result.projectedScore}
            findings={result.findings}
            enabled={enabledIndices}
            onToggle={toggleFinding}
            onSetAll={onSetAll}
            onLocate={onLocate}
            onHover={onHoverFinding}
            findingColumns={findingColumns}
            table={working}
            profile={result.profile}
            result={result}
          />
          </div>

          <div className="min-w-0 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-xl border border-line bg-inset p-1">
              {(
                [
                  ["original", "Original"],
                  ["diff", `Changes · ${acceptedCount}`],
                  ["cleaned", "Cleaned"],
                  ["history", "Change history"],
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
              <>
                <button
                  onClick={undo}
                  title="Undo last review action (Ctrl+Z)"
                  className="rounded-lg border border-line2 bg-card2 px-3 py-1.5 font-mono text-[11px] text-mut transition hover:text-body"
                >
                  ↶ undo
                </button>
                <button
                  onClick={() => setShowHistory((v) => !v)}
                  title="Every review action this session, most recent first"
                  className={`rounded-lg border px-3 py-1.5 font-mono text-[11px] transition ${
                    showHistory
                      ? "border-teal/50 bg-teal/10 text-teal"
                      : "border-line2 bg-card2 text-mut hover:text-body"
                  }`}
                >
                  history · {undoDepth}
                </button>
              </>
            )}
            </div>
          </div>

          {showHistory && undoDepth > 0 && (
            <div className="rounded-xl border border-line bg-card2 px-4 py-3">
              <p className="label text-teal!">History</p>
              <ul className="mt-2 space-y-1">
                {undoStack.current
                  .map((entry, i) => [entry, i] as const)
                  .reverse()
                  .map(([entry, i]) => (
                    <li key={i} className="flex items-center justify-between gap-3">
                      <span className="min-w-0 truncate font-mono text-[12px] text-body">
                        <span className="mr-2 tabular-nums text-dim">{i + 1}.</span>
                        {entry.label}
                      </span>
                      <button
                        onClick={() => undoTo(i)}
                        title="Rewind to before this action (undoes it and everything after)"
                        className="shrink-0 rounded-md border border-line2 px-2.5 py-1 font-mono text-[11px] text-mut transition hover:text-coral"
                      >
                        ↶ rewind
                      </button>
                    </li>
                  ))}
              </ul>
              <p className="mt-2 font-mono text-[11px] text-dim">
                Most recent first. Rewinding undoes that action and everything after it —
                your original data is untouched either way.
              </p>
            </div>
          )}

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

          {showJoin && (
            <JoinPanel
              working={working}
              workingName={baseName}
              datasets={datasets}
              onJoin={onJoin}
              onLoadDataset={() => {
                secondaryIntent.current = "join";
                compareInput.current?.click();
              }}
              onClose={() => setShowJoin(false)}
            />
          )}

          {showGroup && (
            <GroupPanel
              working={working}
              onApply={onGroup}
              onClose={() => setShowGroup(false)}
            />
          )}

          {compareIndex !== null && datasets[compareIndex] && (
            <DatasetDiff
              before={base.table}
              after={datasets[compareIndex]!.table}
              beforeName={baseName}
              afterName={datasets[compareIndex]!.name}
              onClose={() => setCompareIndex(null)}
            />
          )}

          {mode === "history" ? (
            <ChangeHistory
              patches={acceptedPatches}
              headers={working.headers}
              analysedAt={analysedAt}
              actions={undoStack.current.map((e) => ({ label: e.label, at: e.at }))}
            />
          ) : (
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
              onDeleteRow={onDeleteRow}
              onDeleteColumn={onDeleteColumn}
              highlightKeys={hoverKeys ?? pinnedKeys}
              scrollToKey={scrollToKey}
              scrollNonce={scrollNonce}
            />
          )}

          {/* Export actions live under the data panel — review first, export last. */}
          <div className="flex flex-wrap gap-2.5">
            <button
              onClick={() => void copyCleaned()}
              title="Copy the cleaned data — paste straight into Excel or Google Sheets"
              className="rounded-lg bg-gradient-to-r from-teal to-cyan px-5 py-2 text-sm font-semibold text-ink shadow-[0_0_18px_rgba(45,212,191,0.35)] transition hover:brightness-110"
            >
              {copied ? "✓ Copied" : "Copy"}
            </button>
            <ExportMenu
              label="Download"
              title="Download the cleaned data — choose the format"
              open={openMenu === "download"}
              onToggle={() => setOpenMenu((m) => (m === "download" ? null : "download"))}
              options={DOWNLOAD_FORMATS}
              onPick={downloadData}
            />
            <ExportMenu
              label="Report"
              title="Download an audit report of what changed — choose the format"
              open={openMenu === "report"}
              onToggle={() => setOpenMenu((m) => (m === "report" ? null : "report"))}
              options={REPORT_FORMATS}
              onPick={downloadReport}
            />
            <button
              onClick={() => {
                // Always ask for a file. Reusing an already-loaded dataset
                // instead would mean that once ANY second file existed (say the
                // one you joined with), Compare could never open another —
                // silently diffing against a file you didn't choose.
                secondaryIntent.current = "compare";
                compareInput.current?.click();
              }}
              title="Compare this dataset against another version"
              className="rounded-lg border border-line2 bg-card2 px-5 py-2 text-sm font-medium text-body transition hover:border-mut"
            >
              ⇄ Compare
            </button>
            <button
              onClick={() => {
                if (showJoin) {
                  setShowJoin(false);
                  return;
                }
                secondaryIntent.current = "join";
                if (datasets.length > 0) setShowJoin(true);
                else compareInput.current?.click();
              }}
              title="Join another dataset onto this one, and see what the join does before applying it"
              className={`rounded-lg border px-5 py-2 text-sm font-medium transition ${
                showJoin
                  ? "border-teal/50 bg-teal/10 text-teal"
                  : "border-line2 bg-card2 text-body hover:border-mut"
              }`}
            >
              ⨝ Join
            </button>
            <button
              onClick={() => setShowGroup((v) => !v)}
              title="Group rows and work out totals, averages and counts — with whatever the summary had to leave out"
              className={`rounded-lg border px-5 py-2 text-sm font-medium transition ${
                showGroup
                  ? "border-teal/50 bg-teal/10 text-teal"
                  : "border-line2 bg-card2 text-body hover:border-mut"
              }`}
            >
              Σ Summarise
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

          <p className="pb-8 text-center font-mono text-[11px] leading-relaxed text-dim">
            {manualCount > 0
              ? `${manualCount} manual edit${manualCount === 1 ? "" : "s"} applied and re-scored live. `
              : "Amber cells in Changes are advisory — edit them to fix by hand and watch the score update. "}
            Your original data is never modified — refynr only ever exports a copy.
          </p>
          </div>
          </div>
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

      {showSettings && base && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/70 p-4 backdrop-blur-sm sm:p-8"
          role="dialog"
          aria-modal="true"
          aria-label="Settings and recipes"
          onClick={() => setShowSettings(false)}
        >
          <div
            className="relative my-auto w-full max-w-3xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="label text-teal!">Settings &amp; recipes</h2>
              <button
                onClick={() => setShowSettings(false)}
                aria-label="Close settings"
                className="rounded-lg border border-line2 bg-card px-3 py-1.5 font-mono text-[12px] text-mut transition hover:text-body"
              >
                ✕ Close
              </button>
            </div>
            {/* Option toggles keep the modal open for further tweaking;
                reshapes and recipe-apply close it so the result is visible. */}
            <RecipeBar
              currentOptions={options}
              currentSkipRules={currentSkipRules}
              currentJoin={currentJoin}
              columns={base.table.headers}
              suggestions={suggestions}
              onApplyOptions={onApplyOptions}
              onApplyRecipe={(r) => {
                onApplyRecipe(r);
                setShowSettings(false);
              }}
              onSplit={(c, s) => {
                onSplit(c, s);
                setShowSettings(false);
              }}
              onMerge={(c, s) => {
                onMerge(c, s);
                setShowSettings(false);
              }}
              onUnpivot={(c) => {
                onUnpivot(c);
                setShowSettings(false);
              }}
            />
          </div>
        </div>
      )}
      </div>
    </main>
  );
}
