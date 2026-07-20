import type { Finding, RowRemovalPatch } from "../types.js";
import { cellText, isMissingSentinel } from "../table.js";
import { cleanWhitespace } from "./whitespace.js";
import { n, verb, type Fixer, type FixerOutput } from "./fixer.js";

const EXACT_RULE = "remove-duplicate-rows";
const FUZZY_RULE = "near-duplicate-rows";

/** Beyond this many distinct rows the nearest-neighbour pass is skipped
 *  (key-collision clustering still runs) — keeps big files responsive. */
const NN_ROW_CAP = 50_000;

/** Sorted-neighbourhood window: each fingerprint is compared only against
 *  this many sort-adjacent neighbours per pass. */
const SN_WINDOW = 8;

/** Below this many unique fingerprints the exhaustive all-pairs comparison
 *  runs instead of the windowed scan — it catches typo-pairs that sort far
 *  apart in both sort orders. Kept small because cleanse() re-runs on the
 *  main thread per edit: 500² /2 bounded-edit-distance calls is the budget. */
const ALL_PAIRS_CAP = 500;

/** Joins cells inside a composite key. NUL can never survive cleanWhitespace
 *  inside a value, so multi-word cells can't collide across column boundaries
 *  (("Anna Marie","Smith") vs ("Anna","Marie Smith")). Built with fromCharCode
 *  so no literal control character sits in this source file. */
const KEY_SEP = String.fromCharCode(0);

/** Column names that suggest an identifier even in small tables. */
const ID_NAME_RE =
  /(^|[^a-z])(id|ids|uid|ref|reference|code|sku|key|account|acct|no|number)([^a-z]|$)/i;

/** Below this fingerprint length there's no meaningful typo evidence — a
 *  one-token fingerprint a single edit away is coincidence, not a variant. */
const MIN_TYPO_LEN = 6;

/**
 * Whole-row fingerprint for key-collision clustering: every cell is lowercased,
 * stripped of punctuation, and its words sorted, so token order and punctuation
 * stop mattering. "Smith, John" and "John Smith" collide; "Acme Ltd." and
 * "Acme Ltd" collide. Missing-value sentinels contribute nothing (they aren't
 * identity). `skipCols` drops identifier-ish columns from the *context*
 * fingerprint used for typo comparison — two rows that differ only in an ID
 * are distinct records by design, not typos of each other. `lettersOnly`
 * additionally drops digit-only tokens: a one-digit difference between two
 * numbers (dates, amounts, quantities) is a different value, not a typo, so
 * numeric tokens carry no typo evidence.
 */
function fingerprint(
  row: readonly unknown[],
  skipCols?: ReadonlySet<number>,
  lettersOnly = false,
): string {
  const tokens: string[] = [];
  for (let c = 0; c < row.length; c++) {
    if (skipCols?.has(c)) continue;
    const v = row[c];
    if (isMissingSentinel(v as never)) continue;
    const cleaned = cleanWhitespace(cellText(v as never))
      .toLowerCase()
      .replace(/[^\p{L}\p{N}@]+/gu, " ")
      .trim();
    if (!cleaned) continue;
    for (const tok of cleaned.split(" ")) {
      if (lettersOnly && !/\p{L}/u.test(tok)) continue;
      tokens.push(tok);
    }
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
  run({ table, profile, options }): FixerOutput {
    const patches: RowRemovalPatch[] = [];
    const exactSeen = new Map<string, number>();
    // fingerprint -> the row indices (first occurrences only) that produced it
    const printGroups = new Map<string, number[]>();
    // full fingerprint -> context fingerprint (identifier columns excluded),
    // the string typo comparisons run on.
    const ctxByFull = new Map<string, string>();

    // Identifier-ish columns: near-unique with enough rows to be sure, or
    // id-named and fully distinct. Entity-resolution's cardinal rule is that
    // these never contribute to similarity — a row pair differing only in an
    // ID is either genuinely distinct or a job for the dedupe-key feature,
    // never a "typo".
    const idCols = new Set<number>();
    for (const col of profile.columns) {
      if (col.nonEmpty === 0) continue;
      const ratio = col.distinct / col.nonEmpty;
      if (
        (col.nonEmpty >= 10 && ratio >= 0.9) ||
        (ID_NAME_RE.test(col.name) && col.distinct === col.nonEmpty)
      ) {
        idCols.add(col.index);
      }
    }

    // User-chosen key columns narrow what "duplicate" means: matching on just
    // these columns (e.g. Email) counts, even when other cells differ. Keys
    // are header names resolved here, so a saved recipe or a reshaped table
    // can never silently bind the key to the wrong column position.
    const keyCols = (options.dedupeKey ?? [])
      .map((name) => table.headers.indexOf(name))
      .filter((c) => c >= 0)
      .sort((a, b) => a - b);
    const keyNames = keyCols.map((c) => `"${table.headers[c]}"`).join(" + ");

    // Cells are joined with a separator that cleanWhitespace can never leave
    // inside a value, so multi-word cells can't collide across column
    // boundaries (("Anna Marie","Smith") vs ("Anna","Marie Smith")).
    const exactKey = (row: (typeof table.rows)[number]): string =>
      (keyCols.length > 0 ? keyCols.map((c) => row[c] ?? null) : row)
        .map((v) => cleanWhitespace(cellText(v)).toLowerCase())
        .join(KEY_SEP);

    table.rows.forEach((row, r) => {
      if (row.every((v) => cellText(v).trim() === "")) return; // blank rows handled elsewhere
      if (
        keyCols.length > 0 &&
        keyCols.every((c) => cellText(row[c] ?? null).trim() === "")
      )
        return; // no key present — can't call it a duplicate
      const key = exactKey(row);
      const firstAt = exactSeen.get(key);
      if (firstAt !== undefined) {
        patches.push({
          kind: "remove-row",
          id: `${EXACT_RULE}:${r}`,
          rule: EXACT_RULE,
          row: r,
          duplicateOf: firstAt,
          reason:
            keyCols.length > 0
              ? `Row ${r + 2} duplicates row ${firstAt + 2} on ${keyNames} — your chosen duplicate key. The first occurrence is kept.`
              : `Row ${r + 2} is an exact duplicate of row ${firstAt + 2} — every cell matches once whitespace and letter case are ignored. The first occurrence is kept.`,
          confidence: 1,
        });
      } else {
        exactSeen.set(key, r);
        const fp = fingerprint(row);
        if (!fp) return;
        const group = printGroups.get(fp);
        if (group) group.push(r);
        else {
          printGroups.set(fp, [r]);
          ctxByFull.set(fp, fingerprint(row, idCols, true));
        }
      }
    });

    // Key-collision clusters: same fingerprint, >1 distinct row.
    const clusters: number[][] = [...printGroups.values()].filter(
      (g) => g.length > 1,
    );

    // Nearest-neighbour pass over the *unique* fingerprints: merge clusters
    // whose fingerprints are a typo apart. Multi-pass sorted neighbourhood
    // (Rahm & Do's recommended scaling method): instead of comparing all
    // pairs, sort the fingerprints two ways — forwards, and reversed so a
    // typo in the first word can't push variants apart — and compare each
    // only against its SN_WINDOW sort-neighbours. O(n·w) instead of O(n²).
    const prints = [...printGroups.keys()];
    if (prints.length <= NN_ROW_CAP) {
      const parent = new Map(prints.map((p) => [p, p]));
      const find = (p: string): string => {
        let root = p;
        while (parent.get(root) !== root) root = parent.get(root)!;
        return root;
      };
      const tryUnion = (a: string, b: string): void => {
        if (find(a) === find(b)) return;
        const ca = ctxByFull.get(a)!;
        const cb = ctxByFull.get(b)!;
        // Identical context with different full fingerprints means the rows
        // differ only in identifier columns — distinct records, not typos.
        if (ca === cb) return;
        // Tiny fingerprints one edit apart are coincidence ("1" vs "2"),
        // not typo evidence.
        const minLen = Math.min(ca.length, cb.length);
        if (minLen < MIN_TYPO_LEN) return;
        const budget = editBudget(minLen);
        if (boundedEditDistance(ca, cb, budget) <= budget) {
          parent.set(find(a), find(b));
        }
      };
      if (prints.length <= ALL_PAIRS_CAP) {
        // Small enough for the exhaustive comparison — window-based scanning
        // would miss typo-pairs that sort far apart in both orders.
        for (let i = 0; i < prints.length; i++) {
          for (let j = i + 1; j < prints.length; j++) {
            tryUnion(prints[i]!, prints[j]!);
          }
        }
      } else {
        // Sort by CONTEXT fingerprint (the string distances run on) so the
        // window heuristic keeps typo-variants adjacent. Reversed keys are
        // precomputed once (Schwartzian transform) — the sort comparator runs
        // O(n log n) times and must not allocate.
        const reverse = (s: string): string => [...s].reverse().join("");
        const reversed = new Map(
          prints.map((p) => [p, reverse(ctxByFull.get(p)!)]),
        );
        const passes: string[][] = [
          [...prints].sort((a, b) =>
            ctxByFull.get(a)! < ctxByFull.get(b)! ? -1 : 1,
          ),
          [...prints].sort((a, b) =>
            reversed.get(a)! < reversed.get(b)! ? -1 : 1,
          ),
        ];
        for (const ordered of passes) {
          for (let i = 0; i < ordered.length; i++) {
            const stop = Math.min(ordered.length, i + 1 + SN_WINDOW);
            for (let j = i + 1; j < stop; j++) {
              tryUnion(ordered[i]!, ordered[j]!);
            }
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
        title: `${n(patches.length, keyCols.length > 0 ? "duplicate row" : "exact duplicate row")}`,
        detail: `${n(patches.length, "row")} ${verb(patches.length, "is a duplicate of an earlier row", "are duplicates of earlier rows")} ${keyCols.length > 0 ? `matching on ${keyNames} — your chosen duplicate key` : "(every cell matches, ignoring whitespace and letter case)"}. Duplicates inflate counts, break unique keys, and double-send communications. The first occurrence of each is kept.`,
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
