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

const esc = (s: string): string =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** Render a report as a self-contained shareable HTML document (inline styles,
 *  no external assets — safe to email or drop on a shared drive). Same content
 *  as the Markdown rendering; `timestamp` is supplied by the caller. */
export function reportToHtml(
  report: RunReport,
  opts: { title?: string; timestamp?: string } = {},
): string {
  const title = esc(opts.title ?? "refynr cleaning report");
  const th = 'style="text-align:left;padding:6px 10px;border-bottom:2px solid #ccc"';
  const thNum = 'style="text-align:right;padding:6px 10px;border-bottom:2px solid #ccc"';
  const td = 'style="padding:6px 10px;border-bottom:1px solid #e5e5e5"';
  const tdNum = 'style="padding:6px 10px;border-bottom:1px solid #e5e5e5;text-align:right"';

  const parts: string[] = [
    "<!doctype html>",
    `<html lang="en"><head><meta charset="utf-8"><title>${title}</title></head>`,
    '<body style="font-family:system-ui,sans-serif;max-width:720px;margin:2rem auto;padding:0 1rem;color:#1a1a1a">',
    `<h1 style="font-size:1.5rem">${title}</h1>`,
  ];
  if (opts.timestamp) {
    parts.push(`<p style="color:#666"><em>Generated ${esc(opts.timestamp)}</em></p>`);
  }

  parts.push(
    '<h2 style="font-size:1.15rem">Summary</h2>',
    "<ul>",
    `<li><strong>Health score:</strong> ${report.scoreBefore} → ${report.scoreProjected} (if all fixes accepted)</li>`,
    `<li><strong>Rows:</strong> ${report.rowsBefore} → ${report.rowsAfter} (${report.rowsRemoved} removed)</li>`,
    `<li><strong>Cells changed:</strong> ${report.cellsChanged}</li>`,
    `<li><strong>Headers changed:</strong> ${report.headersChanged}</li>`,
    `<li><strong>Fixes applied:</strong> ${report.patchesApplied} of ${report.patchesProposed} proposed</li>`,
    "</ul>",
  );

  if (report.applied.length > 0) {
    parts.push(
      '<h2 style="font-size:1.15rem">Changes applied</h2>',
      '<table style="border-collapse:collapse;width:100%">',
      `<thead><tr><th ${th}>Rule</th><th ${thNum}>Count</th><th ${th}>Example reason</th></tr></thead><tbody>`,
    );
    for (const a of report.applied) {
      parts.push(
        `<tr><td ${td}>${esc(a.rule)}</td><td ${tdNum}>${a.count}</td><td ${td}>${esc(a.sample)}</td></tr>`,
      );
    }
    parts.push("</tbody></table>");
  }

  if (report.advisories.length > 0) {
    parts.push(
      '<h2 style="font-size:1.15rem">Flagged for review (not auto-fixed)</h2>',
      '<table style="border-collapse:collapse;width:100%">',
      `<thead><tr><th ${th}>Finding</th><th ${thNum}>Count</th></tr></thead><tbody>`,
    );
    for (const a of report.advisories) {
      parts.push(`<tr><td ${td}>${esc(a.title)}</td><td ${tdNum}>${a.count}</td></tr>`);
    }
    parts.push("</tbody></table>");
  }

  parts.push("</body></html>");
  return parts.join("\n");
}
