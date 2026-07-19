"use client";

import { useEffect, useMemo, useState } from "react";
import type { Finding } from "@refynr/engine";

function pillFor(f: Finding): { className: string; text: string } {
  if (f.patchIds.length > 0) {
    return { className: "border-amber/30 bg-amber/10 text-amber", text: "Fixable" };
  }
  if (f.severity === "info") {
    return { className: "border-cyan/30 bg-cyan/10 text-cyan", text: "Info" };
  }
  return { className: "border-coral/30 bg-coral/10 text-coral", text: "Advisory" };
}

/** Severity as a left edge stripe on each finding row — denser than a boxed
 *  dot, and readable at a glance down the list. */
const STRIPE: Record<Finding["severity"], string> = {
  error: "border-l-coral",
  warning: "border-l-amber",
  info: "border-l-cyan",
};

export function FindingsPanel({
  findings,
  enabled,
  onToggle,
  onSetAll,
  onLocate,
  onHover,
  columns,
  findingColumns,
}: {
  findings: Finding[];
  enabled: Set<number>;
  onToggle: (index: number) => void;
  /** Accept (true) or clear (false) fixable findings at once. When a column
   *  filter is active, `scopeIndices` limits it to the findings on screen. */
  onSetAll: (accept: boolean, scopeIndices?: number[]) => void;
  /** Jump to and highlight a finding's affected cells in the table. */
  onLocate: (index: number) => void;
  /** Preview-highlight a finding's cells on hover (null clears). */
  onHover: (index: number | null) => void;
  /** Column names, for the column-scoped filter. */
  columns: string[];
  /** Per-finding set of affected column indices (empty = table-wide). */
  findingColumns: Array<Set<number>>;
}) {
  const [filterCol, setFilterCol] = useState<number | "all">("all");

  // Column indices go stale when the table is reshaped or a new file loads —
  // a leftover filter would silently hide every finding. Reset on any change.
  const columnsKey = JSON.stringify(columns);
  useEffect(() => {
    setFilterCol("all");
  }, [columnsKey]);

  // Column filter: a finding shows when it touches the chosen column;
  // table-wide findings (blank rows, PII notice) only show under "all".
  const visible = useMemo(() => {
    const pairs = findings.map((f, i) => [f, i] as const);
    if (filterCol === "all") return pairs;
    return pairs.filter(([, i]) => findingColumns[i]?.has(filterCol));
  }, [findings, findingColumns, filterCol]);

  if (findings.length === 0) {
    return (
      <section className="rounded-2xl border border-teal/25 bg-card p-6">
        <p className="font-mono text-sm text-teal">
          › No issues found — this data looks clean.
        </p>
      </section>
    );
  }

  // "Accept/Clear all" acts on what's on screen: with a column filter active it
  // scopes to the shown findings, so it can never silently toggle hidden ones.
  const filtered = filterCol !== "all";
  const shownFixable = visible
    .filter(([f]) => f.patchIds.length > 0)
    .map(([, i]) => i);
  const shownAllApplied =
    shownFixable.length > 0 && shownFixable.every((i) => enabled.has(i));

  // Honest partial-cleaning disclosure: leaving some fixes unaccepted is a
  // legitimate choice, but it shouldn't be an invisible one.
  const totalPatches = findings.reduce((s, f) => s + f.patchIds.length, 0);
  const acceptedPatches = findings.reduce(
    (s, f, i) => s + (enabled.has(i) ? f.patchIds.length : 0),
    0,
  );

  return (
    <section className="rounded-2xl border border-line bg-card2">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-6 py-4">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="label">Findings ({findings.length})</h2>
          {columns.length > 1 && (
            <select
              value={filterCol}
              onChange={(e) =>
                setFilterCol(e.target.value === "all" ? "all" : Number(e.target.value))
              }
              title="Only show findings that touch one column"
              className="rounded-md border border-line bg-inset px-2 py-1 font-mono text-[11px] text-body outline-none focus:border-teal/60"
            >
              <option value="all">all columns</option>
              {columns.map((c, i) => (
                <option key={`${c}-${i}`} value={i}>
                  {c}
                </option>
              ))}
            </select>
          )}
        </div>
        <div className="flex items-center gap-3">
          {shownFixable.length > 0 && (
            <button
              onClick={() => onSetAll(!shownAllApplied, filtered ? shownFixable : undefined)}
              title={filtered ? "Applies only to the findings shown for this column" : undefined}
              className="rounded-md border border-line2 bg-card px-3 py-1.5 font-mono text-[11px] font-semibold text-body transition hover:border-mut"
            >
              {shownAllApplied ? "Clear" : "Accept"} {filtered ? "shown" : "all"} fixes
            </button>
          )}
          <span className="font-mono text-xs font-semibold text-teal">
            {enabled.size} applied
          </span>
        </div>
      </div>
      {acceptedPatches < totalPatches && (
        <p className="border-b border-line bg-amber/5 px-6 py-2.5 font-mono text-[11px] text-amber">
          {acceptedPatches.toLocaleString("en-GB")} of {totalPatches.toLocaleString("en-GB")} proposed
          {totalPatches === 1 ? " fix" : " fixes"} accepted — what&apos;s left stays unfixed in the export.
        </p>
      )}
      {visible.length === 0 ? (
        <p className="px-6 py-5 font-mono text-[12px] text-mut">
          No findings touch "{typeof filterCol === "number" ? columns[filterCol] : ""}".
        </p>
      ) : (
        <ul className="divide-y divide-line/60">
          {visible.map(([f, i]) => {
            const fixable = f.patchIds.length > 0;
            const pill = pillFor(f);
            return (
              <li
                key={`${f.rule}-${i}`}
                className={`flex items-start gap-3 border-l-[3px] px-5 py-2.5 ${STRIPE[f.severity]}`}
                onMouseEnter={() => onHover(i)}
                onMouseLeave={() => onHover(null)}
              >
                <button
                  type="button"
                  onClick={() => onLocate(i)}
                  title="Show these cells in the table"
                  className="group min-w-0 flex-1 rounded-md text-left transition hover:bg-line/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal/40"
                >
                  <div className="flex flex-wrap items-center gap-2.5">
                    <span className="text-[13.5px] font-semibold text-hi">{f.title}</span>
                    <span className={`pill ${pill.className}`}>{pill.text}</span>
                    <span className="font-mono text-[10px] text-dim opacity-0 transition group-hover:opacity-100">
                      ⌖ locate
                    </span>
                  </div>
                  <p className="mt-0.5 max-w-[85ch] text-[12.5px] leading-snug text-mut">{f.detail}</p>
                </button>
                {fixable ? (
                  <label className="flex shrink-0 cursor-pointer items-center gap-2 pt-0.5">
                    <input
                      type="checkbox"
                      checked={enabled.has(i)}
                      onChange={() => onToggle(i)}
                      className="h-4 w-4 accent-teal"
                    />
                    <span className="font-mono text-xs text-teal">apply</span>
                  </label>
                ) : (
                  <span className="shrink-0 pt-0.5 font-mono text-xs text-dim">review</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
