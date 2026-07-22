"use client";

import { useMemo, useState } from "react";
import {
  inferJoinKeys,
  joinTables,
  type JoinKey,
  type JoinType,
  type Table,
} from "@refynr/engine";

/** A secondary dataset loaded alongside the working one. */
export interface LoadedDataset {
  name: string;
  table: Table;
}

const JOIN_TYPES: ReadonlyArray<readonly [JoinType, string, string]> = [
  ["left", "Keep all my rows", "Every row of your data, plus matching columns where they exist"],
  ["inner", "Only matching rows", "Drop rows that found no match — the result is the overlap"],
  ["full", "Keep everything", "All rows from both, matched where possible"],
];

/**
 * The join builder. Its job is not to run the join — that is one engine call —
 * but to show you what the join is about to DO before you commit to it, because
 * both of the ways a join ruins a dataset are invisible after the fact: rows
 * that silently matched nothing, and rows that silently multiplied.
 *
 * So the preview is the point. It runs the real join on every keystroke (pure,
 * deterministic, cheap enough — a hash join over 100k rows is milliseconds) and
 * reports the row count you will end up with, before Apply.
 */
export function JoinPanel({
  working,
  workingName,
  datasets,
  onJoin,
  onLoadDataset,
  onClose,
}: {
  working: Table;
  workingName: string;
  datasets: LoadedDataset[];
  onJoin: (right: Table, rightName: string, keys: JoinKey[], type: JoinType) => void;
  onLoadDataset: () => void;
  onClose: () => void;
}) {
  const [pick, setPick] = useState(0);
  const [type, setType] = useState<JoinType>("left");
  // null = "follow the engine's inference"; an array = the user has chosen.
  const [keys, setKeys] = useState<JoinKey[] | null>(null);

  const right = datasets[pick];

  const inferred = useMemo(
    () => (right ? inferJoinKeys(working, right.table) : []),
    [working, right],
  );
  const activeKeys = keys ?? inferred;

  // The real join, run for its diagnosis rather than its table.
  const preview = useMemo(() => {
    if (!right || activeKeys.length === 0) return null;
    return joinTables(working, right.table, { keys: activeKeys, type });
  }, [working, right, activeKeys, type]);

  const d = preview?.diagnostics;
  const grew = d ? d.resultRows > d.leftRows : false;
  const shrank = d ? d.resultRows < d.leftRows : false;

  if (datasets.length === 0) {
    return (
      <Shell onClose={onClose}>
        <p className="text-sm text-mut">
          A join needs a second dataset. Load one and it stays available for both
          joining and version comparison.
        </p>
        <button
          onClick={onLoadDataset}
          className="mt-4 rounded-lg bg-gradient-to-r from-teal to-cyan px-5 py-2 text-sm font-semibold text-ink shadow-[0_0_18px_rgba(45,212,191,0.35)] transition hover:brightness-110"
        >
          Load a second dataset
        </button>
      </Shell>
    );
  }

  return (
    <Shell onClose={onClose}>
      {/* ── Which dataset ─────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[12px] text-mut">Join</span>
        <span className="rounded-md border border-line2 bg-inset px-2.5 py-1 font-mono text-[12px] text-hi">
          {workingName}
        </span>
        <span className="font-mono text-[12px] text-mut">with</span>
        <select
          value={pick}
          onChange={(e) => {
            setPick(Number(e.target.value));
            setKeys(null); // re-infer for the newly chosen dataset
          }}
          className="rounded-md border border-line bg-inset px-2 py-1 font-mono text-[12px] text-body outline-none focus:border-teal/60"
        >
          {datasets.map((ds, i) => (
            <option key={`${ds.name}-${i}`} value={i}>
              {ds.name}
            </option>
          ))}
        </select>
        <button
          onClick={onLoadDataset}
          className="rounded-md border border-line2 bg-card2 px-2.5 py-1 font-mono text-[11px] text-mut transition hover:text-body"
        >
          + load another
        </button>
      </div>

      {/* ── Match on ──────────────────────────────────────────────────── */}
      <div className="mt-4">
        <p className="label text-teal!">Match rows on</p>
        {activeKeys.length === 0 ? (
          <p className="mt-2 rounded-lg border border-coral/25 bg-coral/10 px-3 py-2 text-[13px] text-coral">
            These datasets share no column whose values overlap. Pick the key
            columns yourself below, or check you loaded the right file.
          </p>
        ) : null}
        <div className="mt-2 space-y-2">
          {(activeKeys.length > 0 ? activeKeys : [{ left: "", right: "" }]).map((k, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <ColumnSelect
                value={k.left}
                columns={working.headers}
                onChange={(v) => setKeys(replaceAt(activeKeys, i, { ...k, left: v }))}
              />
              <span className="font-mono text-[12px] text-dim" aria-hidden>
                =
              </span>
              <ColumnSelect
                value={k.right}
                columns={right?.table.headers ?? []}
                onChange={(v) => setKeys(replaceAt(activeKeys, i, { ...k, right: v }))}
              />
              {activeKeys.length > 1 && (
                <button
                  onClick={() => setKeys(activeKeys.filter((_, j) => j !== i))}
                  aria-label="Remove this key pair"
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
            setKeys([
              ...activeKeys,
              { left: working.headers[0] ?? "", right: right?.table.headers[0] ?? "" },
            ])
          }
          className="mt-2 font-mono text-[11px] font-semibold text-teal transition hover:text-cyan"
        >
          + match on another column
        </button>
        {keys === null && inferred.length > 0 && (
          <p className="mt-2 font-mono text-[11px] text-dim">
            Chosen automatically — the column whose values actually overlap.
          </p>
        )}
      </div>

      {/* ── Which rows to keep ────────────────────────────────────────── */}
      <div className="mt-5">
        <p className="label text-teal!">Which rows to keep</p>
        <div className="mt-2 space-y-1.5">
          {JOIN_TYPES.map(([value, label, hint]) => (
            <label
              key={value}
              className={`flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2 transition ${
                type === value
                  ? "border-teal/50 bg-teal/10"
                  : "border-line2 bg-card2 hover:border-mut"
              }`}
            >
              <input
                type="radio"
                name="join-type"
                checked={type === value}
                onChange={() => setType(value)}
                className="mt-0.5 h-3.5 w-3.5 accent-teal"
              />
              <span className="min-w-0">
                <span className="block text-[13px] font-medium text-body">{label}</span>
                <span className="block font-mono text-[11px] text-dim">{hint}</span>
              </span>
            </label>
          ))}
        </div>
      </div>

      {/* ── The preview: what this join is about to do ────────────────── */}
      {d && (
        <div className="mt-5 rounded-xl border border-line bg-inset px-4 py-3">
          <p className="label text-teal!">Before you apply</p>
          <p className="mt-2 text-[13px] text-body">
            <span className="tabular-nums font-semibold text-hi">
              {d.leftRows.toLocaleString("en-GB")}
            </span>{" "}
            rows in →{" "}
            <span
              className={`tabular-nums font-semibold ${
                grew ? "text-amber" : shrank ? "text-coral" : "text-hi"
              }`}
            >
              {d.resultRows.toLocaleString("en-GB")}
            </span>{" "}
            rows out
            {grew && (
              <span className="text-amber">
                {" "}
                — {d.fanOut.length.toLocaleString("en-GB")} of your rows matched more
                than one row and multiplied
              </span>
            )}
            {shrank && (
              <span className="text-coral">
                {" "}
                — {(d.leftRows - d.matched).toLocaleString("en-GB")} unmatched rows will
                be dropped
              </span>
            )}
            .
          </p>
          <p className="mt-1.5 font-mono text-[11.5px] text-mut">
            <span className="tabular-nums text-teal">
              {d.matched.toLocaleString("en-GB")}
            </span>{" "}
            matched ·{" "}
            <span
              className={`tabular-nums ${
                d.unmatchedLeft.length > 0 ? "text-amber" : "text-mut"
              }`}
            >
              {d.unmatchedLeft.length.toLocaleString("en-GB")}
            </span>{" "}
            unmatched
            {d.unmatchedRight.length > 0 && (
              <>
                {" "}
                ·{" "}
                <span className="tabular-nums">
                  {d.unmatchedRight.length.toLocaleString("en-GB")}
                </span>{" "}
                unused from {right?.name}
              </>
            )}
          </p>

          {/* The findings are the honest part — surfaced here, before Apply,
              not just afterwards in the findings list. */}
          {preview!.findings.length > 0 && (
            <ul className="mt-3 space-y-1.5 border-t border-line pt-3">
              {preview!.findings.slice(0, 4).map((f, i) => (
                <li key={i} className="flex gap-2 text-[12px]">
                  <span
                    aria-hidden
                    className={
                      f.severity === "error"
                        ? "text-coral"
                        : f.severity === "warning"
                          ? "text-amber"
                          : "text-dim"
                    }
                  >
                    ●
                  </span>
                  <span className="min-w-0 text-mut">
                    <span className="font-medium text-body">{f.title}</span> — {f.detail}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-2.5">
        <button
          onClick={() => right && onJoin(right.table, right.name, activeKeys, type)}
          disabled={!right || activeKeys.length === 0 || activeKeys.some((k) => !k.left || !k.right)}
          className="rounded-lg bg-gradient-to-r from-teal to-cyan px-5 py-2 text-sm font-semibold text-ink shadow-[0_0_18px_rgba(45,212,191,0.35)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
        >
          Apply join
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
    </Shell>
  );
}

function replaceAt(keys: JoinKey[], i: number, next: JoinKey): JoinKey[] {
  const copy = keys.length > 0 ? [...keys] : [next];
  copy[i] = next;
  return copy;
}

function ColumnSelect({
  value,
  columns,
  onChange,
}: {
  value: string;
  columns: string[];
  onChange: (v: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="max-w-[190px] rounded-md border border-line bg-inset px-2 py-1 font-mono text-[12px] text-body outline-none focus:border-teal/60"
    >
      <option value="">choose a column…</option>
      {columns.map((c) => (
        <option key={c} value={c}>
          {c}
        </option>
      ))}
    </select>
  );
}

function Shell({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="rounded-xl border border-line bg-card2 px-4 py-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="label text-teal!">⨝ Join another dataset</h3>
        <button
          onClick={onClose}
          aria-label="Close join panel"
          className="rounded-md border border-line2 px-2.5 py-1 font-mono text-[11px] text-mut transition hover:text-body"
        >
          ✕
        </button>
      </div>
      {children}
    </div>
  );
}
