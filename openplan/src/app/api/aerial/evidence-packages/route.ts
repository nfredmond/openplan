import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { rebuildAerialProjectPosture } from "@/lib/aerial/posture-writeback";

const AERIAL_PACKAGE_TYPES = ["measurable_output", "qa_bundle", "share_package"] as const;
const AERIAL_PACKAGE_STATUSES = ["processing", "qa_pending", "ready", "shared"] as const;
const AERIAL_VERIFICATION_READINESS = ["pending", "partial", "ready", "not_applicable"] as const;

const createEvidencePackageSchema = z.object({
  missionId: z.string().uuid(),
  title: z.string().trim().min(1).max(200),
  packageType: z.enum(AERIAL_PACKAGE_TYPES).default("measurable_output"),
  status: z.enum(AERIAL_PACKAGE_STATUSES).default("processing"),
  verificationReadiness: z.enum(AERIAL_VERIFICATION_READINESS).default("pending"),
  notes: z.string().trim().max(4000).optional(),
});

export async function POST(request: NextRequest) {
  const audit = createApiAuditLogger("aerial-evidence-packages.create", request);
  const startedAt = Date.now();

  try {
    const payload = await request.json();
    const parsed = createEvidencePackageSchema.safeParse(payload);

    if (!parsed.success) {
      audit.warn("validation_failed", { issues: parsed.error.issues });
      return NextResponse.json({ error: "Invalid evidence package payload" }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Load the mission to resolve workspace_id and project_id, then verify membership.
    const { data: mission, error: missionError } = await supabase
      .from("aerial_missions")
      .select("id, workspace_id, project_id")
      .eq("id", parsed.data.missionId)
      .maybeSingle();

    if (missionError) {
      audit.error("aerial_mission_load_failed", {
        missionId: parsed.data.missionId,
        userId: user.id,
        message: missionError.message,
        code: missionError.code ?? null,
      });
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
        userId: user.id,
        message: membershipError.message,
      });
      return NextResponse.json({ error: "Failed to verify workspace access" }, { status: 500 });
    }

    if (!membership) {
      return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });
    }

    const { data: pkg, error: insertError } = await supabase
      .from("aerial_evidence_packages")
      .insert({
        mission_id: mission.id,
        workspace_id: mission.workspace_id,
        project_id: mission.project_id,
        title: parsed.data.title.trim(),
        package_type: parsed.data.packageType,
        status: parsed.data.status,
        verification_readiness: parsed.data.verificationReadiness,
        notes: parsed.data.notes?.trim() || null,
      })
      .select("id, mission_id, workspace_id, project_id, title, package_type, status, verification_readiness, notes, created_at, updated_at")
      .single();

    if (insertError || !pkg) {
      audit.error("evidence_package_insert_failed", {
        missionId: mission.id,
        userId: user.id,
        message: insertError?.message ?? "unknown",
        code: insertError?.code ?? null,
      });
      return NextResponse.json({ error: "Failed to create evidence package" }, { status: 500 });
    }

    audit.info("evidence_package_created", {
      packageId: pkg.id,
      missionId: mission.id,
      userId: user.id,
      workspaceId: mission.workspace_id,
      durationMs: Date.now() - startedAt,
    });

    if (mission.project_id) {
      const postureResult = await rebuildAerialProjectPosture({
        supabase,
        projectId: mission.project_id,
        workspaceId: mission.workspace_id,
      });

      if (postureResult.error) {
        audit.warn("aerial_posture_rebuild_failed", {
          packageId: pkg.id,
          projectId: mission.project_id,
          workspaceId: mission.workspace_id,
          message: postureResult.error.message,
          code: postureResult.error.code ?? null,
        });
      } else {
        audit.info("aerial_posture_rebuilt", {
          packageId: pkg.id,
          projectId: mission.project_id,
          workspaceId: mission.workspace_id,
          missionCount: postureResult.posture?.missionCount ?? 0,
          readyPackageCount: postureResult.posture?.readyPackageCount ?? 0,
          verificationReadiness: postureResult.posture?.verificationReadiness ?? "none",
        });
      }
    }

    return NextResponse.json({ packageId: pkg.id, package: pkg }, { status: 201 });
  } catch (error) {
    audit.error("evidence_package_create_unhandled_error", { error, durationMs: Date.now() - startedAt });
    return NextResponse.json({ error: "Unexpected error while creating evidence package" }, { status: 500 });
  }
}
