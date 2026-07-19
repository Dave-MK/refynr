import type { HealthScore } from "@refynr/engine";

function toneText(score: number): string {
  if (score >= 85) return "text-teal";
  if (score >= 60) return "text-amber";
  return "text-coral";
}

function toneBar(score: number): string {
  if (score >= 80) return "bg-mint";
  if (score >= 60) return "bg-amber";
  return "bg-coral";
}

function Ring({ score, label, glow }: { score: number; label: string; glow?: boolean }) {
  const r = 44;
  const c = 2 * Math.PI * r;
  const tone = toneText(score);
  return (
    <div className="flex flex-col items-center gap-2">
      <div className={`relative h-28 w-28 ${glow ? "glow-teal" : ""}`}>
        <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
          <circle
            cx="50" cy="50" r={r} fill="none"
            className="stroke-inset" strokeWidth="9"
          />
          <circle
            cx="50" cy="50" r={r} fill="none"
            className={`${tone} stroke-current transition-all duration-700`}
            strokeWidth="9" strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - score / 100)}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className={`text-[34px] font-bold tabular-nums ${tone}`}>{score}</span>
        </div>
      </div>
      <span className="font-mono text-[11px] uppercase tracking-[0.15em] text-dim">
        {label}
      </span>
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
  const delta = projected.overall - score.overall;
  return (
    <section className="@container rounded-2xl border border-line bg-card p-6">
      <div className="mb-6 flex items-center justify-between">
        <h2 className="label">Data health</h2>
        {delta > 0 && (
          <span className="font-mono text-xs font-semibold text-teal">
            +{delta} projected
          </span>
        )}
      </div>
      {/* Container query, not viewport: in the xl two-pane layout this card
          sits in a 440px sidebar and must stack even on a wide screen. */}
      <div className="mx-auto flex max-w-4xl flex-col items-center gap-8 @xl:flex-row">
        <div className="flex items-center gap-6">
          <Ring score={score.overall} label="now" />
          <Ring score={projected.overall} label="after fixes" glow />
        </div>
        <div className="w-full flex-1 space-y-4">
          {score.dimensions.map((d) => (
            <div key={d.key}>
              <div className="mb-1.5 flex items-baseline justify-between">
                <span className="text-[13px] font-semibold text-hi">{d.label}</span>
                <span className="font-mono text-[11px] text-mut">
                  {d.score}
                  {d.issues > 0 && (
                    <span className="text-dim">
                      {" "}· {d.issues} issue{d.issues === 1 ? "" : "s"}
                    </span>
                  )}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-inset">
                <div
                  className={`h-full rounded-full ${toneBar(d.score)} transition-all duration-700`}
                  style={{ width: `${Math.max(3, d.score)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
