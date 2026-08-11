/**
 * REGISTRY DISPOSITION — REFUSED as an assistant action, 2026-08-11, recorded
 * executably in `src/test/refused-aerial-actions-stay-refused.test.ts`.
 *
 * Deleting a mission photo destroys SOURCE EVIDENCE — the raw material every
 * processed output derives from — and an agent optimizing for a tidy photo set
 * has a standing incentive to thin exactly the frames a reviewer would want
 * (the submission-geofence refusal's shape). The payload being one verified
 * uuid is why it LOOKS safe and is not: the id test is a proxy for "the model
 * authors no consequential content", and here the consequence is an erasure.
 *
 * THE DELETE PRECONDITION, decided 2026-08-11. Once ANY processing job exists
 * for the mission, deletion is refused — even for jobs that failed, and even
 * for jobs dispatched from a pasted zip URL that never touched stored imagery.
 * The honest reason is stated in the refusal itself: OpenPlan cannot establish
 * AFTER THE FACT which photos a job consumed (the dispatched manifest lives in
 * the request, not as row references), so it cannot prove a photo is NOT part
 * of the evidence under a processed output — and an unprovable "this is safe
 * to destroy" is a refusal, not a permission. Deletion therefore serves its
 * real use case — pre-processing cleanup of a wrong or blurry upload — and
 * nothing else. Relaxing this requires making consumption provable first
 * (per-job imagery references), not a softer sentence.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { isReadOnlyWorkspaceRole } from "@/lib/auth/role-matrix";
import { AERIAL_IMAGERY_BUCKET } from "@/lib/aerial/imagery";

const paramsSchema = z.object({
  missionId: z.string().uuid(),
  imageryId: z.string().uuid(),
});

type RouteContext = { params: Promise<{ missionId: string; imageryId: string }> };

export async function DELETE(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("aerial-imagery.delete", request);
  const startedAt = Date.now();

  try {
    const routeParams = await context.params;
    const parsedParams = paramsSchema.safeParse(routeParams);
    if (!parsedParams.success) {
      return NextResponse.json({ error: "Invalid imagery id" }, { status: 400 });
    }
    const { missionId, imageryId } = parsedParams.data;

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: mission, error: missionError } = await supabase
      .from("aerial_missions")
      .select("id, workspace_id")
      .eq("id", missionId)
      .maybeSingle();

    if (missionError) {
      audit.error("aerial_mission_load_failed", { missionId, message: missionError.message });
      return NextResponse.json({ error: "Failed to load mission" }, { status: 500 });
    }
    if (!mission) {
      return NextResponse.json({ error: "Mission not found" }, { status: 404 });
    }

    const { data: membership, error: membershipError } = await supabase
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", mission.workspace_id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (membershipError) {
      audit.error("membership_check_failed", {
        workspaceId: mission.workspace_id,
        message: membershipError.message,
      });
      return NextResponse.json({ error: "Failed to verify workspace access" }, { status: 500 });
    }
    if (!membership) {
      return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });
    }
    if (isReadOnlyWorkspaceRole((membership as { role?: string }).role)) {
      return NextResponse.json(
        { error: "Viewers have read-only access to this workspace" },
        { status: 403 }
      );
    }

    const service = createServiceRoleClient();

    // Scoped to the parent mission, so an imagery id from another mission
    // cannot be dereferenced through one this caller can write.
    const { data: imagery, error: imageryError } = await service
      .from("aerial_imagery")
      .select("id, workspace_id, mission_id, storage_bucket, storage_path, original_filename")
      .eq("id", imageryId)
      .eq("mission_id", mission.id)
      .maybeSingle();

    if (imageryError) {
      audit.error("aerial_imagery_load_failed", { imageryId, message: imageryError.message });
      return NextResponse.json({ error: "Failed to load photo record" }, { status: 500 });
    }
    if (!imagery) {
      return NextResponse.json({ error: "Photo not found" }, { status: 404 });
    }
    // Belt and braces: the scope trigger makes this unstorable, so a mismatch
    // is a forged or corrupted row — refuse as not-found.
    if (imagery.workspace_id !== mission.workspace_id) {
      audit.warn("aerial_imagery_workspace_mismatch", { imageryId, missionId: mission.id });
      return NextResponse.json({ error: "Photo not found" }, { status: 404 });
    }

    // The precondition (see header). A FAILED count is a 500, never treated as
    // zero — deleting evidence on the strength of an unanswered question would
    // be the read-failure-as-empty defect with real destruction behind it.
    const { count: jobCount, error: jobCountError } = await service
      .from("aerial_processing_jobs")
      .select("id", { count: "exact", head: true })
      .eq("mission_id", mission.id);

    if (jobCountError) {
      audit.error("aerial_processing_job_count_failed", {
        missionId: mission.id,
        message: jobCountError.message,
      });
      return NextResponse.json(
        { error: "Could not verify this mission's processing history; the photo was not deleted." },
        { status: 500 }
      );
    }
    if ((jobCount ?? 0) > 0) {
      audit.info("aerial_imagery_delete_refused_processing_exists", {
        missionId: mission.id,
        imageryId,
        jobCount,
      });
      return NextResponse.json(
        {
          error: "photo_is_potential_processing_evidence",
          detail:
            `Processing has been dispatched for this mission (${jobCount} job${jobCount === 1 ? "" : "s"}), and ` +
            "OpenPlan cannot establish after the fact which photos a job consumed — so it keeps them all. " +
            "Uploaded photos are the source evidence beneath every processed output. Photos can be deleted " +
            "only before the mission's first processing request.",
        },
        { status: 409 }
      );
    }

    // Row first, bytes second: a failed object removal leaves orphaned bytes
    // (harmless, logged), where the other order could leave a row claiming
    // bytes that are gone.
    const { error: deleteError } = await service.from("aerial_imagery").delete().eq("id", imagery.id);
    if (deleteError) {
      audit.error("aerial_imagery_delete_failed", { imageryId, message: deleteError.message });
      return NextResponse.json({ error: "Failed to delete the photo record" }, { status: 500 });
    }

    if (imagery.storage_bucket === AERIAL_IMAGERY_BUCKET && imagery.storage_path) {
      const { error: removeError } = await service.storage
        .from(AERIAL_IMAGERY_BUCKET)
        .remove([imagery.storage_path]);
      if (removeError) {
        audit.warn("aerial_imagery_object_remove_failed", {
          imageryId,
          message: removeError.message,
        });
      }
    }

    audit.info("aerial_imagery_deleted", {
      missionId: mission.id,
      workspaceId: mission.workspace_id,
      userId: user.id,
      imageryId,
      filename: imagery.original_filename,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json({ deleted: true });
  } catch (error) {
    audit.error("aerial_imagery_delete_unhandled_error", { error, durationMs: Date.now() - startedAt });
    return NextResponse.json({ error: "Unexpected error while deleting the photo" }, { status: 500 });
  }
}
