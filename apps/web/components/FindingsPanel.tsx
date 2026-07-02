import type { Finding } from "@refynr/engine";

const SEVERITY_STYLE: Record<
  Finding["severity"],
  { dot: string; badge: string; label: string }
> = {
  error: { dot: "bg-rose-500", badge: "bg-rose-50 text-rose-700", label: "Needs review" },
  warning: { dot: "bg-amber-400", badge: "bg-amber-50 text-amber-700", label: "Fixable" },
  info: { dot: "bg-sky-400", badge: "bg-sky-50 text-sky-700", label: "Info" },
};

export function FindingsPanel({
  findings,
  enabled,
  onToggle,
}: {
  findings: Finding[];
  enabled: Set<number>;
  onToggle: (index: number) => void;
}) {
  if (findings.length === 0) {
    return (
      <div className="rounded-xl border border-teal-200 bg-teal-50 p-6 text-teal-800">
        <p className="font-medium">No issues found — this data looks clean.</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <h2 className="border-b border-slate-100 px-6 py-4 text-sm font-semibold uppercase tracking-wide text-slate-500">
        Findings ({findings.length})
      </h2>
      <ul className="divide-y divide-slate-100">
        {findings.map((f, i) => {
          const style = SEVERITY_STYLE[f.severity];
          const fixable = f.patchIds.length > 0;
          return (
            <li key={`${f.rule}-${i}`} className="flex items-start gap-3 px-6 py-4">
              <span
                className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${style.dot}`}
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-slate-800">{f.title}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${style.badge}`}
                  >
                    {fixable ? style.label : "Advisory"}
                  </span>
                </div>
                <p className="mt-1 text-sm leading-relaxed text-slate-500">
                  {f.detail}
                </p>
              </div>
              {fixable && (
                <label className="flex shrink-0 cursor-pointer items-center gap-2 pt-1 text-sm text-slate-600">
                  <input
                    type="checkbox"
                    checked={enabled.has(i)}
                    onChange={() => onToggle(i)}
                    className="h-4 w-4 accent-teal-600"
                  />
                  Apply
                </label>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
