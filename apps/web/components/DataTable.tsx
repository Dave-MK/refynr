import { cellText, type CellPatch, type Table } from "@refynr/engine";

export type ViewMode = "original" | "diff" | "cleaned";

const ROW_CAP = 300;

export function DataTable({
  table,
  cleaned,
  cellPatches,
  removedRows,
  advisoryCells,
  mode,
}: {
  /** The untouched original. */
  table: Table;
  /** Original + accepted patches (for the "cleaned" view). */
  cleaned: Table;
  /** Accepted cell patches keyed by "row:col" (original coordinates). */
  cellPatches: Map<string, CellPatch>;
  /** Original row indices with an accepted removal patch. */
  removedRows: Set<number>;
  /** Advisory cells keyed by "row:col" → finding title (amber highlight). */
  advisoryCells: Map<string, string>;
  mode: ViewMode;
}) {
  const source = mode === "cleaned" ? cleaned : table;
  const rows = source.rows.slice(0, ROW_CAP);
  const showMarks = mode !== "cleaned";

  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-card">
      <div className="overflow-auto">
        <table className="w-full min-w-max border-collapse font-mono text-[12.5px]">
          <thead>
            <tr className="bg-inset text-left">
              <th className="w-12 px-3 py-2.5 text-right text-[10px] font-semibold tracking-[0.15em] text-dim">
                #
              </th>
              {source.headers.map((h, i) => (
                <th
                  key={i}
                  className="whitespace-nowrap px-3 py-2.5 text-[10px] font-semibold uppercase tracking-[0.15em] text-mut"
                >
                  {h}
                </th>
              ))}
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
                    const advisory = showMarks && !removed ? advisoryCells.get(key) : undefined;
                    const text = cellText(v);
                    return (
                      <td
                        key={c}
                        className={`whitespace-nowrap px-3 py-2 ${removed ? "text-mut" : "text-body"}`}
                        title={advisory}
                      >
                        {advisory ? (
                          <span className="text-amber underline decoration-amber/60 decoration-dotted underline-offset-4">
                            {text || "∅"}
                          </span>
                        ) : (
                          text || (removed ? "∅" : "")
                        )}
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
