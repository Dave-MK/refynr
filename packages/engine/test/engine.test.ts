import { describe, expect, it } from "vitest";
import {
  applyPatches,
  cleanse,
  fromDelimitedText,
  profileTable,
  type CellPatch,
  type Table,
} from "../src/index.js";

/** A deliberately messy CRM export. Rows are 0-indexed in patches. */
const messy: Table = {
  headers: ["Name", "Email", "Phone", "Postcode", "Joined", "Company"],
  rows: [
    ["John Smith", "john@acme.com", "07700 900123", "SW1A 1AA", "2024-01-15", "Acme Ltd"],
    ["  jane doe ", "Jane.Doe@ACME.com", "+44 7700 900456", "sw1a2bb", "15/01/2024", "ACME LTD"],
    ["John Smith", "john@acme.com", "07700 900123", "SW1A 1AA", "2024-01-15", "Acme Ltd"], // exact dupe of row 0
    ["Bob Jones", "bob@@broken", "12345", "ZZ99 9ZZ", "31/02/2024", "acme ltd"],
    [null, null, null, null, null, null], // blank row
    ["Ann Lee", "ann@lee.co.uk", "020 7946 0999", "EC1A1BB", "Apr 3, 2024", "Lee & Co"],
  ],
};

describe("profileTable", () => {
  it("infers column types", () => {
    const p = profileTable(messy);
    const types = p.columns.map((c) => c.type);
    expect(types[1]).toBe("email");
    expect(types[3]).toBe("postcode");
    expect(p.rowCount).toBe(6);
  });
});

describe("cleanse", () => {
  const result = cleanse(messy);

  it("never mutates the input table", () => {
    expect(messy.rows[1]![0]).toBe("  jane doe ");
    expect(messy.rows.length).toBe(6);
  });

  it("trims whitespace including NBSP", () => {
    const patch = result.patches.find(
      (p) => p.kind === "cell" && p.cell.row === 3 && p.cell.col === 0,
    ) as CellPatch;
    expect(patch.after).toBe("Bob Jones");
  });

  it("removes exact duplicate rows, keeping the first", () => {
    const removal = result.patches.find((p) => p.kind === "remove-row" && p.row === 2);
    expect(removal).toBeDefined();
    expect(removal!.rule).toBe("remove-duplicate-rows");
  });

  it("removes blank rows", () => {
    const removal = result.patches.find((p) => p.kind === "remove-row" && p.row === 4);
    expect(removal).toBeDefined();
    expect(removal!.rule).toBe("remove-blank-rows");
  });

  it("normalizes casing to the most frequent variant", () => {
    const patch = result.patches.find(
      (p) => p.kind === "cell" && p.cell.col === 5 && p.rule === "consistent-casing" && p.cell.row === 1,
    ) as CellPatch;
    expect(patch).toBeDefined();
    expect(patch.after).toBe("Acme Ltd");
  });

  it("normalizes emails and flags invalid ones", () => {
    const fix = result.patches.find(
      (p) => p.kind === "cell" && p.cell.row === 1 && p.cell.col === 1,
    ) as CellPatch;
    expect(fix.after).toBe("jane.doe@acme.com");
    const flag = result.findings.find((f) => f.rule === "invalid-email");
    expect(flag?.count).toBe(1);
  });

  it("normalizes UK phone numbers to +44", () => {
    const fix = result.patches.find(
      (p) => p.kind === "cell" && p.cell.row === 0 && p.cell.col === 2,
    ) as CellPatch;
    expect(fix.after).toBe("+44 7700 900123");
  });

  it("fixes postcode spacing and case", () => {
    const fix = result.patches.find(
      (p) => p.kind === "cell" && p.cell.row === 1 && p.cell.col === 3,
    ) as CellPatch;
    expect(fix.after).toBe("SW1A 2BB");
  });

  it("normalizes dates to ISO and flags impossible ones", () => {
    const fix = result.patches.find(
      (p) => p.kind === "cell" && p.cell.row === 1 && p.cell.col === 4,
    ) as CellPatch;
    expect(fix.after).toBe("2024-01-15");
    const monthName = result.patches.find(
      (p) => p.kind === "cell" && p.cell.row === 5 && p.cell.col === 4,
    ) as CellPatch;
    expect(monthName.after).toBe("2024-04-03");
    const flag = result.findings.find((f) => f.rule === "impossible-date");
    expect(flag?.count).toBe(1); // 31/02/2024
  });

  it("scores the dirty table below the projected clean score", () => {
    expect(result.score.overall).toBeLessThan(result.projectedScore.overall);
    expect(result.score.overall).toBeGreaterThanOrEqual(0);
    expect(result.projectedScore.overall).toBeLessThanOrEqual(100);
  });

  it("every patch has a human-readable reason", () => {
    for (const p of result.patches) {
      expect(p.reason.length).toBeGreaterThan(10);
      expect(p.confidence).toBeGreaterThan(0);
      expect(p.confidence).toBeLessThanOrEqual(1);
    }
  });
});

describe("applyPatches", () => {
  it("applies cell patches and row removals into a new table", () => {
    const result = cleanse(messy);
    const cleaned = applyPatches(messy, result.patches);
    expect(cleaned.rows.length).toBe(4); // 6 - 1 dupe - 1 blank
    expect(cleaned.rows[1]![0]).toBe("jane doe");
    expect(messy.rows.length).toBe(6); // original untouched
  });

  it("honours a subset of accepted patch ids", () => {
    const result = cleanse(messy);
    const onlyDupes = new Set(
      result.patches.filter((p) => p.rule === "remove-duplicate-rows").map((p) => p.id),
    );
    const cleaned = applyPatches(messy, result.patches, onlyDupes);
    expect(cleaned.rows.length).toBe(5);
    expect(cleaned.rows[1]![0]).toBe("  jane doe "); // cell patches not applied
  });
});

describe("fromDelimitedText", () => {
  it("parses tab-delimited spreadsheet paste", () => {
    const t = fromDelimitedText("Name\tAge\nJohn\t42\nJane\t39");
    expect(t.headers).toEqual(["Name", "Age"]);
    expect(t.rows.length).toBe(2);
    expect(t.rows[1]).toEqual(["Jane", "39"]);
  });

  it("parses quoted CSV with embedded commas", () => {
    const t = fromDelimitedText('Name,Company\n"Smith, John","Acme, Ltd"');
    expect(t.rows[0]).toEqual(["Smith, John", "Acme, Ltd"]);
  });

  it("handles ragged rows and blank headers", () => {
    const t = fromDelimitedText("A,,C\n1,2\n");
    expect(t.headers).toEqual(["A", "Column 2", "C"]);
    expect(t.rows[0]).toEqual(["1", "2", null]);
  });
});

describe("phone grouping", () => {
  const table: Table = {
    headers: ["Phone"],
    rows: [["020 7946 0999"], ["0161 496 0100"], ["07700900123"]],
  };
  const patches = cleanse(table).patches as CellPatch[];

  it("groups London numbers as +44 20 xxxx xxxx", () => {
    expect(patches.find((p) => p.cell.row === 0)!.after).toBe("+44 20 7946 0999");
  });
  it("groups geographic numbers as +44 1xx xxx xxxx", () => {
    expect(patches.find((p) => p.cell.row === 1)!.after).toBe("+44 161 496 0100");
  });
  it("groups mobiles as +44 7xxx xxxxxx", () => {
    expect(patches.find((p) => p.cell.row === 2)!.after).toBe("+44 7700 900123");
  });
});

describe("casing tie-break", () => {
  it("prefers mixed case over ALL CAPS on a tie", () => {
    const table: Table = {
      headers: ["Name", "Ref"],
      rows: [["SARAH CONNOR", "a"], ["Sarah Connor", "b"]],
    };
    const patches = cleanse(table).patches.filter(
      (p) => p.rule === "consistent-casing",
    ) as CellPatch[];
    expect(patches.length).toBe(1);
    expect(patches[0]!.after).toBe("Sarah Connor");
    expect(patches[0]!.cell.row).toBe(0);
  });
});

describe("date order inference", () => {
  it("infers MDY when unambiguous values say so", () => {
    const table: Table = {
      headers: ["Order Date"],
      rows: [["04/25/2024"], ["03/04/2024"], ["12/31/2023"]],
    };
    const result = cleanse(table);
    const ambiguous = result.patches.find(
      (p) => p.kind === "cell" && p.cell.row === 1,
    ) as CellPatch;
    expect(ambiguous.after).toBe("2024-03-04"); // read as March 4th
  });

  it("defaults to DMY for the UK", () => {
    const table: Table = {
      headers: ["Date"],
      rows: [["03/04/2024"]],
    };
    const result = cleanse(table);
    const patch = result.patches[0] as CellPatch;
    expect(patch.after).toBe("2024-04-03"); // 3rd of April
  });
});
