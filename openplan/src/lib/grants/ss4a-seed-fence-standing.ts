/**
 * WHETHER EACH SEEDED SS4A APPLICATION STILL MATCHES ITS SAFETY EVIDENCE.
 *
 * A Safety seed copies a frozen Safety report into an SS4A application's
 * working drafts. A fenced snapshot records the crash acquisition's
 * `evidence_revision` and a hash of the project's place when the report was
 * generated (`readSafetyPlanEvidenceFence`). The seed route refuses to seed
 * again once either moves; this reader asks the same question of seeds that
 * were already applied, with the same comparison (`safetySeedFenceChanges`).
 *
 * Three reads, all through the caller's client and all paged: the seed
 * receipts with their application and artifact embedded, then the cited
 * projects and crash acquisitions. A seed made before the fence existed
 * cannot be compared and stays `unassessed`, never current.
 *
 * This module writes nothing.
 */

import { readSafetyArtifactSnapshot } from "@/lib/reports/safety-comparison-snapshot";
import { PROJECT_PLACE_SCOPE_COLUMNS } from "@/lib/projects/project-place";
import { looksLikePendingSchema } from "@/lib/supabase/pending-schema";
import { readEveryPageAsResult } from "@/lib/supabase/paged-read";
import { safetySeedFenceChanges } from "./ss4a-safety-seed";

/** One receipt per applied seed (20261018000002), with what it seeded from. */
export const SS4A_SEED_STANDING_SELECT =
  "id, opportunity_id, artifact_id, created_at, funding_opportunities!inner(id, workspace_id, title, project_id, opportunity_status), report_artifacts(id, report_id, metadata_json)";
/** The place columns the fence hashes, plus the row's identity. */
export const SS4A_SEED_STANDING_PROJECT_SELECT = `id, workspace_id, ${PROJECT_PLACE_SCOPE_COLUMNS}`;
export const SS4A_SEED_STANDING_ACQUISITION_SELECT = "id, project_id, evidence_revision";

type SeedFenceStanding =
  | { state: "current" }
  | { state: "stale"; reasons: string[] }
  | { state: "unassessed"; reasons: string[] };

type Ss4aSeedFenceEntry = {
  opportunityId: string;
  title: string;
  opportunityStatus: string | null;
  projectId: string | null;
  seedId: string;
  seededAt: string | null;
  reportId: string | null;
  artifactId: string;
  standing: SeedFenceStanding;
};

type SeedFenceReadFailure = { label: string; message: string; pending: boolean };

export type Ss4aSeedFenceLoad = {
  entries: Ss4aSeedFenceEntry[];
  failures: SeedFenceReadFailure[];
};

type ReadError = { message: string; code?: string | null };
type PageResult = { data: unknown[] | null; error: ReadError | null };
type SeedQuery = PromiseLike<PageResult> & {
  eq(column: string, value: string): SeedQuery;
  in(column: string, values: readonly string[]): SeedQuery;
  order(column: string, options: { ascending: boolean }): SeedQuery;
  range(from: number, toInclusive: number): SeedQuery;
};
type SeedClient = { from(table: string): { select(columns: string): SeedQuery } };

function asRecord(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) return asRecord(value[0]);
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function asText(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

async function readPaged(
  label: string,
  build: (from: number, toInclusive: number) => PromiseLike<PageResult>,
): Promise<{ rows: Array<Record<string, unknown>>; failure: SeedFenceReadFailure | null }> {
  try {
    const result = await readEveryPageAsResult<unknown, ReadError>(build, `The ${label} read stopped before its last page.`);
    if (result.error) {
      return { rows: [], failure: { label, message: result.error.message, pending: looksLikePendingSchema(result.error.message) } };
    }
    return { rows: (result.data ?? []) as Array<Record<string, unknown>>, failure: null };
  } catch (error) {
    return { rows: [], failure: { label, message: error instanceof Error ? error.message : "read threw", pending: false } };
  }
}

const CRASH_RECORDS_CHANGED = "The crash records behind the seeded Safety report changed after it was generated.";
const PLACE_CHANGED = "The project's place changed after the seeded Safety report was generated.";
const PROJECT_RELINKED = "The application now links a different project than the seeded Safety report.";
const UNFENCED = "This seed was made before OpenPlan recorded which crash records a Safety report used, so it cannot be compared.";
const NO_SNAPSHOT = "The seeded artifact has no readable Safety snapshot, so it cannot be compared.";
const ARTIFACT_UNREADABLE = "The seeded Safety report artifact could not be read.";
const SOURCES_UNREADABLE = "The project or crash records behind this seed could not be read.";

/**
 * The latest seed per application in a workspace (or one project), each judged
 * against its fence. Applications are returned whatever their status; a
 * caller decides which ones are still work.
 */
export async function loadSs4aSeedFenceStanding(
  supabase: unknown,
  options: { workspaceId: string; projectId?: string | null }
): Promise<Ss4aSeedFenceLoad> {
  const client = supabase as SeedClient;
  const seedsRead = await readPaged("seeded SS4A applications", (from, to) => {
    let query = client.from("funding_opportunity_safety_seeds").select(SS4A_SEED_STANDING_SELECT).eq("workspace_id", options.workspaceId);
    if (options.projectId) query = query.eq("funding_opportunities.project_id", options.projectId);
    return query.order("created_at", { ascending: false }).order("id", { ascending: false }).range(from, to);
  });
  if (seedsRead.failure) return { entries: [], failures: [seedsRead.failure] };

  // Newest first, so the first receipt per application is its current seed.
  const latestSeeds = new Map<string, Record<string, unknown>>();
  for (const row of seedsRead.rows) {
    const opportunityId = asText(row.opportunity_id);
    if (opportunityId && !latestSeeds.has(opportunityId)) latestSeeds.set(opportunityId, row);
  }

  const seeds = [...latestSeeds.values()].map((row) => {
    const artifact = asRecord(row.report_artifacts);
    const recognized = artifact ? readSafetyArtifactSnapshot(asRecord(artifact.metadata_json)) : null;
    const snapshot = recognized?.kind === "v1" && recognized.snapshot.artifactId === artifact?.id ? recognized.snapshot : null;
    return { row, artifact, recognized, snapshot };
  });
  const projectIds = [...new Set(seeds.flatMap(({ snapshot }) => (snapshot?.evidenceFence ? [snapshot.projectId] : [])))];
  const acquisitionIds = [...new Set(seeds.flatMap(({ snapshot }) => (snapshot?.evidenceFence ? [String(snapshot.acquisition.id)] : [])))];

  const [projectsRead, acquisitionsRead] = await Promise.all([
    projectIds.length
      ? readPaged("projects cited by SS4A seeds", (from, to) =>
          client.from("projects").select(SS4A_SEED_STANDING_PROJECT_SELECT).eq("workspace_id", options.workspaceId)
            .in("id", projectIds).order("id", { ascending: true }).range(from, to))
      : Promise.resolve({ rows: [], failure: null }),
    acquisitionIds.length
      ? readPaged("crash acquisitions cited by SS4A seeds", (from, to) =>
          client.from("safety_crash_ingests").select(SS4A_SEED_STANDING_ACQUISITION_SELECT).eq("workspace_id", options.workspaceId)
            .in("id", acquisitionIds).order("id", { ascending: true }).range(from, to))
      : Promise.resolve({ rows: [], failure: null }),
  ]);
  const failures = [projectsRead.failure, acquisitionsRead.failure].filter(
    (entry): entry is SeedFenceReadFailure => entry !== null
  );
  const projectsById = new Map(projectsRead.rows.map((project) => [String(project.id), project]));
  const acquisitionsById = new Map(acquisitionsRead.rows.map((acquisition) => [String(acquisition.id), acquisition]));

  const entries = seeds.map(({ row, artifact, recognized, snapshot }): Ss4aSeedFenceEntry => {
    const opportunity = asRecord(row.funding_opportunities);
    const opportunityProjectId = asText(opportunity?.project_id);
    const fence = snapshot?.evidenceFence ?? null;
    let standing: SeedFenceStanding;
    if (!artifact) standing = { state: "unassessed", reasons: [ARTIFACT_UNREADABLE] };
    else if (!recognized || !snapshot) standing = { state: "unassessed", reasons: [NO_SNAPSHOT] };
    else if (!fence) standing = { state: "unassessed", reasons: [UNFENCED] };
    else if (failures.length > 0) standing = { state: "unassessed", reasons: [SOURCES_UNREADABLE] };
    else {
      const acquisition = acquisitionsById.get(String(snapshot.acquisition.id));
      const changes = safetySeedFenceChanges(
        fence,
        acquisition && acquisition.project_id === snapshot.projectId ? acquisition : null,
        projectsById.get(snapshot.projectId) ?? null,
      );
      const reasons = [
        ...(changes.crashRecords ? [CRASH_RECORDS_CHANGED] : []),
        ...(changes.projectPlace ? [PLACE_CHANGED] : []),
        ...(opportunityProjectId !== snapshot.projectId ? [PROJECT_RELINKED] : []),
      ];
      standing = reasons.length > 0 ? { state: "stale", reasons } : { state: "current" };
    }
    return {
      opportunityId: String(row.opportunity_id),
      title: asText(opportunity?.title) ?? "(untitled application)",
      opportunityStatus: asText(opportunity?.opportunity_status),
      projectId: opportunityProjectId,
      seedId: String(row.id),
      seededAt: asText(row.created_at),
      reportId: asText(artifact?.report_id) ?? snapshot?.reportId ?? null,
      artifactId: String(row.artifact_id),
      standing,
    };
  });

  return { entries, failures };
}
