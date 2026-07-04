import { describe, expect, it } from "vitest";
import {
  applyPatches,
  cleanse,
  fromDelimitedText,
  profileTable,
  scoreTable,
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

  it("scores uniqueness against rows, not cells (a duplicate is a bad row)", () => {
    // messy has 1 exact-duplicate row out of 6 → uniqueness should be well
    // below a cell-basis reading, which would barely register.
    const uniq = result.score.dimensions.find((d) => d.key === "uniqueness")!;
    expect(uniq.score).toBeLessThan(85);
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

describe("encoding repair", () => {
  const table: Table = {
    headers: ["Name", "Notes"],
    rows: [
      ["CafÃ© Rouge", "Itâ€™s fine â€” really"],
      ["  CafÃ©  ", "normal text"],
      ["João Café", "légitime"], // already-correct accents must be untouched
    ],
  };
  const result = cleanse(table);
  const encodingPatches = result.patches.filter(
    (p) => p.rule === "fix-encoding",
  ) as CellPatch[];

  it("repairs UTF-8-as-CP1252 mojibake", () => {
    const cell00 = encodingPatches.find((p) => p.cell.row === 0 && p.cell.col === 0);
    expect(cell00!.after).toBe("Café Rouge");
    const cell01 = encodingPatches.find((p) => p.cell.row === 0 && p.cell.col === 1);
    // The reversal is faithful: typographic apostrophe (U+2019), not ASCII.
    expect(cell01!.after).toBe("It’s fine — really");
  });

  it("owns whitespace cleanup for corrupted cells (no duelling patches)", () => {
    const cell10 = encodingPatches.find((p) => p.cell.row === 1 && p.cell.col === 0);
    expect(cell10!.after).toBe("Café");
    const whitespaceOnSameCell = result.patches.find(
      (p) => p.rule === "trim-whitespace" && p.kind === "cell" && p.cell.row === 1 && p.cell.col === 0,
    );
    expect(whitespaceOnSameCell).toBeUndefined();
  });

  it("never touches legitimate accented text", () => {
    const row2 = result.patches.filter(
      (p) => p.kind === "cell" && p.cell.row === 2,
    );
    expect(row2.length).toBe(0);
  });
});

describe("number-stored-as-text", () => {
  const table: Table = {
    headers: ["Spend"],
    rows: [["£1,200"], ["1,234.50"], ["(500)"], ["£90"], ["300"], ["75.5"]],
  };
  const patches = cleanse(table).patches.filter(
    (p) => p.rule === "normalize-number",
  ) as CellPatch[];

  it("strips currency symbols and thousands separators", () => {
    expect(patches.find((p) => p.cell.row === 0)!.after).toBe("1200");
    expect(patches.find((p) => p.cell.row === 1)!.after).toBe("1234.50");
    expect(patches.find((p) => p.cell.row === 3)!.after).toBe("90");
  });
  it("converts accountancy parens to negatives", () => {
    expect(patches.find((p) => p.cell.row === 2)!.after).toBe("-500");
  });
  it("leaves already-plain numbers alone", () => {
    expect(patches.find((p) => p.cell.row === 4)).toBeUndefined();
    expect(patches.find((p) => p.cell.row === 5)).toBeUndefined();
  });
  it("ignores a stray currency symbol in a non-numeric column", () => {
    const notes: Table = {
      headers: ["Note"],
      rows: [["paid £50 cash"], ["invoice sent"], ["called twice"], ["n/a"]],
    };
    const p = cleanse(notes).patches.filter((x) => x.rule === "normalize-number");
    expect(p.length).toBe(0);
  });
});

describe("boolean standardisation", () => {
  it("normalises mixed yes/no spellings to the column's dominant token", () => {
    const table: Table = {
      headers: ["Active", "Ref"],
      rows: [
        ["Yes", "a"], ["yes", "b"], ["Y", "c"], ["No", "d"], ["no", "e"], ["N", "f"],
      ],
    };
    const patches = cleanse(table).patches.filter(
      (p) => p.rule === "normalize-boolean",
    ) as CellPatch[];
    // "Yes" (x1) is the only capitalised true form → wins over "yes"/"Y".
    for (const p of patches) {
      expect(["Yes", "No"]).toContain(p.after);
    }
    expect(patches.some((p) => p.before === "Y" && p.after === "Yes")).toBe(true);
    expect(patches.some((p) => p.before === "no" && p.after === "No")).toBe(true);
  });

  it("does not treat a numeric 0/1 column as boolean", () => {
    const table: Table = {
      headers: ["Count"],
      rows: [["0"], ["1"], ["1"], ["0"], ["1"], ["0"]],
    };
    const patches = cleanse(table).patches.filter(
      (p) => p.rule === "normalize-boolean",
    );
    expect(patches.length).toBe(0);
  });
});

describe("header hygiene", () => {
  it("trims header whitespace and de-duplicates names", () => {
    const table: Table = {
      headers: ["Name ", "Email", "Email"],
      rows: [["A", "a@x.io", "a2@x.io"]],
    };
    const result = cleanse(table);
    const headerPatches = result.patches.filter((p) => p.kind === "header");
    expect(headerPatches.length).toBe(2);
    const cleaned = applyPatches(table, result.patches);
    expect(cleaned.headers).toEqual(["Name", "Email", "Email (2)"]);
  });

  it("leaves clean unique headers untouched", () => {
    const table: Table = {
      headers: ["Name", "Email", "Joined"],
      rows: [["A", "a@x.io", "2024-01-01"]],
    };
    const headerPatches = cleanse(table).patches.filter((p) => p.kind === "header");
    expect(headerPatches.length).toBe(0);
  });
});

describe("health scoring", () => {
  // A sheet that is messy in fixable ways (dupes, casing, whitespace, formats)
  // plus a couple of unfixable advisories (invalid email, impossible date).
  const table = fromDelimitedText(
    [
      "Name,Email,Joined,Company",
      "  john smith ,john@acme.com,15/01/2024,ACME LTD",
      "John Smith,john@acme.com,2024-01-15,Acme Ltd",
      "John Smith,john@acme.com,2024-01-15,Acme Ltd",
      "jane doe,not-an-email,31/02/2024,acme ltd",
      "Bob Jones,bob@x.io,03/04/2024,Bob & Co",
      "Ann Lee,ann@lee.co.uk,2024-05-20,Lee Co",
    ].join("\n"),
  );
  const result = cleanse(table);

  it("produces a large, meaningful gain when fixes are accepted", () => {
    const gain = result.projectedScore.overall - result.score.overall;
    expect(gain).toBeGreaterThanOrEqual(15);
  });

  it("never lets remediation lower the score (stable basis)", () => {
    // The old bug: accepting fixes removed rows, shrank the denominator, and
    // the surviving advisory issues penalised harder — cleaning lowered the
    // score. Projected must always be >= now.
    expect(result.projectedScore.overall).toBeGreaterThanOrEqual(
      result.score.overall,
    );
    for (const key of ["validity", "consistency", "completeness", "uniqueness"] as const) {
      const now = result.score.dimensions.find((d) => d.key === key)!.score;
      const proj = result.projectedScore.dimensions.find((d) => d.key === key)!.score;
      expect(proj).toBeGreaterThanOrEqual(now);
    }
  });

  it("scoreTable is stable under a shrinking table when the basis is held", () => {
    // Same findings, but scored against a smaller table with the original
    // basis pinned, must not drop below the original-table score.
    const bigProfile = profileTable(table);
    const smallProfile = profileTable({
      headers: table.headers,
      rows: table.rows.slice(0, 3),
    });
    const findings = result.findings;
    const withOwnBasis = scoreTable(smallProfile, findings);
    const withPinnedBasis = scoreTable(smallProfile, findings, {
      cells: bigProfile.rowCount * bigProfile.columnCount,
      rows: bigProfile.rowCount,
    });
    expect(withPinnedBasis.overall).toBeGreaterThanOrEqual(withOwnBasis.overall);
  });

  it("weights fixable dimensions above validity so mess is recoverable", () => {
    // Validity failures are advisory (never auto-fixed); they must not
    // dominate the composite, or accepting every fix would barely move it.
    const clean = cleanse({
      headers: ["A", "B"],
      rows: [
        ["1", "x"],
        ["2", "y"],
        ["3", "z"],
      ],
    });
    expect(clean.score.overall).toBeGreaterThanOrEqual(95);
  });
});

describe("integrity advisories", () => {
  it("flags likely stripped leading zeros in ID columns", () => {
    const table: Table = {
      headers: ["Account No", "Name"],
      rows: [
        ["00123", "a"], ["00456", "b"], ["789", "c"], ["1234", "d"], ["00999", "e"],
      ],
    };
    const finding = cleanse(table).findings.find(
      (f) => f.rule === "suspect-leading-zeros",
    );
    expect(finding).toBeDefined();
    expect(finding!.count).toBe(2); // "789" and "1234"
    expect(finding!.patchIds).toEqual([]); // advisory — never auto-fixed
  });

  it("flags far outliers in numeric columns", () => {
    const table: Table = {
      headers: ["Amount"],
      rows: [["10"], ["12"], ["11"], ["13"], ["9"], ["10"], ["12"], ["11"], ["99999"]],
    };
    const finding = cleanse(table).findings.find(
      (f) => f.rule === "numeric-outliers",
    );
    expect(finding).toBeDefined();
    expect(finding!.count).toBe(1);
    expect(finding!.severity).toBe("info");
  });

  it("stays quiet on unremarkable numeric data", () => {
    const table: Table = {
      headers: ["Amount"],
      rows: [["10"], ["12"], ["11"], ["13"], ["9"], ["10"], ["12"], ["11"]],
    };
    const finding = cleanse(table).findings.find(
      (f) => f.rule === "numeric-outliers",
    );
    expect(finding).toBeUndefined();
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
