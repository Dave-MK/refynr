"use client";

import { useState } from "react";
import type {
  CleanseResult,
  Finding,
  HealthScore,
  TableProfile,
} from "@refynr/engine";
import { ScoreCard } from "@/components/ScoreCard";
import { FindingsPanel } from "@/components/FindingsPanel";
import { AiSummary } from "@/components/AiSummary";

type Tab = "health" | "findings" | "insights";

/**
 * Analysis tab group — Data health, Findings, and AI insights share one tab
 * strip, kept separate from the Original/Changes/Cleaned data views below.
 * All three panels stay mounted (hidden, not unmounted) so switching tabs
 * never discards a generated AI summary or the user's finding selections.
 */
export function AnalysisPanel({
  score,
  projected,
  findings,
  enabled,
  onToggle,
  profile,
  result,
}: {
  score: HealthScore;
  projected: HealthScore;
  findings: Finding[];
  enabled: Set<number>;
  onToggle: (index: number) => void;
  profile: TableProfile;
  result: CleanseResult;
}) {
  const [tab, setTab] = useState<Tab>("health");

  const tabs: readonly [Tab, string][] = [
    ["health", "Data health"],
    ["findings", `Findings · ${findings.length}`],
    ["insights", "AI insights"],
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
        <FindingsPanel findings={findings} enabled={enabled} onToggle={onToggle} />
      </div>
      <div className={tab === "insights" ? "" : "hidden"}>
        <AiSummary profile={profile} result={result} />
      </div>
    </div>
  );
}
