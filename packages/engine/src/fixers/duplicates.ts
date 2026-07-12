import type { Finding, RowRemovalPatch } from "../types.js";
import { cellText } from "../table.js";
import { cleanWhitespace } from "./whitespace.js";
import { n, verb, type Fixer, type FixerOutput } from "./fixer.js";

const EXACT_RULE = "remove-duplicate-rows";
const FUZZY_RULE = "near-duplicate-rows";

/** Beyond this many distinct rows the O(n²) nearest-neighbour pass is skipped
 *  (key-collision clustering still runs) — keeps big files responsive. */
const NN_ROW_CAP = 2500;

/**
 * Whole-row fingerprint for key-collision clustering: every cell is lowercased,
 * stripped of punctuation, and its words sorted, so token order and punctuation
 * stop mattering. "Smith, John" and "John Smith" collide; "Acme Ltd." and
 * "Acme Ltd" collide.
 */
function fingerprint(row: readonly unknown[]): string {
  const tokens: string[] = [];
  for (const v of row) {
    const cleaned = cleanWhitespace(cellText(v as never))
      .toLowerCase()
      .replace(/[^\p{L}\p{N}@]+/gu, " ")
      .trim();
    if (cleaned) tokens.push(...cleaned.split(" "));
  }
  return tokens.sort().join(" ");
}

/** Levenshtein distance with an early exit once `max` is exceeded. */
function boundedEditDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array<number>(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + cost);
      if (curr[j]! < rowMin) rowMin = curr[j]!;
    }
    if (rowMin > max) return max + 1; // whole row already past the bound
    [prev, curr] = [curr, prev];
  }
  return prev[b.length]!;
}

/** Edit-distance budget for a fingerprint of the given length — tolerant of
 *  a typo or two, never so loose that different records merge. */
function editBudget(len: number): number {
  return Math.min(3, Math.max(1, Math.floor(len * 0.12)));
}

/**
 * Exact duplicate rows (after trimming and case-folding every cell) become
 * removal patches keeping the first occurrence. Near-duplicates — rows that
 * collide on a token-sorted fingerprint, or sit within a small edit distance
 * of one (typos) — are surfaced as an advisory finding grouped by cluster.
 * Refynr never auto-removes near-duplicates: whether "J. Smith" and "John
 * Smith" are the same person is the user's call, not a guess the engine makes.
 */
export const duplicateFixer: Fixer = {
  rule: EXACT_RULE,
  run({ table }): FixerOutput {
    const patches: RowRemovalPatch[] = [];
    const exactSeen = new Map<string, number>();
    // fingerprint -> the row indices (first occurrences only) that produced it
    const printGroups = new Map<string, number[]>();

    const exactKey = (row: (typeof table.rows)[number]): string =>
      row.map((v) => cleanWhitespace(cellText(v)).toLowerCase()).join(" ");

    table.rows.forEach((row, r) => {
      if (row.every((v) => cellText(v).trim() === "")) return; // blank rows handled elsewhere
      const key = exactKey(row);
      const firstAt = exactSeen.get(key);
      if (firstAt !== undefined) {
        patches.push({
          kind: "remove-row",
          id: `${EXACT_RULE}:${r}`,
          rule: EXACT_RULE,
          row: r,
          duplicateOf: firstAt,
          reason: `Row ${r + 2} is an exact duplicate of row ${firstAt + 2} — every cell matches once whitespace and letter case are ignored. The first occurrence is kept.`,
          confidence: 1,
        });
      } else {
        exactSeen.set(key, r);
        const fp = fingerprint(row);
        if (!fp) return;
        const group = printGroups.get(fp);
        if (group) group.push(r);
        else printGroups.set(fp, [r]);
      }
    });

    // Key-collision clusters: same fingerprint, >1 distinct row.
    const clusters: number[][] = [...printGroups.values()].filter(
      (g) => g.length > 1,
    );

    // Nearest-neighbour pass over the *unique* fingerprints: merge clusters
    // whose fingerprints are a typo apart. Skipped on very large inputs.
    const prints = [...printGroups.keys()];
    if (prints.length <= NN_ROW_CAP) {
      const parent = new Map(prints.map((p) => [p, p]));
      const find = (p: string): string => {
        let root = p;
        while (parent.get(root) !== root) root = parent.get(root)!;
        return root;
      };
      for (let i = 0; i < prints.length; i++) {
        for (let j = i + 1; j < prints.length; j++) {
          const a = prints[i]!;
          const b = prints[j]!;
          if (find(a) === find(b)) continue;
          const budget = editBudget(Math.min(a.length, b.length));
          if (boundedEditDistance(a, b, budget) <= budget) {
            parent.set(find(a), find(b));
          }
        }
      }
      // Rebuild clusters by union-find root so typo-variants join up.
      const byRoot = new Map<string, number[]>();
      for (const [fp, rowsForFp] of printGroups) {
        const root = find(fp);
        const bucket = byRoot.get(root);
        if (bucket) for (const r of rowsForFp) bucket.push(r);
        else byRoot.set(root, [...rowsForFp]);
      }
      clusters.length = 0;
      for (const rowsInCluster of byRoot.values()) {
        if (rowsInCluster.length > 1) clusters.push(rowsInCluster.sort((a, b) => a - b));
      }
    }

    const findings: Finding[] = [];

    if (patches.length > 0) {
      findings.push({
        rule: EXACT_RULE,
        severity: "error",
        title: `${n(patches.length, "exact duplicate row")}`,
        detail: `${n(patches.length, "row")} ${verb(patches.length, "is an exact duplicate of an earlier row", "are exact duplicates of earlier rows")} (ignoring whitespace and letter case). Duplicates inflate counts, break unique keys, and double-send communications. The first occurrence of each is kept.`,
        count: patches.length,
        patchIds: patches.map((p) => p.id),
      });
    }

    if (clusters.length > 0) {
      const affected = clusters.reduce((sum, g) => sum + g.length - 1, 0);
      const example = clusters.sort((a, b) => b.length - a.length)[0]!;
      const exampleRows = example
        .slice(0, 3)
        .map((r) => r + 2)
        .join(", ");
      findings.push({
        rule: FUZZY_RULE,
        severity: "warning",
        title: `${n(affected, "probable near-duplicate row")}`,
        detail: `refynr found ${n(clusters.length, "cluster")} of rows that look like the same record written differently — matching once word order, punctuation and small typos are ignored (e.g. "Smith, John" vs "John Smith", "Acme Ltd." vs "Acme Ltd"). The largest cluster is rows ${exampleRows}${example.length > 3 ? "…" : ""}. These are flagged, never auto-removed — review whether each cluster is really one record before merging.`,
        count: affected,
        cells: clusters.flatMap((g) =>
          g.slice(1).map((r) => ({ row: r, col: 0 })),
        ),
        patchIds: [],
      });
    }

    return { findings, patches };
  },
};
