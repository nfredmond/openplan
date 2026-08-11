import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { BODY_LIMITS, readJsonOrNullWithLimit } from "@/lib/http/body-limit";
import { isWriteFailure, noRowsMatchedResponse, writeMatchedNoRows } from "@/lib/http/write-outcome";
import { isReadOnlyWorkspaceRole } from "@/lib/auth/role-matrix";
import { rebuildAerialProjectPosture } from "@/lib/aerial/posture-writeback";

const paramsSchema = z.object({
  missionId: z.string().uuid(),
});

const polygonGeoJsonSchema = z.object({
  type: z.literal("Polygon"),
  coordinates: z
    .array(z.array(z.tuple([z.number(), z.number()])))
    .min(1, "Polygon must have at least one ring")
    .refine(
      (coords) => coords.every((ring) => ring.length >= 4),
      "Each polygon ring must have at least 4 positions (closed)"
    )
    .refine(
      (coords) =>
        coords.every((ring) => {
          const first = ring[0];
          const last = ring[ring.length - 1];
          return first[0] === last[0] && first[1] === last[1];
        }),
      "Each polygon ring must close (first position === last position)"
    ),
});

const patchAerialMissionSchema = z.object({
  status: z.enum(["planned", "active", "complete", "cancelled"]).optional(),
  title: z.string().trim().min(1).max(200).optional(),
  geographyLabel: z.string().trim().max(200).nullable().optional(),
  notes: z.string().trim().max(4000).nullable().optional(),
  aoiGeojson: polygonGeoJsonSchema.nullable().optional(),
}).refine((data) => Object.keys(data).length > 0, { message: "At least one field required" });

type RouteContext = { params: Promise<{ missionId: string }> };

export async function PATCH(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("aerial-missions.update", request);
  const startedAt = Date.now();

  try {
    const routeParams = await context.params;
    const parsedParams = paramsSchema.safeParse(routeParams);
    if (!parsedParams.success) {
      return NextResponse.json({ error: "Invalid mission id" }, { status: 400 });
    }

    const payloadBody = await readJsonOrNullWithLimit(request, BODY_LIMITS.networkGeoJson);

    if (!payloadBody.ok) return payloadBody.response;

    const payload = payloadBody.data;
    const parsed = patchAerialMissionSchema.safeParse(payload);
    if (!parsed.success) {
      audit.warn("validation_failed", { issues: parsed.error.issues });
      return NextResponse.json({ error: "Invalid update payload" }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Load mission to resolve workspace, then verify membership. The project
    // link and current status are read here so the posture writeback below can
    // tell a status change from a rename without a second round trip.
    const { data: missionRow, error: missionError } = await supabase
      .from("aerial_missions")
      .select("id, workspace_id, project_id, status")
      .eq("id", parsedParams.data.missionId)
      .maybeSingle();
    const mission = missionRow as {
      id: string;
      workspace_id: string;
      project_id: string | null;
      status: string;
    } | null;

    if (missionError) {
      audit.error("aerial_mission_load_failed", { missionId: parsedParams.data.missionId, message: missionError.message });
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
      audit.error("membership_check_failed", { workspaceId: mission.workspace_id, message: membershipError.message });
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

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (parsed.data.status !== undefined) updates.status = parsed.data.status;
    if (parsed.data.title !== undefined) updates.title = parsed.data.title;
    if ("geographyLabel" in parsed.data) updates.geography_label = parsed.data.geographyLabel ?? null;
    if ("notes" in parsed.data) updates.notes = parsed.data.notes ?? null;
    if ("aoiGeojson" in parsed.data) updates.aoi_geojson = parsed.data.aoiGeojson ?? null;

    const { data: updated, error: updateError } = await supabase
      .from("aerial_missions")
      .update(updates)
      .eq("id", mission.id)
      .select("id, status, title, geography_label, updated_at")
      .single();

    if (isWriteFailure(updateError)) {
      audit.error("aerial_mission_update_failed", { missionId: mission.id, message: updateError?.message ?? "unknown" });
      return NextResponse.json({ error: "Failed to update mission" }, { status: 500 });
    }

    // This mission row was already read back through the caller's own client
    // above, and the membership and role checks already passed, so a write that
    // matches nothing was refused beneath the application rather than missing.
    if (writeMatchedNoRows({ data: updated, error: updateError })) {
      audit.error("aerial_mission_update_matched_no_rows", {
        missionId: mission.id,
        workspaceId: mission.workspace_id,
        userId: user.id,
      });
      return noRowsMatchedResponse({ subject: "mission", targetWasVerified: true });
    }

    audit.info("aerial_mission_updated", {
      missionId: mission.id,
      userId: user.id,
      fields: Object.keys(parsed.data),
      durationMs: Date.now() - startedAt,
    });

    // The saved project posture counts missions BY STATUS, so only a status
    // change can move it — a rename, a geography edit, or an AOI redraw leaves
    // it exactly as it was, and rebuilding on those would be churn, not
    // freshness. A PATCH cannot move a mission between projects (the schema has
    // no projectId field, and unknown keys are stripped), so the one project
    // whose posture can go stale is the one this mission already belongs to.
    const statusChanged =
      parsed.data.status !== undefined && parsed.data.status !== mission.status;

    if (statusChanged && mission.project_id) {
      const postureResult = await rebuildAerialProjectPosture({
        supabase,
        projectId: mission.project_id,
        workspaceId: mission.workspace_id,
      });

      if (postureResult.error) {
        audit.warn("aerial_posture_rebuild_failed", {
          missionId: mission.id,
          projectId: mission.project_id,
          workspaceId: mission.workspace_id,
          message: postureResult.error.message,
          code: postureResult.error.code ?? null,
        });
      } else {
        audit.info("aerial_posture_rebuilt", {
          missionId: mission.id,
          projectId: mission.project_id,
          workspaceId: mission.workspace_id,
          missionCount: postureResult.posture?.missionCount ?? 0,
          readyPackageCount: postureResult.posture?.readyPackageCount ?? 0,
          verificationReadiness: postureResult.posture?.verificationReadiness ?? "none",
        });
      }
    }

    return NextResponse.json({ mission: updated });
  } catch (error) {
    audit.error("aerial_mission_update_unhandled_error", { error, durationMs: Date.now() - startedAt });
    return NextResponse.json({ error: "Unexpected error while updating mission" }, { status: 500 });
  }
}
