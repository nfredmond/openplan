import { describe, expect, it } from "vitest";
import { csvCellForValue, escapeCsvField, neutralizeSpreadsheetFormula } from "@/lib/export/csv";
import { serializeRecordsToCsv } from "@/lib/export/download";

/**
 * CSV formula injection (the reviewer finding): a cell whose first character
 * is `=` `+` `-` `@` (or tab/CR) is EXECUTED when the export is opened in
 * Excel/LibreOffice/Sheets, and resident-authored free text flows into the
 * engagement item export and the survey answer export. The shared escaping
 * layer prefixes a single quote, so every CSV inherits the defense.
 *
 * THE NUMERIC-COLUMN DECISION is asserted here too: real numbers pass through
 * bare (a number cannot carry a formula, and -6 must stay computable), while
 * a resident-TYPED "-5" is untrusted text and gets the prefix.
 */

describe("the shared CSV layer neutralizes spreadsheet formulas", () => {
  it("prefixes every formula-leading character class", () => {
    expect(escapeCsvField("=HYPERLINK(\"http://evil.example\",\"click\")")).toBe(
      "\"'=HYPERLINK(\"\"http://evil.example\"\",\"\"click\"\")\""
    );
    expect(escapeCsvField("@SUM(1)")).toBe("'@SUM(1)");
    expect(escapeCsvField("+1 (530) 555-0100")).toBe("'+1 (530) 555-0100");
    expect(escapeCsvField("-2+3+cmd|' /C calc'!A0")).toBe("'-2+3+cmd|' /C calc'!A0");
    expect(escapeCsvField("\tstarts with a tab")).toBe("'\tstarts with a tab");
    // CR also forces quoting, and the prefix sits inside the quotes.
    expect(escapeCsvField("\rstarts with a CR")).toBe("\"'\rstarts with a CR\"");
  });

  it("leaves ordinary text, and formula characters mid-cell, alone", () => {
    expect(escapeCsvField("More shade trees")).toBe("More shade trees");
    expect(escapeCsvField("2 + 2 = 4 downtown")).toBe("2 + 2 = 4 downtown");
    expect(neutralizeSpreadsheetFormula("safe")).toBe("safe");
  });

  it("neutralizes a resident-typed '-5' but passes a machine number -5 through bare", () => {
    // Deliberate: a string is untrusted text in a text column; "'-5" displayed
    // as text is the safe rendering. A typed number stays computable.
    expect(escapeCsvField("-5")).toBe("'-5");
    expect(csvCellForValue("-5")).toBe("'-5");
    expect(csvCellForValue(-5)).toBe("-5");
    expect(csvCellForValue(3.5)).toBe("3.5");
    expect(csvCellForValue(true)).toBe("true");
    expect(csvCellForValue(null)).toBe("");
  });

  it("keeps machine numeric columns computable in the download serializers while defusing text", () => {
    const csv = serializeRecordsToCsv([
      { label: "=SUM(A1:A9)", delta: -6, note: "@import" },
    ]);
    // The negative DELTA is a number and stays bare… (keys sort to
    // delta,label,note, so the value row opens with the bare -6)
    expect(csv).toContain("\n-6,");
    expect(csv).not.toContain("'-6");
    // …while the string cells are defused.
    expect(csv).toContain("'=SUM(A1:A9)");
    expect(csv).toContain("'@import");
  });
});
