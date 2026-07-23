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
