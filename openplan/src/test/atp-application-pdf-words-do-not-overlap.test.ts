import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { buildCatalogAttachmentSeeds, buildCatalogSectionSeeds, findGrantProgramCatalogEntry } from "@/lib/grants/application";
import { buildGrantApplicationHtml } from "@/lib/grants/application-html";
import { ifApplicableAttachmentKeys, listGrantApplicationTemplates } from "@/lib/grants/application-templates";
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
 * The first case's cover title wraps to two lines. At the old line spacing its
 * first line's word boxes overlapped the second line's by more than a point
 * ("Active" over "Program"), though the letters did not touch on the page
 * (KI-2026-11-16-074). The earlier fixture title fit one line and could not
 * show it.
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
      // The title a tracked ATP opportunity carries. At the cover's size it wraps to two lines.
      opportunity: { id: ATP_IDS.opportunity, title: "Active Transportation Program (ATP)", agency_name: null, summary: null, expected_award_amount: null, closes_at: null, opportunity_status: null, decision_state: null },
      programTitle: null, sections: [], attachments: [], generatedAt: "2026-11-16T01:31:00.000Z",
      evidenceAppendices: buildAtpEvidenceAppendices(completeAtpRecords(), new Set<string>(ATP_APPENDIX_KEYS)),
      evidenceAppendixFrame: ATP_APPENDIX_FRAME,
    });
    const file = path.join(workDir, "atp-application.pdf");
    writeFileSync(file, await renderHtmlToPdf(html, { footerLabel: "Active Transportation Program (ATP)" }));
    const list = words(file);
    // The address is printed (possibly wrapped), so the check has something to find.
    expect(list.map((w) => w.text).join("")).toContain("https://catc.ca.gov/programs/active-transportation-program");
    // The cover title did wrap, so its two lines' word boxes are under test (KI-2026-11-16-074).
    const title = list.filter((w) => w.page === 1).slice(0, 12).filter((w) => ["Active", "Transportation", "Program", "(ATP)"].includes(w.text)).slice(0, 4);
    expect(title.map((w) => w.text)).toEqual(["Active", "Transportation", "Program", "(ATP)"]);
    expect(title[2].yMin).toBeGreaterThan(title[0].yMax - 1);
    expect(overlappingWords(list)).toEqual([]);
  }, 120_000);

  it("prints an application seeded from the 2027 template: ten sections in order, 26 checklist rows, six appendices, no word over another", async () => {
    process.env.CHROME_EXECUTABLE_PATH = CHROME;
    const atp = findGrantProgramCatalogEntry("atp")!;
    const template = listGrantApplicationTemplates().find((entry) => entry.templateKey === "atp-2027")!;
    const row = { workspace_id: ATP_IDS.workspace, opportunity_id: ATP_IDS.opportunity, updated_by: null, created_at: "", updated_at: "" };
    const sections = buildCatalogSectionSeeds(atp).map((seed, index) => {
      const final = index === 0 || index === 4;
      return {
        section: {
          ...row, id: `section-${index}`, section_key: seed.section_key, title: seed.title, guidance: seed.guidance, sort_order: seed.sort_order,
          source: seed.source, suggested_evidence: seed.suggested_evidence, ai_drafting_enabled: seed.ai_drafting_enabled,
          status: final ? ("final" as const) : ("not_started" as const), final_markdown: final ? "Demonstration text, typed by an agent for a layout check." : null,
          finalized_from_draft_id: null, finalized_by: null, finalized_at: null,
        },
        provenance: { origin: final ? ("operator_authored" as const) : ("none" as const), model: null, groundedSentenceCount: null, totalSentenceCount: null, finalizedBy: final ? "Workspace owner" : null, finalizedAt: null },
      };
    });
    const attachments = buildCatalogAttachmentSeeds(atp).map((seed, index) => ({
      ...row, id: `attachment-${index}`, attachment_key: seed.attachment_key, title: seed.title, guidance: seed.guidance, required: seed.required,
      status: "missing" as const, kb_document_id: null, report_artifact_id: null, note: null, sort_order: seed.sort_order,
    }));
    const html = buildGrantApplicationHtml({
      opportunity: { id: ATP_IDS.opportunity, title: "ATP application", agency_name: null, summary: null, expected_award_amount: null, closes_at: null, opportunity_status: null, decision_state: null },
      programTitle: null, sections, attachments, generatedAt: "2026-11-16T04:00:00.000Z",
      ifApplicableAttachmentKeys: ifApplicableAttachmentKeys(template),
      evidenceAppendices: buildAtpEvidenceAppendices(completeAtpRecords(), new Set<string>(ATP_APPENDIX_KEYS)),
      evidenceAppendixFrame: ATP_APPENDIX_FRAME,
    });
    const file = path.join(workDir, "atp-2027-application.pdf");
    writeFileSync(file, await renderHtmlToPdf(html, { footerLabel: "Active Transportation Program (ATP)" }));
    const list = words(file);
    expect(overlappingWords(list)).toEqual([]);

    // Read as a planner would: the text in reading order, spaces collapsed.
    const pdftotext = path.join(POPPLER!, `pdftotext${process.platform === "win32" ? ".exe" : ""}`);
    const text = execFileSync(pdftotext, ["-layout", file, "-"]).toString().replace(/\s+/g, " ");
    const order = [
      "Part A1 to A4: Applicant and project information",
      "Part A5: Project funding",
      "Part A6: Screening criteria",
      "Part B, Question 1: Disadvantaged Communities (DAC)",
      "Part B, Question 2: Potential to Increase Walking, Biking and Rolling",
      "Part B, Question 3: Potential for Reducing the Number and/or Rate of Active Transportation User Fatalities and Injuries",
      "Part B, Question 4: Public Participation and Planning",
      "Part B, Question 5: Scope and Plan Layout Consistency",
      "Part B, Question 6: Use of California Conservation Corps (CCC) or Certified Local Community Conservation Corps (CALCC)",
      "Part B, Question 7: Performance on Past ATP Projects",
      "Attachment checklist",
    ].map((title) => text.indexOf(title));
    expect(order.every((position) => position > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    for (const letter of ["A", "B", "C", "D", "E", "F"]) expect(text.lastIndexOf(`Appendix ${letter}.`)).toBeGreaterThan(order[order.length - 1]);
    // The label wraps inside its column, so the layout text reads "Required if" and "applicable" on two lines.
    expect(text.match(/Required if /g)).toHaveLength(12);
    expect(text).toContain("DRAFT: 25 required attachment(s) outstanding");
  }, 120_000);
});
