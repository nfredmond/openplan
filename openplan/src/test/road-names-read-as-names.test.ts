/**
 * ROAD NAMES PRINT AS A READER WRITES THEM (KI-2026-11-14-304).
 *
 * TIGER/Line full names put a space after the interstate prefix. The first
 * proven job's Pyramid Lake plan printed "I- 80" in its high-injury table,
 * its countermeasure list and its benefit-cost inputs. The label now reads
 * "I-80". Nothing else is renamed: "State Rte 7" and "US Hwy 395" are the
 * source's own names and print as the source gives them.
 *
 * The stored name still keys each road line, so a segment id saved before
 * this change still finds its segment.
 *
 * Blind category: names inside stored text (a benefit-cost stream's title,
 * seeded SS4A section text), which print as stored; OpenStreetMap names,
 * which this fixture does not carry; other TIGER prefixes with the same
 * spacing, which the rule covers but no stored line here shows.
 */
import { describe, expect, it } from "vitest";
import { buildSs4aEvidenceAppendices } from "@/lib/grants/ss4a-evidence-appendices";
import { safetyActionPlanMarkup } from "@/lib/reports/html";
import { buildSafetyActionPlanSection } from "@/lib/reports/safety-action-plan";
import { buildSafetyPlanSnapshot } from "@/lib/reports/safety-plan-snapshot";
import { buildSafetyPlanNetworkMap, buildSafetyPlanSupport } from "@/lib/reports/safety-plan-support";
import { buildSafetyCrashEvidence } from "@/lib/safety/crash-evidence";
import { computeHighInjuryNetwork, roadLineKey, type HighInjuryNetwork } from "@/lib/safety/high-injury-network";
import { matchSafetyRoadIdentity, readCachedUsRoadContext, roadDisplayName } from "@/lib/safety/road-context";
import { completeEvidenceRecords, EVIDENCE_DATE, EVIDENCE_IDS, evidenceAcquisition } from "./fixtures/grants/ss4a-evidence";
import { seedId } from "./fixtures/grants/safety-seed";

/** Full names as the TIGER/Line road service returns them. */
const TIGER_NAMES: Array<[string, string]> = [
  ["I- 80", "I-80"],
  ["I- 80 Bus", "I-80 Bus"],
  ["I- 580", "I-580"],
  ["State Rte 7", "State Rte 7"],
  ["State Rte 447", "State Rte 447"],
  ["US Hwy 395", "US Hwy 395"],
  ["State Hwy 49", "State Hwy 49"],
  ["Long Valley Rd", "Long Valley Rd"],
];

const ROADS = readCachedUsRoadContext([{
  id: seedId(700), name: "I- 80", source: "us-census-tiger-line", vintage: "2026-01-01",
  geometry_geojson: { type: "LineString", coordinates: [[-119.6, 39.6], [-119.596, 39.6]] },
}]);

function network() {
  const computed = computeHighInjuryNetwork({
    crashes: [{ id: seedId(701), longitude: -119.598, latitude: 39.6, severity: "fatal" }],
    crashesConsidered: 1, basis: "fatal_only", roads: ROADS, years: [2023, 2024],
  });
  if (computed.status !== "computed") throw new Error("fixture network did not compute");
  return computed as Extract<HighInjuryNetwork, { status: "computed" }>;
}

function evidence() {
  return buildSafetyCrashEvidence({
    id: EVIDENCE_IDS.ingest, projectId: EVIDENCE_IDS.project, status: "ready", severityCompleteness: "fatal_only",
    sourceLabel: "NHTSA Fatality Analysis Reporting System (FARS)", attribution: null, crashCount: 1, geocodedCount: 1, storedCount: 1, truncated: false,
    yearsRequested: [2023, 2024], createdAt: EVIDENCE_DATE, dimensionCoverage: null, partyCompleteness: "not_supported", partyCount: null, involvementBasis: null,
  }, { severity: { fatal: 1, severe_injury: 0, injury: 0, pdo: 0, unknown: 0 }, role: null });
}

function text(html: string) {
  return html.replace(/<svg[\s\S]*?<\/svg>/g, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
}

describe("the display name", () => {
  it("closes the space after an interstate prefix and changes nothing else", () => {
    for (const [stored, printed] of TIGER_NAMES) expect(roadDisplayName(stored), stored).toBe(printed);
  });
});

describe("a road line stored as TIGER names it", () => {
  it("labels its segment I-80 and keys it on the stored name, so saved plans still match", () => {
    const [segment] = network().segments;
    expect(segment.label).toBe("I-80");
    expect(segment.id).toBe(`road:${roadLineKey(ROADS[0])}:0`);
    expect(ROADS[0].name).toBe("I- 80");
  });

  it("names a crash concentration's nearest road the same way", () => {
    const identity = matchSafetyRoadIdentity(-119.598, 39.6, ROADS);
    expect(identity).toMatchObject({ status: "matched", name: "I-80" });
  });
});

describe("both exports", () => {
  it("the report's table and countermeasure list print I-80", () => {
    const computed = network();
    const plan = { ingestId: EVIDENCE_IDS.ingest, attachments: [{ segmentId: computed.segments[0].id, segmentLabel: "I- 80", countermeasureIds: ["lighting"] }] };
    const draft = buildSafetyActionPlanSection({ plan, evidence: evidence(), network: computed });
    const support = buildSafetyPlanSupport({
      reads: { engagement: { status: "absent" }, bca: { status: "absent" } }, projectId: EVIDENCE_IDS.project, projectName: "Example",
      networkMap: buildSafetyPlanNetworkMap({ network: computed, roads: ROADS, projectGeometry: null }), network: computed,
    });
    const body = text(safetyActionPlanMarkup(draft, support));
    expect(body).toContain("I-80");
    expect(body).not.toContain("I- 80");
  });

  it("SS4A Appendices A and C print I-80 from a snapshot frozen with I- 80", () => {
    const computed = network();
    // A snapshot frozen before this change carries the stored spelling.
    const frozen = { ...computed, segments: computed.segments.map((segment) => ({ ...segment, label: "I- 80" })) };
    const plan = { ingestId: EVIDENCE_IDS.ingest, attachments: [{ segmentId: computed.segments[0].id, segmentLabel: "I- 80", countermeasureIds: ["lighting"] }] };
    const draft = buildSafetyActionPlanSection({ plan, evidence: evidence(), network: frozen });
    expect(draft.network.kind === "computed" && draft.network.rows[0].label).toBe("I- 80");
    const records = completeEvidenceRecords();
    records.safety = { status: "ready", otherSeededArtifactCount: 0, snapshot: buildSafetyPlanSnapshot({
      artifactId: EVIDENCE_IDS.artifact, reportId: EVIDENCE_IDS.report, workspaceId: EVIDENCE_IDS.workspace, projectId: EVIDENCE_IDS.project,
      generatedAt: EVIDENCE_DATE, reportUpdatedAt: EVIDENCE_DATE, projectUpdatedAt: EVIDENCE_DATE,
      acquisition: evidenceAcquisition({ crash_count: 1, geocoded_count: 1, stored_count: 1 }), selection: plan, draft,
    }) };
    records.hinRecompute = { status: "computed", network: computed, roads: ROADS };
    const [hin, , countermeasures] = buildSs4aEvidenceAppendices(records, new Set(["hin_map", "countermeasures"] as const));
    expect(hin.table!.rows[0][2]).toMatch(/^I-80, near /);
    expect(countermeasures.table!.rows[0][0]).toBe("I-80");
  });
});
