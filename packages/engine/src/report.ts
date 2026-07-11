import type { CleanseResult } from "./types.js";

export interface ReportRuleLine {
  rule: string;
  kind: "cell" | "remove-row" | "header";
  count: number;
  /** A representative reason from one patch, for the "why" column. */
  sample: string;
}

export interface RunReport {
  rowsBefore: number;
  rowsRemoved: number;
  rowsAfter: number;
  cellsChanged: number;
  headersChanged: number;
  scoreBefore: number;
  /** Health if every proposed fix were accepted (shared-basis projected score). */
  scoreProjected: number;
  patchesApplied: number;
  patchesProposed: number;
  applied: ReportRuleLine[];
  /** Findings the engine flagged but can't fix — the things a human must judge. */
  advisories: { rule: string; title: string; count: number }[];
}

/**
 * Summarise a cleanse run into a shareable audit record: what was changed, by
 * which rule, and what remains for a human to judge. This is the trust artefact
 * technical and governance buyers ask for — "show me exactly what you did" —
 * built entirely from patch metadata refynr already captures (each patch's
 * rule, reason and confidence). Pure: pass a timestamp in for the header.
 */
export function buildReport(
  result: CleanseResult,
  acceptedIds: Set<string>,
): RunReport {
  const applied = new Map<string, ReportRuleLine>();
  let cellsChanged = 0;
  let rowsRemoved = 0;
  let headersChanged = 0;

  for (const p of result.patches) {
    if (!acceptedIds.has(p.id)) continue;
    if (p.kind === "cell") cellsChanged++;
    else if (p.kind === "remove-row") rowsRemoved++;
    else headersChanged++;

    const line = applied.get(p.rule);
    if (line) line.count++;
    else applied.set(p.rule, { rule: p.rule, kind: p.kind, count: 1, sample: p.reason });
  }

  const advisories = result.findings
    .filter((f) => f.patchIds.length === 0 && f.count > 0)
    .map((f) => ({ rule: f.rule, title: f.title, count: f.count }));

  const rowsBefore = result.profile.rowCount;

  return {
    rowsBefore,
    rowsRemoved,
    rowsAfter: rowsBefore - rowsRemoved,
    cellsChanged,
    headersChanged,
    scoreBefore: result.score.overall,
    scoreProjected: result.projectedScore.overall,
    patchesApplied: [...acceptedIds].length,
    patchesProposed: result.patches.length,
    applied: [...applied.values()].sort((a, b) => b.count - a.count),
    advisories,
  };
}

/** Render a report as a shareable Markdown document. `timestamp` is supplied by
 *  the caller (the engine is deterministic and can't read the clock). */
export function reportToMarkdown(
  report: RunReport,
  opts: { title?: string; timestamp?: string } = {},
): string {
  const title = opts.title ?? "refynr cleaning report";
  const lines: string[] = [`# ${title}`, ""];
  if (opts.timestamp) lines.push(`_Generated ${opts.timestamp}_`, "");

  lines.push(
    "## Summary",
    "",
    `- **Health score:** ${report.scoreBefore} → ${report.scoreProjected} (if all fixes accepted)`,
    `- **Rows:** ${report.rowsBefore} → ${report.rowsAfter} (${report.rowsRemoved} removed)`,
    `- **Cells changed:** ${report.cellsChanged}`,
    `- **Headers changed:** ${report.headersChanged}`,
    `- **Fixes applied:** ${report.patchesApplied} of ${report.patchesProposed} proposed`,
    "",
  );

  if (report.applied.length > 0) {
    lines.push("## Changes applied", "", "| Rule | Count | Example reason |", "| --- | --: | --- |");
    for (const a of report.applied) {
      lines.push(`| ${a.rule} | ${a.count} | ${a.sample.replace(/\|/g, "\\|")} |`);
    }
    lines.push("");
  }

  if (report.advisories.length > 0) {
    lines.push(
      "## Flagged for review (not auto-fixed)",
      "",
      "| Finding | Count |",
      "| --- | --: |",
    );
    for (const a of report.advisories) {
      lines.push(`| ${a.title.replace(/\|/g, "\\|")} | ${a.count} |`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
