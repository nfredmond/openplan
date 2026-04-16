import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";

const paramsSchema = z.object({
  missionId: z.string().uuid(),
});

const patchAerialMissionSchema = z.object({
  status: z.enum(["planned", "active", "complete", "cancelled"]).optional(),
  title: z.string().trim().min(1).max(200).optional(),
  geographyLabel: z.string().trim().max(200).nullable().optional(),
  notes: z.string().trim().max(4000).nullable().optional(),
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

    const payload = await request.json();
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

    // Load mission to resolve workspace, then verify membership.
    const { data: mission, error: missionError } = await supabase
      .from("aerial_missions")
      .select("id, workspace_id")
      .eq("id", parsedParams.data.missionId)
      .maybeSingle();

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

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (parsed.data.status !== undefined) updates.status = parsed.data.status;
    if (parsed.data.title !== undefined) updates.title = parsed.data.title;
    if ("geographyLabel" in parsed.data) updates.geography_label = parsed.data.geographyLabel ?? null;
    if ("notes" in parsed.data) updates.notes = parsed.data.notes ?? null;

    const { data: updated, error: updateError } = await supabase
      .from("aerial_missions")
      .update(updates)
      .eq("id", mission.id)
      .select("id, status, title, geography_label, updated_at")
      .single();

    if (updateError || !updated) {
      audit.error("aerial_mission_update_failed", { missionId: mission.id, message: updateError?.message ?? "unknown" });
      return NextResponse.json({ error: "Failed to update mission" }, { status: 500 });
    }

    audit.info("aerial_mission_updated", {
      missionId: mission.id,
      userId: user.id,
      fields: Object.keys(parsed.data),
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json({ mission: updated });
  } catch (error) {
    audit.error("aerial_mission_update_unhandled_error", { error, durationMs: Date.now() - startedAt });
    return NextResponse.json({ error: "Unexpected error while updating mission" }, { status: 500 });
  }
}
