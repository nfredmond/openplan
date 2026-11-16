// @vitest-environment node
/**
 * The third proven job's checker reads a real ATP application PDF built by
 * the product's own export code.
 *
 * proven-job-atp-application.test.ts runs the checker on text files a
 * fixture writes from the definition entry, so it cannot show that the
 * definition's strings are the ones the product prints, in an order and a
 * layout the checker can read. Here the application document is built by
 * buildGrantApplicationHtml from the 2027 template in the grants catalog and
 * the real appendix builders, printed to PDF, and read back through the
 * checker's default reader (Poppler's pdftotext). The checker must accept a
 * record whose county and tribal area journeys carry those PDFs.
 *
 * Two engines print the PDF. Chrome prints the PDF the hosted site serves;
 * that block runs only where Chrome is installed (the lane's Windows machine
 * and CI's Linux runner both have it), and the checker must accept it. The built-in writer is the export's fallback
 * when no browser engine works. It needs nothing installed, so its block
 * runs wherever Poppler is (CI's gate has it), and the checker must refuse
 * its PDF by name: a fallback PDF is not the one a planner gets.
 *
 * The evidence records are test fixtures with made-up Census ids. Nothing
 * here is a run, and no place is real.
 *
 * Blind category: the hosted site's Chrome and its font can wrap a line
 * elsewhere than this machine's. The export route's own reads are not run
 * (the route tests cover those with fakes). A city PDF is not printed here;
 * the county and the tribal area cover the two shapes the place rule and the
 * tribal sentences take. Skipped where Poppler is missing: a skipped run
 * proves nothing. Where Chrome is missing, no real PDF is accepted by any
 * test; only the document's lines are compared with the definition.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { buildGrantApplicationHtml } from "@/lib/grants/application-html";
import { ifApplicableAttachmentKeys } from "@/lib/grants/application-templates";
import { ATP_APPENDIX_FRAME, atpCoverLines, buildAtpEvidenceAppendices, type AtpEvidenceRecords } from "@/lib/grants/atp-evidence-appendices";
import { ATP_APPENDIX_KEYS } from "@/lib/grants/evidence-appendix-keys";
import { GRANT_PROGRAM_CATALOG } from "@/lib/grants/program-catalog";
import { BUILTIN_PDF_NOTICE, renderHtmlToPdf, renderReportPdf } from "@/lib/reports/pdf";
import { TRIBAL_AREA_STATE_FILE_SENTENCE } from "@/lib/safety/crash-study-area";
import { CCRS_SOURCE_ID } from "@/lib/safety/sources/ccrs";
import { pdftotextPages, validateProvenJobRecord } from "../../scripts/ops/capability-evidence.mjs";
import { pdfTextHasPhrase } from "../../scripts/lib/pdf-text-match.mjs";
import { ATP_IDS, atpCrashEvidence, atpIngestRow, atpProject, atpRun, atpRunMetrics, completeAtpRecords } from "./fixtures/grants/atp-evidence";
import { syntheticApplicationPdfText, syntheticPdfPages, SYNTHETIC_PDF_HEADER } from "./fixtures/proven-job-atp-application.mjs";

const read = (file: string) => JSON.parse(readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8"));
const EXAMPLE = read("../../../schemas/examples/proven_job_record.v1.atp-application.synthetic.json");
const DEFINITIONS = read("../../../schemas/proven_job_definitions.v1.json");

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- a record under test is deliberately untyped JSON
type Json = any;
const JOB: Json = DEFINITIONS.jobs.find((job: Json) => job.id === "california-atp-application-in-three-places");
const RULE = JOB.application;
const ATP = GRANT_PROGRAM_CATALOG.find((entry) => entry.key === "atp")!;
const GENERATED_AT = "2026-11-20T10:40:00.000Z";

/** The application document the product builds for one journey of the example record. */
function applicationHtml(entry: Json, filler = 0): string {
  const tribalArea = entry.place.kind === "aiannh";
  const studyArea = (atpIngestRow().dimension_coverage as { study_area: Record<string, unknown> }).study_area;
  const base = completeAtpRecords();
  const records: AtpEvidenceRecords = {
    ...base,
    project: {
      status: "ready",
      project: atpProject({ name: entry.projectName, place_source: "tigerweb", place_kind: entry.place.kind, place_ref: entry.place.geoid, place_label: entry.place.label }),
    },
    run: {
      status: "ready",
      run: atpRun({
        metrics: atpRunMetrics({
          sourceSnapshots: {
            crashes: { label: "California Crash Reporting System (CCRS)", yearsQueried: [2022, 2023, 2024, 2025], fetchedAt: "2026-11-20T10:20:00.000Z" },
            census: { dataset: "ACS 5-Year", vintage: 2023, tractCount: 0 },
          },
        }),
      }),
    },
    crash: {
      status: "ready",
      retrievedAt: "2026-11-20T10:10:00+00:00",
      evidence: atpCrashEvidence(
        tribalArea ? { dimension_coverage: { study_area: { ...studyArea, tribalArea: { censusStateFips: ["06"], stateFileUsed: true } } } } : {},
      ),
    },
    generatedAt: GENERATED_AT,
  };
  const row = { workspace_id: ATP_IDS.workspace, opportunity_id: ATP_IDS.opportunity, updated_by: null, created_at: "", updated_at: "" };
  const text = (disposition: string) =>
    `${RULE.demonstrationLabel.text}. This text describes no real project and makes no claim about any agency, place or community.${disposition === "fixed-note" ? ` ${RULE.sections.fixedNote}` : " An agency would write its own answer here."}`;
  return buildGrantApplicationHtml({
    opportunity: {
      id: ATP_IDS.opportunity, title: ATP.name, agency_name: ATP.administeringAgency, summary: ATP.summary,
      expected_award_amount: null, closes_at: null, opportunity_status: null, decision_state: null,
    },
    programTitle: null,
    sections: ATP.applicationSections!.map((section, index) => ({
      section: {
        ...row, id: `section-${index}`, section_key: section.key, title: section.title, guidance: null, sort_order: index,
        source: "catalog", suggested_evidence: [], ai_drafting_enabled: false, status: "final",
        // Review 78's recipe: more text in the third section moves every later title down the page.
        final_markdown: text(RULE.sections.list[index].disposition) + (index === 2 ? " Filler sentence for layout only.".repeat(filler) : ""), finalized_from_draft_id: null, finalized_by: null, finalized_at: null,
      },
      provenance: { origin: "operator_authored", model: null, groundedSentenceCount: null, totalSentenceCount: null, finalizedBy: "Workspace owner", finalizedAt: GENERATED_AT },
    })),
    attachments: ATP.requiredAttachments!.map((attachment, index) => {
      const recorded = entry.application.rows[index];
      return {
        ...row, id: `attachment-${index}`, attachment_key: attachment.key, title: attachment.title, guidance: null, required: attachment.required,
        status: recorded.disposition === "not-applicable" ? ("not_applicable" as const) : ("missing" as const),
        kb_document_id: null, report_artifact_id: null, note: recorded.reason ?? null, sort_order: index,
      };
    }),
    generatedAt: GENERATED_AT,
    evidenceAppendices: buildAtpEvidenceAppendices(records, new Set<string>(ATP_APPENDIX_KEYS)),
    evidenceAppendixFrame: ATP_APPENDIX_FRAME,
    coverLines: atpCoverLines(records.project),
    applicant: { project: { status: "named", name: entry.projectName }, workspace: { status: "named", name: entry.workspaceName } },
    ifApplicableAttachmentKeys: ifApplicableAttachmentKeys({ requiredAttachments: ATP.requiredAttachments! }),
    attachmentDocumentTitles: new Map(),
  });
}

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

const root = mkdtempSync(path.join(tmpdir(), "openplan-proven-atp-real-"));
// Set OPENPLAN_KEEP_ATP_PDFS=1 to keep the printed PDFs and read them by hand; the folder is then named in the output.
afterAll(() => {
  if (process.env.OPENPLAN_KEEP_ATP_PDFS) console.info(`ATP application PDFs kept in ${root}`);
  else rmSync(root, { recursive: true, force: true });
});

/** Real PDFs go to Poppler through the checker's own reader; the example's synthetic files to the stand-in. */
function readPages(file: string): string[] {
  const bytes = readFileSync(file);
  return bytes.subarray(0, SYNTHETIC_PDF_HEADER.length).toString("latin1") === SYNTHETIC_PDF_HEADER ? syntheticPdfPages(bytes.toString("utf8")) : pdftotextPages(file);
}

type Engine = "builtin" | "chrome";
async function printPdf(html: string, engine: Engine): Promise<Uint8Array> {
  if (engine === "chrome") {
    process.env.CHROME_EXECUTABLE_PATH = CHROME;
    return renderHtmlToPdf(html, { footerLabel: ATP.name });
  }
  // No browser engine at this path: the product falls back to its built-in writer.
  process.env.CHROME_EXECUTABLE_PATH = path.join(root, "no-browser-here");
  const result = await renderReportPdf(html, { title: ATP.name, generatedAt: GENERATED_AT, footerLabel: ATP.name });
  expect(result.engine).toBe("builtin");
  return result.bytes;
}

/** The example record with the named journeys' PDFs printed by the product, and their crash facts from the fixture. */
async function recordWithRealPdfs(engine: Engine, roles: string[], filler = 0): Promise<Json> {
  const record = structuredClone(EXAMPLE);
  for (const entry of record.journeys) {
    const pdf = entry.pdfs[0];
    if (!roles.includes(entry.role)) {
      mkdirSync(path.dirname(path.join(root, pdf.path)), { recursive: true });
      writeFileSync(path.join(root, pdf.path), syntheticApplicationPdfText(entry, JOB));
      continue;
    }
    // What the fixture's acquisition holds: 80 crashes reported and stored, 2022 to 2025.
    entry.crashes = { sourceId: "ccrs-ca", years: "2022–2025", reportedCount: 80, storedCount: 80 };
    const bytes = await printPdf(applicationHtml(entry, filler), engine);
    pdf.path = `real/${engine}-${entry.role}-${filler}-atp-application.pdf`;
    mkdirSync(path.dirname(path.join(root, pdf.path)), { recursive: true });
    writeFileSync(path.join(root, pdf.path), bytes);
    pdf.sha256 = createHash("sha256").update(bytes).digest("hex");
    pdf.bytes = bytes.length;
    const pages = pdftotextPages(path.join(root, pdf.path));
    pdf.pages = pages.length;
    const headings = JOB.itemHeadings["atp-application"];
    pdf.items = Object.keys(JOB.items).map((item) => ({
      item, method: "pdftotext", text: headings[item],
      page: pages.findIndex((page) => page.split(/\r?\n/).some((line) => line.trim() === headings[item])) + 1,
    }));
  }
  return record;
}
const journey = (record: Json, role: string) => record.journeys.find((entry: Json) => entry.role === role);
const check = (record: Json) => validateProvenJobRecord(record, { repoRoot: root, readPdfPages: readPages });

const CHROME_AND_POPPLER = POPPLER && Boolean(CHROME);

describe("the definition's sentences are the product's", () => {
  it("names the missing-reports sentence the crash appendix prints", () => {
    expect(RULE.appendices.roleFacts[0].phrase).toBe(TRIBAL_AREA_STATE_FILE_SENTENCE);
  });

  it("asks for the crash source id the product gives California's crash file (KI-2026-11-16-100)", () => {
    // The definition first said "ccrs". The product's id is "ccrs-ca", so no honest run could pass:
    // the first local rehearsal of the journey found it.
    const rule = JOB.journeyFields.find((field: Json) => field.field === "crashes.sourceId");
    expect(rule.equals).toBe(CCRS_SOURCE_ID);
    for (const entry of EXAMPLE.journeys) expect(entry.crashes.sourceId).toBe(CCRS_SOURCE_ID);
  });

  it("names the opening words of the fallback writer's notice", () => {
    expect(BUILTIN_PDF_NOTICE.startsWith(RULE.fallbackWriter.notice)).toBe(true);
  });

  it("uses the demonstration label the journeys use", () => {
    const lib = readFileSync(fileURLToPath(new URL("../../../qa-harness/journey-campaign-lib.js", import.meta.url)), "utf8");
    expect(lib).toContain(`const DEMONSTRATION_LABEL = '${RULE.demonstrationLabel.text}';`);
  });

  it("names each place kind in the product's own words, so an honest city PDF is not refused (review 79)", () => {
    // The definition said "city" where the product prints "city or town", and every honest city PDF
    // was refused. Nobody had printed a city PDF before. The line the definition builds for each
    // journey must be in the document the product builds for it.
    for (const role of ["county", "city", "tribal-area"]) {
      const entry = journey(EXAMPLE, role);
      const line = RULE.placeLine.template
        .replace("{label}", entry.place.label)
        .replace("{kind}", RULE.placeLine.kindWords[entry.place.kind])
        .replace("{geoid}", entry.place.geoid);
      expect(applicationHtml(entry), role).toContain(line);
    }
    expect(RULE.placeLine.kindWords.city).toBe("city or town");
  });

  it("tells the browser to keep a section title whole on one page", () => {
    expect(applicationHtml(journey(EXAMPLE, "county"))).toMatch(/\.section-title \{[^}]*break-inside: avoid;[^}]*\}/);
  });

  it("prints every line the checker reads in the document the product builds, for a county, a city and a tribal area", () => {
    const county = applicationHtml(journey(EXAMPLE, "county"));
    const city = applicationHtml(journey(EXAMPLE, "city"));
    const tribal = applicationHtml(journey(EXAMPLE, "tribal-area"));
    for (const html of [county, city, tribal]) {
      expect(html).toContain("DRAFT: 15 required attachment(s) outstanding");
      expect(html).toContain(RULE.applicant.line);
      for (const section of RULE.sections.list) expect(html).toContain(section.title.replace(/&/g, "&amp;"));
      for (const heading of Object.values<string>(JOB.itemHeadings["atp-application"])) expect(html).toContain(heading);
      expect(html).not.toContain("Not finalized");
    }
    const sentence = TRIBAL_AREA_STATE_FILE_SENTENCE.replace(/'/g, "&#39;");
    expect(tribal).toContain(sentence);
    expect(county).not.toContain(sentence);
    expect(city).not.toContain(sentence);
  });
});

describe.runIf(POPPLER)("the checker on a real ATP application PDF typeset by the export's fallback writer", () => {
  it("refuses the record, because that PDF is not the one a planner gets", async () => {
    const record = await recordWithRealPdfs("builtin", ["county"]);
    const pdf = journey(record, "county").pdfs[0];
    expect(readFileSync(path.join(root, pdf.path)).subarray(0, 5).toString("latin1")).toBe("%PDF-");
    // Poppler reads the product's lines from it: the place line and the stamp are there.
    const pages = pdftotextPages(path.join(root, pdf.path));
    expect(pages[0]).toContain("Study place: Synthetic County, CA (county, GEOID 06998)");
    expect(pages[0]).toContain("DRAFT: 15 required attachment(s) outstanding");
    expect(() => check(record)).toThrow(/proven job record refused: county journey atp-application PDF was typeset by OpenPlan's built-in writer, not the browser engine/);
  }, 120_000);
});

describe.runIf(CHROME_AND_POPPLER)("the checker on a real ATP application PDF printed by the browser engine", () => {
  const engine: Engine = "chrome";
  it("accepts a record whose county, city and tribal area PDFs the product printed", async () => {
    const record = await recordWithRealPdfs(engine, ["county", "city", "tribal-area"]);
    for (const role of ["county", "city", "tribal-area"]) {
      const pdf = journey(record, role).pdfs[0];
      expect(readFileSync(path.join(root, pdf.path)).subarray(0, 5).toString("latin1")).toBe("%PDF-");
      expect(pdf.items.every((item: Json) => item.page > 0), `every appendix heading is a line of its own in the ${role} PDF`).toBe(true);
    }
    expect(() => check(record)).not.toThrow();
  }, 120_000);

  it("keeps every section title whole on one page, and is accepted, when more text moves the titles down the page (review 78)", async () => {
    // With 33 more sentences in Part A6 the three-line title of Question 3 split across two pages on
    // Windows fonts, and the checker refused an honest record. The export now keeps a title whole, and
    // the checker reads across a page break. Where a title falls depends on the machine's fonts, so
    // several lengths are printed and nothing here assumes which one would have split.
    for (const filler of [30, 33, 36]) {
      const record = await recordWithRealPdfs(engine, ["county"], filler);
      const pages = pdftotextPages(path.join(root, journey(record, "county").pdfs[0].path));
      for (const section of RULE.sections.list) {
        expect(pages.some((page) => pdfTextHasPhrase(page, section.title)), `"${section.title}" whole on one page with ${filler} more sentences`).toBe(true);
      }
      expect(() => check(record), `${filler} more sentences`).not.toThrow();
    }
  }, 240_000);

  it("refuses the same PDFs under a record that names another place, another count or the other journey's file", async () => {
    const record = await recordWithRealPdfs(engine, ["county", "tribal-area"]);

    const place = structuredClone(record);
    journey(place, "county").place.geoid = "06997";
    expect(() => check(place)).toThrow(/proven job record refused: county journey atp-application PDF cover does not state "Study place: Synthetic County, CA \(county, GEOID 06997\)"/);

    const count = structuredClone(record);
    journey(count, "county").crashes.reportedCount = 81;
    expect(() => check(count)).toThrow(/proven job record refused: county journey atp-application PDF "Appendix B\. Crash summary" does not state "Crashes reported: 81" as a line of its own/);

    // The record says 8 and the PDF prints 80: a count is not found inside a longer number (review 78).
    const prefix = structuredClone(record);
    Object.assign(journey(prefix, "county").crashes, { reportedCount: 8, storedCount: 8 });
    expect(() => check(prefix)).toThrow(/does not state "Crashes reported: 8" as a line of its own/);

    const rows = structuredClone(record);
    Object.assign(journey(rows, "county").application.rows[0], { disposition: "outstanding" });
    delete journey(rows, "county").application.rows[0].reason;
    journey(rows, "county").application.outstandingRequiredCount = 16;
    expect(() => check(rows)).toThrow(/proven job record refused: county journey atp-application PDF carries a DRAFT line that is not the stamp the record's rows give \("DRAFT: 16 required attachment\(s\) outstanding"\)/);

    // The county's printed PDF under the tribal area journey: its place line names the county.
    const swapped = structuredClone(record);
    const countyPdf = journey(swapped, "county").pdfs[0];
    const tribalPdf = journey(swapped, "tribal-area").pdfs[0];
    journey(swapped, "county").pdfs[0] = tribalPdf;
    journey(swapped, "tribal-area").pdfs[0] = countyPdf;
    expect(() => check(swapped)).toThrow(/proven job record refused: county journey atp-application PDF cover does not (print|state)/);
  }, 120_000);
});
