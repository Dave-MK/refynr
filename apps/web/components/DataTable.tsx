import { useEffect, useState } from "react";
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
}) {
  const source = mode === "cleaned" ? cleaned : mode === "diff" ? working : original;
  const rows = source.rows.slice(0, ROW_CAP);

  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-card">
      <div className="overflow-auto">
        <table className="w-full min-w-max border-collapse font-mono text-[12.5px]">
          <thead>
            <tr className="bg-inset text-left">
              <th className="w-12 px-3 py-2.5 text-right text-[10px] font-semibold tracking-[0.15em] text-dim">
                #
              </th>
              {source.headers.map((h, i) => {
                const hp = mode === "diff" ? headerPatches.get(i) : undefined;
                return (
                  <th
                    key={i}
                    title={hp ? `Renamed to "${hp.after}"` : undefined}
                    className="whitespace-nowrap px-3 py-2.5 text-[10px] font-semibold uppercase tracking-[0.15em] text-mut"
                  >
                    {hp ? (
                      <span className="text-teal underline decoration-teal/50 decoration-dotted underline-offset-4">
                        {h}
                      </span>
                    ) : (
                      h
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-line/40">
            {rows.map((row, r) => {
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
                    const patch =
                      mode === "diff" && !removed ? cellPatches.get(key) : undefined;
                    if (patch) {
                      return (
                        <td
                          key={c}
                          className="whitespace-nowrap px-3 py-2"
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
                        <td key={c} className="px-2 py-1.5">
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
                        className={`whitespace-nowrap px-3 py-2 ${removed ? "text-mut" : "text-body"}`}
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
        {source.rows.length > ROW_CAP
          ? `Showing first ${ROW_CAP} of ${source.rows.length} rows — all rows are analysed and exported.`
          : `Showing all ${source.rows.length} rows · ${cellPatches.size + removedRows.size} changes staged`}
      </p>
    </section>
  );
}
