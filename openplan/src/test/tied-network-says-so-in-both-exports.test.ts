/**
 * AN ALL-TIED NETWORK SAYS SO IN BOTH EXPORTS, IN THE PAGE'S WORDS (D20).
 *
 * The Safety page prints one line when every listed row shares a rank. The
 * report's safety action plan section and SS4A Appendix A print the same
 * line, from the same helper, beside the numbered map. No tie-breaker is
 * invented: each tied row keeps the shared rank in the table, and the map
 * marks each one with its row number, which is not a rank (KI-2026-11-14-304).
 *
 * The last block renders both documents to PDF with Chrome and reads them
 * back with poppler. Blind category: the hosted Chrome bundle, and how the
 * line wraps on a phone-width reader; the PDF block is skipped where Chrome
 * or poppler is not installed.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { buildGrantApplicationHtml } from "@/lib/grants/application-html";
import { SS4A_APPENDIX_KEYS } from "@/lib/grants/ss4a-appendix-keys";
import { buildSs4aEvidenceAppendices } from "@/lib/grants/ss4a-evidence-appendices";
import { buildReportHtml, safetyActionPlanMarkup, type ReportGenerationData } from "@/lib/reports/html";
import { renderHtmlToPdf } from "@/lib/reports/pdf";
import { buildSafetyActionPlanSection } from "@/lib/reports/safety-action-plan";
import { buildSafetyPlanSnapshot } from "@/lib/reports/safety-plan-snapshot";
import { buildSafetyPlanNetworkMap, buildSafetyPlanSupport } from "@/lib/reports/safety-plan-support";
import { buildSafetyCrashEvidence } from "@/lib/safety/crash-evidence";
import { computeHighInjuryNetwork, type HighInjuryNetwork, type HighInjuryNetworkCrash } from "@/lib/safety/high-injury-network";
import { buildProjectStageGateSnapshot, buildProjectStageGateSummary } from "@/lib/stage-gates/summary";
import { completeEvidenceRecords, EVIDENCE_DATE, EVIDENCE_IDS, evidenceAcquisition, STUDY_AREA } from "./fixtures/grants/ss4a-evidence";
import { seedId } from "./fixtures/grants/safety-seed";

const TIE_LINE = "All 3 listed squares are tied at rank 1, so this list is not a ranking.";

/** Three fatal crashes far apart and no stored road lines: three tied squares. */
const CRASHES: HighInjuryNetworkCrash[] = [
  { id: seedId(401), longitude: -100.03, latitude: 39.97, severity: "fatal" },
  { id: seedId(402), longitude: -100.0, latitude: 40.0, severity: "fatal" },
  { id: seedId(403), longitude: -99.97, latitude: 40.03, severity: "fatal" },
];

function tiedNetwork() {
  const network = computeHighInjuryNetwork({ crashes: CRASHES, crashesConsidered: 3, basis: "fatal_only", roads: [], years: [2023, 2024] });
  if (network.status !== "computed") throw new Error("fixture network did not compute");
  return network as Extract<HighInjuryNetwork, { status: "computed" }>;
}

function evidence() {
  return buildSafetyCrashEvidence({
    id: EVIDENCE_IDS.ingest, projectId: EVIDENCE_IDS.project, status: "ready", severityCompleteness: "fatal_only",
    sourceLabel: "NHTSA Fatality Analysis Reporting System (FARS)", attribution: null, crashCount: 3, geocodedCount: 3, storedCount: 3, truncated: false,
    yearsRequested: [2023, 2024], createdAt: EVIDENCE_DATE, dimensionCoverage: null, partyCompleteness: "not_supported", partyCount: null, involvementBasis: null,
  }, { severity: { fatal: 3, severe_injury: 0, injury: 0, pdo: 0, unknown: 0 }, role: null });
}

function planSection() {
  const network = tiedNetwork();
  const plan = { ingestId: EVIDENCE_IDS.ingest, attachments: [{ segmentId: network.segments[0].id, segmentLabel: network.segments[0].label, countermeasureIds: ["walkways"] }] };
  const draft = buildSafetyActionPlanSection({ plan, evidence: evidence(), network });
  const support = buildSafetyPlanSupport({
    reads: { engagement: { status: "absent" }, bca: { status: "absent" } }, projectId: EVIDENCE_IDS.project, projectName: "Example safety project",
    networkMap: buildSafetyPlanNetworkMap({ network, roads: [], projectGeometry: STUDY_AREA }),
  });
  return { plan, draft, support };
}

function ss4aRecords() {
  const { plan, draft } = planSection();
  const records = completeEvidenceRecords();
  const snapshot = buildSafetyPlanSnapshot({
    artifactId: EVIDENCE_IDS.artifact, reportId: EVIDENCE_IDS.report, workspaceId: EVIDENCE_IDS.workspace, projectId: EVIDENCE_IDS.project,
    generatedAt: EVIDENCE_DATE, reportUpdatedAt: EVIDENCE_DATE, projectUpdatedAt: EVIDENCE_DATE,
    acquisition: evidenceAcquisition({ crash_count: 3, geocoded_count: 3, stored_count: 3 }), selection: plan, draft,
  });
  records.safety = { status: "ready", snapshot, otherSeededArtifactCount: 0 };
  records.hinRecompute = { status: "computed", network: tiedNetwork(), roads: [] };
  return records;
}

function text(html: string) {
  return html.replace(/<svg[\s\S]*?<\/svg>/g, " ").replace(/<[^>]+>/g, " ").replace(/&#39;/g, "'").replace(/\s+/g, " ");
}

describe("the tie line in both exports", () => {
  it("prints it in the report's safety action plan, beside the numbered map", () => {
    const { draft, support } = planSection();
    const html = safetyActionPlanMarkup(draft, support);
    expect(text(html)).toContain(TIE_LINE);
    // Each tied square keeps rank 1 in the table; the map marks it with its row number.
    expect(support.networkMap).toMatchObject({ kind: "drawn", segmentCount: 3 });
    expect(html.match(/<td>1 \(tie\)<\/td>/g)).toHaveLength(3);
    expect([...html.matchAll(/<text [^>]*>(\d+)<\/text>/g)].map((match) => match[1]).sort()).toEqual(["1", "2", "3"]);
  });

  it("states it as a fact on SS4A Appendix A", () => {
    const hin = buildSs4aEvidenceAppendices(ss4aRecords(), new Set(SS4A_APPENDIX_KEYS))[0];
    expect(hin.facts).toContainEqual({ label: "Ties", value: TIE_LINE });
    expect(hin.table!.rows.map((row) => row[1])).toEqual(["1 (tie)", "1 (tie)", "1 (tie)"]);
    expect([...hin.figureSvg!.matchAll(/<text [^>]*>(\d+)<\/text>/g)].map((match) => match[1]).sort()).toEqual(["1", "2", "3"]);
  });
});

// ---------------------------------------------------------------------------
// Both documents as PDFs, read back with poppler.
// ---------------------------------------------------------------------------

const CHROME = [process.env.CHROME_EXECUTABLE_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "/usr/bin/google-chrome", "/usr/bin/chromium"]
  .find((candidate): candidate is string => Boolean(candidate && existsSync(candidate)));
/** Poppler's folder: another pdftotext (xpdf) can come first on PATH on Windows. */
function popplerDir(): string | null {
  const exe = process.platform === "win32" ? ".exe" : "";
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    if (dir && ["pdftoppm", "pdftotext", "pdfinfo"].every((name) => existsSync(path.join(dir, `${name}${exe}`)))) return dir;
  }
  return null;
}
const POPPLER = popplerDir();
const tool = (name: "pdftoppm" | "pdftotext") => path.join(POPPLER!, `${name}${process.platform === "win32" ? ".exe" : ""}`);
const PDF_TOOLS = Boolean(CHROME) && POPPLER !== null;
const workDir = PDF_TOOLS ? mkdtempSync(path.join(tmpdir(), "openplan-tie-exports-")) : "";
afterAll(() => {
  if (workDir) rmSync(workDir, { recursive: true, force: true });
});

async function pdfText(name: string, html: string) {
  process.env.CHROME_EXECUTABLE_PATH = CHROME;
  const file = path.join(workDir, `${name}.pdf`);
  writeFileSync(file, await renderHtmlToPdf(html, { footerLabel: name }));
  return { file, text: execFileSync(tool("pdftotext"), [file, "-"]).toString().replace(/\s+/g, " ") };
}

/** Pixels of the map's highlight red across the whole document, at 60 dpi. */
function redPixels(file: string): number {
  const prefix = path.join(workDir, path.basename(file, ".pdf"));
  execFileSync(tool("pdftoppm"), ["-r", "60", file, prefix]);
  let count = 0;
  for (const page of readdirPpm(prefix)) {
    const ppm = readFileSync(page);
    const header = ppm.subarray(0, 32).toString("latin1").split(/\s+/);
    const start = ppm.length - Number(header[1]) * Number(header[2]) * 3;
    for (let index = start; index < ppm.length; index += 3) {
      if (ppm[index] > 150 && ppm[index] < 215 && ppm[index + 1] < 80 && ppm[index + 2] < 70) count += 1;
    }
  }
  return count;
}
function readdirPpm(prefix: string): string[] {
  const dir = path.dirname(prefix);
  const base = path.basename(prefix);
  return readdirSync(dir).filter((name) => name.startsWith(`${base}-`) && name.endsWith(".ppm")).map((name) => path.join(dir, name));
}

function reportData(draft: ReturnType<typeof buildSafetyActionPlanSection>, support: ReturnType<typeof buildSafetyPlanSupport>): ReportGenerationData {
  return {
    report: { id: "r1", title: "Safety action plan report", summary: null, report_type: "project_status", created_at: "2026-11-03T00:00:00.000Z" },
    workspace: { id: "ws-1", name: "Test Workspace" },
    project: { id: EVIDENCE_IDS.project, name: "Example safety project", summary: null, status: "active", plan_type: "corridor_plan",
      delivery_phase: "analysis", created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-11-03T00:00:00.000Z" },
    runs: [], sections: [], deliverables: [], risks: [], issues: [], decisions: [], meetings: [], engagement: null, scenarioSetLinks: [],
    projectFundingSnapshot: null,
    projectRecordsSnapshot: {
      deliverables: { count: 0, latestTitle: null, latestAt: null }, risks: { count: 0, latestTitle: null, latestAt: null },
      issues: { count: 0, latestTitle: null, latestAt: null }, decisions: { count: 0, latestTitle: null, latestAt: null },
      meetings: { count: 0, latestTitle: null, latestAt: null },
    },
    stageGateSnapshot: buildProjectStageGateSnapshot(buildProjectStageGateSummary([], { templateId: "ca_stage_gates_v0_1" })),
    modelingEvidence: [],
    safetyActionPlan: draft,
    safetyActionPlanSupport: support,
  } as unknown as ReportGenerationData;
}

describe.runIf(PDF_TOOLS)("both exports as PDFs, read back with pdftotext and pdftoppm", () => {
  it("the report PDF carries the tie line and the drawn squares", async () => {
    const { draft, support } = planSection();
    const doc = await pdfText("tied-report", buildReportHtml(reportData(draft, support)));
    expect(doc.text).toContain(TIE_LINE);
    expect(redPixels(doc.file)).toBeGreaterThan(50);
  }, 120_000);

  it("the SS4A PDF carries the same tie line on Appendix A", async () => {
    const html = buildGrantApplicationHtml({
      opportunity: { id: EVIDENCE_IDS.opportunity, title: "SS4A application", agency_name: null, summary: null, expected_award_amount: null, closes_at: null, opportunity_status: null, decision_state: null },
      programTitle: null, sections: [], attachments: [], generatedAt: "2026-11-01T00:00:00.000Z",
      evidenceAppendices: buildSs4aEvidenceAppendices(ss4aRecords(), new Set(["hin_map"] as const)),
    });
    const doc = await pdfText("tied-ss4a", html);
    expect(doc.text).toContain(TIE_LINE);
    expect(redPixels(doc.file)).toBeGreaterThan(50);
  }, 120_000);
});
