import { useMemo } from "react";
import { cellText, type CellValue, type Patch } from "@refynr/engine";

/** A user review action, timestamped when it was performed. */
export interface UserAction {
  label: string;
  at: number;
}

/** Cap on rendered entries — big files can stage thousands of fixes. */
const ENTRY_CAP = 300;

interface HistoryEntry {
  at: number;
  actor: "app" | "user";
  text: string;
}

const val = (v: CellValue) => cellText(v) || "∅";

/**
 * The Change history tab: every change in this session — the fixes refynr
 * applied and every manual action the user took — with a timestamp and who
 * made it. App fixes are stamped with the analysis time (they're applied the
 * moment the data is analysed); user actions with the moment they happened.
 * Undoing an action removes it from the log (it's no longer a change).
 */
export function ChangeHistory({
  patches,
  headers,
  analysedAt,
  actions,
}: {
  /** The currently ACCEPTED patches — each one is a change refynr applied. */
  patches: Patch[];
  /** Working-table headers, for naming the column a patch touched. */
  headers: string[];
  /** When the current base table was analysed (app changes' timestamp). */
  analysedAt: number;
  /** User review actions, oldest first (from the undo stack). */
  actions: UserAction[];
}) {
  const entries = useMemo<HistoryEntry[]>(() => {
    const list: HistoryEntry[] = [];
    for (const p of patches) {
      if (p.kind === "cell") {
        const col = headers[p.cell.col] ?? `column ${p.cell.col + 1}`;
        list.push({
          at: analysedAt,
          actor: "app",
          text: `${col}, row ${p.cell.row + 2}: "${val(p.before)}" → "${val(p.after)}" — ${p.reason}`,
        });
      } else if (p.kind === "remove-row") {
        list.push({
          at: analysedAt,
          actor: "app",
          text: `Removed row ${p.row + 2} — ${p.reason}`,
        });
      } else {
        list.push({
          at: analysedAt,
          actor: "app",
          text: `Renamed column "${p.before}" → "${p.after}" — ${p.reason}`,
        });
      }
    }
    for (const a of actions) {
      list.push({ at: a.at, actor: "user", text: a.label });
    }
    // Most recent first; sort is stable, so app fixes keep patch order.
    return list.sort((a, b) => b.at - a.at);
  }, [patches, headers, analysedAt, actions]);

  const shown = entries.slice(0, ENTRY_CAP);

  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-inset px-4 py-2.5">
        <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.15em] text-mut">
          Change history
        </span>
        <span className="font-mono text-[10.5px] text-dim">
          {entries.length.toLocaleString("en-GB")} change{entries.length === 1 ? "" : "s"} ·{" "}
          <span className="text-teal">refynr</span> = applied by the app ·{" "}
          <span className="text-amber">you</span> = done manually
        </span>
      </div>

      {entries.length === 0 ? (
        <p className="px-4 py-8 text-center font-mono text-[12px] text-dim">
          No changes yet — every fix refynr applies and every edit you make will
          be logged here with a timestamp.
        </p>
      ) : (
        <ul className="max-h-[70vh] divide-y divide-line/40 overflow-auto">
          {shown.map((e, i) => (
            <li key={i} className="flex items-start gap-3 px-4 py-2">
              <span className="shrink-0 pt-px font-mono text-[10.5px] tabular-nums text-dim">
                {new Date(e.at).toLocaleString("en-GB", {
                  day: "2-digit",
                  month: "2-digit",
                  year: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                })}
              </span>
              <span
                className={`shrink-0 rounded-full px-2 py-px font-mono text-[10px] font-semibold ${
                  e.actor === "app"
                    ? "bg-teal/10 text-teal"
                    : "bg-amber/10 text-amber"
                }`}
              >
                {e.actor === "app" ? "refynr" : "you"}
              </span>
              <span className="min-w-0 break-words font-mono text-[12px] text-body">
                {e.text}
              </span>
            </li>
          ))}
        </ul>
      )}

      <p className="border-t border-line bg-inset px-4 py-2.5 font-mono text-[11px] text-dim">
        {entries.length > ENTRY_CAP
          ? `Showing the ${ENTRY_CAP} most recent of ${entries.length.toLocaleString("en-GB")} changes. `
          : ""}
        Undoing an action removes it from this log — it's no longer a change.
        Your original data is never modified either way.
      </p>
    </section>
  );
}
