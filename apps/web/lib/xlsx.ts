import type { Table } from "@refynr/engine";

/** Dynamically imported so SheetJS stays out of the initial page bundle. */
export async function downloadXlsx(table: Table, filename: string): Promise<void> {
  const XLSX = await import("xlsx");
  const ws = XLSX.utils.aoa_to_sheet([table.headers, ...table.rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "refynr");
  XLSX.writeFile(wb, filename);
}
