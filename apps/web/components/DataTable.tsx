import { useEffect, useMemo, useRef, useState } from "react";
import { cellText, type CellPatch, type CellValue, type Table } from "@refynr/engine";

export type ViewMode = "original" | "diff" | "cleaned" | "history";

/** An advisory / editable cell: `flagged` = still failing a rule (amber). */
export interface EditableCell {
  label: string;
  flagged: boolean;
}

const ROW_CAP = 300;

/** Inline editable cell — commits on blur or Enter, reverts on Escape.
 *  `autoFocus` + `onExit` support double-click-to-edit (transient editors that
 *  appear on demand and dismiss themselves), alongside the always-on advisory
 *  editors in the Changes view. */
function CellEditor({
  value,
  flagged,
  title,
  onCommit,
  autoFocus = false,
  onExit,
}: {
  value: string;
  flagged: boolean;
  title: string;
  onCommit: (next: string) => void;
  autoFocus?: boolean;
  onExit?: () => void;
}) {
  const [draft, setDraft] = useState(value);
  const cancelled = useRef(false);
  useEffect(() => setDraft(value), [value]);

  const border = flagged
    ? "border-amber/60 focus:border-amber"
    : "border-grape/60 focus:border-grape";

  return (
    <input
      value={draft}
      autoFocus={autoFocus}
      title={flagged ? `${title} — edit to fix` : title}
      autoComplete="off"
      autoCorrect="off"
      autoCapitalize="off"
      spellCheck={false}
      data-1p-ignore
      data-lpignore="true"
      onChange={(e) => setDraft(e.target.value)}
      onFocus={(e) => autoFocus && e.currentTarget.select()}
      onBlur={() => {
        // Escape sets `cancelled` so the pending blur doesn't commit the value.
        if (!cancelled.current && draft !== value) onCommit(draft);
        cancelled.current = false;
        onExit?.();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          (e.target as HTMLInputElement).blur();
        } else if (e.key === "Escape") {
          cancelled.current = true;
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
  onDeleteRow,
  onDeleteColumn,
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
  /** Delete a row (working-table index) — shown in Changes and Cleaned views. */
  onDeleteRow?: (workingRow: number) => void;
  /** Delete a whole column — shown in Changes and Cleaned views. */
  onDeleteColumn?: (col: number) => void;
  /** Cells to ring-highlight (from clicking a finding), keyed "row:col". */
  highlightKeys?: Set<string>;
  /** The one cell to scroll into view; `scrollNonce` retriggers the scroll. */
  scrollToKey?: string | null;
  scrollNonce?: number;
}) {
  const source = mode === "cleaned" ? cleaned : mode === "diff" ? working : original;
  const scrollRef = useRef<HTMLTableCellElement>(null);

  // Row/column deletion is offered in the two editable views only — the
  // Original view stays a faithful, untouchable record of the upload.
  const deletable = mode === "diff" || mode === "cleaned";

  // Double-click editing (Changes + Cleaned views). In the Cleaned view the
  // visible row is a *cleaned* index (removed rows dropped), so it must be
  // mapped back to the working-table row that manual edits are keyed against —
  // otherwise an edit lands on the wrong record whenever any row above it was
  // removed. Changes-view rows are already working indices.
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const cleanedToWorking = useMemo(() => {
    if (mode !== "cleaned") return null;
    const map: number[] = [];
    for (let w = 0; w < working.rows.length; w++) {
      if (!removedRows.has(w)) map.push(w);
    }
    return map;
  }, [mode, working.rows.length, removedRows]);

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
  const [changedOnly, setChangedOnly] = useState(false);

  // Row indices touched by an accepted patch, removal, or manual edit — all
  // keyed "row:col" against working coordinates, so this only lines up in the
  // Changes (diff) view.
  const changedRows = useMemo(() => {
    const s = new Set<number>();
    for (const k of cellPatches.keys()) s.add(Number(k.split(":")[0]));
    for (const r of removedRows) s.add(r);
    for (const k of editableCells.keys()) s.add(Number(k.split(":")[0]));
    return s;
  }, [cellPatches, removedRows, editableCells]);

  const canFilterChanged = mode === "diff" && changedRows.size > 0;

  const displayIndices = useMemo(() => {
    let idx = source.rows.map((_, i) => i);
    if (canFilterChanged && changedOnly) {
      idx = idx.filter((i) => changedRows.has(i));
    }
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
  }, [source, filter, sortCol, sortDir, changedOnly, canFilterChanged, changedRows]);

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
        <div className="flex items-center gap-3">
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter rows…"
            className="w-44 rounded-md border border-line bg-card px-2.5 py-1 font-mono text-[11.5px] text-body outline-none placeholder:text-dim focus:border-teal/60"
          />
          {canFilterChanged && (
            <label
              className="flex cursor-pointer items-center gap-1.5 font-mono text-[11px] text-mut"
              title="Show only the rows with a staged change"
            >
              <input
                type="checkbox"
                checked={changedOnly}
                onChange={(e) => setChangedOnly(e.target.checked)}
                className="h-3.5 w-3.5 accent-teal"
              />
              changed rows only
            </label>
          )}
        </div>
        <span className="font-mono text-[10.5px] text-dim">
          {deletable
            ? "double-click a cell to edit — hover a row or column for ✕ to delete"
            : "click a column to sort — view only, your data is never reordered"}
        </span>
      </div>
      <div className="max-h-[70vh] overflow-auto">
        <table className="w-full min-w-max border-collapse font-mono text-[12.5px]">
          <thead>
            <tr className="text-left">
              <th className="sticky left-0 top-0 z-30 w-12 bg-inset px-3 py-2.5 text-right text-[10px] font-semibold tracking-[0.15em] text-dim">
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
                    className="group sticky top-0 z-20 cursor-pointer select-none whitespace-nowrap bg-inset px-3 py-2.5 text-[10px] font-semibold uppercase tracking-[0.15em] text-mut transition hover:text-body"
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
                    {deletable && onDeleteColumn && source.headers.length > 1 && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation(); // don't trigger the sort
                          onDeleteColumn(i);
                        }}
                        title={`Delete column "${h}"`}
                        aria-label={`Delete column ${h}`}
                        className="ml-1.5 rounded px-1 text-[11px] normal-case text-dim opacity-0 transition hover:bg-coral/15 hover:text-coral focus:opacity-100 group-hover:opacity-100"
                      >
                        ✕
                      </button>
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
                <tr key={r} className={`group/row ${removed ? "bg-coral/5 opacity-45" : ""}`}>
                  <td
                    className={`sticky left-0 z-10 whitespace-nowrap bg-inset px-3 py-2 text-right tabular-nums ${removed ? "text-coral/70" : "text-dim"}`}
                  >
                    {deletable && onDeleteRow && !removed && (
                      <button
                        onClick={() =>
                          onDeleteRow(mode === "cleaned" ? (cleanedToWorking?.[r] ?? r) : r)
                        }
                        title="Delete this row"
                        aria-label={`Delete row ${r + 2}`}
                        className="mr-1.5 rounded px-1 text-[11px] text-dim opacity-0 transition hover:bg-coral/15 hover:text-coral focus:opacity-100 group-hover/row:opacity-100"
                      >
                        ✕
                      </button>
                    )}
                    {r + 2}
                  </td>
                  {row.map((v, c) => {
                    const key = `${r}:${c}`;
                    const hl = highlightKeys?.has(key) ? ` ${HL}` : "";
                    const cellRef = scrollToKey === key ? scrollRef : undefined;
                    const patch =
                      mode === "diff" && !removed ? cellPatches.get(key) : undefined;
                    if (patch) {
                      // Double-click a patched cell to override the fix by
                      // hand — the editor is seeded with the fixed value.
                      if (editingKey === key) {
                        return (
                          <td key={c} ref={cellRef} className={`px-2 py-1.5${hl}`}>
                            <CellEditor
                              value={cellText(patch.after)}
                              flagged={false}
                              title="Edit cell"
                              autoFocus
                              onCommit={(next) => onEditCell(r, c, next === "" ? null : next)}
                              onExit={() => setEditingKey(null)}
                            />
                          </td>
                        );
                      }
                      return (
                        <td
                          key={c}
                          ref={cellRef}
                          onDoubleClick={() => setEditingKey(key)}
                          className={`cursor-text whitespace-nowrap px-3 py-2${hl}`}
                          title={`${patch.reason} (confidence ${Math.round(patch.confidence * 100)}%) — double-click to edit`}
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
                    // Cleaned view: double-click any cell to edit it in place.
                    // Edits route to the mapped working-table row so they
                    // survive re-cleansing and land on the right record.
                    if (mode === "cleaned") {
                      const workingRow = cleanedToWorking?.[r] ?? r;
                      if (editingKey === key) {
                        return (
                          <td key={c} ref={cellRef} className={`px-2 py-1.5${hl}`}>
                            <CellEditor
                              value={cellText(v)}
                              flagged={false}
                              title="Edit cell"
                              autoFocus
                              onCommit={(next) =>
                                onEditCell(workingRow, c, next === "" ? null : next)
                              }
                              onExit={() => setEditingKey(null)}
                            />
                          </td>
                        );
                      }
                      return (
                        <td
                          key={c}
                          ref={cellRef}
                          onDoubleClick={() => setEditingKey(key)}
                          title="Double-click to edit"
                          className={`cursor-text whitespace-nowrap px-3 py-2 text-body transition hover:bg-line/20${hl}`}
                        >
                          {cellText(v) || <span className="text-dim">∅</span>}
                        </td>
                      );
                    }
                    // Changes view: any remaining cell is double-click
                    // editable too (rows here are working indices already).
                    if (mode === "diff" && !removed) {
                      if (editingKey === key) {
                        return (
                          <td key={c} ref={cellRef} className={`px-2 py-1.5${hl}`}>
                            <CellEditor
                              value={cellText(v)}
                              flagged={false}
                              title="Edit cell"
                              autoFocus
                              onCommit={(next) => onEditCell(r, c, next === "" ? null : next)}
                              onExit={() => setEditingKey(null)}
                            />
                          </td>
                        );
                      }
                      return (
                        <td
                          key={c}
                          ref={cellRef}
                          onDoubleClick={() => setEditingKey(key)}
                          title="Double-click to edit"
                          className={`cursor-text whitespace-nowrap px-3 py-2 text-body transition hover:bg-line/20${hl}`}
                        >
                          {cellText(v) || <span className="text-dim">∅</span>}
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
        {filter.trim() || (canFilterChanged && changedOnly)
          ? `${displayIndices.length.toLocaleString("en-GB")} of ${source.rows.length.toLocaleString("en-GB")} rows shown${displayIndices.length > ROW_CAP ? ` — first ${ROW_CAP}` : ""}`
          : displayIndices.length > ROW_CAP
            ? `Showing first ${ROW_CAP} of ${source.rows.length.toLocaleString("en-GB")} rows — all rows are analysed and exported.`
            : `Showing all ${source.rows.length} rows · ${cellPatches.size + removedRows.size} changes staged`}
      </p>
    </section>
  );
}
