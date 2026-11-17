// @vitest-environment node
/**
 * The fourth proven job's checker reads real reimbursement worksheet PDFs
 * printed from the product's own worksheet code, in every role.
 *
 * proven-job-award.test.ts runs the checker on text files its fixture lays
 * out, so it cannot show how Chrome wraps the worksheet or that Poppler reads
 * it back in an order the checker can follow. Here each journey's two
 * worksheets (before and after the close-out) are built by the product
 * (buildAwardDrawdownLedger, resolveReimbursementProfile and
 * buildReimbursementWorksheetHtml, through fixtures/proven-job-award.ts),
 * printed by Chrome with the footer the download route sets
 * (WORKSHEET_FOOTER_NOTE), and read through the checker's default reader
 * (Poppler's pdftotext). The checker must accept all six: the county's
 * Caltrans LAPM worksheets and the city's and tribal area's generic federal
 * worksheets, with the fixed demonstration amounts. Set
 * OPENPLAN_KEEP_AWARD_PDFS=1 to keep the PDFs and their text to read by hand.
 *
 * The built-in writer is the download's fallback when no browser engine
 * works; its PDF must be refused by name. That block needs only Poppler.
 *
 * The evidence records are test fixtures with made-up Census ids. Nothing
 * here is a run, and no place is real.
 *
 * Blind category: the hosted site's Chrome and fonts can wrap a line
 * elsewhere than this machine's. The download route's own reads (the award,
 * its requests, the workspace's place) are not run; the route tests cover
 * them with fakes. Skipped where Poppler is missing, and the Chrome block
 * where Chrome is: a skipped run proves nothing.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { WORKSHEET_FOOTER_NOTE } from "@/lib/invoicing/reimbursement-worksheet";
import { renderHtmlToPdf, renderReportPdf } from "@/lib/reports/pdf";
import { pdftotextPages, validateProvenJobRecord } from "../../scripts/ops/capability-evidence.mjs";
import { SYNTHETIC_PDF_HEADER, screenFiguresAt, syntheticPdfPages, syntheticWorksheetPdfText, worksheetHtmlAt } from "./fixtures/proven-job-award";

const read = (file: string) => JSON.parse(readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8"));
const EXAMPLE = read("../../../schemas/examples/proven_job_record.v1.award.synthetic.json");
const DEFINITIONS = read("../../../schemas/proven_job_definitions.v1.json");

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- a record under test is deliberately untyped JSON
type Json = any;
const JOB: Json = DEFINITIONS.jobs.find((job: Json) => job.id === "grant-award-to-reimbursement-record-in-three-places");

function popplerDir(): string | null {
  const exe = process.platform === "win32" ? ".exe" : "";
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    if (dir && ["pdftoppm", "pdftotext"].every((name) => existsSync(path.join(dir, `${name}${exe}`)))) return dir;
  }
  return null;
}
const POPPLER = popplerDir() !== null;
const CHROME = [process.env.CHROME_EXECUTABLE_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "/usr/bin/google-chrome", "/usr/bin/chromium"]
  .find((candidate): candidate is string => Boolean(candidate && existsSync(candidate)));

const root = mkdtempSync(path.join(tmpdir(), "openplan-proven-award-real-"));
afterAll(() => {
  if (process.env.OPENPLAN_KEEP_AWARD_PDFS) console.info(`Reimbursement worksheet PDFs kept in ${root}`);
  else rmSync(root, { recursive: true, force: true });
});

type Engine = "builtin" | "chrome";
async function printPdf(html: string, engine: Engine): Promise<Uint8Array> {
  if (engine === "chrome") {
    process.env.CHROME_EXECUTABLE_PATH = CHROME;
    // The download route renders with this footer (drawdown-worksheet/route.ts).
    return renderHtmlToPdf(html, { footerLabel: WORKSHEET_FOOTER_NOTE });
  }
  process.env.CHROME_EXECUTABLE_PATH = path.join(root, "no-browser-here");
  const result = await renderReportPdf(html, { title: "Reimbursement worksheet", generatedAt: null, footerLabel: WORKSHEET_FOOTER_NOTE });
  expect(result.engine).toBe("builtin");
  return result.bytes;
}

/** The example record with each named journey's worksheets printed by the product and pinned. */
async function recordWithRealPdfs(engine: Engine, roles: string[]): Promise<Json> {
  const record = structuredClone(EXAMPLE);
  // The journeys not printed here keep the example's synthetic files.
  for (const entry of record.journeys.filter((journey: Json) => !roles.includes(journey.role))) {
    for (const pdf of entry.pdfs) {
      mkdirSync(path.dirname(path.join(root, pdf.path)), { recursive: true });
      writeFileSync(path.join(root, pdf.path), syntheticWorksheetPdfText(entry, pdf.kind));
    }
  }
  for (const entry of record.journeys.filter((journey: Json) => roles.includes(journey.role))) {
    for (const pdf of entry.pdfs) {
      const download = entry.downloads.find((item: Json) => item.pdf === pdf.kind);
      const bytes = await printPdf(worksheetHtmlAt(entry, download.at), engine);
      pdf.path = `real/${engine}-${entry.role}-${pdf.kind}.pdf`;
      mkdirSync(path.dirname(path.join(root, pdf.path)), { recursive: true });
      writeFileSync(path.join(root, pdf.path), bytes);
      pdf.sha256 = createHash("sha256").update(bytes).digest("hex");
      pdf.bytes = bytes.length;
      const pages = pdftotextPages(path.join(root, pdf.path));
      if (process.env.OPENPLAN_KEEP_AWARD_PDFS) writeFileSync(path.join(root, `${pdf.path}.txt`), pages.join("\f"));
      pdf.pages = pages.length;
      const headings = JOB.itemHeadings[pdf.kind];
      pdf.items = Object.keys(JOB.items).map((item) => ({
        item, method: "pdftotext", text: headings[item],
        page: pages.findIndex((page) => page.split(/\r?\n/).some((line) => line.trim().toLowerCase() === headings[item].toLowerCase())) + 1,
      }));
    }
  }
  return record;
}
/** Real PDFs go to Poppler through the checker's own reader; the example's synthetic files to the stand-in. */
function readPages(file: string): string[] {
  const bytes = readFileSync(file);
  return bytes.subarray(0, SYNTHETIC_PDF_HEADER.length).toString("latin1") === SYNTHETIC_PDF_HEADER ? syntheticPdfPages(bytes.toString("utf8")) : pdftotextPages(file);
}
const check = (record: Json) => validateProvenJobRecord(record, { repoRoot: root, readPdfPages: readPages });
const ROLES = ["county", "city", "tribal-area"];

describe.skipIf(!POPPLER || !CHROME)("real worksheets printed by Chrome", () => {
  it("accepts every role's two worksheets, each on its own profile", async () => {
    const record = await recordWithRealPdfs("chrome", ROLES);
    expect(() => check(record)).not.toThrow();
    // The process each worksheet names is its role's, read back from the PDF.
    for (const entry of record.journeys) {
      const text = pdftotextPages(path.join(root, entry.pdfs[1].path)).join("\n");
      expect(text).toContain(`Process: ${JOB.award.profiles.byRole[entry.role].profileName}`);
    }
  }, 240_000);

  it("refuses a real worksheet whose record says another amount was claimed", async () => {
    // The record and its screen readings say 61,000; the printed worksheets say 60,000.
    const record = await recordWithRealPdfs("chrome", ["county"]);
    const county = record.journeys[0];
    county.requests[0].gross = "61000.00";
    county.closeOut.releasedAmount = "94000.00";
    for (const reading of county.screenReadings) reading.figures = screenFiguresAt(county, reading.at, Object.keys(reading.figures));
    let message = "";
    try {
      check(record);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toBe(
      'proven job record refused: county journey worksheet-open PDF "Claimed to date (gross)" prints $105,000.00, but the figure recomputed from the record at the download is $106,000.00',
    );
  }, 240_000);
});

describe.skipIf(!POPPLER)("a worksheet the built-in writer typeset", () => {
  it("is refused by name", async () => {
    const record = await recordWithRealPdfs("builtin", ["city"]);
    let message = "";
    try {
      check(record);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toBe(
      "proven job record refused: city journey worksheet-open PDF was typeset by OpenPlan's built-in writer, not the browser engine (\"Typeset by OpenPlan's built-in PDF writer\"); the export fell back, and a proof needs the PDF a planner gets",
    );
  }, 240_000);
});
