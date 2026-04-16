import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { loadProjectAccess } from "@/lib/programs/api";

const AERIAL_MISSION_STATUSES = ["planned", "active", "complete", "cancelled"] as const;
const AERIAL_MISSION_TYPES = ["corridor_survey", "site_inspection", "aoi_capture", "general"] as const;

const createAerialMissionSchema = z.object({
  projectId: z.string().uuid(),
  title: z.string().trim().min(1).max(200),
  status: z.enum(AERIAL_MISSION_STATUSES).default("planned"),
  missionType: z.enum(AERIAL_MISSION_TYPES).default("corridor_survey"),
  geographyLabel: z.string().trim().max(200).optional(),
  collectedAt: z.string().datetime().optional(),
  notes: z.string().trim().max(4000).optional(),
});

export async function POST(request: NextRequest) {
  const audit = createApiAuditLogger("aerial-missions.create", request);
  const startedAt = Date.now();

  try {
    const payload = await request.json();
    const parsed = createAerialMissionSchema.safeParse(payload);

    if (!parsed.success) {
      audit.warn("validation_failed", { issues: parsed.error.issues });
      return NextResponse.json({ error: "Invalid aerial mission payload" }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const access = await loadProjectAccess(supabase, parsed.data.projectId, user.id, "programs.write");
    if (access.error) {
      audit.error("aerial_mission_project_access_failed", {
        projectId: parsed.data.projectId,
        userId: user.id,
        message: access.error.message,
        code: (access.error as { code?: string }).code ?? null,
      });
      return NextResponse.json({ error: "Failed to verify project access" }, { status: 500 });
    }

    if (!access.project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    if (!access.membership || !access.allowed) {
      return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });
    }

    const { data: mission, error } = await supabase
      .from("aerial_missions")
      .insert({
        workspace_id: access.project.workspace_id,
        project_id: access.project.id,
        title: parsed.data.title.trim(),
        status: parsed.data.status,
        mission_type: parsed.data.missionType,
        geography_label: parsed.data.geographyLabel?.trim() || null,
        collected_at: parsed.data.collectedAt ?? null,
        notes: parsed.data.notes?.trim() || null,
      })
      .select("id, workspace_id, project_id, title, status, mission_type, geography_label, collected_at, notes, created_at, updated_at")
      .single();

    if (error || !mission) {
      audit.error("aerial_mission_insert_failed", {
        projectId: parsed.data.projectId,
        userId: user.id,
        message: error?.message ?? "unknown",
        code: error?.code ?? null,
      });
      return NextResponse.json({ error: "Failed to create aerial mission" }, { status: 500 });
    }

    audit.info("aerial_mission_created", {
      missionId: mission.id,
      userId: user.id,
      workspaceId: access.project.workspace_id,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json({ missionId: mission.id, mission }, { status: 201 });
  } catch (error) {
    audit.error("aerial_mission_create_unhandled_error", { error, durationMs: Date.now() - startedAt });
    return NextResponse.json({ error: "Unexpected error while creating aerial mission" }, { status: 500 });
  }
}
