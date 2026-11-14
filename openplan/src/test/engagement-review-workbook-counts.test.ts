/**
 * THE REVIEW WORKBOOK HOLDS ITS COUNTS IN LABELED CELLS, WITH THE PDF'S WORDS
 * (KI-2026-11-14-324).
 *
 * The workbook's Summary sheet counted contributions, sessions, answers and
 * responses, but no cell held a count by review state or a count of
 * contributions answered by a published response: a reader had to count the
 * Contributions status column, where a withheld contribution reads
 * `rejected`. Now Summary holds each count beside the word the PDF uses, the
 * Contributions sheet gives each row's review state in that word, and the
 * stored status value stays as it was for anyone who reads it.
 *
 * Read by cell, never by text search.
 *
 * WHAT THIS FILE CANNOT PROVE. How a spreadsheet program shows the sheet, or
 * that the numbers agree with the PDF and the public page (the four-output
 * agreement test does that).
 */
import { describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";
import { buildCampaignReviewWorkbook, parseReviewSnapshot } from "@/lib/engagement/review-export";
import { REVIEW_COUNT_IDS, internalReviewCountSnapshot, publicReviewCountSnapshot, savedSnapshot } from "./fixtures/engagement/review-counts";

vi.mock("@/lib/reports/pdf", () => ({ renderReportPdf: vi.fn() }));

async function workbook(snapshot: ReturnType<typeof internalReviewCountSnapshot>) {
  const saved = savedSnapshot(snapshot);
  return XLSX.read(await buildCampaignReviewWorkbook(await parseReviewSnapshot(saved.text, saved.checksum), saved.checksum), { type: "buffer" });
}

/** Summary's B cell for the row whose A cell holds `label`, or undefined. */
function summaryCell(book: XLSX.WorkBook, label: string): XLSX.CellObject | undefined {
  const sheet = book.Sheets.Summary;
  const range = XLSX.utils.decode_range(sheet["!ref"]!);
  for (let row = range.s.r; row <= range.e.r; row += 1) {
    if (sheet[XLSX.utils.encode_cell({ r: row, c: 0 })]?.v === label) return sheet[XLSX.utils.encode_cell({ r: row, c: 1 })];
  }
  return undefined;
}

describe("the review workbook's Summary sheet", () => {
  it("holds each internal count in a cell labeled with the PDF's word", async () => {
    const book = await workbook(internalReviewCountSnapshot());
    const read = (label: string) => summaryCell(book, label)?.v;
    expect({
      received: read("Received"), approved: read("Approved"), withheld: read("Withheld"), pending: read("Pending"),
      flagged: read("Flagged for review"), publishedResponses: read("Published staff responses"),
      answered: read("Answered by a published staff response"),
    }).toEqual({ received: 7, approved: 4, withheld: 1, pending: 1, flagged: 1, publishedResponses: 2, answered: 3 });
    for (const label of ["Received", "Approved", "Withheld", "Answered by a published staff response"]) expect(summaryCell(book, label)?.t).toBe("n");
    // The earlier rows keep their cells, so a reader of B2 to B5 reads what they always did.
    expect([book.Sheets.Summary.A2.v, book.Sheets.Summary.B2.v, book.Sheets.Summary.A5.v, book.Sheets.Summary.B5.v]).toEqual(["Contributions", 7, "Staff responses", 3]);
  });

  it("holds no withheld, pending or flagged count in a public copy and says they are left out", async () => {
    const book = await workbook(publicReviewCountSnapshot());
    expect(summaryCell(book, "Approved")?.v).toBe(4);
    expect(summaryCell(book, "Answered by a published staff response")?.v).toBe(3);
    expect(summaryCell(book, "Withheld")).toBeUndefined();
    expect(summaryCell(book, "Received")).toBeUndefined();
    expect(summaryCell(book, "Withheld, pending and flagged")?.v).toBe("Not in the public copy");
  });
});

describe("the review workbook's Contributions sheet", () => {
  it("gives each row's review state in the PDF's word and keeps the stored status", async () => {
    const book = await workbook(internalReviewCountSnapshot());
    const rows = XLSX.utils.sheet_to_json<{ id: string; status: string; "Review state": string }>(book.Sheets.Contributions);
    const byId = Object.fromEntries(rows.map((row) => [row.id, [row.status, row["Review state"]]]));
    expect(byId[REVIEW_COUNT_IDS.withheld]).toEqual(["rejected", "Withheld"]);
    expect(byId[REVIEW_COUNT_IDS.answeredOnce]).toEqual(["approved", "Approved"]);
    expect(byId[REVIEW_COUNT_IDS.pending]).toEqual(["pending", "Pending"]);
    expect(byId[REVIEW_COUNT_IDS.flagged]).toEqual(["flagged", "Flagged for review"]);
  });
});
