import type { RunReport } from "@refynr/engine";

/**
 * Render a run report as a downloadable PDF. jsPDF (+ the autotable plugin)
 * is dynamically imported so it stays out of the initial page bundle, same as
 * SheetJS. Everything happens in the browser — the report never leaves the
 * device.
 */
export async function downloadReportPdf(
  report: RunReport,
  opts: { title: string; timestamp: string },
  filename: string,
): Promise<void> {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);

  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const margin = 48;
  let y = margin;

  doc.setFontSize(18);
  doc.setFont("helvetica", "bold");
  doc.text(opts.title, margin, y);
  y += 18;

  doc.setFontSize(10);
  doc.setFont("helvetica", "italic");
  doc.setTextColor(110);
  doc.text(`Generated ${opts.timestamp}`, margin, y);
  y += 24;

  doc.setFont("helvetica", "normal");
  doc.setTextColor(30);
  doc.setFontSize(11);
  const summary = [
    `Health score: ${report.scoreBefore} → ${report.scoreProjected} (if all fixes accepted)`,
    `Rows: ${report.rowsBefore} → ${report.rowsAfter} (${report.rowsRemoved} removed)`,
    `Cells changed: ${report.cellsChanged}`,
    `Headers changed: ${report.headersChanged}`,
    `Fixes applied: ${report.patchesApplied} of ${report.patchesProposed} proposed`,
  ];
  for (const line of summary) {
    doc.text(`•  ${line}`, margin, y);
    y += 16;
  }
  y += 8;

  const heading = (text: string) => {
    doc.setFontSize(13);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(30);
    doc.text(text, margin, y);
    y += 10;
  };

  if (report.applied.length > 0) {
    heading("Changes applied");
    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin },
      head: [["Rule", "Count", "Example reason"]],
      body: report.applied.map((a) => [a.rule, String(a.count), a.sample]),
      styles: { fontSize: 9, cellPadding: 5 },
      headStyles: { fillColor: [20, 130, 120] },
      columnStyles: { 1: { halign: "right", cellWidth: 44 } },
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 24;
  }

  if (report.advisories.length > 0) {
    heading("Flagged for review (not auto-fixed)");
    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin },
      head: [["Finding", "Count"]],
      body: report.advisories.map((a) => [a.title, String(a.count)]),
      styles: { fontSize: 9, cellPadding: 5 },
      headStyles: { fillColor: [180, 120, 30] },
      columnStyles: { 1: { halign: "right", cellWidth: 44 } },
    });
  }

  doc.save(filename);
}
