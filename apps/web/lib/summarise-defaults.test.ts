import { describe, expect, it } from "vitest";
import { fromDelimitedText, type Table } from "@refynr/engine";
import { suggestGroupColumn, suggestValueColumn } from "./summarise-defaults";

const SAMPLE_LIKE = fromDelimitedText(
  [
    "Name,Company,Account No,Spend",
    "John Smith,Acme Ltd,00101,249.50",
    "Jane Doe,Acme Ltd,00102,180",
    "Bob Jones,Acme Ltd,103,320.75",
    "Ann Lee,Lee & Co,00105,99999",
    "Sarah Connor,Cyberdyne,00106,275",
    "Mike O'Brien,Lee & Co,00108,290",
  ].join("\n"),
);

describe("suggestGroupColumn", () => {
  it("picks the category, not the near-unique first column", () => {
    // The bug this exists to prevent: grouping by "Name" gives one group per
    // row, so the summary looks like it did nothing at all.
    expect(suggestGroupColumn(SAMPLE_LIKE)).toEqual(["Company"]);
  });

  it("ignores a column that is unique per row", () => {
    const t = fromDelimitedText("id,grade\n1,A\n2,A\n3,B\n4,B");
    expect(suggestGroupColumn(t)).toEqual(["grade"]);
  });

  it("ignores a column with only one distinct value — it wouldn't group anything", () => {
    const t = fromDelimitedText("constant,grade\nx,A\nx,A\nx,B\nx,B");
    expect(suggestGroupColumn(t)).toEqual(["grade"]);
  });

  it("falls back to the first column when nothing qualifies", () => {
    const t = fromDelimitedText("a,b\n1,2");
    expect(suggestGroupColumn(t)).toEqual(["a"]);
  });

  it("survives an empty table", () => {
    const empty: Table = { headers: ["a", "b"], rows: [] };
    expect(suggestGroupColumn(empty)).toEqual(["a"]);
  });
});

describe("suggestValueColumn", () => {
  it("picks a quantity, not the grouping key and not an identifier", () => {
    // "Sum of Company" is nonsense, and "Account No" is numeric-looking but is
    // an identifier — adding up account numbers means nothing.
    expect(suggestValueColumn(SAMPLE_LIKE, ["Company"])).toBe("Spend");
  });

  it("skips every grouping key", () => {
    const picked = suggestValueColumn(SAMPLE_LIKE, ["Company", "Name", "Account No"]);
    expect(picked).toBe("Spend");
  });

  it("falls back to an identifier only when there is no real quantity", () => {
    const t = fromDelimitedText("g,Account No\na,00101\nb,00102\na,00103");
    expect(suggestValueColumn(t, ["g"])).toBe("Account No");
  });

  it("prefers a numeric column over a leading text one", () => {
    const t = fromDelimitedText("g,label,amount\na,foo,10\nb,bar,20\na,baz,30");
    expect(suggestValueColumn(t, ["g"])).toBe("amount");
  });

  it("falls back to any remaining column when none are numeric", () => {
    const t = fromDelimitedText("g,label\na,foo\nb,bar");
    expect(suggestValueColumn(t, ["g"])).toBe("label");
  });

  it("returns a column even when every column is a grouping key", () => {
    const t = fromDelimitedText("a,b\n1,2");
    expect(suggestValueColumn(t, ["a", "b"])).toBe("a");
  });
});
