/**
 * Applied SS4A seeds as database rows for the shared PostgREST fake, built
 * from the seed route's own fixture so the fence is a real one.
 */

import { safetySeedHash } from "@/lib/reports/safety-plan-snapshot";
import { safetySeedFixture, SEED_DATE, SEED_PROJECT_PLACE } from "@/test/fixtures/grants/safety-seed";
import type { Db } from "./fake-my-work-tables";

type Row = Record<string, unknown>;

export const SEED_OPEN_OPPORTUNITY = "00000000-0000-4000-8000-000000000003";
export const SEED_AWARDED_OPPORTUNITY = "00000000-0000-4000-8000-000000000091";
export const SEED_UNREADABLE_OPPORTUNITY = "00000000-0000-4000-8000-000000000092";
export const MISSING_ARTIFACT = "00000000-0000-4000-8000-000000000099";

/**
 * Seed rows for one workspace. `fenced: false` uses a snapshot from before
 * the fence. The open application's seed is current until a test edits the
 * acquisition or the project.
 */
export function seedFenceRows(workspaceId: string, options: { fenced?: boolean } = {}): Db {
  const fixture = safetySeedFixture("fatal_only", { fenced: options.fenced ?? true });
  const projectId = fixture.project.id;
  const opportunity = (id: string, title: string, status: string): Row => ({
    id, workspace_id: workspaceId, project_id: projectId, title, opportunity_status: status,
  });
  return {
    projects: [{ id: projectId, workspace_id: workspaceId, name: fixture.project.name, ...SEED_PROJECT_PLACE }],
    funding_opportunities: [
      opportunity(SEED_OPEN_OPPORTUNITY, "SS4A planning grant", "open"),
      opportunity(SEED_AWARDED_OPPORTUNITY, "SS4A grant already awarded", "awarded"),
    ],
    report_artifacts: [{ ...fixture.artifact }],
    funding_opportunity_safety_seeds: [
      { id: "seed-open", workspace_id: workspaceId, opportunity_id: SEED_OPEN_OPPORTUNITY, artifact_id: fixture.artifact.id, created_at: "2026-10-19T12:00:00+00:00" },
      // An earlier receipt for the same application, replaced by the one above.
      { id: "seed-open-earlier", workspace_id: workspaceId, opportunity_id: SEED_OPEN_OPPORTUNITY, artifact_id: MISSING_ARTIFACT, created_at: "2026-10-18T12:30:00+00:00" },
      { id: "seed-awarded", workspace_id: workspaceId, opportunity_id: SEED_AWARDED_OPPORTUNITY, artifact_id: fixture.artifact.id, created_at: "2026-10-19T13:00:00+00:00" },
    ],
    safety_crash_ingests: [{
      id: String(fixture.acquisition.id), workspace_id: workspaceId, project_id: projectId,
      created_at: SEED_DATE, evidence_revision: fixture.acquisition.evidence_revision ?? null,
    }],
  };
}

const EARLIER_ARTIFACT = "00000000-0000-4000-8000-000000000098";
const SECTION = (n: number) => `00000000-0000-4000-8000-0000000002${String(n).padStart(2, "0")}`;
const DRAFT = (n: number) => `00000000-0000-4000-8000-0000000003${String(n).padStart(2, "0")}`;

/**
 * The open application seeded twice. `seed-open-earlier` came from an
 * earlier Safety report whose crash records have since changed (its fence
 * says revision 6; the acquisition is now at 7). `seed-open` came from the
 * regenerated report and is current. Two sections were finalized from the
 * earlier seed's drafts and kept when the application was seeded again, as
 * `apply_ss4a_safety_seed` does; one was finalized from the newest seed; one
 * holds only a working draft.
 */
export function reseededWithEarlierFinals(workspaceId: string): Db {
  const db = seedFenceRows(workspaceId);
  const current = db.report_artifacts[0];
  const payload: Row = { ...(current.metadata_json as Record<string, Row>).safetyPlanSnapshotV1 };
  delete payload.hash;
  const earlierPayload = { ...payload, artifactId: EARLIER_ARTIFACT, evidenceFence: { ...(payload.evidenceFence as Record<string, unknown>), acquisitionEvidenceRevision: "6" } };
  db.report_artifacts.push({
    ...current,
    id: EARLIER_ARTIFACT,
    metadata_json: { ...(current.metadata_json as Record<string, unknown>), safetyPlanSnapshotV1: { ...earlierPayload, hash: safetySeedHash(earlierPayload) } },
  });
  const earlier = db.funding_opportunity_safety_seeds.find((row) => row.id === "seed-open-earlier")!;
  earlier.artifact_id = EARLIER_ARTIFACT;
  const section = (n: number, title: string, sortOrder: number, status: string, finalizedFrom: string | null): Row => ({
    id: SECTION(n), workspace_id: workspaceId, opportunity_id: SEED_OPEN_OPPORTUNITY, title, sort_order: sortOrder, status, finalized_from_draft_id: finalizedFrom,
  });
  const draft = (n: number, sectionN: number, seedId: string): Row => ({
    id: DRAFT(n), workspace_id: workspaceId, opportunity_id: SEED_OPEN_OPPORTUNITY, section_id: SECTION(sectionN), origin: "safety_plan_seed", safety_seed_id: seedId,
  });
  db.funding_opportunity_application_sections = [
    section(6, "Budget narrative", 6, "final", DRAFT(6)),
    section(1, "Project overview", 1, "final", DRAFT(1)),
    section(2, "Safety problem and impact", 2, "final", DRAFT(12)),
    section(3, "Equity and underserved communities", 3, "operator_review", null),
  ];
  db.funding_opportunity_section_drafts = [
    draft(1, 1, "seed-open-earlier"),
    draft(6, 6, "seed-open-earlier"),
    draft(2, 2, "seed-open-earlier"),
    // The newest seed's drafts: one finalized, one still a working draft.
    draft(12, 2, "seed-open"),
    draft(13, 3, "seed-open"),
  ];
  return db;
}

/** Merge table rows, keeping both sides' rows. */
export function mergeDb(...dbs: Db[]): Db {
  const merged: Db = {};
  for (const db of dbs) {
    for (const [table, rows] of Object.entries(db)) merged[table] = [...(merged[table] ?? []), ...rows];
  }
  return merged;
}
