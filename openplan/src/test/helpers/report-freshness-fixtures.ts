/**
 * Report packets in every freshness state, as database rows for the shared
 * PostgREST fake (`fake-my-work-tables.ts`). The loader test, the page-parity
 * test and the My Work test read the same rows, so a rule that drifts between
 * surfaces fails in all three.
 */

import { buildProjectJurisdictionReadinessExportPayload } from "@/lib/jurisdiction-readiness/payload";
import { jurisdictionReadinessRegistrySha256 } from "@/lib/jurisdiction-readiness/custody";
import type { Db } from "./fake-my-work-tables";

export const FRESH_WS = "aaaaaaaa-0000-4000-8000-000000000001";
export const FRESH_WS_B = "bbbbbbbb-0000-4000-8000-000000000002";
export const FRESH_P1 = "11111111-0000-4000-8000-000000000001";
export const FRESH_P2 = "22222222-0000-4000-8000-000000000002";
export const FRESH_P_B = "33333333-0000-4000-8000-000000000003";

export const GENERATED = "2026-10-20T12:00:00.000Z";
export const EARLIER = "2026-10-19T12:00:00.000Z";
export const LATER = "2026-10-21T12:00:00.000Z";

export const BASIS_REASON = "Model run Base year 2026 succeeded after this packet was generated.";

type Row = Record<string, unknown>;

export function freshnessProject(id: string, workspaceId: string, name: string): Row {
  return {
    id, workspace_id: workspaceId, name, updated_at: EARLIER,
    jurisdiction_context: null, place_label: null, place_country_code: null, place_subdivision_code: null,
  };
}

/** Artifact metadata current generation writes: a writeback receipt and a v4 jurisdiction fingerprint. */
export function currentArtifactMetadata(project: Row, reportUpdatedAt: string): Record<string, unknown> {
  return {
    sourceContext: {
      jurisdictionReadiness: buildProjectJurisdictionReadinessExportPayload(project, jurisdictionReadinessRegistrySha256()),
    },
    generationWriteback: { schema: "openplan.report-generation-writeback.v1", reportUpdatedAt },
  };
}

function report(id: string, workspaceId: string, projectId: string | null, title: string, extra: Row = {}): Row {
  return {
    id, workspace_id: workspaceId, project_id: projectId, rtp_cycle_id: null, engagement_campaign_id: null,
    land_use_plan_id: null, title, report_type: "project_status", status: "generated", summary: null,
    generated_at: GENERATED, latest_artifact_kind: "html", created_at: EARLIER, updated_at: GENERATED,
    metadata_json: {}, rtp_basis_stale: false, rtp_basis_stale_reason: null, rtp_basis_stale_marked_at: null,
    ...extra,
  };
}

/**
 * - `r-current`: the latest artifact matches; an older artifact that would not.
 * - `r-edited`: the report changed after its writeback receipt.
 * - `r-crash`: a crash acquisition arrived after generation. The registry
 *   calls it stale; the Project page's rule does not read crash acquisitions.
 * - `r-basis`: current by both rules, but flagged by an upstream model run.
 * - `r-none`: never generated.
 * - `r-archived`: stale but archived.
 * - `r-decoy`: stale, in another workspace.
 */
export function buildFreshnessDb(): Db {
  const p1 = freshnessProject(FRESH_P1, FRESH_WS, "Main Street corridor");
  const p2 = freshnessProject(FRESH_P2, FRESH_WS, "Downtown safety plan");
  const pB = freshnessProject(FRESH_P_B, FRESH_WS_B, "Another agency's project");
  return {
    projects: [p1, p2, pB],
    reports: [
      report("r-current", FRESH_WS, FRESH_P1, "Current corridor packet"),
      report("r-edited", FRESH_WS, FRESH_P1, "Edited corridor packet", { updated_at: LATER }),
      report("r-crash", FRESH_WS, FRESH_P2, "Safety packet with new crashes"),
      report("r-basis", FRESH_WS, FRESH_P1, "Packet behind a new model run", {
        rtp_basis_stale: true, rtp_basis_stale_reason: BASIS_REASON, rtp_basis_stale_marked_at: LATER,
      }),
      report("r-none", FRESH_WS, FRESH_P1, "Packet never generated", { generated_at: null, latest_artifact_kind: null }),
      report("r-archived", FRESH_WS, FRESH_P1, "Archived edited packet", { status: "archived", updated_at: LATER }),
      report("r-decoy", FRESH_WS_B, FRESH_P_B, "Other workspace packet", { updated_at: LATER }),
    ],
    report_artifacts: [
      { id: "a-current", report_id: "r-current", generated_at: GENERATED, metadata_json: currentArtifactMetadata(p1, GENERATED) },
      // Older and mismatched: chosen instead of the latest, it would make r-current stale.
      { id: "a-current-old", report_id: "r-current", generated_at: EARLIER, metadata_json: currentArtifactMetadata(p1, EARLIER) },
      { id: "a-edited", report_id: "r-edited", generated_at: GENERATED, metadata_json: currentArtifactMetadata(p1, GENERATED) },
      { id: "a-crash", report_id: "r-crash", generated_at: GENERATED, metadata_json: currentArtifactMetadata(p2, GENERATED) },
      { id: "a-basis", report_id: "r-basis", generated_at: GENERATED, metadata_json: currentArtifactMetadata(p1, GENERATED) },
      { id: "a-archived", report_id: "r-archived", generated_at: GENERATED, metadata_json: currentArtifactMetadata(p1, GENERATED) },
      { id: "a-decoy", report_id: "r-decoy", generated_at: GENERATED, metadata_json: currentArtifactMetadata(pB, GENERATED) },
    ],
    safety_crash_ingests: [
      { id: "ingest-p2-new", workspace_id: FRESH_WS, project_id: FRESH_P2, created_at: LATER, evidence_revision: 3 },
      { id: "ingest-p1-old", workspace_id: FRESH_WS, project_id: FRESH_P1, created_at: EARLIER, evidence_revision: 1 },
    ],
    rtp_cycles: [],
    runs: [],
    county_runs: [],
    modeling_claim_decisions: [],
  };
}
