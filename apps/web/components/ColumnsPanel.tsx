"use client";

import { useMemo } from "react";
import { cellText, isEmptyCell, type Table, type TableProfile } from "@refynr/engine";

interface ColumnStats {
  top: Array<{ value: string; count: number }>;
  min: number | null;
  max: number | null;
}

/** Parse a display value as a number, tolerating £/$/€, commas, %. */
function toNumber(s: string): number | null {
  const cleaned = s.trim().replace(/^[£$€]\s?/, "").replace(/,/g, "").replace(/%$/, "");
  if (cleaned === "" || !/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  return Number(cleaned);
}

/**
 * Per-column profiling — the "profile while you clean" panel. Everything here
 * is derived from the already-computed engine profile plus one pass over the
 * table for value frequencies; nothing leaves the browser.
 */
export function ColumnsPanel({
  table,
  profile,
}: {
  table: Table;
  profile: TableProfile;
}) {
  const stats = useMemo<ColumnStats[]>(() => {
    return profile.columns.map((col) => {
      const counts = new Map<string, { display: string; count: number }>();
      let min: number | null = null;
      let max: number | null = null;
      for (const row of table.rows) {
        const v = row[col.index];
        if (isEmptyCell(v)) continue;
        const display = cellText(v).trim();
        const key = display.toLowerCase();
        const entry = counts.get(key);
        if (entry) entry.count++;
        else counts.set(key, { display, count: 1 });
        if (col.type === "number" || col.type === "mixed") {
          const num = toNumber(display);
          if (num !== null) {
            if (min === null || num < min) min = num;
            if (max === null || num > max) max = num;
          }
        }
      }
      const top = [...counts.values()]
        .sort((a, b) => b.count - a.count)
        .slice(0, 3)
        .map((e) => ({ value: e.display, count: e.count }));
      return { top, min, max };
    });
  }, [table, profile]);

  const rows = profile.rowCount || 1;

  return (
    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {profile.columns.map((col, i) => {
        const filledPct = Math.round(((rows - col.empty) / rows) * 100);
        const s = stats[i]!;
        return (
          <div key={col.index} className="rounded-xl border border-line bg-card2 p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="truncate text-[13px] font-semibold text-hi" title={col.name}>
                {col.name}
              </p>
              <span className="pill border-cyan/30 bg-cyan/10 text-cyan">{col.type}</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-inset">
              <div
                className={`h-full rounded-full ${filledPct === 100 ? "bg-teal" : "bg-amber"}`}
                style={{ width: `${filledPct}%` }}
              />
            </div>
            <p className="mt-1.5 font-mono text-[11px] tabular-nums text-mut">
              {filledPct}% filled · {col.distinct.toLocaleString("en-GB")} distinct
              {col.empty > 0 && (
                <span className="text-amber"> · {col.empty.toLocaleString("en-GB")} blank</span>
              )}
            </p>
            {s.min !== null && s.max !== null && (
              <p className="mt-1 font-mono text-[11px] tabular-nums text-mut">
                range {s.min.toLocaleString("en-GB")} – {s.max.toLocaleString("en-GB")}
              </p>
            )}
            {s.top.length > 0 && (
              <ul className="mt-2 space-y-1">
                {s.top.map((t) => (
                  <li
                    key={t.value}
                    className="flex items-center justify-between gap-2 font-mono text-[11px]"
                  >
                    <span className="truncate text-body" title={t.value}>
                      {t.value}
                    </span>
                    <span className="shrink-0 tabular-nums text-dim">×{t.count.toLocaleString("en-GB")}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </section>
  );
}
