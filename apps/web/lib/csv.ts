import { cellText, type Table } from "@refynr/engine";

function csvField(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function toCsv(table: Table): string {
  const lines = [table.headers.map(csvField).join(",")];
  for (const row of table.rows) {
    lines.push(row.map((v) => csvField(cellText(v))).join(","));
  }
  return lines.join("\r\n");
}

/**
 * Tab-separated text for the clipboard — pasting this straight into Excel or
 * Google Sheets drops it into cells, closing the export→clean→re-import loop
 * without a file download. Tabs/newlines in a value are stripped to spaces so
 * the grid stays intact.
 */
export function toTsv(table: Table): string {
  const cell = (v: string) => v.replace(/[\t\r\n]+/g, " ");
  const lines = [table.headers.map(cell).join("\t")];
  for (const row of table.rows) {
    lines.push(row.map((v) => cell(cellText(v))).join("\t"));
  }
  return lines.join("\n");
}

/** Trigger a browser download of `content` as `filename`. */
export function downloadBlob(content: string, mime: string, filename: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadCsv(table: Table, filename: string): void {
  // BOM so Excel opens the file as UTF-8 instead of mangling accents.
  const BOM = String.fromCharCode(0xfeff);
  downloadBlob(BOM + toCsv(table), "text/csv;charset=utf-8", filename);
}

export function downloadTsv(table: Table, filename: string): void {
  const BOM = String.fromCharCode(0xfeff);
  downloadBlob(BOM + toTsv(table), "text/tab-separated-values;charset=utf-8", filename);
}

/** Rows as an array of objects keyed by header — numbers and nulls preserved. */
export function downloadJson(table: Table, filename: string): void {
  const rows = table.rows.map((row) =>
    Object.fromEntries(table.headers.map((h, i) => [h, row[i] ?? null])),
  );
  downloadBlob(JSON.stringify(rows, null, 2), "application/json;charset=utf-8", filename);
}
