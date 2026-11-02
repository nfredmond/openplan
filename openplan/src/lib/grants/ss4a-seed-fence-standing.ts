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
 * Seeding again only adds working drafts: `apply_ss4a_safety_seed` keeps
 * every final section and its `finalized_from_draft_id`, and the export
 * packages that final text. So an application's standing covers every seed
 * still reflected in it: the newest seed, plus each earlier seed whose draft
 * a final section was finalized from (final section -> draft ->
 * `safety_seed_id`). It is current only when all of them are current, stale
 * when any is stale, and unassessed otherwise.
 *
 * Five reads, all through the caller's client and all paged: the seed
 * receipts with their application and artifact embedded; the seeded
 * applications' final sections and their seed drafts; then the projects and
 * crash acquisitions those seeds cite. A seed made before the fence existed
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
/** Final sections of the seeded applications: the text the export packages (20260727000014). */
export const SS4A_SEED_STANDING_SECTION_SELECT = "id, opportunity_id, title, sort_order, status, finalized_from_draft_id";
/** Seed drafts and the receipt each came from (20261018000002). */
export const SS4A_SEED_STANDING_DRAFT_SELECT = "id, opportunity_id, section_id, safety_seed_id";

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
  /** The application's standing across every seed it still reflects. */
  standing: SeedFenceStanding;
  /** The newest seed alone: when stale, seeding again from a new report is the fix. */
  latestSeedState: SeedFenceStanding["state"];
  /** Final sections whose text came from an earlier seed that is now stale. */
  staleFinalSections: string[];
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
type Row = Record<string, unknown>;
type PagedRows = { rows: Row[]; failure: SeedFenceReadFailure | null };

function asRecord(value: unknown): Row | null {
  if (Array.isArray(value)) return asRecord(value[0]);
  return value && typeof value === "object" ? (value as Row) : null;
}

function asText(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

async function readPaged(
  label: string,
  build: (from: number, toInclusive: number) => PromiseLike<PageResult>,
): Promise<PagedRows> {
  try {
    const result = await readEveryPageAsResult<unknown, ReadError>(build, `The ${label} read stopped before its last page.`);
    if (result.error) {
      return { rows: [], failure: { label, message: result.error.message, pending: looksLikePendingSchema(result.error.message) } };
    }
    return { rows: (result.data ?? []) as Row[], failure: null };
  } catch (error) {
    return { rows: [], failure: { label, message: error instanceof Error ? error.message : "read threw", pending: false } };
  }
}

const NO_ROWS: PagedRows = { rows: [], failure: null };

const CRASH_RECORDS_CHANGED = "The crash records behind the seeded Safety report changed after it was generated.";
const PLACE_CHANGED = "The project's place changed after the seeded Safety report was generated.";
const PROJECT_RELINKED = "The application now links a different project than the seeded Safety report.";
const UNFENCED = "This seed was made before OpenPlan recorded which crash records a Safety report used, so it cannot be compared.";
const NO_SNAPSHOT = "The seeded artifact has no readable Safety snapshot, so it cannot be compared.";
const ARTIFACT_UNREADABLE = "The seeded Safety report artifact could not be read.";
const SOURCES_UNREADABLE = "The project or crash records behind this seed could not be read.";
const FINALS_UNREADABLE = "The final sections could not be read, so OpenPlan cannot tell which Safety report their text came from.";

function nameList(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** Names the final sections that came from an earlier seed, before that seed's reasons. */
function earlierSeedReason(titles: string[]): string {
  return `${nameList(titles)} ${titles.length === 1 ? "is" : "are"} still final from an earlier Safety seed.`;
}

type ReadSeed = { row: Row; artifact: Row | null; recognized: ReturnType<typeof readSafetyArtifactSnapshot> | null; snapshot: SnapshotV1 | null };
type SnapshotV1 = Extract<ReturnType<typeof readSafetyArtifactSnapshot>, { kind: "v1" }>["snapshot"];

function readSeed(row: Row): ReadSeed {
  const artifact = asRecord(row.report_artifacts);
  const recognized = artifact ? readSafetyArtifactSnapshot(asRecord(artifact.metadata_json)) : null;
  const snapshot = recognized?.kind === "v1" && recognized.snapshot.artifactId === artifact?.id ? recognized.snapshot : null;
  return { row, artifact, recognized, snapshot };
}

/**
 * Every seeded application in a workspace (or one project), judged across the
 * seeds it still reflects. Applications are returned whatever their status; a
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

  // Newest first, so the first receipt per application is its newest seed.
  const latestSeeds = new Map<string, Row>();
  const receiptsById = new Map<string, Row>();
  for (const row of seedsRead.rows) {
    const opportunityId = asText(row.opportunity_id);
    if (!opportunityId) continue;
    if (!latestSeeds.has(opportunityId)) latestSeeds.set(opportunityId, row);
    receiptsById.set(String(row.id), row);
  }
  const opportunityIds = [...latestSeeds.keys()];

  // Which seed each final section's text came from: section -> draft -> receipt.
  const [sectionsRead, draftsRead] = opportunityIds.length
    ? await Promise.all([
        readPaged("final sections of seeded SS4A applications", (from, to) =>
          client.from("funding_opportunity_application_sections").select(SS4A_SEED_STANDING_SECTION_SELECT)
            .eq("workspace_id", options.workspaceId).eq("status", "final").in("opportunity_id", opportunityIds)
            .order("id", { ascending: true }).range(from, to)),
        readPaged("Safety seed drafts", (from, to) =>
          client.from("funding_opportunity_section_drafts").select(SS4A_SEED_STANDING_DRAFT_SELECT)
            .eq("workspace_id", options.workspaceId).eq("origin", "safety_plan_seed").in("opportunity_id", opportunityIds)
            .order("id", { ascending: true }).range(from, to)),
      ])
    : [NO_ROWS, NO_ROWS];
  const finalsReadable = !sectionsRead.failure && !draftsRead.failure;
  const draftsById = new Map(draftsRead.rows.map((draft) => [String(draft.id), draft]));
  /** Application -> seed id -> the final sections finalized from that seed's drafts. */
  const finalsBySeed = new Map<string, Map<string, Array<{ title: string; sortOrder: number }>>>();
  for (const section of finalsReadable ? sectionsRead.rows : []) {
    const draft = draftsById.get(String(section.finalized_from_draft_id));
    const opportunityId = asText(section.opportunity_id);
    const seedId = asText(draft?.safety_seed_id);
    // The export refuses a draft from another section, so it is not this section's source.
    if (!draft || !opportunityId || !seedId || draft.section_id !== section.id || draft.opportunity_id !== opportunityId) continue;
    const bySeed = finalsBySeed.get(opportunityId) ?? new Map<string, Array<{ title: string; sortOrder: number }>>();
    bySeed.set(seedId, [...(bySeed.get(seedId) ?? []), { title: asText(section.title) ?? "(untitled section)", sortOrder: Number(section.sort_order ?? 0) }]);
    finalsBySeed.set(opportunityId, bySeed);
  }

  // The seeds still reflected in each application: its newest, and every one behind a final section.
  const reflectedSeeds = new Map<string, ReadSeed>();
  for (const [opportunityId, latest] of latestSeeds) {
    reflectedSeeds.set(String(latest.id), readSeed(latest));
    for (const seedId of finalsBySeed.get(opportunityId)?.keys() ?? []) {
      const receipt = receiptsById.get(seedId);
      if (receipt && receipt.opportunity_id === opportunityId) reflectedSeeds.set(seedId, readSeed(receipt));
    }
  }
  const seeds = [...reflectedSeeds.values()];
  const projectIds = [...new Set(seeds.flatMap(({ snapshot }) => (snapshot?.evidenceFence ? [snapshot.projectId] : [])))];
  const acquisitionIds = [...new Set(seeds.flatMap(({ snapshot }) => (snapshot?.evidenceFence ? [String(snapshot.acquisition.id)] : [])))];

  const [projectsRead, acquisitionsRead] = await Promise.all([
    projectIds.length
      ? readPaged("projects cited by SS4A seeds", (from, to) =>
          client.from("projects").select(SS4A_SEED_STANDING_PROJECT_SELECT).eq("workspace_id", options.workspaceId)
            .in("id", projectIds).order("id", { ascending: true }).range(from, to))
      : Promise.resolve(NO_ROWS),
    acquisitionIds.length
      ? readPaged("crash acquisitions cited by SS4A seeds", (from, to) =>
          client.from("safety_crash_ingests").select(SS4A_SEED_STANDING_ACQUISITION_SELECT).eq("workspace_id", options.workspaceId)
            .in("id", acquisitionIds).order("id", { ascending: true }).range(from, to))
      : Promise.resolve(NO_ROWS),
  ]);
  const sourceFailures = [projectsRead.failure, acquisitionsRead.failure].filter(
    (entry): entry is SeedFenceReadFailure => entry !== null
  );
  const projectsById = new Map(projectsRead.rows.map((project) => [String(project.id), project]));
  const acquisitionsById = new Map(acquisitionsRead.rows.map((acquisition) => [String(acquisition.id), acquisition]));

  /** One seed against its fence and the application's current project. */
  function judge(seed: ReadSeed | undefined, opportunityProjectId: string | null): SeedFenceStanding {
    if (!seed?.artifact) return { state: "unassessed", reasons: [ARTIFACT_UNREADABLE] };
    const { recognized, snapshot } = seed;
    const fence = snapshot?.evidenceFence ?? null;
    if (!recognized || !snapshot) return { state: "unassessed", reasons: [NO_SNAPSHOT] };
    if (!fence) return { state: "unassessed", reasons: [UNFENCED] };
    if (sourceFailures.length > 0) return { state: "unassessed", reasons: [SOURCES_UNREADABLE] };
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
    return reasons.length > 0 ? { state: "stale", reasons } : { state: "current" };
  }

  const entries = [...latestSeeds.entries()].map(([opportunityId, row]): Ss4aSeedFenceEntry => {
    const opportunity = asRecord(row.funding_opportunities);
    const opportunityProjectId = asText(opportunity?.project_id);
    const latestId = String(row.id);
    const latest = reflectedSeeds.get(latestId);
    const latestStanding = judge(latest, opportunityProjectId);
    const stale = latestStanding.state === "stale" ? [...latestStanding.reasons] : [];
    const unassessed = latestStanding.state === "unassessed" ? [...latestStanding.reasons] : [];
    const staleFinalSections: string[] = [];
    for (const [seedId, sections] of finalsBySeed.get(opportunityId) ?? []) {
      if (seedId === latestId) continue;
      const titles = [...sections].sort((left, right) => left.sortOrder - right.sortOrder).map((section) => section.title);
      const standing = judge(reflectedSeeds.get(seedId), opportunityProjectId);
      if (standing.state === "stale") {
        staleFinalSections.push(...titles);
        stale.push(earlierSeedReason(titles), ...standing.reasons);
      } else if (standing.state === "unassessed") {
        unassessed.push(earlierSeedReason(titles), ...standing.reasons);
      }
    }
    if (!finalsReadable) unassessed.push(FINALS_UNREADABLE);
    const standing: SeedFenceStanding = stale.length > 0
      ? { state: "stale", reasons: [...new Set(stale)] }
      : unassessed.length > 0
        ? { state: "unassessed", reasons: [...new Set(unassessed)] }
        : { state: "current" };
    return {
      opportunityId,
      title: asText(opportunity?.title) ?? "(untitled application)",
      opportunityStatus: asText(opportunity?.opportunity_status),
      projectId: opportunityProjectId,
      seedId: latestId,
      seededAt: asText(row.created_at),
      reportId: asText(latest?.artifact?.report_id) ?? latest?.snapshot?.reportId ?? null,
      artifactId: String(row.artifact_id),
      standing,
      latestSeedState: latestStanding.state,
      staleFinalSections,
    };
  });

  const failures = [sectionsRead.failure, draftsRead.failure, ...sourceFailures].filter(
    (entry): entry is SeedFenceReadFailure => entry !== null
  );
  return { entries, failures };
}
