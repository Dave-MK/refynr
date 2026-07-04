import type { CleanseResult, Table } from "@refynr/engine";

interface Stage {
  name: string;
  sub: string;
}

export function Pipeline({
  table,
  result,
  acceptedCount,
}: {
  table: Table;
  result: CleanseResult;
  acceptedCount: number;
}) {
  const stages: Stage[] = [
    { name: "Parse", sub: `${table.rows.length} rows` },
    { name: "Profile", sub: `${result.profile.columnCount} columns` },
    { name: "Detect", sub: `${result.findings.length} findings` },
    { name: "Patch", sub: `${result.patches.length} staged` },
    { name: "Score", sub: `${result.score.overall} / 100` },
  ];

  return (
    <section className="rounded-2xl border border-line bg-card p-5">
      <div className="mb-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="label">Processing pipeline</h2>
          <span className="pill border-teal/30 bg-teal/10 text-teal">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-teal" />
            live
          </span>
        </div>
        <span className="font-mono text-xs text-dim">
          stage {stages.length} / {stages.length}
        </span>
      </div>

      <div className="flex items-center gap-2">
        {stages.map((stage, i) => (
          <div key={stage.name} className="flex flex-1 items-center gap-2">
            <div className="flex min-w-0 flex-1 flex-col items-center gap-2">
              <div className="relative">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-line2 bg-inset">
                  <span className="glow-teal h-2.5 w-2.5 rounded-full bg-teal" />
                </div>
              </div>
              <div className="text-center">
                <div className="text-[13px] font-semibold text-hi">{stage.name}</div>
                <div className="font-mono text-[10px] text-dim">{stage.sub}</div>
              </div>
            </div>
            {i < stages.length - 1 && (
              <div className="mb-8 h-px w-6 shrink-0 bg-line2 sm:w-10" aria-hidden />
            )}
          </div>
        ))}
      </div>

      <div className="mt-4 h-1 overflow-hidden rounded-full bg-inset">
        <div className="h-full w-full rounded-full bg-gradient-to-r from-teal to-cyan" />
      </div>

      <div className="mt-4 flex items-center justify-between rounded-lg bg-inset px-4 py-2.5">
        <span className="font-mono text-xs text-mut">
          <span className="mr-2 text-teal">›</span>
          Staging patches — {result.patches.length} reversible edits queued
        </span>
        <span className="font-mono text-xs font-semibold text-teal">
          {acceptedCount} fixes
        </span>
      </div>
    </section>
  );
}
