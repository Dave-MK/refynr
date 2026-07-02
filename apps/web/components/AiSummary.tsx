"use client";

import { useState } from "react";
import type { CleanseResult, TableProfile } from "@refynr/engine";
import type { InsightResponse } from "@/app/api/insights/route";

const RISK_STYLE: Record<InsightResponse["riskLevel"], string> = {
  low: "bg-teal-50 text-teal-700 border-teal-200",
  medium: "bg-amber-50 text-amber-700 border-amber-200",
  high: "bg-rose-50 text-rose-700 border-rose-200",
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
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          AI insights
        </h2>
        {state.status === "done" && (
          <span
            className={`rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize ${RISK_STYLE[state.insights.riskLevel]}`}
          >
            {state.insights.riskLevel} risk
          </span>
        )}
      </div>

      <div className="px-6 py-5">
        {state.status === "idle" && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-slate-500">
              Get an executive summary and recommendations from Claude. Only
              column statistics and a handful of sample values are sent — never
              your full dataset.
            </p>
            <button
              onClick={() => void generate()}
              className="shrink-0 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-violet-700"
            >
              Generate AI summary
            </button>
          </div>
        )}

        {state.status === "loading" && (
          <p className="animate-pulse text-sm text-slate-400">
            Claude is reading the column profiles…
          </p>
        )}

        {state.status === "error" && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-rose-600">{state.message}</p>
            <button
              onClick={() => void generate()}
              className="shrink-0 rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              Try again
            </button>
          </div>
        )}

        {state.status === "done" && (
          <div className="space-y-4">
            <p className="leading-relaxed text-slate-700">
              {state.insights.summary}
            </p>
            <p className="text-sm italic text-slate-500">
              {state.insights.likelyOrigin}
            </p>
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                Recommended next steps
              </h3>
              <ol className="space-y-1.5">
                {state.insights.recommendations.map((r, i) => (
                  <li key={i} className="flex gap-2 text-sm text-slate-600">
                    <span className="font-medium text-violet-500">{i + 1}.</span>
                    {r}
                  </li>
                ))}
              </ol>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
