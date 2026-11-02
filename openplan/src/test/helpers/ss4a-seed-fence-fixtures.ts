/**
 * Applied SS4A seeds as database rows for the shared PostgREST fake, built
 * from the seed route's own fixture so the fence is a real one.
 */

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

/** Merge table rows, keeping both sides' rows. */
export function mergeDb(...dbs: Db[]): Db {
  const merged: Db = {};
  for (const db of dbs) {
    for (const [table, rows] of Object.entries(db)) merged[table] = [...(merged[table] ?? []), ...rows];
  }
  return merged;
}
