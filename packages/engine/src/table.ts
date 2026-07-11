import type { CellValue, Patch, Table } from "./types.js";

/** Cell value as a trimmed-of-nothing display string ("" for null). */
export function cellText(v: CellValue): string {
  if (v === null || v === undefined) return "";
  return String(v);
}

export function isEmptyCell(v: CellValue): boolean {
  return v === null || v === undefined || String(v).trim() === "";
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
 * Parse pasted text (from Excel/Sheets clipboard or a raw CSV snippet)
 * into a Table. Tab-delimited wins if tabs are present (spreadsheet paste),
 * otherwise falls back to a small CSV parser that honours quoted fields.
 * First row is treated as headers.
 */
export function fromDelimitedText(text: string): Table {
  const normalized = text.replace(/\r\n?/g, "\n").replace(/\n+$/, "");
  if (!normalized.trim()) return { headers: [], rows: [] };

  const delimiter = normalized.includes("\t") ? "\t" : ",";
  const grid = parseDelimited(normalized, delimiter);

  const width = Math.max(...grid.map((r) => r.length));
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

  return { headers, rows: grid.slice(1).map(pad) };
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
