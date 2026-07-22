import type { CellValue, Finding, Table } from "./types.js";
import { cellText, isEmptyCell, isMissingSentinel } from "./table.js";
import { n, verb } from "./fixers/fixer.js";

/**
 * Relational join with an honest account of what it did.
 *
 * A join is where data quality fails hardest and most silently: VLOOKUP hands
 * back #N/A and shrugs, and a 1:many merge quietly turns 10,000 rows into
 * 43,000 without anyone noticing for a week. Both failures are invisible in the
 * output — you have to already suspect them to go looking.
 *
 * So `joinTables` returns the joined table AND a diagnosis: which rows matched
 * nothing, which rows multiplied and by how much, and — the useful part — WHY
 * the misses missed. A key that failed only because one side zero-pads its
 * codes is a fixable mistake, not an absent record, and refynr says so instead
 * of leaving you to guess.
 *
 * Like the shape transforms in `transform.ts`, a join changes the table's shape
 * and so can't be expressed as cell patches; it returns a NEW table and never
 * mutates either input. Pure and deterministic.
 */

/** How unmatched rows are treated. */
export type JoinType = "inner" | "left" | "full";

/** One pair of columns to match on, by header name (so keys survive re-exports
 *  and reordered columns, like `Constraint.column` and `EngineOptions.dedupeKey`). */
export interface JoinKey {
  left: string;
  right: string;
}

export interface JoinOptions {
  /** Default "left" — keep every left row, whether or not it matched. */
  type?: JoinType;
  /** Columns to match on. Inferred from shared names + overlap when omitted. */
  keys?: JoinKey[];
  /** Disambiguates non-key columns whose names collide. Default [" (left)", " (right)"]. */
  suffixes?: [string, string];
}

/** Why a left row found no partner on the right. */
export type MissReason =
  | "zero-padding"
  | "punctuation"
  | "numeric-format"
  | "empty-key"
  | "absent";

export interface UnmatchedRow {
  /** 0-based row index in its source table. */
  row: number;
  /** The key value as written, for display. */
  key: string;
  reason: MissReason;
  /** The right-hand key this row would have matched under a repair, if any. */
  wouldMatch?: string;
}

export interface FanOutRow {
  /** 0-based left row index that expanded. */
  row: number;
  key: string;
  /** How many right rows it matched. */
  matches: number;
}

export interface JoinDiagnostics {
  keys: JoinKey[];
  type: JoinType;
  leftRows: number;
  rightRows: number;
  resultRows: number;
  /** Left rows that found at least one partner. */
  matched: number;
  /** How the matches were made — a key that only matches once you ignore case
   *  or collapse whitespace is a key with a consistency problem. */
  matchedVia: { exact: number; caseOnly: number; whitespaceOnly: number };
  unmatchedLeft: UnmatchedRow[];
  unmatchedRight: UnmatchedRow[];
  /** Left rows matching more than one right row, worst first. */
  fanOut: FanOutRow[];
  /** resultRows / leftRows — 1 means no expansion. */
  expansion: number;
}

export interface JoinResult {
  table: Table;
  diagnostics: JoinDiagnostics;
  /** Advisory findings (never auto-fixed) describing the join's quality. */
  findings: Finding[];
}

/** Column names that plausibly identify records — shared with diff.ts's intent. */
const ID_ISH_RE =
  /(^|[^a-z])(id|ids|uid|ref|reference|code|sku|key|account|acct|no|number|email)([^a-z]|$)/i;

/** Rows sampled per side when inferring which column to join on. */
const INFER_SAMPLE = 2000;

/** Separator for composite keys — a control char can't occur in cell text. */
const SEP = String.fromCharCode(0);

/** The value as written, trimmed. Two identical strings here matched exactly. */
function baseKey(v: CellValue): string {
  return cellText(v).trim();
}

/** Repeated whitespace squeezed to single spaces, case untouched. */
function collapseWs(s: string): string {
  return s.replace(/\s+/g, " ");
}

/** The form actually used for matching: case-folded, inner whitespace collapsed.
 *  Users overwhelmingly mean "ACME Ltd" and "acme  ltd" to be the same customer,
 *  so matching is forgiving by default — but `matchedVia` records when the
 *  forgiveness was needed, because it means the keys disagree. */
function matchKey(v: CellValue): string {
  return baseKey(v).replace(/\s+/g, " ").toLowerCase();
}

/** True when the cell can't act as a key at all (blank or a missing sentinel
 *  like NA/NULL/-). Such a row can never match, and saying so is more useful
 *  than reporting it as an absent record. */
function unusableKey(v: CellValue): boolean {
  return isEmptyCell(v) || isMissingSentinel(v);
}

/** Repairs tried, in order, against a miss — first hit wins. Each maps a match
 *  key to a laxer form; if both sides collapse to the same laxer form, the miss
 *  is a formatting difference rather than a missing record. */
const REPAIRS: { reason: MissReason; relax: (s: string) => string }[] = [
  // "00123" vs "123" — Excel and CSV round-trips strip leading zeros constantly.
  { reason: "zero-padding", relax: (s) => s.replace(/\b0+(?=\d)/g, "") },
  // "1.0" vs "1", "1,234" vs "1234" — numbers that took a trip through a string.
  // Ordered before the punctuation repair so a thousands separator is reported
  // as number formatting rather than as stray punctuation; non-numeric values
  // fall through here unchanged and reach the punctuation repair anyway.
  {
    reason: "numeric-format",
    relax: (s) => {
      const num = Number(s.replace(/,/g, ""));
      return Number.isFinite(num) && s.trim() !== "" ? String(num) : s;
    },
  },
  // "AB-12 3CD" vs "ab123cd" — dashes and spaces in codes, postcodes, SKUs.
  { reason: "punctuation", relax: (s) => s.replace(/[^a-z0-9]/gi, "") },
];

/** The laxest form of a key: punctuation gone, leading zeros gone, case folded.
 *  Used only to decide WHICH column to join on — a column that overlaps once
 *  formatting noise is ignored is still the right key, and picking it lets the
 *  join explain the mismatch instead of refusing to run. */
function looseKey(s: string): string {
  return s
    .replace(/[^a-z0-9]/gi, "")
    .replace(/^0+(?=\d)/, "")
    .toLowerCase();
}

function relaxComposite(key: string, relax: (s: string) => string): string {
  return key.split(SEP).map(relax).join(SEP);
}

/** Build the composite match key for a row, or null if any part is unusable —
 *  a partial key is not a key. */
function rowKey(
  row: CellValue[],
  cols: number[],
  fn: (v: CellValue) => string,
): string | null {
  const parts: string[] = [];
  for (const c of cols) {
    const v = row[c] ?? null;
    if (unusableKey(v)) return null;
    parts.push(fn(v));
  }
  return parts.join(SEP);
}

/** Display form of a row's key, for findings and the unmatched list. */
function rowKeyLabel(row: CellValue[], cols: number[]): string {
  const parts = cols.map((c) => cellText(row[c] ?? null).trim());
  const shown = parts.filter((p) => p !== "");
  return shown.length === 0 ? "(blank)" : shown.join(" · ");
}

/**
 * Pick join columns when the caller didn't. Shared header names are ranked by
 * how well their values actually overlap (sampled), not just by looking like an
 * id — a column named `id` that shares nothing with the other table is a worse
 * key than an unglamorous `email` that matches 98% of rows. Ties break toward
 * identifier-ish names. Returns [] when nothing overlaps meaningfully, which
 * the caller reports rather than joining on a guess.
 */
export function inferJoinKeys(left: Table, right: Table): JoinKey[] {
  const rightNames = new Set(right.headers);
  const shared = left.headers.filter((h) => rightNames.has(h));
  if (shared.length === 0) return [];

  let best: { name: string; rate: number } | null = null;
  for (const name of shared) {
    const li = left.headers.indexOf(name);
    const ri = right.headers.indexOf(name);

    // Overlap is measured on the LOOSE form. A pair of columns that only lines
    // up once zero-padding or punctuation is ignored is still the intended key;
    // choosing it lets `joinTables` report "these misses are a formatting
    // difference" rather than the useless "no column to join on".
    const rightKeys = new Set<string>();
    const rLimit = Math.min(right.rows.length, INFER_SAMPLE);
    for (let i = 0; i < rLimit; i++) {
      const v = right.rows[i]![ri] ?? null;
      if (!unusableKey(v)) rightKeys.add(looseKey(matchKey(v)));
    }
    if (rightKeys.size === 0) continue;

    let hits = 0;
    let considered = 0;
    const lLimit = Math.min(left.rows.length, INFER_SAMPLE);
    for (let i = 0; i < lLimit; i++) {
      const v = left.rows[i]![li] ?? null;
      if (unusableKey(v)) continue;
      considered++;
      if (rightKeys.has(looseKey(matchKey(v)))) hits++;
    }
    if (considered === 0) continue;

    const rate = hits / considered;
    const better =
      !best ||
      rate > best.rate + 0.01 ||
      (Math.abs(rate - best.rate) <= 0.01 &&
        ID_ISH_RE.test(name) &&
        !ID_ISH_RE.test(best.name));
    if (better) best = { name, rate };
  }

  // Below a fifth of rows matching, "shared column name" is a coincidence.
  if (!best || best.rate < 0.2) return [];
  return [{ left: best.name, right: best.name }];
}

/**
 * Join `right` onto `left` and report honestly on the result.
 *
 * Key columns are matched case-insensitively with whitespace collapsed; the
 * right-hand key columns are dropped from the output (they duplicate the left's)
 * and any other colliding column names take the configured suffixes.
 *
 * Unmatched left rows are diagnosed rather than merely counted: each one is
 * tested against progressively laxer forms of the right-hand keys, so a miss
 * caused by zero-padding, punctuation or number formatting is reported as such.
 */
export function joinTables(
  left: Table,
  right: Table,
  options: JoinOptions = {},
): JoinResult {
  const type = options.type ?? "left";
  const suffixes = options.suffixes ?? [" (left)", " (right)"];

  const requested = options.keys?.length ? options.keys : inferJoinKeys(left, right);
  // Drop key pairs naming columns that don't exist, like dedupeKey does.
  const keys = requested.filter(
    (k) => left.headers.includes(k.left) && right.headers.includes(k.right),
  );

  if (keys.length === 0) {
    const diagnostics: JoinDiagnostics = {
      keys: [],
      type,
      leftRows: left.rows.length,
      rightRows: right.rows.length,
      resultRows: left.rows.length,
      matched: 0,
      matchedVia: { exact: 0, caseOnly: 0, whitespaceOnly: 0 },
      unmatchedLeft: [],
      unmatchedRight: [],
      fanOut: [],
      expansion: 1,
    };
    return {
      table: left,
      diagnostics,
      findings: [
        {
          rule: "join-no-key",
          severity: "error",
          title: "No column to join on",
          detail:
            "These two datasets share no column whose values meaningfully " +
            "overlap, so there is nothing to match rows on. Pick the key " +
            "columns yourself, or check you loaded the files you meant to.",
          count: 1,
          patchIds: [],
        },
      ],
    };
  }

  const leftCols = keys.map((k) => left.headers.indexOf(k.left));
  const rightCols = keys.map((k) => right.headers.indexOf(k.right));

  // --- Output shape: left columns, then right's non-key columns. ------------
  const rightKeep: number[] = [];
  const rightKeySet = new Set(rightCols);
  for (let i = 0; i < right.headers.length; i++) {
    if (!rightKeySet.has(i)) rightKeep.push(i);
  }

  const leftNameCount = new Map<string, number>();
  for (const h of left.headers) leftNameCount.set(h, (leftNameCount.get(h) ?? 0) + 1);

  const headers: string[] = [];
  for (const h of left.headers) {
    headers.push(rightKeep.some((i) => right.headers[i] === h) ? `${h}${suffixes[0]}` : h);
  }
  for (const i of rightKeep) {
    const h = right.headers[i]!;
    headers.push(leftNameCount.has(h) ? `${h}${suffixes[1]}` : h);
  }

  // --- Index the right side. -----------------------------------------------
  const rightIndex = new Map<string, number[]>();
  for (let r = 0; r < right.rows.length; r++) {
    const k = rowKey(right.rows[r]!, rightCols, matchKey);
    // Unusable right keys simply never match; they surface via unmatchedRight.
    if (k === null) continue;
    const bucket = rightIndex.get(k);
    if (bucket) bucket.push(r);
    else rightIndex.set(k, [r]);
  }

  // Base-form indexes, to tell an exact match from a case/whitespace rescue:
  // `rightBase` is the key exactly as written, `rightBaseWs` the same with
  // repeated spaces collapsed but case intact. A left key that misses the first
  // but hits the second differed only by spacing; missing both means case.
  const rightBase = new Set<string>();
  const rightBaseWs = new Set<string>();
  for (let r = 0; r < right.rows.length; r++) {
    const k = rowKey(right.rows[r]!, rightCols, baseKey);
    if (k === null) continue;
    rightBase.add(k);
    rightBaseWs.add(collapseWs(k));
  }

  const relaxedCache: RelaxedCache = new Map();

  // --- Walk the left side. -------------------------------------------------
  const rows: CellValue[][] = [];
  const unmatchedLeft: UnmatchedRow[] = [];
  const fanOut: FanOutRow[] = [];
  const matchedRight = new Set<number>();
  const matchedVia = { exact: 0, caseOnly: 0, whitespaceOnly: 0 };
  let matched = 0;

  const emit = (lRow: CellValue[] | null, rRow: CellValue[] | null) => {
    const out: CellValue[] = [];
    for (let i = 0; i < left.headers.length; i++) {
      out.push(lRow ? (lRow[i] ?? null) : null);
    }
    for (const i of rightKeep) {
      out.push(rRow ? (rRow[i] ?? null) : null);
    }
    // A right-only row still needs its key values, which live in left's slots.
    if (!lRow && rRow) {
      for (let k = 0; k < leftCols.length; k++) {
        out[leftCols[k]!] = rRow[rightCols[k]!] ?? null;
      }
    }
    rows.push(out);
  };

  for (let r = 0; r < left.rows.length; r++) {
    const lRow = left.rows[r]!;
    const mk = rowKey(lRow, leftCols, matchKey);

    if (mk === null) {
      unmatchedLeft.push({ row: r, key: rowKeyLabel(lRow, leftCols), reason: "empty-key" });
      if (type !== "inner") emit(lRow, null);
      continue;
    }

    const hits = rightIndex.get(mk);
    if (!hits || hits.length === 0) {
      unmatchedLeft.push(diagnoseMiss(r, lRow, leftCols, mk, rightIndex, relaxedCache));
      if (type !== "inner") emit(lRow, null);
      continue;
    }

    matched++;
    const bk = rowKey(lRow, leftCols, baseKey)!;
    if (rightBase.has(bk)) matchedVia.exact++;
    else if (rightBaseWs.has(collapseWs(bk))) matchedVia.whitespaceOnly++;
    else matchedVia.caseOnly++;

    if (hits.length > 1) {
      fanOut.push({ row: r, key: rowKeyLabel(lRow, leftCols), matches: hits.length });
    }
    for (const rr of hits) {
      matchedRight.add(rr);
      emit(lRow, right.rows[rr]!);
    }
  }

  // --- Right rows nobody claimed. ------------------------------------------
  const unmatchedRight: UnmatchedRow[] = [];
  for (let r = 0; r < right.rows.length; r++) {
    if (matchedRight.has(r)) continue;
    const rRow = right.rows[r]!;
    const isUnusable = rowKey(rRow, rightCols, matchKey) === null;
    unmatchedRight.push({
      row: r,
      key: rowKeyLabel(rRow, rightCols),
      reason: isUnusable ? "empty-key" : "absent",
    });
    if (type === "full") emit(null, rRow);
  }

  fanOut.sort((a, b) => b.matches - a.matches || a.row - b.row);

  const diagnostics: JoinDiagnostics = {
    keys,
    type,
    leftRows: left.rows.length,
    rightRows: right.rows.length,
    resultRows: rows.length,
    matched,
    matchedVia,
    unmatchedLeft,
    unmatchedRight,
    fanOut,
    expansion: left.rows.length === 0 ? 1 : rows.length / left.rows.length,
  };

  return {
    table: { headers, rows },
    diagnostics,
    findings: buildJoinFindings(diagnostics, keys),
  };
}

/**
 * Work out why a left key found nothing. Tries each repair in turn against a
 * lazily-built index of equally-relaxed right keys; the first that lands names
 * the reason and the key it would have matched. Nothing landing means the
 * record genuinely isn't there — which is a real answer, not a failure.
 */
function diagnoseMiss(
  row: number,
  lRow: CellValue[],
  leftCols: number[],
  mk: string,
  rightIndex: Map<string, number[]>,
  cache: RelaxedCache,
): UnmatchedRow {
  const key = rowKeyLabel(lRow, leftCols);
  for (const repair of REPAIRS) {
    const relaxed = relaxComposite(mk, repair.relax);
    if (relaxed === mk) continue; // this repair changes nothing for this key
    const hit = relaxedIndex(rightIndex, repair, cache).get(relaxed);
    if (hit !== undefined) {
      return { row, key, reason: repair.reason, wouldMatch: hit };
    }
  }
  return { row, key, reason: "absent" };
}

/** Relaxed right-key indexes, built lazily on first miss of each kind and
 *  reused across the remaining misses. Created per `joinTables` call and passed
 *  down, never module-level: a cache outliving the call would serve one join's
 *  right-hand keys to the next. Keyed by reason, which identifies the repair. */
type RelaxedCache = Map<MissReason, Map<string, string>>;

function relaxedIndex(
  rightIndex: Map<string, number[]>,
  repair: { reason: MissReason; relax: (s: string) => string },
  cache: RelaxedCache,
): Map<string, string> {
  const cached = cache.get(repair.reason);
  if (cached) return cached;
  const built = new Map<string, string>();
  for (const k of rightIndex.keys()) {
    const r = relaxComposite(k, repair.relax);
    // First key wins, so the reported `wouldMatch` is deterministic.
    if (!built.has(r)) built.set(r, k);
  }
  cache.set(repair.reason, built);
  return built;
}

/** Turn the diagnosis into the advisory findings the review UI already renders.
 *  Every one is `patchIds: []` — a join problem is fixed by choosing different
 *  keys or cleaning the key column, never by refynr inventing a match. */
function buildJoinFindings(d: JoinDiagnostics, keys: JoinKey[]): Finding[] {
  const findings: Finding[] = [];
  const keyLabel = keys
    .map((k) => (k.left === k.right ? k.left : `${k.left} → ${k.right}`))
    .join(" + ");

  const emptyKey = d.unmatchedLeft.filter((u) => u.reason === "empty-key");
  const repairable = d.unmatchedLeft.filter(
    (u) => u.reason !== "empty-key" && u.reason !== "absent",
  );
  const absent = d.unmatchedLeft.filter((u) => u.reason === "absent");

  if (d.unmatchedLeft.length > 0) {
    findings.push({
      rule: "join-unmatched",
      severity: "warning",
      title: `${n(d.unmatchedLeft.length, "row")} matched nothing`,
      detail:
        `${verb(d.unmatchedLeft.length, "This row", "These rows")} came through the join with ` +
        `empty columns from the second dataset. That is the join's most common silent failure: ` +
        `the output still looks complete, and the gap only shows up later as a total that is too low.` +
        (repairable.length > 0
          ? ` ${n(repairable.length, "of them is", "of them are")} a formatting difference rather than a missing record — see below.`
          : ""),
      count: d.unmatchedLeft.length,
      patchIds: [],
    });
  }

  // The actionable one: misses that are really key-format disagreements.
  for (const reason of ["zero-padding", "punctuation", "numeric-format"] as const) {
    const group = repairable.filter((u) => u.reason === reason);
    if (group.length === 0) continue;
    const example = group[0]!;
    const label: Record<typeof reason, string> = {
      "zero-padding": "leading zeros",
      punctuation: "punctuation and spacing",
      "numeric-format": "number formatting",
    };
    findings.push({
      rule: "join-key-format",
      severity: "warning",
      title: `${n(group.length, "miss", "misses")} caused by ${label[reason]}`,
      detail:
        `${verb(group.length, "This row", "These rows")} would have matched if the two datasets ` +
        `agreed on ${label[reason]} in the ${keyLabel} column — for example "${example.key}" ` +
        `here against "${example.wouldMatch ?? ""}" there. The records exist on both sides; ` +
        `only the way the key is written differs. Clean that column and re-run the join.`,
      count: group.length,
      patchIds: [],
    });
  }

  if (emptyKey.length > 0) {
    findings.push({
      rule: "join-empty-key",
      severity: "warning",
      title: `${n(emptyKey.length, "row has", "rows have")} no join key`,
      detail:
        `The ${keyLabel} column is blank or holds a placeholder (NA, NULL, -) in ` +
        `${verb(emptyKey.length, "this row", "these rows")}, so ${verb(emptyKey.length, "it", "they")} ` +
        `cannot be matched to anything. This is a gap in the source data, not a join failure.`,
      count: emptyKey.length,
      patchIds: [],
    });
  }

  if (d.fanOut.length > 0) {
    const worst = d.fanOut[0]!;
    findings.push({
      rule: "join-fan-out",
      severity: "warning",
      title: `${n(d.fanOut.length, "row")} multiplied into more rows`,
      detail:
        `The second dataset holds several rows per key, so the join expanded ` +
        `${n(d.fanOut.length, "left row")} into more — "${worst.key}" alone matched ` +
        `${n(worst.matches, "row")}. Your table went from ${d.leftRows} rows to ${d.resultRows}. ` +
        `This is the merge bug that quietly inflates every total downstream: check whether ` +
        `the second dataset should have been de-duplicated first, or whether you meant to ` +
        `summarise it before joining.`,
      count: d.fanOut.length,
      patchIds: [],
    });
  }

  if (d.matchedVia.caseOnly + d.matchedVia.whitespaceOnly > 0) {
    const soft = d.matchedVia.caseOnly + d.matchedVia.whitespaceOnly;
    findings.push({
      rule: "join-key-inconsistent",
      severity: "info",
      title: `${n(soft, "row")} matched only after ignoring case or spacing`,
      detail:
        `${verb(soft, "This row", "These rows")} matched because refynr compares keys ` +
        `case-insensitively and collapses repeated spaces. The match is almost certainly ` +
        `right, but the two datasets do disagree on how the ${keyLabel} value is written — ` +
        `worth tidying if this key is used elsewhere.`,
      count: soft,
      patchIds: [],
    });
  }

  if (d.unmatchedRight.length > 0 && d.type !== "full") {
    findings.push({
      rule: "join-dropped-right",
      severity: "info",
      title: `${n(d.unmatchedRight.length, "row")} from the second dataset ${verb(d.unmatchedRight.length, "was", "were")} not used`,
      detail:
        `${verb(d.unmatchedRight.length, "This row", "These rows")} had no partner on the left ` +
        `and ${verb(d.unmatchedRight.length, "is", "are")} absent from the result. Switch the join ` +
        `to "keep everything" if ${verb(d.unmatchedRight.length, "it", "they")} should appear.`,
      count: d.unmatchedRight.length,
      patchIds: [],
    });
  }

  if (absent.length > 0 && repairable.length > 0) {
    findings.push({
      rule: "join-absent",
      severity: "info",
      title: `${n(absent.length, "row")} genuinely ${verb(absent.length, "has", "have")} no match`,
      detail:
        `Unlike the formatting misses above, ${verb(absent.length, "this key", "these keys")} ` +
        `${verb(absent.length, "does", "do")} not appear in the second dataset in any form. ` +
        `${verb(absent.length, "It is", "They are")} missing records, not a key problem.`,
      count: absent.length,
      patchIds: [],
    });
  }

  return findings;
}
