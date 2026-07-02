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

export function downloadCsv(table: Table, filename: string): void {
  // BOM so Excel opens the file as UTF-8 instead of mangling accents.
  const BOM = String.fromCharCode(0xfeff);
  const blob = new Blob([BOM + toCsv(table)], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
