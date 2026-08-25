import { readFileSync } from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { reviewPortfolioWorkbook, type PortfolioSheetConfiguration } from "@/lib/projects/portfolio-import";
import {
  inspectPortfolioWorkbook,
  PortfolioWorkbookError,
  validatePortfolioArchive,
} from "@/lib/projects/portfolio-workbook";

const fixture = (name: string) => readFileSync(path.join(process.cwd(), "src/test/fixtures/portfolio-import", name));
const contentTypes = {
  csv: "text/csv",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
} as const;
const defaults = { planType: "capital_program", status: "draft" as const, deliveryPhase: "programming" as const };

function markZipEncrypted(input: Uint8Array): Uint8Array {
  const bytes = new Uint8Array(input);
  for (let index = 0; index <= bytes.length - 10; index += 1) {
    const signature = bytes[index] | (bytes[index + 1] << 8) | (bytes[index + 2] << 16) | (bytes[index + 3] << 24);
    const flagOffset = signature === 0x04034b50 ? index + 6 : signature === 0x02014b50 ? index + 8 : -1;
    if (flagOffset >= 0) bytes[flagOffset] |= 1;
  }
  return bytes;
}

function configuration(worksheetIndex: number, headerRow: number, mapping: PortfolioSheetConfiguration["mapping"]): PortfolioSheetConfiguration {
  return {
    worksheetIndex,
    headerRow,
    mapping,
    defaults: {
      ...defaults,
      ...(mapping.estimatedCost === undefined ? {} : { cost: { currency: "EUR", scale: "ones" as const, priceYear: 2026 } }),
    },
  };
}

describe("direct portfolio workbook inspection", () => {
  it.each([
    ["portfolio.csv", "csv", contentTypes.csv],
    ["portfolio-multi.xls", "xls", contentTypes.xls],
    ["portfolio-multi.xlsx", "xlsx", contentTypes.xlsx],
    ["portfolio-multi.ods", "ods", contentTypes.ods],
  ] as const)("inspects %s as %s without selecting a worksheet", async (filename, format, contentType) => {
    const inspection = await inspectPortfolioWorkbook({ bytes: fixture(filename), filename, contentType });
    expect(inspection.format).toBe(format);
    expect(inspection.sourceHash).toMatch(/^[0-9a-f]{64}$/);
    expect(inspection.worksheets.length).toBe(format === "csv" ? 1 : 3);
    expect(inspection).not.toHaveProperty("selectedWorksheetIndex");
  });

  it("reports physical sheet identity, hidden state, dimensions, Unicode, merged headers, and bounded samples", async () => {
    const inspection = await inspectPortfolioWorkbook({
      bytes: fixture("portfolio-multi.xlsx"),
      filename: "portfolio-multi.xlsx",
      contentType: contentTypes.xlsx,
    });
    expect(inspection.worksheets.map((sheet) => [sheet.index, sheet.name, sheet.visibility])).toEqual([
      [0, "District α", "visible"],
      [1, "District β", "visible"],
      [2, "Reference", "hidden"],
    ]);
    expect(inspection.worksheets[0]).toMatchObject({ rowCount: 6, columnCount: 7 });
    expect(inspection.worksheets[0].sampleRows[3].cells[1].display).toBe("Calle Peatonal ñ");
    expect(inspection.worksheets[0].sampleRows.length).toBeLessThanOrEqual(12);
  });

  it("refuses extension, stored content type, and byte-structure disagreement", async () => {
    await expect(inspectPortfolioWorkbook({ bytes: fixture("portfolio-multi.xlsx"), filename: "renamed.ods", contentType: contentTypes.ods })).rejects.toMatchObject({ code: "format_mismatch" });
    await expect(inspectPortfolioWorkbook({ bytes: fixture("portfolio-multi.xlsx"), filename: "source.xlsx", contentType: contentTypes.xls })).rejects.toMatchObject({ code: "format_mismatch" });
    await expect(inspectPortfolioWorkbook({ bytes: fixture("portfolio.csv"), filename: "source.xls", contentType: contentTypes.xls })).rejects.toMatchObject({ code: "format_mismatch" });
  });

  it("refuses a source above the shared 10 MiB ceiling before parsing", async () => {
    await expect(inspectPortfolioWorkbook({
      bytes: new Uint8Array(10 * 1024 * 1024 + 1),
      filename: "too-large.csv",
      contentType: contentTypes.csv,
    })).rejects.toMatchObject({ code: "size_limit" });
  });

  it("drains archives, refuses encryption and macros, and enforces entry limits before parsing", async () => {
    await expect(validatePortfolioArchive(fixture("portfolio-multi.xlsx"))).resolves.toBeInstanceOf(Map);
    await expect(validatePortfolioArchive(markZipEncrypted(fixture("portfolio-multi.xlsx")))).rejects.toMatchObject({ code: "archive_encrypted" });
    const macro = await JSZip.loadAsync(fixture("portfolio-multi.xlsx"));
    macro.file("xl/vbaProject.bin", "not executable, only a refusal fixture");
    const bytes = await macro.generateAsync({ type: "uint8array" });
    await expect(inspectPortfolioWorkbook({ bytes, filename: "macro.xlsx", contentType: contentTypes.xlsx })).rejects.toMatchObject({ code: "macro_workbook" });

    const crowded = new JSZip();
    for (let index = 0; index < 2_001; index += 1) crowded.file(`entry-${index}`, "x");
    await expect(validatePortfolioArchive(await crowded.generateAsync({ type: "uint8array" }))).rejects.toMatchObject({ code: "archive_entry_limit" });

    const oversized = new JSZip();
    oversized.file("large.bin", new Uint8Array(25 * 1024 * 1024 + 1));
    await expect(validatePortfolioArchive(await oversized.generateAsync({ type: "uint8array", compression: "DEFLATE" }))).rejects.toMatchObject({ code: "archive_entry_size" });

    const expansive = new JSZip();
    for (let index = 0; index < 3; index += 1) expansive.file(`part-${index}.bin`, new Uint8Array(17 * 1024 * 1024));
    await expect(validatePortfolioArchive(await expansive.generateAsync({ type: "uint8array", compression: "DEFLATE" }))).rejects.toMatchObject({ code: "archive_total_size" });
  });
});

describe("multi-sheet portfolio review", () => {
  it("combines rows in physical/source order, ignores blank rows, and keeps each sheet setup", async () => {
    const review = await reviewPortfolioWorkbook({
      bytes: fixture("portfolio-multi.xlsx"), filename: "portfolio-multi.xlsx", contentType: contentTypes.xlsx,
      configurations: [
        configuration(0, 3, { sourceId: 0, name: 1, sourceLocation: 3 }),
        configuration(1, 1, { sourceId: 0, name: 1, sourceLocation: 3 }),
      ],
    });
    expect(review.rows.map((row) => [row.worksheetIndex, row.rowNumber])).toEqual([[0, 4], [0, 5], [1, 2], [1, 3]]);
    expect(review.sheets.map((sheet) => [sheet.headerRow, sheet.headers[1]])).toEqual([[3, "Project"], [1, "Project"]]);
    expect(review.sheets[0].duplicateHeaders).toEqual([{ header: "repeated", indexes: [5, 6] }]);
    expect(review.rows[0].sourceLocationText).toBe("Distrito Norte");
    expect(review.rows[0]).not.toHaveProperty("geometry");
  });

  it("blocks source IDs across sheets and individually confirms normalized names within the batch", async () => {
    const input = {
      bytes: fixture("portfolio-multi.xlsx"), filename: "portfolio-multi.xlsx", contentType: contentTypes.xlsx,
      configurations: [configuration(0, 3, { sourceId: 0, name: 1 }), configuration(1, 1, { sourceId: 0, name: 1 })],
    };
    const first = await reviewPortfolioWorkbook(input);
    expect(first.rows.filter((row) => row.sourceId === "DUP-7").every((row) => row.errors.some((issue) => issue.code === "duplicate_source_id"))).toBe(true);
    const shared = first.rows.filter((row) => row.name === "Shared name");
    expect(shared.every((row) => row.warnings.some((issue) => issue.code === "batch_name_match"))).toBe(true);

    const selected = await reviewPortfolioWorkbook({
      ...input,
      rowReviews: [{ worksheetIndex: 1, rowNumber: 2, decision: "create" }],
    });
    expect(selected.rows.find((row) => row.worksheetIndex === 1 && row.rowNumber === 2)).toMatchObject({ canCreate: false });
    const confirmed = await reviewPortfolioWorkbook({
      ...input,
      rowReviews: [{ worksheetIndex: 1, rowNumber: 2, decision: "create", confirmNameMatch: true }],
    });
    expect(confirmed.rows.find((row) => row.worksheetIndex === 1 && row.rowNumber === 2)).toMatchObject({ canCreate: true });
  });

  it("uses cached formulas without recalculation, blocks error results, and requires row confirmation", async () => {
    const input = {
      bytes: fixture("portfolio-multi.xlsx"), filename: "portfolio-multi.xlsx", contentType: contentTypes.xlsx,
      configurations: [configuration(0, 3, { name: 1, estimatedCost: 4 })],
    };
    const first = await reviewPortfolioWorkbook({ ...input, rowReviews: [{ worksheetIndex: 0, rowNumber: 4, decision: "create" }] });
    expect(first.rows[0]).toMatchObject({ estimatedCost: { amount: "999" }, formulaFields: ["estimatedCost"], canCreate: false });
    expect(first.rows[1].errors.map((issue) => issue.code)).toContain("formula_error");
    const confirmed = await reviewPortfolioWorkbook({ ...input, rowReviews: [{ worksheetIndex: 0, rowNumber: 4, decision: "create", confirmFormula: true }] });
    expect(confirmed.rows[0]).toMatchObject({ decision: "create", canCreate: true });

    const missingZip = await JSZip.loadAsync(fixture("portfolio-multi.xlsx"));
    const sheetXml = await missingZip.file("xl/worksheets/sheet1.xml")!.async("string");
    missingZip.file("xl/worksheets/sheet1.xml", sheetXml.replace(/(<c r="E4"[^>]*><f>[^<]+<\/f>)<v>[^<]*<\/v>/, "$1"));
    const missingBytes = await missingZip.generateAsync({ type: "uint8array" });
    const missing = await reviewPortfolioWorkbook({ ...input, bytes: missingBytes });
    expect(missing.rows[0].errors.map((issue) => issue.code)).toContain("formula_missing_value");
    expect(missing.rows[0]).toMatchObject({ decision: "skip", canCreate: false });
  });

  it("accepts numeric and strict decimal costs but rejects booleans and ambiguous text", async () => {
    const review = await reviewPortfolioWorkbook({
      bytes: fixture("portfolio-multi.xlsx"), filename: "portfolio-multi.xlsx", contentType: contentTypes.xlsx,
      configurations: [configuration(0, 3, { name: 1, estimatedCost: 2 }), configuration(1, 1, { name: 1, estimatedCost: 2 })],
    });
    expect(review.rows[0].estimatedCost?.amount).toBe("12.5");
    expect(review.rows[1].estimatedCost?.amount).toBe("3.25");
    expect(review.rows[2].estimatedCost?.amount).toBe("44");
    expect(review.rows[3].errors.map((issue) => issue.code)).toContain("unsupported_cell");
  });

  it("changes the preview hash with sheet identity, decisions, confirmations, and current duplicate checks", async () => {
    const input = {
      bytes: fixture("portfolio.csv"), filename: "portfolio.csv", contentType: contentTypes.csv,
      configurations: [configuration(0, 1, { sourceId: 0, name: 1 })],
    };
    const baseline = await reviewPortfolioWorkbook(input);
    const selected = await reviewPortfolioWorkbook({ ...input, rowReviews: [{ worksheetIndex: 0, rowNumber: 2, decision: "create" }] });
    const match = await reviewPortfolioWorkbook({ ...input, existingProjects: [{ id: "existing", name: "Unicode café" }] });
    expect(new Set([baseline.previewHash, selected.previewHash, match.previewHash]).size).toBe(3);
    expect(baseline.rows[0].fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it("keys prior creation by sheet index, row number, and fingerprint", async () => {
    const input = {
      bytes: fixture("portfolio.csv"), filename: "portfolio.csv", contentType: contentTypes.csv,
      configurations: [configuration(0, 1, { name: 1 })],
    };
    const first = await reviewPortfolioWorkbook(input);
    const rerun = await reviewPortfolioWorkbook({
      ...input,
      rowReviews: [{ worksheetIndex: 0, rowNumber: 2, decision: "create" }],
      previouslyCreatedRows: [{ sourceHash: first.sourceHash, worksheetIndex: 0, rowNumber: 2, rowFingerprint: first.rows[0].fingerprint, projectId: "created" }],
    });
    expect(rerun.rows[0]).toMatchObject({ state: "created_before", decision: "skip", previouslyCreatedProjectId: "created" });
  });

  it("refuses sources that extend past the 2,000-row review boundary", async () => {
    const csv = ["ID,Name", ...Array.from({ length: 2_001 }, (_, index) => `${index},Project ${index}`)].join("\n");
    await expect(reviewPortfolioWorkbook({
      bytes: new TextEncoder().encode(csv),
      filename: "long.csv",
      contentType: contentTypes.csv,
      configurations: [configuration(0, 1, { sourceId: 0, name: 1 })],
    })).rejects.toMatchObject({ code: "row_limit" });
  });
});
