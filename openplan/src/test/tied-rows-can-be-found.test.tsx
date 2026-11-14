/**
 * A TIED ROW CAN BE FOUND ON THE MAP AND ON THE GROUND (KI-2026-11-14-340).
 *
 * The first proven job's Sierra County plan drew fifteen map marks labeled
 * "5", one per tied segment, and its table named the route only ("State Hwy
 * 49"). A public works director could not tell which mark was which row, or
 * which half mile of the highway a row meant.
 *
 * Each listed row now carries a number (1 to n, never shared) that its map
 * mark also carries, and a location from the stored road line ("near 39.4989,
 * -121.0184", the same point the mark sits on). Rank and tie wording stay as
 * they were, in their own column. The ranking and every count are unchanged.
 *
 * The agreement checks read the drawn SVG: for every pair of rows, the mark
 * with the first row's number lies west or east of the mark with the second's
 * exactly as the printed longitudes say. Numbering marks by rank, or in a
 * different order from the table, fails them.
 *
 * Blind category: the screen's map marks carry no numbers (jsdom has no
 * WebGL; the marks are plain circles); whether a reader at 390 px can read the
 * location line; the hosted Chrome bundle. The PDF block is skipped where
 * Chrome or poppler is missing, so CI on a runner without them checks the HTML
 * only.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { HighInjuryNetworkPanel } from "@/components/safety/high-injury-network-panel";
import { buildGrantApplicationHtml } from "@/lib/grants/application-html";
import { buildSs4aEvidenceAppendices } from "@/lib/grants/ss4a-evidence-appendices";
import { buildReportHtml, safetyActionPlanMarkup, type ReportGenerationData } from "@/lib/reports/html";
import { renderHtmlToPdf } from "@/lib/reports/pdf";
import { buildSafetyActionPlanSection } from "@/lib/reports/safety-action-plan";
import { buildSafetyPlanSnapshot } from "@/lib/reports/safety-plan-snapshot";
import { buildSafetyPlanNetworkMap, buildSafetyPlanSupport, safetyPlanSegmentLocations } from "@/lib/reports/safety-plan-support";
import { buildSafetyCrashEvidence } from "@/lib/safety/crash-evidence";
import {
  computeHighInjuryNetwork,
  describeHighInjuryNetworkLocation,
  highInjuryNetworkFeatureCollection,
  highInjuryNetworkMarkerCollection,
  type HighInjuryNetwork,
  type HighInjuryNetworkCrash,
} from "@/lib/safety/high-injury-network";
import { readCachedUsRoadContext } from "@/lib/safety/road-context";
import { buildProjectStageGateSnapshot, buildProjectStageGateSummary } from "@/lib/stage-gates/summary";
import { findPdfPhrase } from "../../scripts/lib/pdf-text-match.mjs";
import { completeEvidenceRecords, EVIDENCE_DATE, EVIDENCE_IDS, evidenceAcquisition } from "./fixtures/grants/ss4a-evidence";
import { seedId } from "./fixtures/grants/safety-seed";

vi.mock("mapbox-gl", async () => {
  const { createMapboxGlModuleFake } = await import("@/test/helpers/mapbox-gl-fake");
  return createMapboxGlModuleFake();
});
vi.mock("mapbox-gl/dist/mapbox-gl.css", () => ({}));

afterEach(cleanup);

/**
 * Three stored lines of one highway, a few miles apart, each with one fatal
 * crash: three rows tied at rank 1, all named "State Hwy 49".
 */
const LINES: Array<[number, number]> = [[-120.95, 39.5], [-120.75, 39.55], [-120.55, 39.6]];
const ROADS = readCachedUsRoadContext(LINES.map(([lon, lat], index) => ({
  id: seedId(500 + index), name: "State Hwy 49", source: "us-census-tiger-line", vintage: "2026-01-01",
  geometry_geojson: { type: "LineString", coordinates: [[lon, lat], [lon + 0.004, lat]] },
})));
const CRASHES: HighInjuryNetworkCrash[] = LINES.map(([lon, lat], index) => ({
  id: seedId(600 + index), longitude: lon + 0.002, latitude: lat, severity: "fatal",
}));

function tiedNetwork() {
  const network = computeHighInjuryNetwork({ crashes: CRASHES, crashesConsidered: 3, basis: "fatal_only", roads: ROADS, years: [2023, 2024] });
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
  // The countermeasure goes on the LAST listed row, so its number is not 1.
  const treated = network.segments[2];
  const plan = { ingestId: EVIDENCE_IDS.ingest, attachments: [{ segmentId: treated.id, segmentLabel: treated.label, countermeasureIds: ["lighting"] }] };
  const draft = buildSafetyActionPlanSection({ plan, evidence: evidence(), network });
  const support = buildSafetyPlanSupport({
    reads: { engagement: { status: "absent" }, bca: { status: "absent" } }, projectId: EVIDENCE_IDS.project, projectName: "Example safety project",
    networkMap: buildSafetyPlanNetworkMap({ network, roads: ROADS, projectGeometry: null }),
    segmentLocations: safetyPlanSegmentLocations(network),
  });
  return { network, plan, draft, support };
}

function ss4aRecords() {
  const { network, plan, draft } = planSection();
  const records = completeEvidenceRecords();
  const snapshot = buildSafetyPlanSnapshot({
    artifactId: EVIDENCE_IDS.artifact, reportId: EVIDENCE_IDS.report, workspaceId: EVIDENCE_IDS.workspace, projectId: EVIDENCE_IDS.project,
    generatedAt: EVIDENCE_DATE, reportUpdatedAt: EVIDENCE_DATE, projectUpdatedAt: EVIDENCE_DATE,
    acquisition: evidenceAcquisition({ crash_count: 3, geocoded_count: 3, stored_count: 3 }), selection: plan, draft,
  });
  records.safety = { status: "ready", snapshot, otherSeededArtifactCount: 0 };
  records.hinRecompute = { status: "computed", network, roads: ROADS };
  records.studyArea = { status: "none" };
  return records;
}

function text(html: string) {
  return html.replace(/<svg[\s\S]*?<\/svg>/g, " ").replace(/<[^>]+>/g, " ").replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();
}

/** Each drawn mark's number and its x position, from the SVG. */
function marks(svg: string): Map<number, number> {
  const found = new Map<number, number>();
  for (const match of svg.matchAll(/<g transform="translate\((-?[\d.]+) (-?[\d.]+)\)"><circle r="9"[^>]*\/><text [^>]*>(\d+)<\/text><\/g>/g)) {
    found.set(Number(match[3]), Number(match[1]));
  }
  return found;
}

/** The longitude a printed location names. */
function printedLongitude(location: string): number {
  const match = /near (-?\d+\.\d{4}), (-?\d+\.\d{4})/.exec(location);
  if (!match) throw new Error(`no location in "${location}"`);
  return Number(match[2]);
}

/**
 * The agreement rule: every mark exists once per row, and for every pair of
 * rows the marks sit west and east of each other as the printed longitudes say.
 */
function expectMarksMatchRows(svg: string, rows: Array<{ number: number; location: string }>) {
  const drawn = marks(svg);
  expect([...drawn.keys()].sort()).toEqual(rows.map((row) => row.number).sort());
  for (const a of rows) {
    for (const b of rows) {
      if (a.number >= b.number) continue;
      const printed = Math.sign(printedLongitude(a.location) - printedLongitude(b.location));
      const onMap = Math.sign(drawn.get(a.number)! - drawn.get(b.number)!);
      expect(onMap, `marks ${a.number} and ${b.number}`).toBe(printed);
    }
  }
}

describe("the fixture is the defect's shape", () => {
  it("lists three rows of one road, all tied at rank 1", () => {
    const network = tiedNetwork();
    expect(network.segments.map((segment) => [segment.label, segment.rank, segment.tied])).toEqual([
      ["State Hwy 49", 1, true], ["State Hwy 49", 1, true], ["State Hwy 49", 1, true],
    ]);
    // Three different places, so three different printed locations.
    expect(new Set(network.segments.map((segment) => describeHighInjuryNetworkLocation(segment.geometry))).size).toBe(3);
  });
});

describe("the report's safety action plan", () => {
  it("numbers each row, keeps rank and tie in their own column, and prints where each row is", () => {
    const { network, draft, support } = planSection();
    const html = safetyActionPlanMarkup(draft, support);
    const table = html.match(/<table>[\s\S]*?<\/table>/)![0];
    expect(table).toContain("<th>No.</th><th>Rank</th><th>Location</th>");
    const rows = [...table.matchAll(/<tr>\s*<td>(\d+)<\/td>\s*<td>([^<]*)<\/td>\s*<td>([^<]*)<br><span class="meta">([^<]*)<\/span><\/td>/g)]
      .map((match) => ({ number: Number(match[1]), rank: match[2], label: match[3], location: match[4] }));
    expect(rows.map((row) => row.number)).toEqual([1, 2, 3]);
    expect(rows.map((row) => row.rank)).toEqual(["1 (tie)", "1 (tie)", "1 (tie)"]);
    expect(rows.map((row) => row.location)).toEqual(network.segments.map((segment) => describeHighInjuryNetworkLocation(segment.geometry)));
    expect(support.networkMap).toMatchObject({ kind: "drawn" });
    expectMarksMatchRows(html.match(/<svg[\s\S]*?<\/svg>/)![0], rows);
    expect(text(html)).toContain("drawn in red, each marked with its number from the table's No. column.");
    // The countermeasure line names the row the same way.
    expect(text(html)).toContain(`State Hwy 49 (No. 3, rank 1, ${rows[2].location}):`);
  });
});

describe("SS4A Appendix A and Appendix C", () => {
  it("numbers each row the same way and draws the same numbers", () => {
    const { network } = planSection();
    const [hin, , countermeasures] = buildSs4aEvidenceAppendices(ss4aRecords(), new Set(["hin_map", "countermeasures"] as const));
    expect(hin.table!.headers.slice(0, 3)).toEqual(["No.", "Rank", "Location"]);
    const rows = hin.table!.rows.map((row) => ({ number: Number(row[0]), rank: row[1], location: row[2] }));
    expect(rows.map((row) => row.number)).toEqual([1, 2, 3]);
    expect(rows.map((row) => row.rank)).toEqual(["1 (tie)", "1 (tie)", "1 (tie)"]);
    expect(rows.map((row) => row.location)).toEqual(network.segments.map((segment) => `State Hwy 49, ${describeHighInjuryNetworkLocation(segment.geometry)}`));
    expectMarksMatchRows(hin.figureSvg!, rows);
    expect(hin.notes).toContain("Each numbered mark is a row of the table, by its No. column. Tied rows share a rank but never a number.");
    expect(countermeasures.table!.rows[0].slice(0, 2)).toEqual(["State Hwy 49", "No. 3, rank 1"]);
  });

  it("prints no location when the recomputation does not reproduce the frozen ranking", () => {
    const records = ss4aRecords();
    const fewer = computeHighInjuryNetwork({ crashes: CRASHES.slice(0, 2), crashesConsidered: 2, basis: "fatal_only", roads: ROADS, years: [2023, 2024] });
    records.hinRecompute = { status: "computed", network: fewer as Extract<HighInjuryNetwork, { status: "computed" }>, roads: ROADS };
    const [hin] = buildSs4aEvidenceAppendices(records, new Set(["hin_map"] as const));
    expect(hin.figureSvg).toBeNull();
    expect(hin.table!.rows.map((row) => row.slice(0, 3))).toEqual([["1", "1 (tie)", "State Hwy 49"], ["2", "1 (tie)", "State Hwy 49"], ["3", "1 (tie)", "State Hwy 49"]]);
  });
});

describe("the Safety screen's list", () => {
  it("shows the same numbers and locations as the exports", () => {
    const network = tiedNetwork();
    render(
      <HighInjuryNetworkPanel network={network} sourceLabel="FARS" showOnMap onShowOnMapChange={() => {}} onFocusSegment={() => {}}
        ingestId={EVIDENCE_IDS.ingest} reports={[]} />,
    );
    const rows = screen.getAllByTestId("safety-hin-row");
    expect(rows.map((row) => row.querySelectorAll("td")[0].textContent)).toEqual(["1", "2", "3"]);
    // Rank and tie wording as the screen already printed them.
    expect(rows.map((row) => row.querySelectorAll("td")[1].textContent)).toEqual(["1=", "1=", "1="]);
    expect(screen.getAllByTestId("safety-hin-location").map((node) => node.textContent))
      .toEqual(network.segments.map((segment) => describeHighInjuryNetworkLocation(segment.geometry)));
    // The screen's map marks sit on the same anchors the locations name.
    const markers = highInjuryNetworkMarkerCollection(highInjuryNetworkFeatureCollection(network)).features;
    expect(markers.map((marker) => `near ${marker.geometry.coordinates[1].toFixed(4)}, ${marker.geometry.coordinates[0].toFixed(4)}`))
      .toEqual(network.segments.map((segment) => describeHighInjuryNetworkLocation(segment.geometry)));
  });
});

// ---------------------------------------------------------------------------
// Both documents as PDFs, read back with poppler.
// ---------------------------------------------------------------------------

const CHROME = [process.env.CHROME_EXECUTABLE_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "/usr/bin/google-chrome", "/usr/bin/chromium"]
  .find((candidate): candidate is string => Boolean(candidate && existsSync(candidate)));
function popplerDir(): string | null {
  const exe = process.platform === "win32" ? ".exe" : "";
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    if (dir && ["pdftoppm", "pdftotext", "pdfinfo"].every((name) => existsSync(path.join(dir, `${name}${exe}`)))) return dir;
  }
  return null;
}
const POPPLER = popplerDir();
const PDF_TOOLS = Boolean(CHROME) && POPPLER !== null;
const workDir = PDF_TOOLS ? mkdtempSync(path.join(tmpdir(), "openplan-tied-rows-")) : "";
afterAll(() => {
  if (workDir) rmSync(workDir, { recursive: true, force: true });
});

async function pdfPages(name: string, html: string): Promise<string[]> {
  process.env.CHROME_EXECUTABLE_PATH = CHROME;
  const file = path.join(workDir, `${name}.pdf`);
  writeFileSync(file, await renderHtmlToPdf(html, { footerLabel: name }));
  const exe = process.platform === "win32" ? ".exe" : "";
  const pages = Number(/Pages:\s+(\d+)/.exec(execFileSync(path.join(POPPLER!, `pdfinfo${exe}`), [file]).toString())![1]);
  return Array.from({ length: pages }, (_, index) =>
    execFileSync(path.join(POPPLER!, `pdftotext${exe}`), ["-f", String(index + 1), "-l", String(index + 1), file, "-"]).toString());
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

describe.runIf(PDF_TOOLS)("both exports as PDFs, read back with pdftotext", () => {
  it("prints each row's number and location in the report and in Appendix A", async () => {
    const { network, draft, support } = planSection();
    const locations = network.segments.map((segment) => describeHighInjuryNetworkLocation(segment.geometry)!);
    const report = await pdfPages("tied-rows-report", buildReportHtml(reportData(draft, support)));
    const application = await pdfPages("tied-rows-ss4a", buildGrantApplicationHtml({
      opportunity: { id: EVIDENCE_IDS.opportunity, title: "SS4A application", agency_name: null, summary: null, expected_award_amount: null, closes_at: null, opportunity_status: null, decision_state: null },
      programTitle: null, sections: [], attachments: [], generatedAt: "2026-11-01T00:00:00.000Z",
      evidenceAppendices: buildSs4aEvidenceAppendices(ss4aRecords(), new Set(["hin_map"] as const)),
    }));
    for (const [name, pages] of [["report", report], ["ss4a", application]] as const) {
      for (const location of locations) expect(findPdfPhrase(pages, location), `${name}: ${location}`).not.toEqual([]);
    }
    expect(findPdfPhrase(report, "each marked with its number from the table's No. column"), "report caption").not.toEqual([]);
    expect(findPdfPhrase(application, "Tied rows share a rank but never a number"), "ss4a note").not.toEqual([]);
  }, 120_000);
});
