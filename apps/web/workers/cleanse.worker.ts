import {
  cleanse,
  fromDelimitedText,
  fromJson,
  type CellValue,
  type CleanseResult,
  type Table,
} from "@refynr/engine";
import * as XLSX from "xlsx";
import { parquetMetadataAsync, parquetReadObjects } from "hyparquet";

/** "main" runs the full cleanse; "compare" only parses the file to a Table
 *  (for the version-diff view) without re-running analysis. */
type Tag = "main" | "compare";

export type CleanseRequest =
  | { kind: "text"; text: string; tag?: Tag }
  | { kind: "json"; text: string; tag?: Tag }
  | { kind: "xlsx"; buffer: ArrayBuffer; name: string; tag?: Tag }
  | { kind: "parquet"; buffer: ArrayBuffer; name: string; tag?: Tag };

export type CleanseResponse =
  | {
      ok: true;
      tag: "main";
      table: Table;
      result: CleanseResult;
      sheetName?: string;
      /** Set when the source had more rows than we loaded this session. */
      truncated?: { shown: number; total: number };
    }
  | { ok: true; tag: "compare"; table: Table }
  | { ok: false; tag: Tag; error: string };

/** Interactive session cap. Everything up to this is cleaned and exported in
 *  full; beyond it the file is loaded as a (disclosed) preview so the browser
 *  stays responsive. Raising this is a memory/time trade-off, not a code one. */
const PARQUET_ROW_CAP = 100_000;

function tableFromWorkbook(buffer: ArrayBuffer): { table: Table; sheetName: string } {
  const wb = XLSX.read(buffer, { type: "array" });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error("The workbook has no sheets.");
  const ws = wb.Sheets[sheetName]!;

  // raw:false gives the *formatted* text — what the user sees in Excel —
  // which is exactly what a quality tool should be judging.
  const grid = XLSX.utils.sheet_to_json(ws, {
    header: 1,
    raw: false,
    defval: null,
    blankrows: true,
  }) as (string | null)[][];

  if (grid.length === 0) throw new Error(`Sheet "${sheetName}" is empty.`);

  const width = grid.reduce((w, r) => Math.max(w, r.length), 0);
  const headerRow = grid[0] ?? [];
  const headers = Array.from(
    { length: width },
    (_, i) => (headerRow[i] ? String(headerRow[i]).trim() : "") || `Column ${i + 1}`,
  );
  const rows: CellValue[][] = grid.slice(1).map((r) => {
    const row: CellValue[] = [...r];
    while (row.length < width) row.push(null);
    return row;
  });

  return { table: { headers, rows }, sheetName };
}

/** Coerce a Parquet value (which may be a BigInt, Date, or nested object) into
 *  a flat engine CellValue. */
function toCell(v: unknown): CellValue {
  if (v === null || v === undefined) return null;
  if (typeof v === "bigint") return Number.isSafeInteger(Number(v)) ? Number(v) : v.toString();
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") return JSON.stringify(v);
  if (typeof v === "number" || typeof v === "boolean" || typeof v === "string") return v;
  return String(v);
}

async function tableFromParquet(
  buffer: ArrayBuffer,
): Promise<{ table: Table; truncated?: { shown: number; total: number } }> {
  // ArrayBuffer satisfies hyparquet's AsyncBuffer (byteLength + slice).
  let total: number;
  try {
    const meta = await parquetMetadataAsync(buffer);
    total = Number(meta.num_rows);
  } catch {
    throw new Error("That doesn't look like a valid Parquet file.");
  }

  const rowEnd = Math.min(total, PARQUET_ROW_CAP);
  let records: Record<string, unknown>[];
  try {
    records = await parquetReadObjects({ file: buffer, rowEnd });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/compress|snappy|gzip|zstd|brotli|codec/i.test(msg)) {
      throw new Error(
        "This Parquet file uses a compression codec refynr can't read yet. Re-export it with Snappy (the default) or uncompressed.",
      );
    }
    throw new Error(`Couldn't read the Parquet data: ${msg}`);
  }

  // Parquet has a fixed schema, so the first record's keys are the full column
  // set; union across a few rows as a cheap safety net.
  const headerSet = new Set<string>();
  for (const rec of records.slice(0, 50)) for (const k of Object.keys(rec)) headerSet.add(k);
  const headers = [...headerSet];
  const rows: CellValue[][] = records.map((rec) => headers.map((h) => toCell(rec[h])));

  return {
    table: { headers, rows },
    truncated: total > rowEnd ? { shown: rowEnd, total } : undefined,
  };
}

self.onmessage = async (e: MessageEvent<CleanseRequest>) => {
  const tag: Tag = e.data.tag ?? "main";
  try {
    let table: Table;
    let sheetName: string | undefined;
    let truncated: { shown: number; total: number } | undefined;

    if (e.data.kind === "text") {
      table = fromDelimitedText(e.data.text);
    } else if (e.data.kind === "json") {
      table = fromJson(e.data.text);
    } else if (e.data.kind === "parquet") {
      const parsed = await tableFromParquet(e.data.buffer);
      table = parsed.table;
      truncated = parsed.truncated;
    } else {
      const parsed = tableFromWorkbook(e.data.buffer);
      table = parsed.table;
      sheetName = parsed.sheetName;
    }

    if (table.rows.length === 0) {
      throw new Error(
        "Couldn't find any data rows. The file needs a header row and at least one data row.",
      );
    }

    if (tag === "compare") {
      postMessage({ ok: true, tag: "compare", table } satisfies CleanseResponse);
      return;
    }

    const result = cleanse(table);
    postMessage({ ok: true, tag: "main", table, result, sheetName, truncated } satisfies CleanseResponse);
  } catch (err) {
    postMessage({
      ok: false,
      tag,
      error: err instanceof Error ? err.message : String(err),
    } satisfies CleanseResponse);
  }
};
