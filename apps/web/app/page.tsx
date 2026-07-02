"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  applyPatches,
  type CellPatch,
  type CleanseResult,
  type Table,
} from "@refynr/engine";
import type {
  CleanseRequest,
  CleanseResponse,
} from "@/workers/cleanse.worker";
import { AiSummary } from "@/components/AiSummary";
import { ScoreCard } from "@/components/ScoreCard";
import { FindingsPanel } from "@/components/FindingsPanel";
import { DataTable, type ViewMode } from "@/components/DataTable";
import { downloadCsv } from "@/lib/csv";
import { downloadXlsx } from "@/lib/xlsx";
import { SAMPLE_DATA } from "@/lib/sample";

interface Session {
  table: Table;
  result: CleanseResult;
}

export default function Home() {
  const [pasted, setPasted] = useState("");
  const [session, setSession] = useState<Session | null>(null);
  const [enabledFindings, setEnabledFindings] = useState<Set<number>>(new Set());
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
      const { table, result } = e.data;
      setSession({ table, result });
      // Every fixable finding starts enabled — the user unticks what they don't want.
      setEnabledFindings(
        new Set(
          result.findings
            .map((f, i) => (f.patchIds.length > 0 ? i : -1))
            .filter((i) => i >= 0),
        ),
      );
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

  const accepted = useMemo(() => {
    if (!session) return { ids: new Set<string>(), cellPatches: new Map<string, CellPatch>(), removedRows: new Set<number>() };
    const ids = new Set<string>();
    session.result.findings.forEach((f, i) => {
      if (enabledFindings.has(i)) for (const id of f.patchIds) ids.add(id);
    });
    const cellPatches = new Map<string, CellPatch>();
    const removedRows = new Set<number>();
    for (const p of session.result.patches) {
      if (!ids.has(p.id)) continue;
      if (p.kind === "cell") cellPatches.set(`${p.cell.row}:${p.cell.col}`, p);
      else removedRows.add(p.row);
    }
    return { ids, cellPatches, removedRows };
  }, [session, enabledFindings]);

  const cleaned = useMemo(
    () =>
      session
        ? applyPatches(session.table, session.result.patches, accepted.ids)
        : { headers: [], rows: [] },
    [session, accepted],
  );

  const acceptedCount = accepted.cellPatches.size + accepted.removedRows.size;

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <header className="mb-10 flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            refynr<span className="text-teal-600">.</span>
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Non-destructive spreadsheet quality — see every change before you accept it.
          </p>
        </div>
        {session && (
          <button
            onClick={() => {
              setSession(null);
              setPasted("");
            }}
            className="text-sm text-slate-400 hover:text-slate-600"
          >
            ← Start over
          </button>
        )}
      </header>

      {!session && (
        <section className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
          <h2 className="text-lg font-medium text-slate-800">
            Paste data or upload a spreadsheet
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Everything runs in your browser — your data never leaves this device.
          </p>
          <textarea
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            placeholder={"Paste from Excel or Google Sheets (Ctrl+V)…\n\nName\tEmail\tJoined\nJohn Smith\tjohn@acme.com\t15/01/2024"}
            className="mt-4 h-48 w-full resize-y rounded-lg border border-slate-200 bg-slate-50 p-4 font-mono text-sm outline-none placeholder:text-slate-300 focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
          />
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              onClick={() => analyse(pasted)}
              disabled={!pasted.trim() || busy}
              className="rounded-lg bg-teal-600 px-5 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ? "Analysing…" : "Analyse data"}
            </button>
            <button
              onClick={() => fileInput.current?.click()}
              disabled={busy}
              className="rounded-lg border border-slate-200 bg-white px-5 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-40"
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
              className="text-sm font-medium text-teal-600 hover:text-teal-700"
            >
              Try sample data →
            </button>
          </div>
          {error && (
            <p className="mt-4 rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {error}
            </p>
          )}
        </section>
      )}

      {session && (
        <div className="space-y-6">
          <ScoreCard
            score={session.result.score}
            projected={session.result.projectedScore}
          />

          <AiSummary profile={session.result.profile} result={session.result} />

          <FindingsPanel
            findings={session.result.findings}
            enabled={enabledFindings}
            onToggle={(i) =>
              setEnabledFindings((prev) => {
                const next = new Set(prev);
                if (next.has(i)) next.delete(i);
                else next.add(i);
                return next;
              })
            }
          />

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1 shadow-sm">
              {(
                [
                  ["original", "Original"],
                  ["diff", "Changes"],
                  ["cleaned", "Cleaned"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => setMode(value)}
                  className={`rounded-md px-4 py-1.5 text-sm font-medium transition ${
                    mode === value
                      ? "bg-teal-600 text-white shadow-sm"
                      : "text-slate-500 hover:text-slate-700"
                  }`}
                >
                  {label}
                  {value === "diff" && acceptedCount > 0 && (
                    <span className="ml-1.5 rounded-full bg-white/20 px-1.5 text-xs">
                      {acceptedCount}
                    </span>
                  )}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => downloadCsv(cleaned, "refynr-cleaned.csv")}
                className="rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-slate-700"
              >
                Download CSV
              </button>
              <button
                onClick={() => void downloadXlsx(cleaned, "refynr-cleaned.xlsx")}
                className="rounded-lg border border-slate-300 bg-white px-5 py-2.5 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50"
              >
                Download Excel
              </button>
            </div>
          </div>

          <DataTable
            table={session.table}
            cleaned={cleaned}
            cellPatches={accepted.cellPatches}
            removedRows={accepted.removedRows}
            mode={mode}
          />

          <p className="pb-6 text-center text-xs text-slate-400">
            Hover any changed cell to see why it changed. Your original data is
            never modified — refynr only ever exports a copy.
          </p>
        </div>
      )}
    </main>
  );
}
