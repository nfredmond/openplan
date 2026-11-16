import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { buildGrantApplicationHtml } from "@/lib/grants/application-html";
import { ATP_APPENDIX_FRAME, buildAtpEvidenceAppendices } from "@/lib/grants/atp-evidence-appendices";
import { ATP_APPENDIX_KEYS } from "@/lib/grants/evidence-appendix-keys";
import { renderHtmlToPdf } from "@/lib/reports/pdf";
import { ATP_IDS, completeAtpRecords } from "./fixtures/grants/atp-evidence";

/**
 * NO TWO PRINTED WORDS SIT ON TOP OF EACH OTHER IN THE ATP APPLICATION PDF.
 *
 * Lane 67's run-through exported a Trinity County, CA application and found
 * the ATP screening packet's "Program page" address printed across the next
 * column: an unbreakable URL in a two-column fact grid ran past its cell and
 * over "The CTC adopts an ATP program...". The PDF is rendered here with Chrome,
 * read back with Poppler's word boxes, and every pair of words on one line is
 * checked for overlap.
 *
 * Blind category: overlap with a drawn shape (a border or a map), text clipped
 * by a cell rather than drawn over its neighbor, and pages this fixture does
 * not produce. Skipped where Chrome or Poppler is not installed.
 */

const CHROME = [process.env.CHROME_EXECUTABLE_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "/usr/bin/google-chrome", "/usr/bin/chromium"]
  .find((candidate): candidate is string => Boolean(candidate && existsSync(candidate)));

/** Poppler's folder: the one holding pdftotext and pdftoppm (xpdf's pdftotext has no -bbox). */
function popplerDir(): string | null {
  const exe = process.platform === "win32" ? ".exe" : "";
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    if (dir && ["pdftoppm", "pdftotext"].every((name) => existsSync(path.join(dir, `${name}${exe}`)))) return dir;
  }
  return null;
}
const POPPLER = popplerDir();
const PDF_TOOLS = Boolean(CHROME) && POPPLER !== null;
const workDir = PDF_TOOLS ? mkdtempSync(path.join(tmpdir(), "openplan-atp-pdf-")) : "";
afterAll(() => {
  if (workDir) rmSync(workDir, { recursive: true, force: true });
});

type Word = { page: number; xMin: number; yMin: number; xMax: number; yMax: number; text: string };

function words(file: string): Word[] {
  const pdftotext = path.join(POPPLER!, `pdftotext${process.platform === "win32" ? ".exe" : ""}`);
  const xml = execFileSync(pdftotext, ["-bbox", file, "-"]).toString();
  const out: Word[] = [];
  let page = 0;
  for (const pageMatch of xml.matchAll(/<page [^>]*>([\s\S]*?)<\/page>/g)) {
    page += 1;
    for (const w of pageMatch[1].matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)<\/word>/g)) {
      out.push({ page, xMin: Number(w[1]), yMin: Number(w[2]), xMax: Number(w[3]), yMax: Number(w[4]), text: w[5] });
    }
  }
  return out;
}

/** Pairs of words on one page whose boxes overlap by more than a point each way. */
function overlappingWords(list: Word[]): string[] {
  const found: string[] = [];
  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      const [a, b] = [list[i], list[j]];
      if (a.page !== b.page) continue;
      const dx = Math.min(a.xMax, b.xMax) - Math.max(a.xMin, b.xMin);
      const dy = Math.min(a.yMax, b.yMax) - Math.max(a.yMin, b.yMin);
      if (dx > 1 && dy > 1) found.push(`page ${a.page}: "${a.text}" over "${b.text}"`);
    }
  }
  return found;
}

describe.runIf(PDF_TOOLS)("the ATP application PDF, read back with Poppler's word boxes", () => {
  it("prints the program page address inside its cell and no word over another", async () => {
    process.env.CHROME_EXECUTABLE_PATH = CHROME;
    const html = buildGrantApplicationHtml({
      opportunity: { id: ATP_IDS.opportunity, title: "ATP application", agency_name: null, summary: null, expected_award_amount: null, closes_at: null, opportunity_status: null, decision_state: null },
      programTitle: null, sections: [], attachments: [], generatedAt: "2026-11-16T01:31:00.000Z",
      evidenceAppendices: buildAtpEvidenceAppendices(completeAtpRecords(), new Set<string>(ATP_APPENDIX_KEYS)),
      evidenceAppendixFrame: ATP_APPENDIX_FRAME,
    });
    const file = path.join(workDir, "atp-application.pdf");
    writeFileSync(file, await renderHtmlToPdf(html, { footerLabel: "Active Transportation Program (ATP)" }));
    const list = words(file);
    // The address is printed (possibly wrapped), so the check has something to find.
    expect(list.map((w) => w.text).join("")).toContain("https://catc.ca.gov/programs/active-transportation-program");
    expect(overlappingWords(list)).toEqual([]);
  }, 120_000);
});
