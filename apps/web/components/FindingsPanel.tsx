import type { Finding } from "@refynr/engine";

function pillFor(f: Finding): { className: string; text: string } {
  if (f.patchIds.length > 0) {
    return { className: "border-amber/30 bg-amber/10 text-amber", text: "Fixable" };
  }
  if (f.severity === "info") {
    return { className: "border-cyan/30 bg-cyan/10 text-cyan", text: "Info" };
  }
  return { className: "border-coral/30 bg-coral/10 text-coral", text: "Advisory" };
}

const DOT: Record<Finding["severity"], string> = {
  error: "bg-coral",
  warning: "bg-amber",
  info: "bg-cyan",
};

export function FindingsPanel({
  findings,
  enabled,
  onToggle,
  onSetAll,
  onLocate,
}: {
  findings: Finding[];
  enabled: Set<number>;
  onToggle: (index: number) => void;
  /** Accept (true) or clear (false) every fixable finding at once. */
  onSetAll: (accept: boolean) => void;
  /** Jump to and highlight a finding's affected cells in the table. */
  onLocate: (index: number) => void;
}) {
  if (findings.length === 0) {
    return (
      <section className="rounded-2xl border border-teal/25 bg-card p-6">
        <p className="font-mono text-sm text-teal">
          › No issues found — this data looks clean.
        </p>
      </section>
    );
  }

  const fixableCount = findings.filter((f) => f.patchIds.length > 0).length;
  const allApplied = fixableCount > 0 && enabled.size === fixableCount;

  return (
    <section className="rounded-2xl border border-line bg-card2">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-6 py-4">
        <h2 className="label">Findings ({findings.length})</h2>
        <div className="flex items-center gap-3">
          {fixableCount > 0 && (
            <button
              onClick={() => onSetAll(!allApplied)}
              className="rounded-md border border-line2 bg-card px-3 py-1.5 font-mono text-[11px] font-semibold text-body transition hover:border-mut"
            >
              {allApplied ? "Clear all fixes" : "Accept all fixes"}
            </button>
          )}
          <span className="font-mono text-xs font-semibold text-teal">
            {enabled.size} applied
          </span>
        </div>
      </div>
      <ul className="divide-y divide-line/60">
        {findings.map((f, i) => {
          const fixable = f.patchIds.length > 0;
          const pill = pillFor(f);
          return (
            <li key={`${f.rule}-${i}`} className="flex items-start gap-4 px-6 py-4">
              <span
                className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line bg-inset"
                aria-hidden
              >
                <span className={`h-2 w-2 rounded-full ${DOT[f.severity]}`} />
              </span>
              <button
                type="button"
                onClick={() => onLocate(i)}
                title="Show these cells in the table"
                className="group min-w-0 flex-1 rounded-lg text-left transition hover:bg-line/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal/40"
              >
                <div className="flex flex-wrap items-center gap-2.5">
                  <span className="text-[14px] font-semibold text-hi">{f.title}</span>
                  <span className={`pill ${pill.className}`}>{pill.text}</span>
                  <span className="font-mono text-[10px] text-dim opacity-0 transition group-hover:opacity-100">
                    ⌖ locate
                  </span>
                </div>
                <p className="mt-1 text-[13px] leading-relaxed text-mut">{f.detail}</p>
              </button>
              {fixable ? (
                <label className="flex shrink-0 cursor-pointer items-center gap-2 pt-1.5">
                  <input
                    type="checkbox"
                    checked={enabled.has(i)}
                    onChange={() => onToggle(i)}
                    className="h-4 w-4 accent-teal"
                  />
                  <span className="font-mono text-xs text-teal">apply</span>
                </label>
              ) : (
                <span className="shrink-0 pt-1.5 font-mono text-xs text-dim">review</span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
