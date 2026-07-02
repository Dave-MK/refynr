import { cellText, type CellPatch, type Table } from "@refynr/engine";

export type ViewMode = "original" | "diff" | "cleaned";

const ROW_CAP = 300;

export function DataTable({
  table,
  cleaned,
  cellPatches,
  removedRows,
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
  mode: ViewMode;
}) {
  const source = mode === "cleaned" ? cleaned : table;
  const rows = source.rows.slice(0, ROW_CAP);

  return (
    <div className="overflow-auto rounded-xl border border-slate-200 bg-white shadow-sm">
      <table className="w-full min-w-max border-collapse text-sm">
        <thead>
          <tr className="sticky top-0 bg-slate-100 text-left">
            <th className="w-12 px-3 py-2 text-right font-normal text-slate-400">
              #
            </th>
            {source.headers.map((h, i) => (
              <th
                key={i}
                className="whitespace-nowrap px-3 py-2 font-semibold text-slate-700"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => {
            const removed = mode === "diff" && removedRows.has(r);
            return (
              <tr
                key={r}
                className={
                  removed
                    ? "bg-rose-50 text-rose-400 line-through decoration-rose-300"
                    : "odd:bg-white even:bg-slate-50/60"
                }
              >
                <td className="px-3 py-1.5 text-right tabular-nums text-slate-300">
                  {r + 2}
                </td>
                {row.map((v, c) => {
                  const patch =
                    mode === "diff" && !removed
                      ? cellPatches.get(`${r}:${c}`)
                      : undefined;
                  if (patch) {
                    return (
                      <td
                        key={c}
                        className="whitespace-nowrap px-3 py-1.5"
                        title={`${patch.reason} (confidence ${Math.round(patch.confidence * 100)}%)`}
                      >
                        <span className="rounded bg-rose-50 px-1 text-rose-500 line-through decoration-rose-300">
                          {cellText(patch.before) || "∅"}
                        </span>
                        <span className="mx-1 text-slate-300">→</span>
                        <span className="rounded bg-teal-50 px-1 font-medium text-teal-700">
                          {cellText(patch.after) || "∅"}
                        </span>
                      </td>
                    );
                  }
                  return (
                    <td
                      key={c}
                      className="whitespace-nowrap px-3 py-1.5 text-slate-600"
                    >
                      {cellText(v)}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      {source.rows.length > ROW_CAP && (
        <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-400">
          Showing first {ROW_CAP} of {source.rows.length} rows. All rows are
          included in analysis and export.
        </p>
      )}
    </div>
  );
}
