/**
 * A FRESHLY SEEDED SS4A EXPORT PRINTS DATES AND SEVERITY COVERAGE IN PLAIN
 * WORDS, AND ENDS ON ITS LAST PAGE OF TEXT (KI-2026-11-14-116, first full
 * journey, run 9; verification 18).
 *
 * Run 9 exported an SS4A application seeded from a Safety report minutes
 * earlier. Each section repeated the seed header "Retrieved:
 * 2026-11-14T05:52:05.469213+00:00. Artifact generated:
 * 2026-11-14T05:53:50.306Z.", and Appendix B printed its recorded severity
 * coverage as the code `kabco_full`. A planner reads both in a document that
 * goes to a funder. Verification 18 found the same export ending on a blank
 * page.
 *
 * Where each string comes from:
 *  - the seed header is written once into section text when the seed is
 *    applied. A new seed now writes plain dates; sections seeded earlier keep
 *    the stamps they were written with, because stored text is the record.
 *  - the snapshot it reads is hashed and is not changed: only the wording the
 *    seed derives from it is.
 *  - Appendix B is computed when the export is built, so every export now
 *    leaves the code out; its "Severity coverage" row already states the same
 *    recorded value as the product's sentence.
 *  - the blank page was bottom spacing with no text in it: the screen
 *    layout's 80 px under the document, and the last box's own padding and
 *    margin. When the text ended close to a page end, that spacing spilled
 *    onto a new page. Print drops it.
 *
 * Blind category: section text a planner typed with an ISO stamp in it (their
 * own words, printed as written); sections seeded before this change (stored
 * text, kept); the Safety report packet's own layout; Linux Chrome and the
 * hosted bundle. The PDF block is skipped where Chrome or poppler is missing,
 * so CI checks the HTML only.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ApplicationSectionRow } from "@/lib/grants/application";
import { buildGrantApplicationHtml, type GrantApplicationExportSection } from "@/lib/grants/application-html";
import { SS4A_APPENDIX_KEYS } from "@/lib/grants/ss4a-appendix-keys";
import { buildSs4aEvidenceAppendices } from "@/lib/grants/ss4a-evidence-appendices";
import { SAFETY_SEED_CAVEAT } from "@/lib/grants/safety-seed-origin";
import { buildSs4aSafetyDrafts } from "@/lib/grants/ss4a-safety-seed";
import { renderHtmlToPdf } from "@/lib/reports/pdf";
import { completeEvidenceRecords, EVIDENCE_IDS, evidenceSnapshot } from "./fixtures/grants/ss4a-evidence";

/** An ISO 8601 date and time as stored, the shape run 9 printed. */
const ISO_STAMP = /\d{4}-\d{2}-\d{2}T\d{2}:/;
/** The stored severity coverage codes, printed bare. */
const COVERAGE_CODE = /\b(kabco_full|fatal_injury_only|fatal_only)\b/;

/** Run 9's acquisition stamp: microseconds and an offset, as Postgres returns it. */
const RETRIEVED_AT = "2026-11-14T05:52:05.469213+00:00";

/**
 * A CCRS acquisition with serious injuries joined (`kabco_full`), seeded into
 * all six sections and finalized unedited, as run 9 did.
 */
function seededPacket(): string {
  const snapshot = evidenceSnapshot({
    source_id: "ccrs-ca", source_label: "California Crash Reporting System (CCRS)",
    severity_completeness: "kabco_full", created_at: RETRIEVED_AT,
  });
  const drafts = buildSs4aSafetyDrafts(snapshot, "Example safety project");
  const sections: GrantApplicationExportSection[] = drafts.map((draft, index) => {
    const row: ApplicationSectionRow = {
      id: `00000000-0000-4000-8000-0000000001${String(index).padStart(2, "0")}`, workspace_id: EVIDENCE_IDS.workspace,
      opportunity_id: EVIDENCE_IDS.opportunity, section_key: draft.section_key, title: draft.section_key, guidance: null, sort_order: index,
      source: "catalog", suggested_evidence: [], ai_drafting_enabled: true, status: "final", final_markdown: draft.draft_markdown,
      finalized_from_draft_id: null, finalized_by: null, finalized_at: null, updated_by: null,
      created_at: "2026-11-14T00:00:00.000Z", updated_at: "2026-11-14T05:54:00.000Z",
    };
    return { section: row, provenance: { origin: "safety_seed_unedited", safetySeed: draft.provenance, model: null, groundedSentenceCount: null,
      totalSentenceCount: null, finalizedBy: null, finalizedAt: null } };
  });
  const records = completeEvidenceRecords();
  records.safety = { status: "ready", snapshot, otherSeededArtifactCount: 0 };
  return buildGrantApplicationHtml({
    opportunity: { id: EVIDENCE_IDS.opportunity, title: "SS4A application", agency_name: "U.S. Department of Transportation", summary: null,
      expected_award_amount: null, closes_at: null, opportunity_status: null, decision_state: null },
    programTitle: null, sections, attachments: [], generatedAt: "2026-11-14T06:00:00.000Z",
    evidenceAppendices: buildSs4aEvidenceAppendices(records, new Set(SS4A_APPENDIX_KEYS)),
    safetySeedHistory: [drafts[0].provenance],
  });
}

/** Visible text with whitespace collapsed and a hyphen rejoined to a word the line wrapped. */
function readable(text: string): string {
  return text.replace(/\s+/g, " ").replace(/- (?=\d)/g, "-");
}

function visibleText(html: string): string {
  return readable(html.replace(/<style[\s\S]*?<\/style>|<svg[\s\S]*?<\/svg>/g, " ").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&"));
}

describe("the patterns can fail", () => {
  it("match what run 9 printed, including a stamp the PDF wrapped at its hyphen", () => {
    expect(readable("Retrieved: 2026-11-\n14T05:52:05.469213+00:00.")).toMatch(ISO_STAMP);
    expect("Artifact generated: 2026-11-14T05:53:50.306Z.").toMatch(ISO_STAMP);
    expect("Recorded severity coverage kabco_full Years requested").toMatch(COVERAGE_CODE);
    expect("Retrieved: Nov 14, 2026, 05:52 UTC.").not.toMatch(ISO_STAMP);
    expect("Fatal crashes only.").not.toMatch(COVERAGE_CODE);
  });
});

describe("a freshly seeded SS4A export", () => {
  it("prints the acquisition and artifact dates in words, in UTC, in every seeded section", () => {
    const text = visibleText(seededPacket());
    expect(text.match(ISO_STAMP)?.[0] ?? null).toBeNull();
    // Six seeded sections, each with the header's two dates.
    expect(text.match(/Retrieved: Nov 14, 2026, 05:52 UTC\. Artifact generated: Oct 18, 2026, 12:00 UTC\./g)).toHaveLength(6);
  });

  it("prints no bare severity coverage code, and still states the coverage", () => {
    const text = visibleText(seededPacket());
    expect(text.match(COVERAGE_CODE)?.[0] ?? null).toBeNull();
    expect(text).toContain("injured-person records, joined to each crash");
  });
});

// ---------------------------------------------------------------------------
// The same export as a PDF, read back with poppler.
// ---------------------------------------------------------------------------

const CHROME = [process.env.CHROME_EXECUTABLE_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "/usr/bin/google-chrome", "/usr/bin/chromium"]
  .find((candidate): candidate is string => Boolean(candidate && existsSync(candidate)));
/** Poppler's folder: the one that holds pdftotext and pdfinfo (xpdf's pdftotext can come first on PATH). */
function popplerDir(): string | null {
  const exe = process.platform === "win32" ? ".exe" : "";
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    if (dir && ["pdftotext", "pdfinfo"].every((name) => existsSync(path.join(dir, `${name}${exe}`)))) return dir;
  }
  return null;
}
const POPPLER = popplerDir();
const PDF_TOOLS = Boolean(CHROME) && POPPLER !== null;
const workDir = PDF_TOOLS ? mkdtempSync(path.join(tmpdir(), "openplan-ss4a-plain-")) : "";
afterAll(() => {
  if (workDir) rmSync(workDir, { recursive: true, force: true });
});

const FOOTER = "Safe Streets and Roads for All (SS4A)";

/** Each page's text, with the footer the renderer adds removed. */
async function pdfPages(name: string, html: string): Promise<string[]> {
  process.env.CHROME_EXECUTABLE_PATH = CHROME;
  const file = path.join(workDir, `${name}.pdf`);
  writeFileSync(file, await renderHtmlToPdf(html, { footerLabel: FOOTER }));
  const exe = process.platform === "win32" ? ".exe" : "";
  const info = execFileSync(path.join(POPPLER!, `pdfinfo${exe}`), [file]).toString();
  const pages = Number(/Pages:\s+(\d+)/.exec(info)![1]);
  return Array.from({ length: pages }, (_, index) =>
    readable(execFileSync(path.join(POPPLER!, `pdftotext${exe}`), ["-f", String(index + 1), "-l", String(index + 1), file, "-"]).toString())
      .replace(/Safe Streets and Roads for All \(SS4A\)\s*\S\s*Page \d+ of \d+/, "").trim());
}

/**
 * A one-section packet that ends, as run 9's did, on the Safety seed sources
 * list, here `items` one-line qualifications long. The list splits across
 * pages line by line, so its end can land anywhere on a page.
 */
function packetEndingOnList(items: number): string {
  const row: ApplicationSectionRow = {
    id: "00000000-0000-4000-8000-000000000199", workspace_id: EVIDENCE_IDS.workspace, opportunity_id: EVIDENCE_IDS.opportunity,
    section_key: "project-overview", title: "Project overview", guidance: null, sort_order: 0, source: "catalog", suggested_evidence: [],
    ai_drafting_enabled: true, status: "final", final_markdown: "Project overview text.",
    finalized_from_draft_id: null, finalized_by: null, finalized_at: null, updated_by: null,
    created_at: "2026-11-14T00:00:00.000Z", updated_at: "2026-11-14T05:54:00.000Z",
  };
  return buildGrantApplicationHtml({
    opportunity: { id: EVIDENCE_IDS.opportunity, title: "SS4A application", agency_name: null, summary: null,
      expected_award_amount: null, closes_at: null, opportunity_status: null, decision_state: null },
    programTitle: null, attachments: [], generatedAt: "2026-11-14T06:00:00.000Z",
    sections: [{ section: row, provenance: { origin: "operator_authored", model: null, groundedSentenceCount: null, totalSentenceCount: null, finalizedBy: null, finalizedAt: null } }],
    safetySeedHistory: [{ kind: "openplan.ss4a-safety-seed.v1", artifactId: EVIDENCE_IDS.artifact, reportId: EVIDENCE_IDS.report,
      acquisitionId: EVIDENCE_IDS.ingest, snapshotHash: "0".repeat(64), caveat: SAFETY_SEED_CAVEAT,
      sourceCaveats: Array.from({ length: items }, (_, n) => `Qualification ${n + 1}.`) }],
  });
}

describe.runIf(PDF_TOOLS)("the SS4A export as a PDF, read back with pdftotext", () => {
  it("holds no ISO stamp and no bare coverage code on any page", async () => {
    const text = (await pdfPages("ss4a-seeded", seededPacket())).join(" ");
    expect(text.match(ISO_STAMP)?.[0] ?? null).toBeNull();
    expect(text.match(COVERAGE_CODE)?.[0] ?? null).toBeNull();
    expect(text).toContain("Retrieved: Nov 14, 2026, 05:52 UTC");
  }, 120_000);

  // One list item moves the end of the text about 19 px, less than the
  // spacing that spilled, so 40 lengths spanning more than a page must land in
  // that window. On the base commit 70 to 75 items printed a blank fourth
  // page; with only the 80 px removed, 74 and 75 still did.
  it("ends on the last page that holds text, at every list length across more than a page", async () => {
    const trailingBlank: number[] = [];
    for (let items = 60; items < 100; items += 1) {
      const pages = await pdfPages(`ss4a-list-${items}`, packetEndingOnList(items));
      if (pages[pages.length - 1] === "") trailingBlank.push(items);
    }
    expect(trailingBlank).toEqual([]);
  }, 600_000);
});
