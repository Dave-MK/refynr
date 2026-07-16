"use client";

import { useState } from "react";
import type {
  CleanseResult,
  Finding,
  HealthScore,
  Table,
  TableProfile,
} from "@refynr/engine";
import { ScoreCard } from "@/components/ScoreCard";
import { FindingsPanel } from "@/components/FindingsPanel";
import { ColumnsPanel } from "@/components/ColumnsPanel";
// AI insights are temporarily disabled (pending a free/paywalled model).
// Re-enable by uncommenting this import and the "insights" tab + panel below.
// import { AiSummary } from "@/components/AiSummary";

type Tab = "health" | "findings" | "columns" | "insights";

/**
 * Analysis tab group — Data health, Findings, Columns, and AI insights share
 * one tab strip, kept separate from the Original/Changes/Cleaned data views
 * below. Stateful panels stay mounted (hidden, not unmounted) so switching
 * tabs never discards a generated AI summary or the user's finding
 * selections; the stateless ColumnsPanel mounts on demand (see below).
 */
export function AnalysisPanel({
  score,
  projected,
  findings,
  enabled,
  onToggle,
  onSetAll,
  onLocate,
  onHover,
  findingColumns,
  table,
  profile,
  result,
}: {
  score: HealthScore;
  projected: HealthScore;
  findings: Finding[];
  enabled: Set<number>;
  onToggle: (index: number) => void;
  onSetAll: (accept: boolean) => void;
  onLocate: (index: number) => void;
  onHover: (index: number | null) => void;
  findingColumns: Array<Set<number>>;
  /** The working table (with manual edits), for column profiling. */
  table: Table;
  profile: TableProfile;
  result: CleanseResult;
}) {
  const [tab, setTab] = useState<Tab>("health");

  const tabs: readonly [Tab, string][] = [
    ["health", "Data health"],
    ["findings", `Findings · ${findings.length}`],
    ["columns", "Columns"],
    // ["insights", "AI insights"], // AI insights temporarily disabled
  ];

  return (
    <div className="space-y-5">
      <div className="inline-flex rounded-xl border border-line bg-inset p-1">
        {tabs.map(([value, label]) => (
          <button
            key={value}
            onClick={() => setTab(value)}
            className={`rounded-lg px-4 py-1.5 font-mono text-xs font-semibold transition ${
              tab === value
                ? "bg-gradient-to-r from-teal to-cyan text-ink shadow-[0_0_14px_rgba(45,212,191,0.35)]"
                : "text-mut hover:text-body"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className={tab === "health" ? "" : "hidden"}>
        <ScoreCard score={score} projected={projected} />
      </div>
      <div className={tab === "findings" ? "" : "hidden"}>
        <FindingsPanel
          findings={findings}
          enabled={enabled}
          onToggle={onToggle}
          onSetAll={onSetAll}
          onLocate={onLocate}
          onHover={onHover}
          columns={table.headers}
          findingColumns={findingColumns}
        />
      </div>
      {/* ColumnsPanel is stateless and its stats pass is a full table scan,
          so it mounts only while its tab is open — a hidden mount would
          re-profile 100k-row files on every edit for users who never look. */}
      {tab === "columns" && <ColumnsPanel table={table} profile={profile} />}
      {/* AI insights temporarily disabled — re-enable with the import + tab above.
      <div className={tab === "insights" ? "" : "hidden"}>
        <AiSummary profile={profile} result={result} />
      </div>
      */}
    </div>
  );
}
