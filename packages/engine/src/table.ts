import type { CellRef, CellValue, Patch, Table } from "./types.js";

/** Cell value as a trimmed-of-nothing display string ("" for null). */
export function cellText(v: CellValue): string {
  if (v === null || v === undefined) return "";
  return String(v);
}

export function isEmptyCell(v: CellValue): boolean {
  return v === null || v === undefined || String(v).trim() === "";
}

/**
 * Missing-value sentinels: placeholder text that means "no value" but reads
 * as a real value to spreadsheets, imports, and naive counts (pandas
 * recognises the same family by default). Deliberately conservative — only
 * tokens that are near-universally placeholders, compared as the whole
 * trimmed cell, case-insensitively.
 */
const MISSING_SENTINELS = new Set([
  "na", "n/a", "n.a.", "#n/a", "#na", "null", "none", "nan", "nil", "-", "--",
]);

/** True when the whole cell is a missing-value placeholder like "N/A". */
export function isMissingSentinel(v: CellValue): boolean {
  if (typeof v !== "string") return false;
  return MISSING_SENTINELS.has(v.trim().toLowerCase());
}

/**
 * Apply accepted patches to a table, returning a NEW table.
 * The original is never mutated — this is the only way "cleaned" data exists.
 * Cell patches apply first; row removals apply last so indices stay valid.
 */
export function applyPatches(
  table: Table,
  patches: Patch[],
  acceptedIds?: Set<string>,
): Table {
  const accepted = acceptedIds
    ? patches.filter((p) => acceptedIds.has(p.id))
    : patches;

  const rows = table.rows.map((r) => [...r]);
  const headers = [...table.headers];

  for (const p of accepted) {
    if (p.kind === "cell") {
      const row = rows[p.cell.row];
      if (row !== undefined) row[p.cell.col] = p.after;
    } else if (p.kind === "header") {
      if (p.col >= 0 && p.col < headers.length) headers[p.col] = p.after;
    }
  }

  const removals = new Set(
    accepted.filter((p) => p.kind === "remove-row").map((p) => p.row),
  );

  return {
    headers,
    rows: removals.size ? rows.filter((_, i) => !removals.has(i)) : rows,
  };
}

/**
 * Sniff the delimiter from a sample of the text: try each candidate and pick
 * the one that yields the most consistent multi-column grid. Tab is tried
 * first so a spreadsheet paste (tabs, but data containing commas) keeps
 * winning ties; semicolon and pipe cover EU-locale and finance-tool exports
 * that would otherwise parse as one silent column.
 */
function sniffDelimiter(text: string): string {
  const sample = text.split("\n", 21).join("\n");
  let best = ",";
  let bestScore = 0;
  for (const d of ["\t", ",", ";", "|"]) {
    const grid = parseDelimited(sample, d);
    const widths = grid.map((r) => r.length);
    if (widths.length === 0) continue;
    const counts = new Map<number, number>();
    for (const w of widths) counts.set(w, (counts.get(w) ?? 0) + 1);
    let modalWidth = 1;
    let modalCount = 0;
    for (const [w, c] of counts) {
      if (c > modalCount || (c === modalCount && w > modalWidth)) {
        modalWidth = w;
        modalCount = c;
      }
    }
    if (modalWidth < 2) continue; // this delimiter never splits anything
    const score = (modalCount / widths.length) * 100 + modalWidth;
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

/**
 * Parse pasted text (from Excel/Sheets clipboard or a raw CSV snippet)
 * into a Table. The delimiter is sniffed (tab, comma, semicolon, pipe) from
 * a sample, honouring quoted fields. First row is treated as headers.
 * Non-empty rows whose field count differs from the header's are counted in
 * `parseIssues.raggedRows` — the classic symptom of unquoted delimiters —
 * so the analysis can flag a malformed export instead of silently padding.
 */
export function fromDelimitedText(text: string): Table {
  const normalized = text.replace(/\r\n?/g, "\n").replace(/\n+$/, "");
  if (!normalized.trim()) return { headers: [], rows: [] };

  const delimiter = sniffDelimiter(normalized);
  const grid = parseDelimited(normalized, delimiter);

  const width = grid.reduce((w, r) => Math.max(w, r.length), 0);
  const pad = (r: string[]): CellValue[] => {
    const out: CellValue[] = [...r];
    while (out.length < width) out.push(null);
    return out.map((v) => (v === "" ? null : v));
  };

  const headerRow = grid[0] ?? [];
  const headers = Array.from(
    { length: width },
    (_, i) => headerRow[i]?.trim() || `Column ${i + 1}`,
  );

  let raggedRows = 0;
  for (let i = 1; i < grid.length; i++) {
    const r = grid[i]!;
    if (r.length !== headerRow.length && r.some((f) => f.trim() !== "")) {
      raggedRows++;
    }
  }

  return {
    headers,
    rows: grid.slice(1).map(pad),
    ...(raggedRows > 0 ? { parseIssues: { raggedRows } } : {}),
  };
}

export interface FindReplaceOptions {
  /** Case-sensitive matching (default false). */
  matchCase?: boolean;
  /** Only match when the whole cell equals the query (default false: substring). */
  wholeCell?: boolean;
  /** Restrict to one column index. */
  column?: number;
}

export interface Replacement {
  cell: CellRef;
  before: CellValue;
  after: string;
}

/**
 * Find-and-replace as data, not mutation: returns the list of cell
 * replacements a query would make, leaving the table untouched. The shell
 * applies them through its existing edit pipeline so every replacement is
 * previewable, revertible, and re-scored — never a blind global mutate.
 * Plain-text matching only (no regex): predictable for non-technical users.
 */
export function findReplace(
  table: Table,
  find: string,
  replace: string,
  options: FindReplaceOptions = {},
): Replacement[] {
  if (find === "") return [];
  const { matchCase = false, wholeCell = false, column } = options;
  const needle = matchCase ? find : find.toLowerCase();
  const out: Replacement[] = [];

  table.rows.forEach((row, r) => {
    row.forEach((v, c) => {
      if (column !== undefined && c !== column) return;
      const text = cellText(v);
      if (text === "") return;
      const hay = matchCase ? text : text.toLowerCase();

      let after: string | null = null;
      if (wholeCell) {
        if (hay === needle) after = replace;
      } else if (hay.includes(needle)) {
        if (matchCase) {
          after = text.split(find).join(replace);
        } else {
          // Case-insensitive substring replace that preserves surrounding text.
          let result = "";
          let i = 0;
          while (i < text.length) {
            const at = hay.indexOf(needle, i);
            if (at === -1) {
              result += text.slice(i);
              break;
            }
            result += text.slice(i, at) + replace;
            i = at + find.length;
          }
          after = result;
        }
      }

      if (after !== null && after !== text) {
        out.push({ cell: { row: r, col: c }, before: v, after });
      }
    });
  });

  return out;
}

/**
 * Parse JSON into a Table. Accepts an array of row objects, or an object with
 * a `data`/`rows`/`records` array. Headers are the union of keys in first-seen
 * order; nested objects/arrays are stringified so the grid stays flat. This is
 * the JSON half of "technical inputs" — the shape APIs and NoSQL exports arrive
 * in — handled with zero dependencies.
 */
export function fromJson(text: string): Table {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("That isn't valid JSON.");
  }
  const arr = Array.isArray(parsed)
    ? parsed
    : (parsed as Record<string, unknown>)?.data ??
      (parsed as Record<string, unknown>)?.rows ??
      (parsed as Record<string, unknown>)?.records;
  if (!Array.isArray(arr)) {
    throw new Error("Expected a JSON array of records, or an object with a data/rows/records array.");
  }

  const headers: string[] = [];
  const seen = new Set<string>();
  for (const item of arr) {
    if (item && typeof item === "object" && !Array.isArray(item)) {
      for (const k of Object.keys(item as object)) {
        if (!seen.has(k)) { seen.add(k); headers.push(k); }
      }
    }
  }
  if (headers.length === 0) throw new Error("No object records found in the JSON.");

  const toCell = (v: unknown): CellValue => {
    if (v === null || v === undefined) return null;
    if (typeof v === "object") return JSON.stringify(v);
    if (typeof v === "boolean" || typeof v === "number" || typeof v === "string") return v;
    return String(v);
  };

  const rows: CellValue[][] = arr.map((item) => {
    const obj = (item && typeof item === "object" && !Array.isArray(item) ? item : {}) as Record<string, unknown>;
    return headers.map((h) => toCell(obj[h]));
  });

  return { headers, rows };
}

function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"' && field === "") {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  row.push(field);
  rows.push(row);
  return rows;
}
