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
import { Pipeline } from "@/components/Pipeline";
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
    if (!session) {
      return {
        ids: new Set<string>(),
        cellPatches: new Map<string, CellPatch>(),
        removedRows: new Set<number>(),
      };
    }
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

  /** Advisory (non-fixable) finding cells → amber underline in the table. */
  const advisoryCells = useMemo(() => {
    const map = new Map<string, string>();
    if (!session) return map;
    for (const f of session.result.findings) {
      if (f.patchIds.length > 0 || !f.cells) continue;
      for (const cell of f.cells) map.set(`${cell.row}:${cell.col}`, f.title);
    }
    return map;
  }, [session]);

  const cleaned = useMemo(
    () =>
      session
        ? applyPatches(session.table, session.result.patches, accepted.ids)
        : { headers: [], rows: [] },
    [session, accepted],
  );

  const acceptedCount = accepted.cellPatches.size + accepted.removedRows.size;

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
          {session && (
            <button
              onClick={() => {
                setSession(null);
                setPasted("");
              }}
              className="font-mono text-xs text-dim transition hover:text-body"
            >
              start over
            </button>
          )}
        </div>
      </header>

      {!session && (
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
      )}

      {session && (
        <div className="space-y-5">
          <Pipeline
            table={session.table}
            result={session.result}
            acceptedCount={acceptedCount}
          />

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
            table={session.table}
            cleaned={cleaned}
            cellPatches={accepted.cellPatches}
            removedRows={accepted.removedRows}
            advisoryCells={advisoryCells}
            mode={mode}
          />

          <p className="pb-8 text-center font-mono text-[11px] leading-relaxed text-dim">
            Hover any changed cell to see why. Your original data is never
            modified — refynr only ever exports a copy.
          </p>
        </div>
      )}
    </main>
  );
}
