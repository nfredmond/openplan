import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { buildAwardDrawdownLedger, type DrawdownInvoiceLike } from "@/lib/invoicing/drawdown-ledger";
import {
  buildReimbursementWorksheetHtml,
  summarizeWorksheetCostEntries,
  WORKSHEET_FOOTER_NOTE,
  WORKSHEET_PREPARED_NOTE,
} from "@/lib/invoicing/reimbursement-worksheet";
import { INTERIM_DEFAULT_RATIONALE, resolveReimbursementProfile } from "@/lib/invoicing/reimbursement-profile-binding";
import { renderHtmlToPdf } from "@/lib/reports/pdf";

/**
 * THE WORKSHEET'S REPEATING FOOTER COVERS NO PRINTED FIGURE.
 *
 * Lane 84's run-through downloaded a Plumas County, CA worksheet with three
 * invoice records. The third row (INV-2A, $45,000.00) landed at the bottom of
 * page 1, and the fixed footer that repeats the "not a funder's form" note on
 * every page was drawn over it: the amounts were cut in half on the page. The
 * footer is `position: fixed`, which Chrome repeats on each page but which
 * reserves no space, so whatever row reaches the bottom of a page runs under it.
 *
 * The worksheet is rendered here with Chrome from a 30-line ledger and a long
 * disclosure note, so text runs across page breaks on any font, and read back
 * with Poppler's word boxes. On each page the footer's top is the lowest "Prepared"
 * (the note's first word; the Chrome page line below it says "prepared" in
 * lower case). Every word that reaches below that line, above Chrome's own page
 * line, must be one of the note's own words.
 *
 * Blind category: a body word that happens to equal a note word ("the",
 * "form") and sits in the band is excused; the figures and invoice numbers this
 * exists for never match. Overlap with drawn rules or shading is not measured.
 * Skipped where Chrome or Poppler is not installed.
 */

const CHROME = [process.env.CHROME_EXECUTABLE_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "/usr/bin/google-chrome", "/usr/bin/chromium"]
  .find((candidate): candidate is string => Boolean(candidate && existsSync(candidate)));

/** Poppler's folder: the one holding pdftotext (xpdf's pdftotext has no -bbox). */
function popplerDir(): string | null {
  const exe = process.platform === "win32" ? ".exe" : "";
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    if (dir && ["pdftoppm", "pdftotext"].every((name) => existsSync(path.join(dir, `${name}${exe}`)))) return dir;
  }
  return null;
}
const POPPLER = popplerDir();
const PDF_TOOLS = Boolean(CHROME) && POPPLER !== null;
const workDir = PDF_TOOLS ? mkdtempSync(path.join(tmpdir(), "openplan-worksheet-pdf-")) : "";
afterAll(() => {
  if (workDir) rmSync(workDir, { recursive: true, force: true });
});

type Word = { page: number; yMin: number; yMax: number; text: string };

function words(file: string): Word[] {
  const pdftotext = path.join(POPPLER!, `pdftotext${process.platform === "win32" ? ".exe" : ""}`);
  const xml = execFileSync(pdftotext, ["-bbox", file, "-"]).toString();
  const out: Word[] = [];
  let page = 0;
  for (const pageMatch of xml.matchAll(/<page [^>]*>([\s\S]*?)<\/page>/g)) {
    page += 1;
    for (const w of pageMatch[1].matchAll(/<word xMin="[\d.]+" yMin="([\d.]+)" xMax="[\d.]+" yMax="([\d.]+)">([^<]*)<\/word>/g)) {
      out.push({ page, yMin: Number(w[1]), yMax: Number(w[2]), text: w[3].replace(/&apos;/g, "'").replace(/&amp;/g, "&") });
    }
  }
  return out;
}

/** Words below the footer's top on each page that are not the footer note's own words. */
function wordsUnderTheFooter(list: Word[]): string[] {
  const found: string[] = [];
  const pages = [...new Set(list.map((w) => w.page))];
  for (const page of pages) {
    const onPage = list.filter((w) => w.page === page);
    const footerTop = Math.max(...onPage.filter((w) => w.text === "Prepared").map((w) => w.yMin));
    const chromeLineTop = Math.max(...onPage.filter((w) => w.text === "Page").map((w) => w.yMin));
    const noteWords = WORKSHEET_PREPARED_NOTE.split(/\s+/);
    for (const word of onPage) {
      if (word.yMax <= footerTop + 0.5 || word.yMin >= chromeLineTop - 0.5) continue;
      const index = noteWords.indexOf(word.text);
      if (index >= 0) noteWords.splice(index, 1);
      else found.push(`page ${page}: "${word.text}" at ${word.yMin.toFixed(1)} to ${word.yMax.toFixed(1)}, footer from ${footerTop.toFixed(1)}`);
    }
  }
  return found;
}

/**
 * A note long enough to cross at least one page boundary on any font. Where a
 * table row breaks is luck (a row that does not fit moves whole to the next
 * page and may stop short of the footer); a paragraph that runs across a break
 * always puts a line within one line of the page bottom, which is inside the
 * footer's band unless the space is reserved.
 */
const LONG_NOTICE = Array.from({ length: 160 }, (_, i) => `Demonstration sentence ${i + 1} for a layout check.`).join(" ");

function thirtyLineWorksheet(): string {
  const invoices: DrawdownInvoiceLike[] = Array.from({ length: 30 }, (_, i) => ({
    id: `invoice-${i + 1}`,
    invoice_number: `INV-${i + 1}`,
    status: i % 3 === 0 ? "paid" : "submitted",
    amount: 1000 + i,
    retention_percent: 0,
    retention_amount: 0,
    net_amount: 1000 + i,
    invoice_date: `2026-0${(i % 9) + 1}-15`,
    due_date: null,
    paid_date: null,
  }));
  const ledger = buildAwardDrawdownLedger({
    award: { awarded_amount: 200000, match_amount: 50000, match_posture: "partial" },
    invoiceRead: { ok: true, invoices },
  });
  const profile = resolveReimbursementProfile({ workspaceJurisdiction: null });
  if (!ledger.ok || profile.kind !== "resolved") throw new Error("fixture did not build");
  return buildReimbursementWorksheetHtml({
    workspace: { name: "Demonstration workspace" },
    award: { title: "Demonstration award", projectName: "Demonstration project" },
    period: null,
    ledger: ledger.ledger,
    profile: profile.binding,
    currencyCode: "USD",
    interimDefaultRationale: INTERIM_DEFAULT_RATIONALE,
    costs: summarizeWorksheetCostEntries({ ok: true, entries: [] }),
    assemblyNotices: [LONG_NOTICE],
  });
}

describe.runIf(PDF_TOOLS)("the reimbursement worksheet PDF, read back with Poppler's word boxes", () => {
  it("prints every invoice row clear of the footer that repeats on each page", async () => {
    process.env.CHROME_EXECUTABLE_PATH = CHROME;
    const file = path.join(workDir, "worksheet-thirty-lines.pdf");
    writeFileSync(file, await renderHtmlToPdf(thirtyLineWorksheet(), { footerLabel: WORKSHEET_FOOTER_NOTE }));
    const list = words(file);

    // The document broke across pages, and the footer is on every page, so the check has something to find.
    const pages = new Set(list.map((w) => w.page));
    expect(pages.size).toBeGreaterThanOrEqual(2);
    for (const page of pages) expect(list.some((w) => w.page === page && w.text === "Prepared"), `page ${page} footer`).toBe(true);
    for (let n = 1; n <= 30; n += 1) expect(list.some((w) => w.text === `INV-${n}`), `INV-${n}`).toBe(true);
    expect(list.some((w) => w.text === "160"), "the long note's last sentence").toBe(true);

    expect(wordsUnderTheFooter(list)).toEqual([]);
  }, 120_000);
});
