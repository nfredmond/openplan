import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { withAssistantActionAudit } from "@/lib/observability/action-audit";
import { loadProjectAccess } from "@/lib/programs/api";

const paramsSchema = z.object({
  projectId: z.string().uuid(),
});

const patchFundingProfileSchema = z.object({
  fundingNeedAmount: z.union([z.number().min(0), z.null()]).optional(),
  localMatchNeedAmount: z.union([z.number().min(0), z.null()]).optional(),
  notes: z.union([z.string().trim().max(4000), z.null()]).optional(),
});

type RouteContext = {
  params: Promise<{ projectId: string }>;
};

export async function PATCH(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("projects.funding-profile.patch", request);
  const startedAt = Date.now();

  try {
    const routeParams = await context.params;
    const parsedParams = paramsSchema.safeParse(routeParams);
    if (!parsedParams.success) {
      audit.warn("params_validation_failed", { issues: parsedParams.error.issues });
      return NextResponse.json({ error: "Invalid project id" }, { status: 400 });
    }

    const payload = await request.json();
    const parsed = patchFundingProfileSchema.safeParse(payload);
    if (!parsed.success) {
      audit.warn("validation_failed", { issues: parsed.error.issues });
      return NextResponse.json({ error: "Invalid funding profile payload" }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const access = await loadProjectAccess(supabase, parsedParams.data.projectId, user.id, "programs.write");
    if (access.error) {
      audit.error("project_access_failed", {
        projectId: parsedParams.data.projectId,
        userId: user.id,
        message: access.error.message,
        code: access.error.code ?? null,
      });
      return NextResponse.json({ error: "Failed to verify project access" }, { status: 500 });
    }

    if (!access.project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    if (!access.membership || !access.allowed) {
      return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });
    }

    const upsertPayload = {
      workspace_id: access.project.workspace_id,
      project_id: access.project.id,
      funding_need_amount: parsed.data.fundingNeedAmount ?? null,
      local_match_need_amount: parsed.data.localMatchNeedAmount ?? null,
      notes: parsed.data.notes?.trim() || null,
      created_by: user.id,
    };

    let profile;
    try {
      profile = await withAssistantActionAudit(
        supabase,
        {
          actionKind: "create_project_funding_profile",
          workspaceId: access.project.workspace_id,
          userId: user.id,
          inputSummary: {
            projectId: access.project.id,
            hasFundingNeed: parsed.data.fundingNeedAmount !== undefined,
            hasLocalMatchNeed: parsed.data.localMatchNeedAmount !== undefined,
          },
        },
        async () => {
          const { data, error } = await supabase
            .from("project_funding_profiles")
            .upsert(upsertPayload, { onConflict: "project_id" })
            .select("id, workspace_id, project_id, funding_need_amount, local_match_need_amount, notes, created_at, updated_at")
            .single();

          if (error || !data) {
            throw new Error(error?.message ?? "project_funding_profile_upsert_returned_no_row");
          }
          return data;
        }
      );
    } catch (upsertErr) {
      audit.error("project_funding_profile_upsert_failed", {
        projectId: access.project.id,
        userId: user.id,
        message: upsertErr instanceof Error ? upsertErr.message : String(upsertErr),
      });
      return NextResponse.json({ error: "Failed to save project funding profile" }, { status: 500 });
    }

    audit.info("project_funding_profile_saved", {
      projectId: access.project.id,
      userId: user.id,
      workspaceId: access.project.workspace_id,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json({ profile });
  } catch (error) {
    audit.error("project_funding_profile_patch_unhandled_error", { error, durationMs: Date.now() - startedAt });
    return NextResponse.json({ error: "Unexpected error while saving project funding profile" }, { status: 500 });
  }
}
