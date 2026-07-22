"use client";

import { useMemo, useState } from "react";
import {
  groupBy,
  numericValue,
  type AggFn,
  type Aggregation,
  type Table,
} from "@refynr/engine";

const FNS: ReadonlyArray<readonly [AggFn, string]> = [
  ["count", "Count rows"],
  ["sum", "Total"],
  ["mean", "Average"],
  ["median", "Median"],
  ["min", "Lowest"],
  ["max", "Highest"],
  ["count-distinct", "Distinct values"],
];

/**
 * Pick a sensible column to total. Defaulting to the first header hands you
 * "Sum of region" — a total of the very column you grouped by — so prefer a
 * column that isn't a grouping key and whose values actually read as numbers.
 */
function suggestValueColumn(table: Table, by: string[]): string {
  const candidates = table.headers.filter((h) => !by.includes(h));
  const sample = table.rows.slice(0, 20);
  for (const h of candidates) {
    const col = table.headers.indexOf(h);
    let numeric = 0;
    let seen = 0;
    for (const row of sample) {
      const v = row[col] ?? null;
      if (v === null || String(v).trim() === "") continue;
      seen++;
      if (numericValue(v) !== null) numeric++;
    }
    if (seen > 0 && numeric / seen >= 0.8) return h;
  }
  return candidates[0] ?? table.headers[0] ?? "";
}

/**
 * The summarise builder. Like the join panel, its job is to show what the
 * operation will DO before it is applied — a summary collapses many rows into
 * one number, and everything it quietly left out disappears at the same moment.
 */
export function GroupPanel({
  working,
  onApply,
  onClose,
}: {
  working: Table;
  onApply: (by: string[], aggregations: Aggregation[]) => void;
  onClose: () => void;
}) {
  const [by, setBy] = useState<string[]>(() => working.headers.slice(0, 1));
  const [aggs, setAggs] = useState<Aggregation[]>([{ fn: "count" }]);

  const preview = useMemo(() => {
    if (by.length === 0 || aggs.length === 0) return null;
    return groupBy(working, { by, aggregations: aggs });
  }, [working, by, aggs]);

  const d = preview?.diagnostics;
  const toggleBy = (h: string) =>
    setBy((prev) => (prev.includes(h) ? prev.filter((x) => x !== h) : [...prev, h]));

  const setAgg = (i: number, next: Aggregation) =>
    setAggs((prev) => prev.map((a, j) => (j === i ? next : a)));

  return (
    <div className="rounded-xl border border-line bg-card2 px-4 py-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="label text-teal!">Σ Summarise</h3>
        <button
          onClick={onClose}
          aria-label="Close summarise panel"
          className="rounded-md border border-line2 px-2.5 py-1 font-mono text-[11px] text-mut transition hover:text-body"
        >
          ✕
        </button>
      </div>

      <p className="label text-teal!">Group by</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {working.headers.map((h) => (
          <button
            key={h}
            onClick={() => toggleBy(h)}
            className={`rounded-md border px-2.5 py-1 font-mono text-[11.5px] transition ${
              by.includes(h)
                ? "border-teal/50 bg-teal/10 text-teal"
                : "border-line2 bg-card text-mut hover:border-mut"
            }`}
          >
            {h}
          </button>
        ))}
      </div>
      {by.length === 0 && (
        <p className="mt-2 font-mono text-[11px] text-amber">
          Pick at least one column to group by.
        </p>
      )}

      <p className="label text-teal! mt-4">Work out</p>
      <div className="mt-2 space-y-2">
        {aggs.map((a, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <select
              value={a.fn}
              onChange={(e) => {
                const fn = e.target.value as AggFn;
                setAgg(i, {
                  fn,
                  // "Count rows" needs no column; everything else does.
                  column: fn === "count" ? undefined : (a.column ?? suggestValueColumn(working, by)),
                });
              }}
              className="rounded-md border border-line bg-inset px-2 py-1 font-mono text-[12px] text-body outline-none focus:border-teal/60"
            >
              {FNS.map(([fn, label]) => (
                <option key={fn} value={fn}>{label}</option>
              ))}
            </select>
            {a.fn !== "count" && (
              <>
                <span className="font-mono text-[12px] text-dim" aria-hidden>of</span>
                <select
                  value={a.column ?? ""}
                  onChange={(e) => setAgg(i, { ...a, column: e.target.value })}
                  className="max-w-[190px] rounded-md border border-line bg-inset px-2 py-1 font-mono text-[12px] text-body outline-none focus:border-teal/60"
                >
                  {working.headers.map((h) => (
                    <option key={h} value={h}>{h}</option>
                  ))}
                </select>
              </>
            )}
            {aggs.length > 1 && (
              <button
                onClick={() => setAggs((prev) => prev.filter((_, j) => j !== i))}
                aria-label="Remove this summary"
                className="rounded-md border border-line2 px-2 py-1 font-mono text-[11px] text-dim transition hover:text-coral"
              >
                ✕
              </button>
            )}
          </div>
        ))}
      </div>
      <button
        onClick={() =>
          setAggs((prev) => [...prev, { fn: "sum", column: suggestValueColumn(working, by) }])
        }
        className="mt-2 font-mono text-[11px] font-semibold text-teal transition hover:text-cyan"
      >
        + work out something else
      </button>

      {d && (
        <div className="mt-5 rounded-xl border border-line bg-inset px-4 py-3">
          <p className="label text-teal!">Before you apply</p>
          <p className="mt-2 text-[13px] text-body">
            <span className="tabular-nums font-semibold text-hi">
              {d.rowsIn.toLocaleString("en-GB")}
            </span>{" "}
            rows in →{" "}
            <span className="tabular-nums font-semibold text-hi">
              {d.groups.toLocaleString("en-GB")}
            </span>{" "}
            {d.groups === 1 ? "group" : "groups"} out.
          </p>
          {preview!.findings.length > 0 ? (
            <ul className="mt-3 space-y-1.5 border-t border-line pt-3">
              {preview!.findings.slice(0, 4).map((f, i) => (
                <li key={i} className="flex gap-2 text-[12px]">
                  <span
                    aria-hidden
                    className={f.severity === "error" ? "text-coral" : "text-amber"}
                  >
                    ●
                  </span>
                  <span className="min-w-0 text-mut">
                    <span className="font-medium text-body">{f.title}</span> — {f.detail}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1.5 font-mono text-[11.5px] text-mut">
              Every row counted — nothing left out.
            </p>
          )}
        </div>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-2.5">
        <button
          onClick={() => onApply(by, aggs)}
          disabled={by.length === 0 || !preview || preview.findings.some((f) => f.severity === "error")}
          className="rounded-lg bg-gradient-to-r from-teal to-cyan px-5 py-2 text-sm font-semibold text-ink shadow-[0_0_18px_rgba(45,212,191,0.35)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
        >
          Apply summary
        </button>
        <button
          onClick={onClose}
          className="rounded-lg border border-line2 bg-card2 px-4 py-2 text-sm text-body transition hover:border-mut"
        >
          Cancel
        </button>
        <span className="font-mono text-[11px] text-dim">
          Undoable — your original data is untouched.
        </span>
      </div>
    </div>
  );
}
