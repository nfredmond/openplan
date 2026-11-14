/**
 * Both safety exports, whole, for one synthetic project that carries every
 * block the first proven job printed: the safety action plan report (with its
 * readiness payload, stage-gate snapshot, high-injury map, countermeasures,
 * engagement and a benefit-cost analysis with a safety stream) and the SS4A
 * packet (six seeded sections and all five evidence appendices).
 *
 * Coordinates are arbitrary test geometry, not a real place.
 */
import { addBcaSafetyStream } from "@/lib/bca/workbench/safety-evidence";
import { exampleBcaDocument } from "@/lib/bca/workbench/document";
import type { BcaDocument } from "@/lib/bca/workbench/schema";
import { buildGrantApplicationHtml, type GrantApplicationExportSection } from "@/lib/grants/application-html";
import type { ApplicationSectionRow } from "@/lib/grants/application";
import { SS4A_APPENDIX_KEYS } from "@/lib/grants/ss4a-appendix-keys";
import { buildSs4aEvidenceAppendices } from "@/lib/grants/ss4a-evidence-appendices";
import { buildSs4aSafetyDrafts } from "@/lib/grants/ss4a-safety-seed";
import { buildProjectJurisdictionReadinessExportPayload } from "@/lib/jurisdiction-readiness/payload";
import { clearedProjectPlace } from "@/lib/projects/project-place";
import { buildReportHtml, type ReportGenerationData } from "@/lib/reports/html";
import { buildSafetyActionPlanSection } from "@/lib/reports/safety-action-plan";
import { buildSafetyPlanNetworkMap, buildSafetyPlanSupport } from "@/lib/reports/safety-plan-support";
import type { BcaCountedSegment, BcaSafetyPlanOffer } from "@/lib/safety/bca-evidence";
import { buildSafetyCrashEvidence } from "@/lib/safety/crash-evidence";
import { buildProjectStageGateSnapshot, buildProjectStageGateSummary } from "@/lib/stage-gates/summary";
import { BCA_VERSION_ROW, completeEvidenceRecords, EVIDENCE_DATE, EVIDENCE_IDS, evidenceRoads, evidenceSnapshot, fixtureNetwork, STUDY_AREA } from "./ss4a-evidence";

/** A saved analysis with one safety stream from the plan's top segment, as the workbench adds it. */
function bcaWithSafetyStream(): BcaDocument {
  const network = fixtureNetwork();
  const segment = network.segments[0];
  const counted: BcaCountedSegment = {
    status: "counted", segmentId: segment.id, segmentLabel: segment.label,
    countermeasures: [{ id: "walkways", name: "Walkways", cmfNote: "[VERIFY]", listStatus: null }],
    years: [{ year: 2023, fatalCrashes: 2, seriousInjuryCrashes: null }, { year: 2024, fatalCrashes: 1, seriousInjuryCrashes: null }],
    fatalCrashes: 3, seriousInjuryCrashes: null, fatalities: 3, fatalCrashesWithoutPersonCount: 0,
  };
  const plan: Extract<BcaSafetyPlanOffer, { status: "ready" }> = {
    status: "ready", reportId: EVIDENCE_IDS.report, reportTitle: "Example safety action plan", ingestId: EVIDENCE_IDS.ingest,
    sourceId: "fars-national", sourceLabel: "NHTSA Fatality Analysis Reporting System (FARS)", coverage: "Fatal crashes only.",
    years: [2023, 2024], seriousInjury: "not_in_source", caveats: [], segments: [counted],
  };
  return addBcaSafetyStream(exampleBcaDocument(EVIDENCE_IDS.project), plan, counted, { outcome: "fatality", persons: null, cmf: 0.84, cmfId: 2438 });
}

function bcaRead() {
  return { status: "version" as const, row: { ...BCA_VERSION_ROW(), document_json: bcaWithSafetyStream() } };
}

function planEvidence() {
  return buildSafetyCrashEvidence({
    id: EVIDENCE_IDS.ingest, projectId: EVIDENCE_IDS.project, status: "ready", severityCompleteness: "fatal_only",
    sourceLabel: "NHTSA Fatality Analysis Reporting System (FARS)", attribution: null, crashCount: 4, geocodedCount: 4, storedCount: 4, truncated: false,
    yearsRequested: [2023, 2024], createdAt: EVIDENCE_DATE, dimensionCoverage: null, partyCompleteness: "not_supported", partyCount: null, involvementBasis: null,
  }, { severity: { fatal: 4, severe_injury: 0, injury: 0, pdo: 0, unknown: 0 }, role: null });
}

export const SAFETY_EXPORT_PROJECT = {
  ...clearedProjectPlace(), id: EVIDENCE_IDS.project, workspace_id: EVIDENCE_IDS.workspace, name: "Example safety project", summary: null,
  status: "active", plan_type: "safety_plan", delivery_phase: "scoping", latitude: null, longitude: null,
  created_at: "2026-10-15T00:00:00.000Z", updated_at: "2026-10-15T01:00:00.000Z",
  place_source: "uploaded", place_label: "Uploaded study boundary", place_geometry_geojson: STUDY_AREA, jurisdiction_context: null,
};

export function safetyReportData(): ReportGenerationData {
  const network = fixtureNetwork();
  const plan = { ingestId: EVIDENCE_IDS.ingest, attachments: [{ segmentId: network.segments[0].id, segmentLabel: network.segments[0].label, countermeasureIds: ["walkways"] }] };
  const draft = buildSafetyActionPlanSection({ plan, evidence: planEvidence(), network });
  const support = buildSafetyPlanSupport({
    reads: { engagement: completeEvidenceRecords().engagement, bca: bcaRead() as never }, projectId: EVIDENCE_IDS.project, projectName: SAFETY_EXPORT_PROJECT.name,
    networkMap: buildSafetyPlanNetworkMap({ network, roads: evidenceRoads(), projectGeometry: STUDY_AREA }), network,
  });
  const data = {
    report: { id: EVIDENCE_IDS.report, title: "Example safety action plan", summary: null, report_type: "project_status", created_at: "2026-11-14T17:33:55.000Z" },
    workspace: { id: EVIDENCE_IDS.workspace, name: "Example workspace" },
    project: SAFETY_EXPORT_PROJECT,
    jurisdictionReadiness: buildProjectJurisdictionReadinessExportPayload(SAFETY_EXPORT_PROJECT as never, "a".repeat(64)),
    runs: [], sections: [], deliverables: [], risks: [], issues: [], decisions: [], meetings: [], engagement: null, scenarioSetLinks: [],
    projectFundingSnapshot: null,
    projectRecordsSnapshot: Object.fromEntries(["deliverables", "risks", "issues", "decisions", "meetings"].map((key) => [key, { count: 0, latestTitle: null, latestAt: null }])),
    stageGateSnapshot: buildProjectStageGateSnapshot(buildProjectStageGateSummary([], { templateId: "us_federal_aid_stage_gates_v0_1" })),
    modelingEvidence: [],
    safetyActionPlan: draft,
    safetyActionPlanSupport: support,
  } as unknown as ReportGenerationData;
  return data;
}

export function safetyReportHtml(): string {
  return buildReportHtml(safetyReportData());
}

export function ss4aPacketHtml(): string {
  const records = completeEvidenceRecords();
  records.bca = bcaRead() as never;
  const snapshot = evidenceSnapshot({ source_id: "fars-national" });
  records.safety = { status: "ready", snapshot, otherSeededArtifactCount: 0 };
  const drafts = buildSs4aSafetyDrafts(snapshot, SAFETY_EXPORT_PROJECT.name);
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
  return buildGrantApplicationHtml({
    opportunity: { id: EVIDENCE_IDS.opportunity, title: "Safe Streets and Roads for All (SS4A)", agency_name: "U.S. Department of Transportation", summary: null,
      expected_award_amount: null, closes_at: null, opportunity_status: null, decision_state: null },
    programTitle: null, sections, attachments: [], generatedAt: "2026-11-14T17:57:00.000Z",
    evidenceAppendices: buildSs4aEvidenceAppendices(records, new Set(SS4A_APPENDIX_KEYS)),
    safetySeedHistory: [drafts[0].provenance],
  });
}
