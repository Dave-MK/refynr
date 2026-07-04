"use client";

import { useState } from "react";
import type { CleanseResult, TableProfile } from "@refynr/engine";
import type { InsightResponse } from "@/app/api/insights/route";

const RISK_PILL: Record<InsightResponse["riskLevel"], string> = {
  low: "border-teal/30 bg-teal/10 text-teal",
  medium: "border-amber/30 bg-amber/10 text-amber",
  high: "border-coral/30 bg-coral/10 text-coral",
};

export function AiSummary({
  profile,
  result,
}: {
  profile: TableProfile;
  result: CleanseResult;
}) {
  const [state, setState] = useState<
    | { status: "idle" }
    | { status: "loading" }
    | { status: "done"; insights: InsightResponse }
    | { status: "error"; message: string }
  >({ status: "idle" });

  const generate = async () => {
    setState({ status: "loading" });
    try {
      const res = await fetch("/api/insights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profile,
          findings: result.findings.map((f) => ({
            rule: f.rule,
            severity: f.severity,
            title: f.title,
            count: f.count,
          })),
          score: result.score,
          projectedScore: result.projectedScore,
        }),
      });
      const data = (await res.json()) as InsightResponse & { error?: string };
      if (!res.ok) {
        setState({ status: "error", message: data.error ?? "Something went wrong." });
        return;
      }
      setState({ status: "done", insights: data });
    } catch {
      setState({ status: "error", message: "Couldn't reach the server." });
    }
  };

  return (
    <section className="rounded-2xl border border-ailine bg-aicard p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="glow-teal text-sm text-grape" aria-hidden>
            ✦
          </span>
          <h2 className="label text-grape!">AI insights</h2>
        </div>
        {state.status === "done" && (
          <span className={`pill ${RISK_PILL[state.insights.riskLevel]}`}>
            {state.insights.riskLevel} risk
          </span>
        )}
      </div>

      <div className="mt-4">
        {state.status === "idle" && (
          <div className="flex flex-wrap items-center justify-between gap-4">
            <p className="max-w-xl text-sm leading-relaxed text-mut">
              Get an executive summary and recommendations from Claude. Only
              column statistics and a handful of sample values are sent — never
              your full dataset.
            </p>
            <button
              onClick={() => void generate()}
              className="shrink-0 rounded-lg border border-grape/40 bg-grape/15 px-4 py-2 font-mono text-xs font-semibold tracking-wide text-grape transition hover:bg-grape/25"
            >
              Generate AI summary
            </button>
          </div>
        )}

        {state.status === "loading" && (
          <p className="animate-pulse font-mono text-xs text-grape/70">
            › Claude is reading the column profiles…
          </p>
        )}

        {state.status === "error" && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-coral">{state.message}</p>
            <button
              onClick={() => void generate()}
              className="shrink-0 rounded-lg border border-line2 px-4 py-2 font-mono text-xs text-mut transition hover:text-body"
            >
              Try again
            </button>
          </div>
        )}

        {state.status === "done" && (
          <div className="space-y-4">
            <p className="text-[15px] leading-relaxed text-hi">
              {state.insights.summary}
            </p>
            <p className="text-sm italic leading-relaxed text-grape/80">
              {state.insights.likelyOrigin}
            </p>
            <div className="pt-1">
              <h3 className="label mb-3 text-[10px]!">Recommended next steps</h3>
              <ol className="space-y-2">
                {state.insights.recommendations.map((r, i) => (
                  <li key={i} className="flex gap-3 text-sm leading-relaxed text-body">
                    <span className="font-mono font-semibold text-grape">{i + 1}</span>
                    {r}
                  </li>
                ))}
              </ol>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
