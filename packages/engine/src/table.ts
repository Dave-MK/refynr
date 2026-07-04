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
