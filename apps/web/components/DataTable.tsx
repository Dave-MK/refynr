import { useEffect, useMemo, useRef, useState } from "react";
import { cellText, type CellPatch, type CellValue, type Table } from "@refynr/engine";

export type ViewMode = "original" | "diff" | "cleaned";

/** An advisory / editable cell: `flagged` = still failing a rule (amber). */
export interface EditableCell {
  label: string;
  flagged: boolean;
}

const ROW_CAP = 300;

/** Inline editable cell — commits on blur or Enter, reverts on Escape. */
function CellEditor({
  value,
  flagged,
  title,
  onCommit,
}: {
  value: string;
  flagged: boolean;
  title: string;
  onCommit: (next: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  const border = flagged
    ? "border-amber/60 focus:border-amber"
    : "border-grape/60 focus:border-grape";

  return (
    <input
      value={draft}
      title={flagged ? `${title} — edit to fix` : "Edited manually"}
      autoComplete="off"
      autoCorrect="off"
      autoCapitalize="off"
      spellCheck={false}
      data-1p-ignore
      data-lpignore="true"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft !== value && onCommit(draft)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          (e.target as HTMLInputElement).blur();
        } else if (e.key === "Escape") {
          setDraft(value);
          (e.target as HTMLInputElement).blur();
        }
      }}
      className={`w-full min-w-28 rounded border bg-inset px-1.5 py-0.5 font-mono text-[12px] text-body outline-none focus:ring-1 ${flagged ? "focus:ring-amber/30" : "focus:ring-grape/30"} ${border}`}
    />
  );
}

export function DataTable({
  original,
  working,
  cleaned,
  cellPatches,
  removedRows,
  editableCells,
  headerPatches,
  mode,
  onEditCell,
  highlightKeys,
  scrollToKey,
  scrollNonce,
}: {
  /** The untouched upload. */
  original: Table;
  /** original + manual edits — the base the Changes view diffs against. */
  working: Table;
  /** working + accepted patches — the download. */
  cleaned: Table;
  /** Accepted cell patches keyed by "row:col" (original coordinates). */
  cellPatches: Map<string, CellPatch>;
  /** Original row indices with an accepted removal patch. */
  removedRows: Set<number>;
  /** Advisory / manually-edited cells keyed "row:col" → render as editors. */
  editableCells: Map<string, EditableCell>;
  /** Accepted header renames, keyed by column index. */
  headerPatches: Map<number, { before: string; after: string }>;
  mode: ViewMode;
  onEditCell: (row: number, col: number, value: CellValue) => void;
  /** Cells to ring-highlight (from clicking a finding), keyed "row:col". */
  highlightKeys?: Set<string>;
  /** The one cell to scroll into view; `scrollNonce` retriggers the scroll. */
  scrollToKey?: string | null;
  scrollNonce?: number;
}) {
  const source = mode === "cleaned" ? cleaned : mode === "diff" ? working : original;
  const scrollRef = useRef<HTMLTableCellElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [scrollNonce]);

  const HL = "shadow-[inset_0_0_0_2px_rgba(45,212,191,0.8)]";

  // View-only sort and filter: only the DISPLAY ORDER changes. Rows keep their
  // original indices, so patch/editable lookups (keyed "row:col") stay aligned
  // and the exported data is never reordered.
  const [sortCol, setSortCol] = useState<number | null>(null);
  const [sortDir, setSortDir] = useState<1 | -1>(1);
  const [filter, setFilter] = useState("");

  const displayIndices = useMemo(() => {
    let idx = source.rows.map((_, i) => i);
    const q = filter.trim().toLowerCase();
    if (q) {
      idx = idx.filter((i) =>
        source.rows[i]!.some((v) => cellText(v).toLowerCase().includes(q)),
      );
    }
    if (sortCol !== null && sortCol < source.headers.length) {
      const num = (v: CellValue) => {
        const n = Number(cellText(v).replace(/[£$€,%\s]/g, ""));
        return Number.isNaN(n) ? null : n;
      };
      idx = [...idx].sort((a, b) => {
        const va = source.rows[a]![sortCol];
        const vb = source.rows[b]![sortCol];
        const na = num(va);
        const nb = num(vb);
        const cmp =
          na !== null && nb !== null
            ? na - nb
            : cellText(va).localeCompare(cellText(vb), undefined, { sensitivity: "base" });
        return cmp * sortDir;
      });
    }
    return idx;
  }, [source, filter, sortCol, sortDir]);

  const visible = displayIndices.slice(0, ROW_CAP);

  const cycleSort = (col: number) => {
    if (sortCol !== col) {
      setSortCol(col);
      setSortDir(1);
    } else if (sortDir === 1) {
      setSortDir(-1);
    } else {
      setSortCol(null);
    }
  };

  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-card">
      <div className="flex items-center justify-between gap-3 border-b border-line bg-inset px-4 py-2">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter rows…"
          className="w-48 rounded-md border border-line bg-card px-2.5 py-1 font-mono text-[11.5px] text-body outline-none placeholder:text-dim focus:border-teal/60"
        />
        <span className="font-mono text-[10.5px] text-dim">
          click a column to sort — view only, your data is never reordered
        </span>
      </div>
      <div className="overflow-auto">
        <table className="w-full min-w-max border-collapse font-mono text-[12.5px]">
          <thead>
            <tr className="bg-inset text-left">
              <th className="w-12 px-3 py-2.5 text-right text-[10px] font-semibold tracking-[0.15em] text-dim">
                #
              </th>
              {source.headers.map((h, i) => {
                const hp = mode === "diff" ? headerPatches.get(i) : undefined;
                const sorted = sortCol === i;
                return (
                  <th
                    key={i}
                    onClick={() => cycleSort(i)}
                    title={hp ? `Renamed to "${hp.after}"` : "Sort by this column"}
                    className="cursor-pointer select-none whitespace-nowrap px-3 py-2.5 text-[10px] font-semibold uppercase tracking-[0.15em] text-mut transition hover:text-body"
                  >
                    {hp ? (
                      <span className="text-teal underline decoration-teal/50 decoration-dotted underline-offset-4">
                        {h}
                      </span>
                    ) : (
                      h
                    )}
                    {sorted && (
                      <span className="ml-1 text-teal">{sortDir === 1 ? "▲" : "▼"}</span>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-line/40">
            {visible.map((r) => {
              const row = source.rows[r]!;
              const removed = mode === "diff" && removedRows.has(r);
              return (
                <tr key={r} className={removed ? "bg-coral/5 opacity-45" : ""}>
                  <td
                    className={`px-3 py-2 text-right tabular-nums ${removed ? "text-coral/70" : "text-dim"}`}
                  >
                    {r + 2}
                  </td>
                  {row.map((v, c) => {
                    const key = `${r}:${c}`;
                    const hl = highlightKeys?.has(key) ? ` ${HL}` : "";
                    const cellRef = scrollToKey === key ? scrollRef : undefined;
                    const patch =
                      mode === "diff" && !removed ? cellPatches.get(key) : undefined;
                    if (patch) {
                      return (
                        <td
                          key={c}
                          ref={cellRef}
                          className={`whitespace-nowrap px-3 py-2${hl}`}
                          title={`${patch.reason} (confidence ${Math.round(patch.confidence * 100)}%)`}
                        >
                          <span className="rounded bg-coral/10 px-1.5 py-0.5 text-coral/90 line-through decoration-coral/50">
                            {cellText(patch.before) || "∅"}
                          </span>
                          <span className="mx-1.5 text-dim">→</span>
                          <span className="rounded bg-teal/10 px-1.5 py-0.5 font-semibold text-teal">
                            {cellText(patch.after) || "∅"}
                          </span>
                        </td>
                      );
                    }
                    const editable =
                      mode === "diff" && !removed ? editableCells.get(key) : undefined;
                    if (editable) {
                      return (
                        <td key={c} ref={cellRef} className={`px-2 py-1.5${hl}`}>
                          <CellEditor
                            value={cellText(v)}
                            flagged={editable.flagged}
                            title={editable.label}
                            onCommit={(next) => onEditCell(r, c, next === "" ? null : next)}
                          />
                        </td>
                      );
                    }
                    return (
                      <td
                        key={c}
                        ref={cellRef}
                        className={`whitespace-nowrap px-3 py-2 ${removed ? "text-mut" : "text-body"}${hl}`}
                      >
                        {cellText(v) || (removed ? "∅" : "")}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="border-t border-line bg-inset px-4 py-2.5 font-mono text-[11px] text-dim">
        {filter.trim()
          ? `${displayIndices.length.toLocaleString("en-GB")} of ${source.rows.length.toLocaleString("en-GB")} rows match${displayIndices.length > ROW_CAP ? ` — showing first ${ROW_CAP}` : ""}`
          : displayIndices.length > ROW_CAP
            ? `Showing first ${ROW_CAP} of ${source.rows.length.toLocaleString("en-GB")} rows — all rows are analysed and exported.`
            : `Showing all ${source.rows.length} rows · ${cellPatches.size + removedRows.size} changes staged`}
      </p>
    </section>
  );
}
