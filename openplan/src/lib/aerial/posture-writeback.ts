import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildAerialProjectPosture,
  type AerialProjectPosture,
} from "@/lib/aerial/catalog";

export type AerialPostureWritebackSupabaseLike = Pick<SupabaseClient, "from">;

export type AerialPostureWritebackResult = {
  posture: AerialProjectPosture | null;
  updatedAt: string | null;
  error: { message: string; code?: string | null } | null;
};

export type RebuildAerialProjectPostureInput = {
  supabase: AerialPostureWritebackSupabaseLike;
  projectId: string;
  workspaceId: string;
  now?: () => Date;
};

export async function rebuildAerialProjectPosture({
  supabase,
  projectId,
  workspaceId,
  now = () => new Date(),
}: RebuildAerialProjectPostureInput): Promise<AerialPostureWritebackResult> {
  const missionsResult = await supabase
    .from("aerial_missions")
    .select("id, status")
    .eq("workspace_id", workspaceId)
    .eq("project_id", projectId);

  if (missionsResult.error) {
    return {
      posture: null,
      updatedAt: null,
      error: {
        message: missionsResult.error.message,
        code: missionsResult.error.code ?? null,
      },
    };
  }

  const missions = (missionsResult.data ?? []) as Array<{ id: string; status: string }>;

  let packages: Array<{ status: string; verification_readiness: string }> = [];

  if (missions.length > 0) {
    const missionIds = missions.map((m) => m.id);
    const packagesResult = await supabase
      .from("aerial_evidence_packages")
      .select("status, verification_readiness")
      .eq("workspace_id", workspaceId)
      .in("mission_id", missionIds);

    if (packagesResult.error) {
      return {
        posture: null,
        updatedAt: null,
        error: {
          message: packagesResult.error.message,
          code: packagesResult.error.code ?? null,
        },
      };
    }

    packages = (packagesResult.data ?? []) as typeof packages;
  }

  const posture = buildAerialProjectPosture(missions, packages);
  const updatedAt = now().toISOString();

  const updateResult = await supabase
    .from("projects")
    .update({
      aerial_posture: posture,
      aerial_posture_updated_at: updatedAt,
    })
    .eq("id", projectId)
    .eq("workspace_id", workspaceId);

  if (updateResult.error) {
    return {
      posture,
      updatedAt: null,
      error: {
        message: updateResult.error.message,
        code: updateResult.error.code ?? null,
      },
    };
  }

  return { posture, updatedAt, error: null };
}
