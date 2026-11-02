import { exampleBcaDocument } from "@/lib/bca/workbench/document";
import { buildSs4aSafetyDrafts } from "@/lib/grants/ss4a-safety-seed";
import type { Ss4aEvidenceRecords } from "@/lib/grants/ss4a-evidence-appendices";
import { buildProjectEngagementEvidenceByProjectId } from "@/lib/grants/engagement-evidence";
import { buildSafetyActionPlanSection } from "@/lib/reports/safety-action-plan";
import { buildSafetyPlanSnapshot, type SafetyPlanSnapshot } from "@/lib/reports/safety-plan-snapshot";
import { buildSafetyCrashEvidence, SAFETY_CRASH_EVIDENCE_INGEST_PROJECTION } from "@/lib/safety/crash-evidence";
import { computeHighInjuryNetwork, type HighInjuryNetwork, type HighInjuryNetworkCrash } from "@/lib/safety/high-injury-network";
import { readCachedUsRoadContext } from "@/lib/safety/road-context";
import { seedId } from "./safety-seed";

/**
 * A synthetic SS4A evidence set: one fatality-census acquisition with four
 * fatal crashes on two cached road lines, a ranked network, one attached
 * countermeasure, a saved BCA workbench version and one engagement campaign.
 * Coordinates are arbitrary test geometry, not a real place.
 */
export const EVIDENCE_IDS = {
  workspace: seedId(1),
  project: seedId(2),
  opportunity: seedId(3),
  report: seedId(4),
  artifact: seedId(5),
  ingest: seedId(6),
  bcaVersion: seedId(80),
  campaign: seedId(90),
};
export const EVIDENCE_DATE = "2026-10-18T12:00:00+00:00";

export const ROAD_ROWS = [
  { id: seedId(201), road_name: "Test Road A", source_id: "us-census-tiger-line", source_vintage: "2024",
    geometry_geojson: { type: "LineString", coordinates: [[-100.0, 40.0], [-100.0, 40.01]] } },
  { id: seedId(202), road_name: "Test Road B", source_id: "us-census-tiger-line", source_vintage: "2024",
    geometry_geojson: { type: "LineString", coordinates: [[-100.01, 40.02], [-100.0, 40.02]] } },
];

export const CRASH_ROWS: HighInjuryNetworkCrash[] = [
  { id: seedId(301), longitude: -100.0, latitude: 40.002, severity: "fatal" },
  { id: seedId(302), longitude: -100.0, latitude: 40.003, severity: "fatal" },
  { id: seedId(303), longitude: -100.0, latitude: 40.004, severity: "fatal" },
  { id: seedId(304), longitude: -100.005, latitude: 40.02, severity: "fatal" },
];

export function evidenceRoads() {
  return readCachedUsRoadContext(ROAD_ROWS.map((row) => ({ id: row.id, name: row.road_name, geometry_geojson: row.geometry_geojson, source: row.source_id, vintage: row.source_vintage })));
}

export function fixtureNetwork(crashes: HighInjuryNetworkCrash[] = CRASH_ROWS) {
  const network = computeHighInjuryNetwork({ crashes, crashesConsidered: crashes.length, basis: "fatal_only", roads: evidenceRoads(), years: [2023, 2024] });
  if (network.status !== "computed") throw new Error("fixture network did not compute");
  return network as Extract<HighInjuryNetwork, { status: "computed" }>;
}

export function evidenceAcquisition(overrides: Record<string, unknown> = {}) {
  const acquisition: Record<string, unknown> = Object.fromEntries(SAFETY_CRASH_EVIDENCE_INGEST_PROJECTION.split(", ").map((key) => [key, null]));
  Object.assign(acquisition, {
    id: EVIDENCE_IDS.ingest, project_id: EVIDENCE_IDS.project, status: "ready", source_id: "fars",
    source_label: "NHTSA Fatality Analysis Reporting System (FARS)", created_at: EVIDENCE_DATE,
    min_lon: -100.05, min_lat: 39.95, max_lon: -99.95, max_lat: 40.05,
    severity_completeness: "fatal_only", crash_count: 4, geocoded_count: 4, stored_count: 4, truncated: false,
    years_requested: [2023, 2024], party_completeness: "not_supported",
  }, overrides);
  return acquisition;
}

/** The frozen v1 snapshot a Safety report generation would have stored. */
export function evidenceSnapshot(acquisitionOverrides: Record<string, unknown> = {}): SafetyPlanSnapshot {
  const network = fixtureNetwork();
  const acquisition = evidenceAcquisition(acquisitionOverrides);
  const plan = { ingestId: EVIDENCE_IDS.ingest, attachments: [{ segmentId: network.segments[0].id, segmentLabel: network.segments[0].label, countermeasureIds: ["walkways"] }] };
  const completeness = typeof acquisition.severity_completeness === "string" ? acquisition.severity_completeness : "";
  const evidence = buildSafetyCrashEvidence({
    id: EVIDENCE_IDS.ingest, projectId: EVIDENCE_IDS.project, status: "ready", severityCompleteness: completeness,
    sourceLabel: String(acquisition.source_label), attribution: null, crashCount: 4, geocodedCount: 4, storedCount: 4, truncated: false,
    yearsRequested: [2023, 2024], createdAt: EVIDENCE_DATE, dimensionCoverage: acquisition.dimension_coverage ?? null, partyCompleteness: "not_supported", partyCount: null, involvementBasis: null,
    publishedThrough: typeof acquisition.published_through === "string" ? acquisition.published_through : null,
    publishedThroughProvenance: (acquisition.published_through_provenance as Record<string, unknown> | null) ?? null,
  }, { severity: { fatal: 4, severe_injury: 0, injury: 0, pdo: 0, unknown: 0 }, role: null });
  const draft = buildSafetyActionPlanSection({ plan, evidence, network });
  return buildSafetyPlanSnapshot({
    artifactId: EVIDENCE_IDS.artifact, reportId: EVIDENCE_IDS.report, workspaceId: EVIDENCE_IDS.workspace, projectId: EVIDENCE_IDS.project,
    generatedAt: EVIDENCE_DATE, reportUpdatedAt: EVIDENCE_DATE, projectUpdatedAt: EVIDENCE_DATE, acquisition, selection: plan, draft,
  });
}

export function seedProvenance(snapshot: SafetyPlanSnapshot) {
  return buildSs4aSafetyDrafts(snapshot, "Example safety project")[0].provenance;
}

export const BCA_VERSION_ROW = () => ({
  id: EVIDENCE_IDS.bcaVersion, project_id: EVIDENCE_IDS.project, created_at: "2026-10-20T09:00:00+00:00",
  engine_version: "annual-ledger-1", document_json: exampleBcaDocument(EVIDENCE_IDS.project),
});

export const CAMPAIGN_ROW = {
  id: EVIDENCE_IDS.campaign, project_id: EVIDENCE_IDS.project, title: "Corridor listening session", status: "closed",
  updated_at: "2026-10-21T10:00:00+00:00", ai_synthesized_at: "2026-10-21T09:00:00+00:00",
  ai_synthesis_json: { source: "deterministic-fallback", analyzed_item_count: 12, overall_sentiment: "mixed", themes: [{ label: "Crossing safety", item_count: 7, sentiment: "negative" }] },
  representativeness_json: null, representativeness_computed_at: null,
};

/** Every record present and consistent: the shape the loader returns for a complete project. */
export function completeEvidenceRecords(): Ss4aEvidenceRecords {
  const snapshot = evidenceSnapshot();
  return {
    projectId: EVIDENCE_IDS.project,
    projectName: "Example safety project",
    safety: { status: "ready", snapshot, otherSeededArtifactCount: 0 },
    hinRecompute: { status: "computed", network: fixtureNetwork(), roads: evidenceRoads() },
    bca: { status: "workbench", row: BCA_VERSION_ROW() },
    engagement: { status: "ready", evidence: buildProjectEngagementEvidenceByProjectId([CAMPAIGN_ROW]).get(EVIDENCE_IDS.project)!, truncated: false },
  };
}
