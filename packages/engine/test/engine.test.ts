import { describe, expect, it } from "vitest";
import {
  applyPatches,
  buildReport,
  cleanse,
  createRecipe,
  diffTables,
  findReplace,
  fromDelimitedText,
  fromJson,
  mergeColumns,
  parseInstruction,
  splitColumn,
  parseRecipe,
  profileTable,
  reportToMarkdown,
  runRecipe,
  scoreTable,
  serializeRecipe,
  type CellPatch,
  type Constraint,
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

describe("near-duplicate clustering", () => {
  it("collides token-reordered and punctuated variants of one record", () => {
    const table: Table = {
      headers: ["Name", "Company"],
      rows: [
        ["John Smith", "Acme Ltd"],
        ["Smith, John", "Acme Ltd."], // same record, reordered + punctuation
        ["Jane Doe", "Beta Co"],
      ],
    };
    const finding = cleanse(table).findings.find((f) => f.rule === "near-duplicate-rows");
    expect(finding).toBeDefined();
    expect(finding!.count).toBeGreaterThanOrEqual(1);
    expect(finding!.patchIds).toEqual([]); // advisory, never auto-removed
  });

  it("catches a single-character typo via nearest-neighbour", () => {
    const table: Table = {
      headers: ["Company"],
      rows: [["Acme Trading Limited"], ["Acme Tradlng Limited"], ["Wholly Different Co"]],
    };
    const finding = cleanse(table).findings.find((f) => f.rule === "near-duplicate-rows");
    expect(finding).toBeDefined();
  });

  it("does not flag genuinely distinct rows", () => {
    const table: Table = {
      headers: ["Name"],
      rows: [["Alice"], ["Bob"], ["Carol"], ["Dave"]],
    };
    const finding = cleanse(table).findings.find((f) => f.rule === "near-duplicate-rows");
    expect(finding).toBeUndefined();
  });
});

describe("UK business identifiers", () => {
  it("normalises a valid VAT number and flags an invalid one", () => {
    const table: Table = {
      headers: ["VAT Number"],
      rows: [["gb 123 4567 82"], ["123456789"]], // first valid checksum, second not
    };
    const result = cleanse(table);
    const fix = result.patches.find((p) => p.rule === "normalize-vat") as CellPatch;
    expect(fix.after).toBe("GB123456782");
    expect(result.findings.some((f) => f.rule === "invalid-vat" && f.count === 1)).toBe(true);
  });

  it("hyphenates a six-digit sort code and flags a short one", () => {
    const table: Table = {
      headers: ["Sort Code"],
      rows: [["560036"], ["1234"]],
    };
    const result = cleanse(table);
    const fix = result.patches.find((p) => p.rule === "normalize-sort-code") as CellPatch;
    expect(fix.after).toBe("56-00-36");
    expect(result.findings.some((f) => f.rule === "invalid-sort-code")).toBe(true);
  });

  it("zero-pads a company number stripped by Excel", () => {
    const table: Table = {
      headers: ["Company Number"],
      rows: [["123456"], ["SC123456"], ["nope"]],
    };
    const result = cleanse(table);
    const fix = result.patches.find(
      (p) => p.rule === "normalize-company-number" && (p as CellPatch).cell.row === 0,
    ) as CellPatch;
    expect(fix.after).toBe("00123456");
    expect(result.findings.some((f) => f.rule === "invalid-company-number")).toBe(true);
  });

  it("ignores identifier columns it wasn't asked about", () => {
    const table: Table = { headers: ["Age"], rows: [["42"], ["37"]] };
    const result = cleanse(table);
    expect(result.patches.some((p) => p.rule.startsWith("normalize-vat"))).toBe(false);
  });
});

describe("recipes", () => {
  const table: Table = {
    headers: ["Name", "Email"],
    rows: [
      ["  Ann ", "ANN@x.com"],
      ["  Ann ", "ANN@x.com"], // exact dupe
      ["bob", "bob@x.com"],
    ],
  };

  it("round-trips through serialise/parse", () => {
    const recipe = createRecipe("Monthly export", { dateOutput: "iso", disabledRules: ["consistent-casing"] }, ["remove-duplicate-rows"]);
    const back = parseRecipe(serializeRecipe(recipe));
    expect(back.name).toBe("Monthly export");
    expect(back.options.disabledRules).toEqual(["consistent-casing"]);
    expect(back.skipRules).toEqual(["remove-duplicate-rows"]);
  });

  it("replays accepted fixes deterministically", () => {
    const recipe = createRecipe("all fixes");
    const a = runRecipe(table, recipe);
    const b = runRecipe(table, recipe);
    expect(a.cleaned).toEqual(b.cleaned);
    // whitespace trimmed and the exact dupe dropped -> 2 rows
    expect(a.cleaned.rows.length).toBe(2);
  });

  it("honours skipRules by leaving that fix unapplied", () => {
    const keepDupes = createRecipe("keep dupes", {}, ["remove-duplicate-rows"]);
    const run = runRecipe(table, keepDupes);
    expect(run.cleaned.rows.length).toBe(3); // dupe retained
  });

  it("rejects a non-recipe file", () => {
    expect(() => parseRecipe("{\"hello\":1}")).toThrow();
    expect(() => parseRecipe("not json")).toThrow();
  });
});

describe("natural-language commands", () => {
  it("understands a keep/skip instruction", () => {
    const i = parseInstruction("Clean it up but keep duplicates and don't change the casing");
    expect(i.options.disabledRules).toContain("remove-duplicate-rows");
    expect(i.options.disabledRules).toContain("consistent-casing");
    expect(i.matched.length).toBeGreaterThanOrEqual(2);
  });

  it("sets date output format", () => {
    const i = parseInstruction("format dates as ISO");
    expect(i.options.dateOutput).toBe("iso");
  });

  it("handles 'only' by disabling everything else", () => {
    const i = parseInstruction("only fix whitespace");
    expect(i.options.disabledRules).toContain("remove-duplicate-rows");
    expect(i.options.disabledRules).not.toContain("trim-whitespace");
  });

  it("reports clauses it could not interpret", () => {
    const i = parseInstruction("translate everything into French");
    expect(i.unmatched.length).toBeGreaterThan(0);
  });

  it("a parsed instruction drives the engine as options", () => {
    const table: Table = { headers: ["Name"], rows: [["a"], ["a"]] };
    const i = parseInstruction("keep duplicates");
    const result = cleanse(table, i.options);
    expect(result.patches.some((p) => p.rule === "remove-duplicate-rows")).toBe(false);
  });
});

describe("expectations (constraints)", () => {
  const table: Table = {
    headers: ["Email", "Status", "Age"],
    rows: [
      ["a@x.com", "active", "30"],
      ["", "archived", "200"],
      ["a@x.com", "banana", "25"],
    ],
  };

  it("flags not-null, unique, allowed-values and range violations", () => {
    const constraints: Constraint[] = [
      { column: "Email", type: "not-null" },
      { column: "Email", type: "unique" },
      { column: "Status", type: "allowed-values", values: ["active", "archived"] },
      { column: "Age", type: "range", min: 0, max: 120 },
    ];
    const result = cleanse(table, { constraints });
    const rules = result.findings.map((f) => f.rule);
    expect(rules).toContain("constraint-not-null"); // blank email row 2
    expect(rules).toContain("constraint-unique"); // duplicate a@x.com
    expect(rules).toContain("constraint-allowed-values"); // "banana"
    expect(rules).toContain("constraint-range"); // 200 > 120
    // Constraints are advisory — they never produce patches.
    expect(result.findings.filter((f) => f.rule.startsWith("constraint")).every((f) => f.patchIds.length === 0)).toBe(true);
  });

  it("passes cleanly when the data satisfies the rule", () => {
    const ok = cleanse(
      { headers: ["Email"], rows: [["a@x.com"], ["b@x.com"]] },
      { constraints: [{ column: "Email", type: "unique" }] },
    );
    expect(ok.findings.some((f) => f.rule.startsWith("constraint"))).toBe(false);
  });

  it("warns when a constraint names a missing column", () => {
    const result = cleanse(table, { constraints: [{ column: "Nope", type: "not-null" }] });
    expect(result.findings.some((f) => f.title.includes("missing column"))).toBe(true);
  });
});

describe("dataset diff", () => {
  const before: Table = {
    headers: ["id", "name", "spend"],
    rows: [
      ["1", "Ann", "100"],
      ["2", "Bob", "200"],
      ["3", "Cara", "300"],
    ],
  };
  const after: Table = {
    headers: ["id", "name", "spend"],
    rows: [
      ["1", "Ann", "150"], // spend changed
      ["3", "Cara", "300"], // unchanged
      ["4", "Dan", "400"], // added
      // id 2 removed
    ],
  };

  it("classifies added, removed, changed and unchanged rows on an inferred key", () => {
    const d = diffTables(before, after);
    expect(d.keyColumn).toBe("id");
    expect(d.added.map((r) => r.key)).toEqual(["4"]);
    expect(d.removed.map((r) => r.key)).toEqual(["2"]);
    expect(d.changed).toHaveLength(1);
    expect(d.changed[0]!.cells[0]!.column).toBe("spend");
    expect(d.changed[0]!.cells[0]!.after).toBe("150");
    expect(d.unchanged).toBe(1);
  });

  it("reports added and removed columns", () => {
    const d = diffTables(
      { headers: ["id", "old"], rows: [["1", "x"]] },
      { headers: ["id", "new"], rows: [["1", "y"]] },
    );
    expect(d.addedColumns).toEqual(["new"]);
    expect(d.removedColumns).toEqual(["old"]);
  });

  it("counts rows with an empty key as added/removed, never dropping them", () => {
    const b: Table = { headers: ["id", "v"], rows: [["1", "a"], ["", "orphan-b"]] };
    const a: Table = { headers: ["id", "v"], rows: [["1", "a"], ["", "orphan-a"]] };
    const d = diffTables(b, a, "id");
    // The keyless rows can't be matched, so one is removed and one added —
    // total row count is conserved, nothing silently disappears.
    expect(d.added.length + d.removed.length + d.changed.length + d.unchanged).toBe(3);
    expect(d.added.some((r) => r.key === "(no key)")).toBe(true);
    expect(d.removed.some((r) => r.key === "(no key)")).toBe(true);
  });

  it("falls back to positional diff without a usable key", () => {
    // Repeated values mean no column is a usable key -> positional comparison.
    const d = diffTables(
      { headers: ["v"], rows: [["a"], ["a"]] },
      { headers: ["v"], rows: [["a"], ["c"]] },
    );
    expect(d.keyColumn).toBeNull();
    expect(d.changed).toHaveLength(1);
    expect(d.unchanged).toBe(1);
  });
});

describe("run report", () => {
  it("summarises accepted patches and advisories", () => {
    const messyForReport: Table = {
      headers: ["Name", "Email"],
      rows: [["  Ann ", "a@x.com"], ["  Ann ", "a@x.com"], ["bob", "not-an-email"]],
    };
    const result = cleanse(messyForReport);
    const acceptedIds = new Set(result.patches.map((p) => p.id));
    const report = buildReport(result, acceptedIds);
    expect(report.rowsRemoved).toBeGreaterThanOrEqual(1); // the exact dupe
    expect(report.patchesApplied).toBe(result.patches.length);
    expect(report.applied.length).toBeGreaterThan(0);
    const md = reportToMarkdown(report, { timestamp: "2026-07-11" });
    expect(md).toContain("# refynr cleaning report");
    expect(md).toContain("Health score:");
  });
});

describe("column transforms", () => {
  const table: Table = {
    headers: ["Name", "City"],
    rows: [
      ["John Smith", "Leeds"],
      ["Ann", "York"],
      ["Mary Jane Watson", "Hull"],
      [null, "Bath"],
    ],
  };

  it("splits a column on a separator, sized by the widest row", () => {
    const t = splitColumn(table, 0, { separator: " " });
    expect(t.headers).toEqual(["Name 1", "Name 2", "Name 3", "City"]);
    expect(t.rows[0]).toEqual(["John", "Smith", null, "Leeds"]);
    expect(t.rows[1]).toEqual(["Ann", null, null, "York"]);
    expect(t.rows[2]).toEqual(["Mary", "Jane", "Watson", "Hull"]);
    expect(t.rows[3]).toEqual([null, null, null, "Bath"]);
    // Non-destructive: the input is untouched.
    expect(table.headers).toEqual(["Name", "City"]);
    expect(table.rows[0]![0]).toBe("John Smith");
  });

  it("honours custom names and returns the table unchanged when nothing splits", () => {
    const named = splitColumn(table, 0, { separator: " ", names: ["First", "Last"] });
    expect(named.headers.slice(0, 2)).toEqual(["First", "Last"]);
    const noop = splitColumn(table, 1, { separator: "|" }); // no pipes in City
    expect(noop).toBe(table);
  });

  it("merges columns, skipping empties, and drops the source columns", () => {
    const split = splitColumn(table, 0, { separator: " " });
    const back = mergeColumns(split, [0, 1, 2], { name: "Name" });
    expect(back.headers).toEqual(["Name", "City"]);
    expect(back.rows[0]![0]).toBe("John Smith");
    expect(back.rows[1]![0]).toBe("Ann"); // no trailing separators from empties
    expect(back.rows[3]![0]).toBeNull();
  });

  it("merge is a no-op for fewer than two valid columns", () => {
    expect(mergeColumns(table, [0])).toBe(table);
    expect(mergeColumns(table, [0, 99])).toBe(table);
  });
});

describe("findReplace", () => {
  const table: Table = {
    headers: ["Name", "City"],
    rows: [
      ["Acme Ltd", "Leeds"],
      ["ACME Corp", "leeds"],
      ["Beta Inc", "York"],
    ],
  };

  it("matches case-insensitively by default and preserves surrounding text", () => {
    const reps = findReplace(table, "acme", "Apex");
    expect(reps).toHaveLength(2);
    expect(reps[0]!.after).toBe("Apex Ltd");
    expect(reps[1]!.after).toBe("Apex Corp"); // original casing outside the match kept
  });

  it("honours matchCase, wholeCell and column restriction", () => {
    expect(findReplace(table, "ACME", "X", { matchCase: true })).toHaveLength(1);
    expect(findReplace(table, "Leeds", "Bradford", { wholeCell: true, matchCase: true })).toHaveLength(1);
    expect(findReplace(table, "leeds", "Bradford", { column: 0 })).toHaveLength(0);
  });

  it("never mutates the table and returns nothing for an empty query", () => {
    findReplace(table, "Acme", "Zzz");
    expect(table.rows[0]![0]).toBe("Acme Ltd");
    expect(findReplace(table, "", "x")).toHaveLength(0);
  });
});

describe("large inputs", () => {
  it("cleanses a table with 60k patch-producing rows without overflowing the stack", () => {
    // Every cell has whitespace, so the whitespace fixer alone emits ~60k
    // patches — a regression guard against `push(...hugeArray)` blowing up.
    const rows = Array.from({ length: 60000 }, (_, i) => [`  user ${i} `]);
    const table: Table = { headers: ["Name"], rows };
    expect(() => cleanse(table)).not.toThrow();
    const result = cleanse(table);
    expect(result.patches.length).toBeGreaterThan(50000);
  });
});

describe("JSON input", () => {
  it("parses an array of records with a union of keys", () => {
    const t = fromJson('[{"a":1,"b":"x"},{"a":2,"c":true}]');
    expect(t.headers).toEqual(["a", "b", "c"]);
    expect(t.rows[0]).toEqual([1, "x", null]);
    expect(t.rows[1]).toEqual([2, null, true]);
  });

  it("accepts a wrapped {data:[...]} object and stringifies nested values", () => {
    const t = fromJson('{"data":[{"tags":["x","y"]}]}');
    expect(t.headers).toEqual(["tags"]);
    expect(t.rows[0]![0]).toBe('["x","y"]');
  });

  it("throws a clear error on non-record JSON", () => {
    expect(() => fromJson("42")).toThrow();
    expect(() => fromJson("not json")).toThrow();
  });
});
