import { buildSafetyActionPlanSection } from "@/lib/reports/safety-action-plan";
import { buildSafetyCrashEvidence } from "@/lib/safety/crash-evidence";
import { SAFETY_CRASH_EVIDENCE_INGEST_PROJECTION } from "@/lib/safety/crash-evidence";
import { buildSafetyPlanSnapshot } from "@/lib/reports/safety-plan-snapshot";
import { SS4A_SECTION_KEYS, type SeedSourceRows } from "@/lib/grants/ss4a-safety-seed";

export const seedId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const SEED_DATE = "2026-10-18T12:00:00+00:00";
export function safetySeedFixture(completeness = "fatal_only"): SeedSourceRows {
  const [workspace, project, opportunity, report, artifact, ingest] = [1,2,3,4,5,6].map(seedId);
  const plan = { ingestId: ingest, attachments: [{ segmentId: "road:abc:0", segmentLabel: "Example Road", countermeasureIds: ["walkways"] }] };
  const acquisition = Object.fromEntries(SAFETY_CRASH_EVIDENCE_INGEST_PROJECTION.split(", ").map((key) => [key, null]));
  Object.assign(acquisition, { id: ingest, project_id: project, status: "ready", source_id: "fixture", source_label: "Recorded crash source", created_at: SEED_DATE,
    severity_completeness: completeness, crash_count: 0, geocoded_count: 0, stored_count: 0, truncated: false, years_requested: [2024], party_completeness: "not_supported" });
  const evidence = buildSafetyCrashEvidence({ id: ingest, projectId: project, status: "ready", severityCompleteness: completeness, sourceLabel: "Recorded crash source", attribution: null, crashCount: 0, geocodedCount: 0, storedCount: 0, truncated: false, yearsRequested: [2024], createdAt: SEED_DATE, dimensionCoverage: null, partyCompleteness: "not_supported", partyCount: null, involvementBasis: null },
    { severity: { fatal: 0, severe_injury: 0, injury: 0, pdo: 0, unknown: 0 }, role: null });
  const draft = buildSafetyActionPlanSection({ plan, evidence, network: { status: "unavailable", reason: "road_read_failed", basis: "fatal_only" } });
  const snapshot = buildSafetyPlanSnapshot({ artifactId: artifact, reportId: report, workspaceId: workspace, projectId: project, generatedAt: SEED_DATE, reportUpdatedAt: SEED_DATE, projectUpdatedAt: SEED_DATE, acquisition, selection: plan, draft });
  return { opportunity: { id: opportunity, workspace_id: workspace, project_id: project, pursuit_kind: "grant", updated_at: SEED_DATE },
    project: { id: project, workspace_id: workspace, name: "Example safety project", updated_at: SEED_DATE },
    report: { id: report, workspace_id: workspace, project_id: project, updated_at: SEED_DATE, metadata_json: { safetyActionPlan: plan, safetyIngestSelections: [{ ingestId: ingest }] } },
    artifact: { id: artifact, report_id: report, generated_at: SEED_DATE, metadata_json: { safetyPlanSnapshotV1: snapshot, generationWriteback: { schema: "openplan.report-generation-writeback.v1", reportUpdatedAt: SEED_DATE } } },
    acquisition,
    sections: SS4A_SECTION_KEYS.map((key, i) => ({ id: seedId(10+i), workspace_id: workspace, opportunity_id: opportunity, section_key: key, source: "catalog", status: i === 0 ? "final" : "not_started", final_markdown: i === 0 ? "Retain this approved text." : null, finalized_from_draft_id: null, updated_at: SEED_DATE })), drafts: [{ id: seedId(50), section_id: seedId(10) }] };
}
