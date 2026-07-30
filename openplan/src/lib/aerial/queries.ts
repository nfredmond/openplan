/**
 * Aerial data-access provider — the aerial module's read surface for NON-aerial
 * callers. Part of the separability boundary (see `./public`): the rest of
 * OpenPlan must not issue raw `.from("aerial_missions" | "aerial_evidence_packages")`
 * reads, because that binds unrelated code to the aerial schema and blocks the
 * aerial module from ever moving/renaming its own tables. Callers load aerial
 * rows through these purpose-shaped loaders instead.
 *
 * Each loader encapsulates the `looksLikePendingSchema` guard so a not-yet-applied
 * aerial migration degrades to empty results (never a hard failure) exactly as
 * the inlined reads did.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { looksLikePendingSchema } from "@/lib/models/run-launch";
import type { AerialProjectPosture } from "@/lib/aerial/catalog";
import {
  AERIAL_ARTIFACT_CUSTODY_COLUMNS,
  type AerialArtifactCustodyRecord,
} from "@/lib/aerial/artifact-custody";

export type AerialQuerySupabaseLike = Pick<SupabaseClient, "from">;

/**
 * Minimal supabase shape for the workspace posture roll-up — a `.from().select()
 * .eq().limit()` chain that awaits to `{ data, error }`. Deliberately narrow so
 * it is satisfied by BOTH the real client and the operations summary's own
 * narrowed test seam (WorkspaceOperationsSupabaseLike), without coupling the
 * aerial module to the operations types.
 */
type WorkspacePostureQueryResult = { data: unknown[] | null; error?: { message?: string } | null };
type WorkspacePostureSupabaseLike = {
  from: (table: string) => {
    select: (query: string) => {
      eq: (
        column: string,
        value: string
      ) => { limit: (count: number) => PromiseLike<WorkspacePostureQueryResult> };
    };
  };
};

/** Cap on workspace-wide aerial rows fetched for the operations posture roll-up. */
const MAX_WORKSPACE_AERIAL_ROWS = 500;

// ── Workspace operations posture inputs ──────────────────────────────────
export type WorkspaceAerialMissionRow = { id: string; status: string; mission_type: string };
export type WorkspaceAerialPackageRow = { id: string; status: string; verification_readiness: string };

export async function loadWorkspaceAerialPostureInputs(
  supabase: WorkspacePostureSupabaseLike,
  workspaceId: string
): Promise<{ missions: WorkspaceAerialMissionRow[]; packages: WorkspaceAerialPackageRow[] }> {
  const missionsResult = await supabase
    .from("aerial_missions")
    .select("id, status, mission_type")
    .eq("workspace_id", workspaceId)
    .limit(MAX_WORKSPACE_AERIAL_ROWS);
  const missions = looksLikePendingSchema(missionsResult.error?.message)
    ? []
    : ((missionsResult.data ?? []) as WorkspaceAerialMissionRow[]);

  const packagesResult = await supabase
    .from("aerial_evidence_packages")
    .select("id, status, verification_readiness")
    .eq("workspace_id", workspaceId)
    .limit(MAX_WORKSPACE_AERIAL_ROWS);
  const packages = looksLikePendingSchema(packagesResult.error?.message)
    ? []
    : ((packagesResult.data ?? []) as WorkspaceAerialPackageRow[]);

  return { missions, packages };
}

// ── Map-feature count: missions with a drawn AOI ─────────────────────────
/**
 * Returns the (awaitable) count query so callers can compose it inside their own
 * `Promise.all` and keep the PostgREST `{ count, error }` result shape. Not
 * awaited here.
 */
export function aerialMissionsWithAoiCountQuery(supabase: AerialQuerySupabaseLike, workspaceId: string) {
  return supabase
    .from("aerial_missions")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .not("aoi_geojson", "is", null);
}

// ── Per-project posture inputs across a project list ─────────────────────
export type ProjectListAerialMissionRow = { id: string; project_id: string; status: string };
export type ProjectListAerialPackageRow = {
  mission_id: string;
  project_id: string;
  status: string;
  verification_readiness: string;
};

export async function loadAerialPostureInputsForProjects(
  supabase: AerialQuerySupabaseLike,
  projectIds: string[]
): Promise<{ missions: ProjectListAerialMissionRow[]; packages: ProjectListAerialPackageRow[] }> {
  if (projectIds.length === 0) return { missions: [], packages: [] };

  const missionsResult = await supabase
    .from("aerial_missions")
    .select("id, project_id, status")
    .in("project_id", projectIds);
  const missions = looksLikePendingSchema(missionsResult.error?.message)
    ? []
    : ((missionsResult.data ?? []) as ProjectListAerialMissionRow[]);

  const missionIds = missions.map((m) => m.id);
  if (missionIds.length === 0) return { missions, packages: [] };

  const packagesResult = await supabase
    .from("aerial_evidence_packages")
    .select("mission_id, project_id, status, verification_readiness")
    .in("mission_id", missionIds);
  const packages = looksLikePendingSchema(packagesResult.error?.message)
    ? []
    : ((packagesResult.data ?? []) as ProjectListAerialPackageRow[]);

  return { missions, packages };
}

// ── Full mission + package rows for one project (detail page) ─────────────
export type ProjectAerialMissionRow = {
  id: string;
  title: string;
  status: string;
  mission_type: string;
  geography_label: string | null;
  collected_at: string | null;
  updated_at: string;
};
export type ProjectAerialPackageRow = {
  id: string;
  mission_id: string;
  title: string;
  package_type: string;
  status: string;
  verification_readiness: string;
  updated_at: string;
};

export async function loadAerialMissionsAndPackagesForProject(
  supabase: AerialQuerySupabaseLike,
  projectId: string
): Promise<{ missions: ProjectAerialMissionRow[]; packages: ProjectAerialPackageRow[]; pending: boolean }> {
  const missionsResult = await supabase
    .from("aerial_missions")
    .select("id, title, status, mission_type, geography_label, collected_at, updated_at")
    .eq("project_id", projectId)
    .order("updated_at", { ascending: false });
  const missionsPending = looksLikePendingSchema(missionsResult.error?.message);
  const missions = missionsPending
    ? []
    : ((missionsResult.data ?? []) as ProjectAerialMissionRow[]);

  const missionIds = missions.map((m) => m.id);
  if (missionIds.length === 0) return { missions, packages: [], pending: missionsPending };

  const packagesResult = await supabase
    .from("aerial_evidence_packages")
    .select("id, mission_id, title, package_type, status, verification_readiness, updated_at")
    .in("mission_id", missionIds)
    .order("updated_at", { ascending: false });
  const packagesPending = looksLikePendingSchema(packagesResult.error?.message);
  const packages = packagesPending
    ? []
    : ((packagesResult.data ?? []) as ProjectAerialPackageRow[]);

  return { missions, packages, pending: missionsPending || packagesPending };
}

// ── Report source-context inputs for one project ─────────────────────────
/**
 * Mission fields the report packet's aerial provenance summary reads. Wider
 * than the detail-page loader above on purpose: the summary's readiness
 * verdict turns on `aoi_geojson` (a missing AOI blocks map-exhibit use), so
 * reusing the narrower detail shape here would report every mission as
 * blocked no matter what the row actually says.
 */
export type ProjectAerialSourceContextMissionRow = {
  id: string;
  title: string | null;
  status: string | null;
  mission_type: string | null;
  project_id: string | null;
  aoi_geojson: unknown;
  updated_at: string | null;
};

/** Package fields the same summary reads — `notes` IS the source-context text. */
export type ProjectAerialSourceContextPackageRow = {
  id: string;
  mission_id: string;
  title: string | null;
  status: string | null;
  verification_readiness: string | null;
  notes: string | null;
  updated_at: string | null;
};

export type ProjectAerialSourceContextRows = {
  missions: ProjectAerialSourceContextMissionRow[];
  packages: ProjectAerialSourceContextPackageRow[];
  /**
   * Why the aerial rows could NOT be read, or null when the read succeeded —
   * including the ordinary "this project has no aerial work" case, which is a
   * successful read of zero rows and must stay distinguishable from a failure.
   *
   * The other loaders in this file swallow a pending-schema error into an empty
   * result because their callers only tint a posture chip. A generated report
   * artifact is a durable record an agency publishes, so its caller has to be
   * able to say "this could not be read" instead of "there is none".
   */
  unreadableReason: string | null;
};

function aerialReadFailureReason(subject: string, message: string | undefined): string {
  return looksLikePendingSchema(message)
    ? `The aerial tables are not present in this database, so ${subject} could not be read.`
    : `${subject} could not be read: ${message ?? "unknown database error"}`;
}

/**
 * Load the mission and evidence-package rows a report needs to describe its
 * aerial provenance.
 *
 * Packages are fetched by BOTH the project link and the loaded mission ids, and
 * merged. Fetching only by mission id would make an untraceable package
 * impossible to observe (the summary's `orphanPackageCount` would always be
 * zero); fetching only by project id would miss packages whose own project link
 * is null while their mission belongs to the project. A package that survives
 * the merge but names a mission that is not in the mission list is genuinely
 * untraceable — which is exactly the signal the report summary reports.
 */
export async function loadAerialSourceContextRowsForProject(
  supabase: AerialQuerySupabaseLike,
  projectId: string
): Promise<ProjectAerialSourceContextRows> {
  const missionsResult = await supabase
    .from("aerial_missions")
    .select("id, title, status, mission_type, project_id, aoi_geojson, updated_at")
    .eq("project_id", projectId)
    .order("updated_at", { ascending: false });

  if (missionsResult.error) {
    return {
      missions: [],
      packages: [],
      unreadableReason: aerialReadFailureReason(
        "aerial missions for this project",
        missionsResult.error.message
      ),
    };
  }

  const missions = (missionsResult.data ?? []) as ProjectAerialSourceContextMissionRow[];
  const missionIds = missions.map((mission) => mission.id);
  const packageColumns = "id, mission_id, title, status, verification_readiness, notes, updated_at";

  const [projectPackagesResult, missionPackagesResult] = await Promise.all([
    supabase
      .from("aerial_evidence_packages")
      .select(packageColumns)
      .eq("project_id", projectId)
      .order("updated_at", { ascending: false }),
    missionIds.length > 0
      ? supabase
          .from("aerial_evidence_packages")
          .select(packageColumns)
          .in("mission_id", missionIds)
          .order("updated_at", { ascending: false })
      : Promise.resolve({ data: [] as unknown[], error: null }),
  ]);

  const packageError = projectPackagesResult.error ?? missionPackagesResult.error;
  if (packageError) {
    return {
      missions: [],
      packages: [],
      unreadableReason: aerialReadFailureReason(
        "aerial evidence packages for this project",
        packageError.message
      ),
    };
  }

  const packagesById = new Map<string, ProjectAerialSourceContextPackageRow>();
  for (const row of [
    ...((projectPackagesResult.data ?? []) as ProjectAerialSourceContextPackageRow[]),
    ...((missionPackagesResult.data ?? []) as ProjectAerialSourceContextPackageRow[]),
  ]) {
    packagesById.set(row.id, row);
  }

  return { missions, packages: [...packagesById.values()], unreadableReason: null };
}

// ── Artifact custody for a mission's processing jobs ─────────────────────
/**
 * Every custody row for a mission, grouped by processing job.
 *
 * WHY IT RETURNS A REASON RATHER THAN AN EMPTY MAP ON FAILURE. Custody is the
 * answer to "do we still have the orthomosaic?", and an unreadable table
 * rendered as "no artifacts" would answer that question wrongly in the
 * reassuring direction — the exact shape of the defect custody exists to close.
 * The pending-schema case (custody migration not applied) is reported too, for
 * the same reason: a deployment that has not applied 20260730000004 is not
 * holding bytes, and must not be shown as though it were.
 *
 * The projection is `AERIAL_ARTIFACT_CUSTODY_COLUMNS`, shared with the write
 * engine so the summarizer and the writer cannot disagree about which columns
 * exist — Supabase clients here are untyped, and a column dropped from a
 * `.select()` is `undefined` at runtime with nothing failing at build.
 */
export async function loadAerialArtifactCustodyForMission(
  supabase: AerialQuerySupabaseLike,
  missionId: string
): Promise<{
  byProcessingJobId: Map<string, AerialArtifactCustodyRecord[]>;
  unreadableReason: string | null;
}> {
  const result = await supabase
    .from("aerial_artifact_custody")
    .select(AERIAL_ARTIFACT_CUSTODY_COLUMNS + ", processing_job_id")
    .eq("mission_id", missionId)
    .order("kind", { ascending: true });

  if (result.error) {
    return {
      byProcessingJobId: new Map(),
      unreadableReason: looksLikePendingSchema(result.error.message)
        ? "The aerial artifact custody table is not present in this database (migration 20260730000004 has not been applied), so whether OpenPlan holds this mission's processing outputs cannot be established."
        : `Artifact custody for this mission could not be read: ${result.error.message ?? "unknown database error"}`,
    };
  }

  const byProcessingJobId = new Map<string, AerialArtifactCustodyRecord[]>();
  for (const row of ((result.data ?? []) as unknown) as Array<
    AerialArtifactCustodyRecord & { processing_job_id: string }
  >) {
    const existing = byProcessingJobId.get(row.processing_job_id) ?? [];
    existing.push(row);
    byProcessingJobId.set(row.processing_job_id, existing);
  }

  return { byProcessingJobId, unreadableReason: null };
}

// ── Cached project posture (aerial-owned table) ──────────────────────────
/**
 * Reads the authoritative cached aerial posture for a project from the
 * aerial-owned `aerial_project_posture` table (written by rebuildAerialProjectPosture).
 * Degrades to a null posture if the row is absent or the migration is pending.
 */
export async function loadAerialProjectPosture(
  supabase: AerialQuerySupabaseLike,
  projectId: string
): Promise<{ posture: AerialProjectPosture | null; updatedAt: string | null }> {
  const result = await supabase
    .from("aerial_project_posture")
    .select("posture, updated_at")
    .eq("project_id", projectId)
    .maybeSingle();

  if (looksLikePendingSchema(result.error?.message) || result.error || !result.data) {
    return { posture: null, updatedAt: null };
  }

  const row = result.data as { posture: AerialProjectPosture | null; updated_at: string | null };
  return { posture: row.posture ?? null, updatedAt: row.updated_at ?? null };
}

// ── Imagery processing jobs for one mission (detail page) ────────────────
/**
 * Every column the mission page's processing surface renders.
 *
 * PINNED AS A CONSTANT ON PURPOSE. Supabase clients in this repo are
 * deliberately untyped (see CLAUDE.md), so a column dropped from this string is
 * `undefined` at runtime and silent at build. The page test asserts against
 * THIS string as well as against the rendered DOM, because a page test that
 * mocks the client gets its fixture back no matter what was projected — the
 * fixture would keep rendering a `dispatch_error` the query stopped asking for.
 */
export const AERIAL_PROCESSING_JOB_SELECT = [
  "id",
  "request_id",
  "job_reference",
  "status",
  "progress",
  "message",
  "preset_id",
  "imagery_url",
  "imagery_image_count",
  "imagery_size_bytes",
  "artifacts",
  "benchmark_summary",
  "last_callback_id",
  "last_callback_at",
  "dispatch_error",
  "created_at",
  "updated_at",
].join(", ");

/**
 * Cap on jobs shown for a single mission; newest first, so the cap drops the oldest.
 *
 * The loader asks for ONE MORE than this and reports whether it got it. A capped
 * list rendered as "N total" would be the page stating a count it did not
 * establish — the same class of claim as rendering a failed read as zero, just
 * quieter. `truncated` is what lets the page say "the N most recent" instead.
 */
export const MAX_MISSION_PROCESSING_JOBS = 50;

export type AerialProcessingJobRow = {
  id: string;
  request_id: string;
  job_reference: string | null;
  status: string;
  progress: number | string | null;
  message: string | null;
  preset_id: string | null;
  imagery_url: string | null;
  imagery_image_count: number | null;
  imagery_size_bytes: number | null;
  artifacts: unknown;
  benchmark_summary: unknown;
  last_callback_id: string | null;
  last_callback_at: string | null;
  dispatch_error: string | null;
  created_at: string;
  updated_at: string;
};

export type MissionAerialProcessingJobs = {
  jobs: AerialProcessingJobRow[];
  /**
   * Why the jobs could NOT be read, or null when the read succeeded — including
   * the ordinary "this mission has never been dispatched" case, which is a
   * successful read of zero rows.
   *
   * Unlike the posture loaders above, this one does NOT swallow a pending-schema
   * error into an empty list. The page it feeds is where an operator goes to
   * find out whether a flight they dispatched is running; answering "no jobs"
   * to a failed read there is the difference between "nothing was dispatched"
   * and "OpenPlan cannot see what was dispatched", and an operator acts
   * differently on each.
   */
  unreadableReason: string | null;
  /**
   * True when the mission has MORE jobs than `MAX_MISSION_PROCESSING_JOBS`, so
   * `jobs` is the newest page of them rather than all of them. The page must
   * say "the N most recent" rather than "N total" when this is set.
   */
  truncated: boolean;
};

export async function loadAerialProcessingJobsForMission(
  supabase: AerialQuerySupabaseLike,
  params: { workspaceId: string; missionId: string }
): Promise<MissionAerialProcessingJobs> {
  const result = await supabase
    .from("aerial_processing_jobs")
    .select(AERIAL_PROCESSING_JOB_SELECT)
    .eq("workspace_id", params.workspaceId)
    .eq("mission_id", params.missionId)
    .order("created_at", { ascending: false })
    // One more than the cap: the extra row is never rendered, it only answers
    // "is this list all of them?" without a second COUNT query.
    .limit(MAX_MISSION_PROCESSING_JOBS + 1);

  if (result.error) {
    return {
      jobs: [],
      truncated: false,
      unreadableReason: aerialReadFailureReason(
        "imagery processing jobs for this mission",
        result.error.message
      ),
    };
  }

  const rows = (result.data ?? []) as unknown as AerialProcessingJobRow[];
  const truncated = rows.length > MAX_MISSION_PROCESSING_JOBS;

  return {
    jobs: truncated ? rows.slice(0, MAX_MISSION_PROCESSING_JOBS) : rows,
    truncated,
    unreadableReason: null,
  };
}
