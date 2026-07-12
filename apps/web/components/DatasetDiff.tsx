"use client";

import { useMemo, useState } from "react";
import { cellText, diffTables, type Table } from "@refynr/engine";

const LIST_CAP = 100;

function Tile({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-xl border border-line bg-card2 p-4">
      <div className={`font-mono text-2xl font-bold tabular-nums ${tone}`}>
        {value.toLocaleString("en-GB")}
      </div>
      <div className="mt-0.5 font-mono text-[11px] uppercase tracking-wider text-mut">
        {label}
      </div>
    </div>
  );
}

/**
 * Version-vs-version diff view — refynr's review model pointed at "what changed
 * since last time?". Compares a baseline table against a newer one and shows,
 * at the row and cell level, what was added, removed, and changed. Local and
 * non-destructive: neither file is modified, and nothing leaves the browser.
 */
export function DatasetDiff({
  before,
  after,
  beforeName,
  afterName,
  onClose,
}: {
  before: Table;
  after: Table;
  beforeName: string;
  afterName: string;
  onClose: () => void;
}) {
  // Shared columns that could serve as a match key.
  const sharedColumns = useMemo(
    () => before.headers.filter((h) => after.headers.includes(h)),
    [before, after],
  );
  const [key, setKey] = useState<string>("");

  const diff = useMemo(
    () => diffTables(before, after, key || undefined),
    [before, after, key],
  );

  return (
    <div className="rounded-2xl border border-teal/25 bg-card p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="label text-teal!">Version comparison</h2>
          <p className="mt-1 text-sm text-mut">
            <span className="font-mono text-hi">{beforeName}</span> →{" "}
            <span className="font-mono text-hi">{afterName}</span>
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="font-mono text-[11px] text-mut">
            Match on&nbsp;
            <select
              value={key}
              onChange={(e) => setKey(e.target.value)}
              className="rounded-md border border-line bg-inset px-2 py-1 text-[12px] text-body outline-none focus:border-teal/60"
            >
              <option value="">auto ({diff.keyColumn ?? "row position"})</option>
              {sharedColumns.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </label>
          <button
            onClick={onClose}
            className="rounded-md border border-line2 px-2.5 py-1 font-mono text-[11px] text-mut transition hover:text-body"
          >
            ✕ close
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label="Added" value={diff.added.length} tone="text-teal" />
        <Tile label="Removed" value={diff.removed.length} tone="text-coral" />
        <Tile label="Changed" value={diff.changed.length} tone="text-amber" />
        <Tile label="Unchanged" value={diff.unchanged} tone="text-mut" />
      </div>

      {(diff.addedColumns.length > 0 || diff.removedColumns.length > 0) && (
        <p className="mt-3 font-mono text-[11px] text-mut">
          {diff.addedColumns.length > 0 && (
            <span className="text-teal">+ columns: {diff.addedColumns.join(", ")}&nbsp;&nbsp;</span>
          )}
          {diff.removedColumns.length > 0 && (
            <span className="text-coral">− columns: {diff.removedColumns.join(", ")}</span>
          )}
        </p>
      )}

      {diff.changed.length > 0 && (
        <section className="mt-5">
          <h3 className="mb-2 font-mono text-[11px] uppercase tracking-wider text-amber">
            Changed rows
          </h3>
          <ul className="space-y-1.5">
            {diff.changed.slice(0, LIST_CAP).map((c) => (
              <li
                key={`${c.key}-${c.afterRow}`}
                className="rounded-lg border border-line bg-inset px-3 py-2 text-[13px]"
              >
                <span className="font-mono font-semibold text-hi">{c.key}</span>
                <span className="ml-2 text-mut">
                  {c.cells.map((cell, i) => (
                    <span key={cell.column}>
                      {i > 0 && " · "}
                      <span className="text-body">{cell.column}:</span>{" "}
                      <span className="text-coral line-through">{cellText(cell.before) || "∅"}</span>{" "}
                      →{" "}
                      <span className="text-teal">{cellText(cell.after) || "∅"}</span>
                    </span>
                  ))}
                </span>
              </li>
            ))}
          </ul>
          {diff.changed.length > LIST_CAP && (
            <p className="mt-1.5 font-mono text-[11px] text-dim">
              …and {(diff.changed.length - LIST_CAP).toLocaleString("en-GB")} more changed rows
            </p>
          )}
        </section>
      )}

      <div className="mt-5 grid gap-5 sm:grid-cols-2">
        {diff.added.length > 0 && (
          <section>
            <h3 className="mb-2 font-mono text-[11px] uppercase tracking-wider text-teal">
              Added rows
            </h3>
            <ul className="space-y-1">
              {diff.added.slice(0, LIST_CAP).map((r) => (
                <li key={`a-${r.row}`} className="truncate font-mono text-[12px] text-body">
                  <span className="text-teal">+</span> {r.values.map(cellText).join(", ")}
                </li>
              ))}
            </ul>
            {diff.added.length > LIST_CAP && (
              <p className="mt-1 font-mono text-[11px] text-dim">
                …and {(diff.added.length - LIST_CAP).toLocaleString("en-GB")} more
              </p>
            )}
          </section>
        )}
        {diff.removed.length > 0 && (
          <section>
            <h3 className="mb-2 font-mono text-[11px] uppercase tracking-wider text-coral">
              Removed rows
            </h3>
            <ul className="space-y-1">
              {diff.removed.slice(0, LIST_CAP).map((r) => (
                <li key={`r-${r.row}`} className="truncate font-mono text-[12px] text-body">
                  <span className="text-coral">−</span> {r.values.map(cellText).join(", ")}
                </li>
              ))}
            </ul>
            {diff.removed.length > LIST_CAP && (
              <p className="mt-1 font-mono text-[11px] text-dim">
                …and {(diff.removed.length - LIST_CAP).toLocaleString("en-GB")} more
              </p>
            )}
          </section>
        )}
      </div>

      {diff.added.length === 0 && diff.removed.length === 0 && diff.changed.length === 0 && (
        <p className="mt-4 rounded-lg border border-teal/20 bg-teal/5 px-4 py-3 text-sm text-body">
          No differences — the two versions are identical across their shared columns.
        </p>
      )}
    </div>
  );
}
