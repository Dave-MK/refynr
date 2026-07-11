import {
  cleanse,
  fromDelimitedText,
  fromJson,
  type CellValue,
  type CleanseResult,
  type Table,
} from "@refynr/engine";
import * as XLSX from "xlsx";

export type CleanseRequest =
  | { kind: "text"; text: string }
  | { kind: "json"; text: string }
  | { kind: "xlsx"; buffer: ArrayBuffer; name: string };

export type CleanseResponse =
  | { ok: true; table: Table; result: CleanseResult; sheetName?: string }
  | { ok: false; error: string };

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

  const width = Math.max(...grid.map((r) => r.length));
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

self.onmessage = (e: MessageEvent<CleanseRequest>) => {
  try {
    let table: Table;
    let sheetName: string | undefined;

    if (e.data.kind === "text") {
      table = fromDelimitedText(e.data.text);
    } else if (e.data.kind === "json") {
      table = fromJson(e.data.text);
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

    const result = cleanse(table);
    const response: CleanseResponse = { ok: true, table, result, sheetName };
    postMessage(response);
  } catch (err) {
    const response: CleanseResponse = {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
    postMessage(response);
  }
};
