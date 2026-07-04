import type { Finding, HeaderPatch } from "../types.js";
import { cleanWhitespace } from "../text.js";
import { type Fixer, type FixerOutput } from "./fixer.js";

const RULE = "header-hygiene";

/**
 * Column-header hygiene: trims stray whitespace from header names and
 * de-duplicates repeated names (the two silent killers of joins, VLOOKUPs and
 * Power Query imports, which key on exact header text). Duplicates are
 * suffixed " (2)", " (3)", … keeping the first occurrence unchanged.
 */
export const headerFixer: Fixer = {
  rule: RULE,
  run({ table }): FixerOutput {
    const patches: HeaderPatch[] = [];
    const seen = new Map<string, number>();
    let trimmed = 0;
    let deduped = 0;

    table.headers.forEach((header, col) => {
      const cleaned = cleanWhitespace(header);
      if (cleaned !== header) trimmed++;

      const seenCount = seen.get(cleaned.toLowerCase()) ?? 0;
      seen.set(cleaned.toLowerCase(), seenCount + 1);
      const finalName = seenCount === 0 ? cleaned : `${cleaned} (${seenCount + 1})`;
      if (seenCount > 0) deduped++;

      if (finalName !== header) {
        patches.push({
          kind: "header",
          id: `${RULE}:${col}`,
          rule: RULE,
          col,
          before: header,
          after: finalName,
          reason:
            seenCount > 0
              ? `Duplicate column header renamed to "${finalName}". Two columns with the same name break joins and VLOOKUP, which match on exact header text.`
              : `Header whitespace trimmed to "${finalName}". Trailing spaces in headers silently break lookups and Power Query column references.`,
          confidence: 1,
        });
      }
    });

    if (patches.length === 0) return { findings: [], patches: [] };

    const parts: string[] = [];
    if (trimmed > 0) parts.push(`${trimmed} with stray whitespace`);
    if (deduped > 0) parts.push(`${deduped} duplicated`);

    const findings: Finding[] = [
      {
        rule: RULE,
        severity: "warning",
        title: `${patches.length} column header${patches.length === 1 ? "" : "s"} need cleanup`,
        detail: `Column headers (${parts.join(", ")}) will silently break joins, VLOOKUP/XLOOKUP and Power BI imports, which key on exact header text. Trimmed and de-duplicated.`,
        count: patches.length,
        patchIds: patches.map((p) => p.id),
      },
    ];

    return { findings, patches };
  },
};
