// @vitest-environment node
/**
 * The third proven job's checker still accepts a real ATP application PDF
 * whose corridor analysis run retrieved Census tract data.
 *
 * proven-job-atp-application-real-pdf.test.ts prints PDFs for a run that
 * retrieved no tract data, so Appendix E there reads "Not recorded" on each
 * count line and prints no equity score. The three recorded hosted PDFs all
 * had tract data (4, 2 and 1 tracts). Since KI-2026-11-16-111 the appendix
 * prints, for such a run, each proxy count with its total and its rule, and
 * under the score what the score adds up. Those are the longest lines in the
 * appendix and the only ones that sit beside a printed score, so they are
 * where the checker's rules could be tripped: a refused phrase, a number
 * under a label that ends in "score", a row under "Guidelines criterion,",
 * or a sentence that belongs to a run with no tract data.
 *
 * Here the document is built by the product's own code for a county with
 * four tracts and a tribal area with one, printed by Chrome, read back by
 * Poppler and given to the checker under a record that says "retrieved".
 * The same PDFs under a record that says no tract data was retrieved are
 * refused, which shows the checker read Appendix E in them.
 *
 * The evidence records are test fixtures with made-up Census ids. Nothing
 * here is a run, and no place is real. The document recipe is the one in
 * proven-job-atp-application-real-pdf.test.ts, which must not change with
 * this lane, so it is repeated here with the run's metrics as an argument.
 *
 * Blind category: the hosted site's Chrome and its font can wrap a line
 * elsewhere than this machine's or CI's. A city PDF is not printed. Skipped
 * where Chrome or Poppler is missing: a skipped run proves nothing.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { EQUITY_PROXY_THRESHOLDS } from "@/lib/data-sources/equity";
import { buildGrantApplicationHtml } from "@/lib/grants/application-html";
import { ifApplicableAttachmentKeys } from "@/lib/grants/application-templates";
import { ATP_APPENDIX_FRAME, atpCoverLines, buildAtpEvidenceAppendices, type AtpEvidenceRecords } from "@/lib/grants/atp-evidence-appendices";
import { ATP_APPENDIX_KEYS } from "@/lib/grants/evidence-appendix-keys";
import { GRANT_PROGRAM_CATALOG } from "@/lib/grants/program-catalog";
import { renderHtmlToPdf } from "@/lib/reports/pdf";
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

/** What each printed journey's run retrieved: tracts, tracts flagged, low-income tracts and the equity score. */
const TRACTS: Record<string, { tracts: number; flagged: number; lowIncome: number; score: number }> = {
  county: { tracts: 4, flagged: 1, lowIncome: 2, score: 15 },
  "tribal-area": { tracts: 1, flagged: 0, lowIncome: 0, score: 0 },
};

/** The application document the product builds for one journey, for a run that retrieved tract data. */
function applicationHtml(entry: Json): string {
  const tribalArea = entry.place.kind === "aiannh";
  const studyArea = (atpIngestRow().dimension_coverage as { study_area: Record<string, unknown> }).study_area;
  const found = TRACTS[entry.role];
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
          equityScore: found.score,
          scorePresentation: {
            safety: { value: 60, eligible: true, withheldReason: null },
            equity: { value: found.score, eligible: true, withheldReason: null },
          },
          dataQuality: { censusAvailable: true, crashDataAvailable: true, crashDataComplete: true },
          tractCount: found.tracts,
          disadvantagedTracts: found.flagged,
          lowIncomeTracts: found.lowIncome,
          sourceSnapshots: {
            crashes: { label: "California Crash Reporting System (CCRS)", yearsQueried: [2022, 2023, 2024, 2025], fetchedAt: "2026-11-20T10:20:00.000Z" },
            census: { dataset: "ACS 5-Year", vintage: 2023, tractCount: found.tracts, clipScale: "corridor" },
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
        final_markdown: text(RULE.sections.list[index].disposition), finalized_from_draft_id: null, finalized_by: null, finalized_at: null,
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

const root = mkdtempSync(path.join(tmpdir(), "openplan-proven-atp-tracts-"));
// Set OPENPLAN_KEEP_ATP_PDFS=1 to keep the printed PDFs and read them by hand; the folder is then named in the output.
afterAll(() => {
  if (process.env.OPENPLAN_KEEP_ATP_PDFS) console.info(`ATP application PDFs with tract data kept in ${root}`);
  else rmSync(root, { recursive: true, force: true });
});

/** Real PDFs go to Poppler through the checker's own reader; the example's synthetic files to the stand-in. */
function readPages(file: string): string[] {
  const bytes = readFileSync(file);
  return bytes.subarray(0, SYNTHETIC_PDF_HEADER.length).toString("latin1") === SYNTHETIC_PDF_HEADER ? syntheticPdfPages(bytes.toString("utf8")) : pdftotextPages(file);
}

/** The example record with the county's and the tribal area's PDFs printed by Chrome for runs that retrieved tract data. */
async function recordWithTractData(): Promise<Json> {
  const record = structuredClone(EXAMPLE);
  process.env.CHROME_EXECUTABLE_PATH = CHROME;
  for (const entry of record.journeys) {
    const pdf = entry.pdfs[0];
    if (!Object.hasOwn(TRACTS, entry.role)) {
      mkdirSync(path.dirname(path.join(root, pdf.path)), { recursive: true });
      writeFileSync(path.join(root, pdf.path), syntheticApplicationPdfText(entry, JOB));
      continue;
    }
    entry.crashes = { sourceId: "ccrs-ca", years: "2022–2025", reportedCount: 80, storedCount: 80 };
    entry.application.tractData = "retrieved";
    const bytes = await renderHtmlToPdf(applicationHtml(entry), { footerLabel: ATP.name });
    pdf.path = `real/chrome-${entry.role}-tract-data-atp-application.pdf`;
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
const pdfText = (record: Json, role: string) => pdftotextPages(path.join(root, journey(record, role).pdfs[0].path)).join("\n");

describe.runIf(POPPLER && Boolean(CHROME))("the checker on a real ATP application PDF whose run retrieved tract data", () => {
  it("accepts the county's and the tribal area's PDFs, and refuses them under a record that says no tract data was retrieved", async () => {
    const record = await recordWithTractData();
    const line = `$${EQUITY_PROXY_THRESHOLDS.lowIncomeMedian.toLocaleString("en-US")}`;

    // The new lines are in the PDFs Poppler reads, so the checker read them too.
    const tribal = pdfText(record, "tribal-area");
    expect(pdfTextHasPhrase(tribal, "Demographic source: ACS 5-Year 2023, 1 tract, clipped to the corridor")).toBe(true);
    expect(pdfTextHasPhrase(tribal, "Tracts the ACS income and burden proxy flags: 0 of 1 tract. The proxy flags a tract when")).toBe(true);
    expect(pdfTextHasPhrase(tribal, `Low-income tracts (ACS proxy): 0 of 1 tract. A tract counts as low-income here when the ACS reports a median household income for it below ${line}.`)).toBe(true);
    expect(pdfTextHasPhrase(tribal, "Equity screening score (OpenPlan, not a CTC score): 0.0")).toBe(true);
    expect(pdfTextHasPhrase(tribal, "A low score means few tracts met those fixed lines. It is not a finding that no disadvantaged community is present.")).toBe(true);
    expect(tribal).not.toMatch(/\b1 tracts\b/);
    const county = pdfText(record, "county");
    expect(pdfTextHasPhrase(county, "Demographic source: ACS 5-Year 2023, 4 tracts, clipped to the corridor")).toBe(true);
    expect(pdfTextHasPhrase(county, "Tracts the ACS income and burden proxy flags: 1 of 4 tracts.")).toBe(true);
    expect(pdfTextHasPhrase(county, "Low-income tracts (ACS proxy): 2 of 4 tracts.")).toBe(true);
    expect(pdfTextHasPhrase(county, "Equity screening score (OpenPlan, not a CTC score): 15.0")).toBe(true);

    expect(() => check(record)).not.toThrow();

    // The check can fail on these PDFs: the same files under a record that says its run retrieved none.
    const none = structuredClone(record);
    journey(none, "tribal-area").application.tractData = "none-retrieved";
    expect(() => check(none)).toThrow(/proven job record refused: tribal-area journey atp-application PDF "Appendix E\. Disadvantaged-community and equity inputs" does not say "no tract data was retrieved for this run", but the record says its run retrieved no tract data/);
  }, 180_000);
});
