/**
 * FOUR COUNTERMEASURES FHWA REMOVED FROM ITS LIST SAY SO WHEREVER THEY ARE
 * SHOWN OR PRINTED (KI-2026-11-14-071).
 *
 * Internet Archive captures of FHWA's Proven Safety Countermeasures list show
 * Roadway Reconfiguration (road diets), Bicycle Lanes, Appropriate Speed
 * Limits for All Road Users and Speed Safety Cameras on it on 2026-06-30 and
 * absent from 2026-07-10 through the newest capture read, 2026-11-04. OpenPlan
 * keeps them because saved plans cite them by id. These tests check the
 * picker, the saved plan on the Safety page, the report's countermeasure
 * section, SS4A Appendix C, the SS4A seed text and the benefit-cost Evidence
 * tab: an item FHWA removed carries the status line, and a plan that uses
 * only items on the list prints none of it. The last block renders both
 * exports to PDF with Chrome and reads them back with poppler.
 *
 * Blind category: whether FHWA's live page still matches the 2026-11-04
 * capture (the catalog marks that [VERIFY]); layout at 390 px (jsdom has no
 * layout); the hosted Chrome bundle. The PDF block is skipped where Chrome or
 * poppler is not installed.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { BcaSafetyEvidencePanel } from "@/components/grants/bca-workbench/safety-evidence-panel";
import { HighInjuryNetworkPanel } from "@/components/safety/high-injury-network-panel";
import { exampleBcaDocument } from "@/lib/bca/workbench/document";
import { buildGrantApplicationHtml } from "@/lib/grants/application-html";
import { buildSs4aEvidenceAppendices } from "@/lib/grants/ss4a-evidence-appendices";
import { buildSs4aSafetyDrafts } from "@/lib/grants/ss4a-safety-seed";
import { buildReportHtml, safetyActionPlanMarkup, type ReportGenerationData } from "@/lib/reports/html";
import { renderHtmlToPdf } from "@/lib/reports/pdf";
import { buildSafetyActionPlanSection } from "@/lib/reports/safety-action-plan";
import { safetyPlanDraftSchema } from "@/lib/reports/safety-plan-snapshot";
import { summarizeBcaTreatedSegments, type BcaSafetyEvidenceRead } from "@/lib/safety/bca-evidence";
import { buildSafetyCrashEvidence } from "@/lib/safety/crash-evidence";
import { SAFETY_COUNTERMEASURES } from "@/lib/safety/countermeasures";
import { buildProjectStageGateSnapshot, buildProjectStageGateSummary } from "@/lib/stage-gates/summary";
import { completeEvidenceRecords, EVIDENCE_DATE, EVIDENCE_IDS, evidenceSnapshot, fixtureNetwork } from "./fixtures/grants/ss4a-evidence";

const STATUS = "Not on FHWA's Proven Safety Countermeasures list since July 2026.";
/** Any form of the status, in a sentence or in parentheses. */
const ANY_STATUS = /on FHWA's Proven Safety Countermeasures list since/i;
const REMOVED_NAMES = ["Road diets (roadway reconfiguration)", "Bicycle Lanes", "Appropriate Speed Limits for All Road Users", "Speed Safety Cameras"];
const COUNTERMEASURE_FUNDING_CHECK =
  "Check the current notice of funding opportunity for what a program counts as an eligible or proven countermeasure.";

const NETWORK = fixtureNetwork();
const SEGMENT = NETWORK.segments[0];

function planWith(countermeasureIds: string[]) {
  return { ingestId: EVIDENCE_IDS.ingest, attachments: [{ segmentId: SEGMENT.id, segmentLabel: SEGMENT.label, countermeasureIds }] };
}

afterEach(() => cleanup());

// ---------------------------------------------------------------------------
// The picker and the saved plan on the Safety page.
// ---------------------------------------------------------------------------

function renderPicker(countermeasureIds: string[]) {
  render(
    <HighInjuryNetworkPanel
      network={NETWORK}
      sourceLabel="NHTSA Fatality Analysis Reporting System (FARS)"
      showOnMap
      onShowOnMapChange={vi.fn()}
      onFocusSegment={vi.fn()}
      ingestId={EVIDENCE_IDS.ingest}
      reports={[{ id: "report-a", title: "Plan A", safetyActionPlan: planWith(countermeasureIds) }]}
      saveRequest={vi.fn().mockResolvedValue({ ok: true })}
    />,
  );
  return screen.getAllByTestId("safety-hin-row")[0];
}

describe("the Safety page", () => {
  it("marks each removed item in the picker, and only those", () => {
    const row = renderPicker(["walkways"]);
    for (const box of within(row).getAllByRole("checkbox")) {
      const name = box.getAttribute("aria-label") ?? box.closest("label")!.textContent!;
      const removed = REMOVED_NAMES.some((removedName) => name.startsWith(removedName));
      expect(name.includes(STATUS), name).toBe(removed);
    }
    expect(within(row).getAllByTestId("safety-countermeasure-list-status")).toHaveLength(4);
  });

  it("shows the status beside a saved removed item, and none on a plan of current items", () => {
    let row = renderPicker(["bicycle-lanes", "walkways"]);
    const checked = within(row).getAllByRole("checkbox").filter((box) => (box as HTMLInputElement).checked);
    expect(checked.map((box) => box.closest("label")!.textContent).sort()).toEqual([`Bicycle Lanes${STATUS}`, "Walkways"]);
    cleanup();

    row = renderPicker(["walkways", "lighting"]);
    const current = within(row).getAllByRole("checkbox").filter((box) => (box as HTMLInputElement).checked);
    expect(current).toHaveLength(2);
    for (const box of current) expect(box.closest("label")!.textContent).not.toMatch(ANY_STATUS);
  });

  it("titles the whole list without calling every item an FHWA Proven Safety Countermeasure", () => {
    renderPicker([]);
    const list = screen.getByTestId("safety-countermeasure-list");
    expect(list.querySelector("summary")!.textContent).toBe(`Countermeasure list (${SAFETY_COUNTERMEASURES.length})`);
    expect(within(list).getAllByTestId("safety-countermeasure-list-status")).toHaveLength(4);
  });
});

// ---------------------------------------------------------------------------
// The report's countermeasure section.
// ---------------------------------------------------------------------------

function evidence() {
  return buildSafetyCrashEvidence({
    id: EVIDENCE_IDS.ingest, projectId: EVIDENCE_IDS.project, status: "ready", severityCompleteness: "fatal_only",
    sourceLabel: "NHTSA Fatality Analysis Reporting System (FARS)", attribution: null, crashCount: 4, geocodedCount: 4, storedCount: 4, truncated: false,
    yearsRequested: [2023, 2024], createdAt: EVIDENCE_DATE, dimensionCoverage: null, partyCompleteness: "not_supported", partyCount: null, involvementBasis: null,
  }, { severity: { fatal: 4, severe_injury: 0, injury: 0, pdo: 0, unknown: 0 }, role: null });
}

function draftFor(countermeasureIds: string[]) {
  return buildSafetyActionPlanSection({ plan: planWith(countermeasureIds), evidence: evidence(), network: NETWORK });
}

function text(html: string) {
  return html.replace(/<svg[\s\S]*?<\/svg>/g, " ").replace(/<[^>]+>/g, " ").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ");
}

describe("the report's countermeasure section", () => {
  it("prints the status for a removed item, in the list and the network table", () => {
    const draft = draftFor(["road-diets", "walkways"]);
    const printed = text(safetyActionPlanMarkup(draft));
    expect(printed).toContain(`Road diets (roadway reconfiguration). ${STATUS} Internet Archive captures of FHWA's list show it on June 30, 2026`);
    expect(printed).toContain("Road diets (roadway reconfiguration) (not on FHWA's Proven Safety Countermeasures list since July 2026); Walkways");
    expect(printed).toContain(COUNTERMEASURE_FUNDING_CHECK);
    expect(printed.match(/Not on FHWA's Proven Safety Countermeasures list/g)).toHaveLength(1);
  });

  it("prints none of it for a plan of items on the list", () => {
    const printed = text(safetyActionPlanMarkup(draftFor(["walkways", "lighting"])));
    expect(printed).toContain("Walkways. Addresses:");
    expect(printed).not.toMatch(ANY_STATUS);
    expect(printed).not.toContain(COUNTERMEASURE_FUNDING_CHECK);
  });
});

// ---------------------------------------------------------------------------
// SS4A Appendix C and the seed text, from the frozen snapshot.
// ---------------------------------------------------------------------------

function appendixC(countermeasureIds: string[]) {
  const records = completeEvidenceRecords();
  records.safety = { status: "ready", snapshot: evidenceSnapshot({}, countermeasureIds), otherSeededArtifactCount: 0 };
  return buildSs4aEvidenceAppendices(records, new Set(["countermeasures"] as const)).find((appendix) => appendix.key === "countermeasures")!;
}

describe("SS4A Appendix C and the seed", () => {
  it("prints the status in the countermeasure cell of a removed item only", () => {
    const appendix = appendixC(["speed-safety-cameras", "walkways"]);
    const cells = appendix.table!.rows.map((row) => row[2]);
    expect(cells[0]).toMatch(new RegExp(`^Speed Safety Cameras\\. ${STATUS.replace(/[.']/g, "\\$&")} Internet Archive captures`));
    expect(cells[1]).toBe("Walkways");
    expect(appendix.table!.rows[0][6]).toBe("https://web.archive.org/web/20260603/https://highways.dot.gov/safety/proven-safety-countermeasures/speed-safety-cameras");
    expect(appendix.notes.join(" ")).toContain(COUNTERMEASURE_FUNDING_CHECK);
  });

  it("prints none of it for a snapshot of items on the list", () => {
    const appendix = appendixC(["walkways"]);
    expect(JSON.stringify(appendix)).not.toMatch(ANY_STATUS);
    expect(appendix.notes.join(" ")).not.toContain(COUNTERMEASURE_FUNDING_CHECK);
  });

  it("carries the status into the seeded application text", () => {
    const [section] = buildSs4aSafetyDrafts(evidenceSnapshot({}, ["appropriate-speed-limits"]), "Example safety project").filter((draft) => draft.section_key === "implementation-and-capacity");
    expect(section.draft_markdown).toContain(`Appropriate Speed Limits for All Road Users: ${STATUS}`);
    const current = buildSs4aSafetyDrafts(evidenceSnapshot({}, ["walkways"]), "Example safety project");
    for (const draft of current) expect(draft.draft_markdown).not.toMatch(ANY_STATUS);
  });

  it("still reads a snapshot frozen before the status existed, with its own text", () => {
    const draft = evidenceSnapshot({}, ["bicycle-lanes"]).draft;
    const frozen = JSON.parse(JSON.stringify(draft)) as typeof draft;
    delete frozen.treatments[0].countermeasures[0].listStatus;
    expect(safetyPlanDraftSchema.safeParse(frozen).success).toBe(true);
    expect(safetyPlanDraftSchema.safeParse({ ...frozen, treatments: [{ ...frozen.treatments[0], countermeasures: [{ ...frozen.treatments[0].countermeasures[0], listStatus: "" }] }] }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The benefit-cost Evidence tab.
// ---------------------------------------------------------------------------

describe("the benefit-cost Evidence tab", () => {
  it("lists the status beside a removed item on a treated segment", () => {
    const [segment] = summarizeBcaTreatedSegments({
      attachments: [{ segmentId: SEGMENT.id, segmentLabel: SEGMENT.label, countermeasureIds: ["speed-safety-cameras", "walkways"] }],
      crashes: [{ id: "c1", longitude: -100, latitude: 40.002, severity: "fatal", collisionYear: 2023, killedCount: 1 }],
      placements: new Map([["c1", SEGMENT.id]]),
      seriousInjuryCounted: false,
      years: [2023, 2024],
    });
    expect(segment.countermeasures.map((entry) => entry.listStatus)).toEqual([STATUS, null]);
    const safety: BcaSafetyEvidenceRead = { status: "read", plansNotShown: 0, plans: [{
      status: "ready", reportId: EVIDENCE_IDS.report, reportTitle: "Safety plan", ingestId: EVIDENCE_IDS.ingest, sourceId: "fars-national",
      sourceLabel: "FARS", coverage: "Fatal crashes only.", years: [2023, 2024], seriousInjury: "not_in_source", caveats: [], segments: [segment],
    }] };
    render(<BcaSafetyEvidencePanel safety={safety} projectId={EVIDENCE_IDS.project} doc={exampleBcaDocument(EVIDENCE_IDS.project)} onChange={vi.fn()} onNotice={vi.fn()} />);
    const items = screen.getAllByRole("listitem").map((item) => item.textContent);
    expect(items[0]).toMatch(/^Speed Safety Cameras\. Not on FHWA's Proven Safety Countermeasures list since July 2026\. \[VERIFY\]/);
    expect(items[1]).not.toMatch(ANY_STATUS);
  });
});

// ---------------------------------------------------------------------------
// Both exports as PDFs, read back with poppler.
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
const PDF_TOOLS = Boolean(CHROME) && POPPLER !== null;
const workDir = PDF_TOOLS ? mkdtempSync(path.join(tmpdir(), "openplan-fhwa-status-")) : "";
afterAll(() => {
  if (workDir) rmSync(workDir, { recursive: true, force: true });
});

async function pdfText(name: string, html: string): Promise<string> {
  process.env.CHROME_EXECUTABLE_PATH = CHROME;
  const file = path.join(workDir, `${name}.pdf`);
  writeFileSync(file, await renderHtmlToPdf(html, { footerLabel: name }));
  const pdftotext = path.join(POPPLER!, `pdftotext${process.platform === "win32" ? ".exe" : ""}`);
  // Poppler can drop the hyphen where a wrapped line breaks, so compare without hyphens.
  return execFileSync(pdftotext, [file, "-"]).toString().replace(/\s+/g, " ").replace(/-/g, "");
}

function reportHtml(countermeasureIds: string[]): string {
  return buildReportHtml({
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
    safetyActionPlan: draftFor(countermeasureIds),
    safetyActionPlanSupport: null,
  } as unknown as ReportGenerationData);
}

function ss4aHtml(countermeasureIds: string[]): string {
  const records = completeEvidenceRecords();
  records.safety = { status: "ready", snapshot: evidenceSnapshot({}, countermeasureIds), otherSeededArtifactCount: 0 };
  return buildGrantApplicationHtml({
    opportunity: { id: EVIDENCE_IDS.opportunity, title: "SS4A application", agency_name: null, summary: null, expected_award_amount: null, closes_at: null, opportunity_status: null, decision_state: null },
    programTitle: null, sections: [], attachments: [], generatedAt: "2026-11-01T00:00:00.000Z",
    evidenceAppendices: buildSs4aEvidenceAppendices(records, new Set(["countermeasures"] as const)),
  });
}

const PDF_STATUS = STATUS.replace(/-/g, "");
const PDF_ANY_STATUS = /on FHWA.s Proven Safety Countermeasures list since/i;

describe.runIf(PDF_TOOLS)("both exports as PDFs, read back with pdftotext", () => {
  it("the report PDF prints the status for a removed item and none for current items", async () => {
    const removed = await pdfText("report-removed", reportHtml(["road-diets", "walkways"]));
    expect(removed).toContain(`Road diets (roadway reconfiguration). ${PDF_STATUS}`);
    expect(removed).toContain(COUNTERMEASURE_FUNDING_CHECK);
    const current = await pdfText("report-current", reportHtml(["walkways"]));
    expect(current).toContain("Walkways. Addresses:");
    expect(current).not.toMatch(PDF_ANY_STATUS);
  }, 120_000);

  it("the SS4A PDF prints the status in Appendix C for a removed item and none for current items", async () => {
    const removed = await pdfText("ss4a-removed", ss4aHtml(["bicycle-lanes", "walkways"]));
    expect(removed).toContain("Appendix C. Countermeasures");
    expect(removed).toContain(`Bicycle Lanes. ${PDF_STATUS}`);
    const current = await pdfText("ss4a-current", ss4aHtml(["walkways"]));
    expect(current).toContain("Appendix C. Countermeasures");
    expect(current).not.toMatch(PDF_ANY_STATUS);
  }, 120_000);
});
