import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderReportPdf } from "@/lib/reports/pdf";
import { buildAwardDrawdownLedger, type DrawdownInvoiceLike } from "@/lib/invoicing/drawdown-ledger";
import {
  buildReimbursementWorksheetHtml,
  summarizeWorksheetCostEntries,
  WORKSHEET_DOCUMENT_TITLE,
  WORKSHEET_FOOTER_NOTE,
  WORKSHEET_PREPARED_NOTE,
} from "@/lib/invoicing/reimbursement-worksheet";
import { resolveReimbursementProfile } from "@/lib/invoicing/reimbursement-profile-binding";
import { decodePdfLiteral, pdfSource } from "./pdf-text-extraction-helpers";

/**
 * THE DISCLAIMER HAS TO SURVIVE THE TIER WITHOUT CHROME.
 *
 * The worksheet's prepared note reaches every printed page through
 * `.page-footer { position: fixed }`. That is a CHROME mechanism. Through the
 * BUILT-IN typesetter — what a self-hosted deployment with no Chrome always
 * gets, and CLAUDE.md makes self-hosting first-class — `htmlToPdfBlocks` knows
 * nothing about fixed positioning: the note became two ordinary paragraphs in
 * the flow, and the actual per-page footer read "Page 2 of 4 · Reimbursement
 * worksheet".
 *
 * So on exactly the deployments that cannot afford a mistake, every page after
 * the first was an official-looking table of an agency's claim position against
 * a funder with nothing on it saying OpenPlan made it. A packet gets pulled
 * apart; a middle page is what lands on somebody's desk.
 *
 * These tests run the REAL renderer with Chrome forced unavailable, and read
 * the text back out of each page's own content stream. Asserting on the whole
 * document would pass on a note that appears once.
 */

const AWARD_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

/** Enough rows that the packet cannot fit on one page. */
function manyInvoices(): DrawdownInvoiceLike[] {
  return Array.from({ length: 40 }, (_unused, index) => ({
    id: `${AWARD_ID}-${index}`,
    invoice_number: `RB-${String(index + 1).padStart(3, "0")}`,
    status: index % 4 === 0 ? "paid" : "submitted",
    amount: `${1000 + index}.25`,
    retention_percent: 5,
    invoice_date: `2026-0${(index % 9) + 1}-15`,
    paid_date: index % 4 === 0 ? `2026-0${(index % 9) + 1}-28` : null,
  }));
}

function worksheetHtml(): string {
  const built = buildAwardDrawdownLedger({
    award: { awarded_amount: "250000.00", match_amount: "32362.50", match_posture: "secured" },
    invoiceRead: { ok: true, invoices: manyInvoices() },
  });
  if (!built.ok) throw new Error("fixture ledger failed to build");

  const profile = resolveReimbursementProfile({
    workspaceJurisdiction: { country: "US", subdivision: "CA" },
  });
  if (profile.kind !== "resolved") throw new Error("fixture profile did not resolve");

  return buildReimbursementWorksheetHtml({
    workspace: { name: "Sierra Regional Transportation Agency" },
    award: { title: "Ridge Corridor Safety Improvements", projectName: "Ridge Corridor" },
    period: null,
    ledger: built.ledger,
    profile: profile.binding,
    costs: summarizeWorksheetCostEntries({
      ok: true,
      entries: Array.from({ length: 30 }, (_unused, index) => ({
        entry_date: `2026-0${(index % 9) + 1}-08`,
        description: `Field data collection task ${index + 1}`,
        vendor_label: "Sierra Counts LLC",
        amount: `${210 + index}.75`,
      })),
    }),
  });
}

/**
 * The decoded text of each page, in order.
 *
 * `pdfDrawnText` joins the whole document, which cannot tell "on every page"
 * from "somewhere once" — and "somewhere once" is precisely the defect.
 */
function pdfPageTexts(bytes: Uint8Array): string[] {
  const source = pdfSource(bytes);
  return [...source.matchAll(/stream\n([\s\S]*?)\nendstream/g)].map((match) =>
    [...match[1].matchAll(/\(([\s\S]*?)\) Tj/g)].map((tj) => decodePdfLiteral(tj[1])).join(" ")
  );
}

describe("the reimbursement worksheet's disclaimer in the built-in PDF tier", () => {
  const ORIGINAL = process.env.CHROME_EXECUTABLE_PATH;

  beforeEach(() => {
    // Force the tier a Chrome-less self-hosted deployment always gets.
    process.env.CHROME_EXECUTABLE_PATH = "/nonexistent/chrome-for-tests";
  });

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.CHROME_EXECUTABLE_PATH;
    else process.env.CHROME_EXECUTABLE_PATH = ORIGINAL;
  });

  async function renderWorksheetPdf() {
    const html = worksheetHtml();
    const rendered = await renderReportPdf(html, {
      // Exactly what the worksheet route passes.
      title: `${WORKSHEET_DOCUMENT_TITLE} — Ridge Corridor Safety Improvements`,
      generatedAt: null,
      footerLabel: WORKSHEET_FOOTER_NOTE,
    });
    return { rendered, pages: pdfPageTexts(rendered.bytes) };
  }

  it("produces more than one page, so 'every page' means something", async () => {
    const { rendered, pages } = await renderWorksheetPdf();

    expect(rendered.engine).toBe("builtin");
    expect(rendered.pageCount).toBeGreaterThan(1);
    expect(pages.length).toBe(rendered.pageCount);
  });

  it("stamps the disclaimer on EVERY page, not only the one carrying the note", async () => {
    const { pages } = await renderWorksheetPdf();

    const pagesWithout = pages
      .map((text, index) => (text.includes(WORKSHEET_FOOTER_NOTE) ? null : index + 1))
      .filter((page): page is number => page !== null);

    expect(
      pagesWithout,
      [
        "A page of the reimbursement worksheet carries no statement that OpenPlan produced it.",
        "Packets get pulled apart; a middle page of claim figures with no disclaimer reads as",
        "the funder's own form. The note must ride `footerLabel`, which the built-in writer",
        "stamps per page — the HTML's fixed page-footer is Chrome-only.",
      ].join("\n")
    ).toEqual([]);
  });

  it("keeps the page numbering it always had, alongside the note", async () => {
    const { rendered, pages } = await renderWorksheetPdf();

    expect(pages[0]).toContain(`Page 1 of ${rendered.pageCount}`);
    expect(pages[pages.length - 1]).toContain(`Page ${rendered.pageCount} of ${rendered.pageCount}`);
  });

  it("says who made it and denies the form claim, in the footer's own words", () => {
    // A footer that fits but says nothing would pass the per-page test above.
    expect(WORKSHEET_FOOTER_NOTE).toContain("OpenPlan");
    expect(WORKSHEET_FOOTER_NOTE).toMatch(/not a funder's form/i);
  });

  it("is short enough and plain enough for an 8pt footer line", async () => {
    const { rendered } = await renderWorksheetPdf();

    // The built-in writer transliterates or drops what WinAnsi cannot encode.
    // A footer is the last place to spend that budget, so it stays ASCII.
    expect(WORKSHEET_FOOTER_NOTE).toMatch(/^[\x20-\x7e]+$/);
    // `Page N of M · ` plus the label, right-aligned inside a 512pt column.
    expect(`Page 1 of ${rendered.pageCount} · ${WORKSHEET_FOOTER_NOTE}`.length).toBeLessThan(100);
  });

  it("still carries the full three-sentence note in the body", async () => {
    const { pages } = await renderWorksheetPdf();

    // The short footer replaces nothing: the instruction to check the packet
    // against the current exhibit is longer than a footer line and still has to
    // be in the document.
    const whole = pages.join(" ");
    expect(whole).toContain("Check it against the exhibit your funding agreement currently requires");
    expect(WORKSHEET_PREPARED_NOTE).toContain(
      "Check it against the exhibit your funding agreement currently requires"
    );
  });
});
