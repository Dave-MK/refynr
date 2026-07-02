import type { HealthScore } from "@refynr/engine";

function ringColor(score: number): string {
  if (score >= 85) return "text-teal-600";
  if (score >= 60) return "text-amber-500";
  return "text-rose-500";
}

function barColor(score: number): string {
  if (score >= 85) return "bg-teal-500";
  if (score >= 60) return "bg-amber-400";
  return "bg-rose-400";
}

function Ring({ score, label }: { score: number; label: string }) {
  const r = 44;
  const c = 2 * Math.PI * r;
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative h-28 w-28">
        <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
          <circle
            cx="50" cy="50" r={r} fill="none"
            className="stroke-slate-200" strokeWidth="8"
          />
          <circle
            cx="50" cy="50" r={r} fill="none"
            className={`${ringColor(score)} stroke-current transition-all duration-700`}
            strokeWidth="8" strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - score / 100)}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className={`text-3xl font-semibold ${ringColor(score)}`}>
            {score}
          </span>
        </div>
      </div>
      <span className="text-xs font-medium text-slate-500">{label}</span>
    </div>
  );
}

export function ScoreCard({
  score,
  projected,
}: {
  score: HealthScore;
  projected: HealthScore;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">
        Data health
      </h2>
      <div className="flex items-center gap-6">
        <Ring score={score.overall} label="Now" />
        <div className="text-2xl text-slate-300" aria-hidden>
          →
        </div>
        <Ring score={projected.overall} label="After fixes" />
        <div className="ml-4 flex-1 space-y-3">
          {score.dimensions.map((d) => (
            <div key={d.key}>
              <div className="mb-1 flex justify-between text-xs">
                <span className="font-medium text-slate-600">{d.label}</span>
                <span className="text-slate-400">
                  {d.score}
                  {d.issues > 0 && ` · ${d.issues} issue${d.issues === 1 ? "" : "s"}`}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                <div
                  className={`h-full rounded-full ${barColor(d.score)} transition-all duration-700`}
                  style={{ width: `${d.score}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
