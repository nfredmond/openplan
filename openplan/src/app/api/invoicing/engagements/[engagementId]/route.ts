import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { canAccessWorkspaceAction } from "@/lib/auth/role-matrix";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { createClient } from "@/lib/supabase/server";
import { BODY_LIMITS, readJsonOrNullWithLimit } from "@/lib/http/body-limit";

const ENGAGEMENT_SELECT =
  "id, workspace_id, client_id, project_id, parent_engagement_id, title, reference_code, engagement_kind, billing_basis, not_to_exceed_amount, start_date, end_date, status, notes, created_by, created_at, updated_at";

const paramsSchema = z.object({
  engagementId: z.string().uuid(),
});

const patchEngagementSchema = z
  .object({
    workspaceId: z.string().uuid(),
    clientId: z.string().uuid().optional(),
    projectId: z.union([z.string().uuid(), z.null()]).optional(),
    title: z.string().trim().min(1).max(300).optional(),
    referenceCode: z.union([z.string().trim().max(120), z.null()]).optional(),
    engagementKind: z.enum(["contract", "task_order", "on_call", "other"]).optional(),
    billingBasis: z
      .union([z.enum(["lump_sum", "time_and_materials", "cost_plus", "milestone", "progress_payment"]), z.null()])
      .optional(),
    // z.null() must be tried FIRST: z.coerce.number() would coerce null to 0,
    // silently turning "clear the ceiling" into "set a zero ceiling".
    notToExceedAmount: z.union([z.null(), z.coerce.number().min(0)]).optional(),
    startDate: z.union([z.string().trim().max(30), z.null()]).optional(),
    endDate: z.union([z.string().trim().max(30), z.null()]).optional(),
    status: z.enum(["pending", "active", "closed"]).optional(),
    notes: z.union([z.string().trim().max(4000), z.null()]).optional(),
  })
  .refine(
    (value) =>
      value.clientId !== undefined ||
      value.projectId !== undefined ||
      value.title !== undefined ||
      value.referenceCode !== undefined ||
      value.engagementKind !== undefined ||
      value.billingBasis !== undefined ||
      value.notToExceedAmount !== undefined ||
      value.startDate !== undefined ||
      value.endDate !== undefined ||
      value.status !== undefined ||
      value.notes !== undefined,
    { message: "At least one engagement patch field is required", path: ["title"] }
  );

type RouteContext = {
  params: Promise<{ engagementId: string }>;
};

/** A nullable text patch: null clears, a blank string also clears, text stores trimmed. */
function nullableText(value: string | null): string | null {
  return value === null ? null : value.trim() || null;
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("invoicing.engagements.patch", request);
  const startedAt = Date.now();

  try {
    const parsedParams = paramsSchema.safeParse(await context.params);
    if (!parsedParams.success) {
      audit.warn("params_validation_failed", { issues: parsedParams.error.issues });
      return NextResponse.json({ error: "Invalid engagement id" }, { status: 400 });
    }

    const payloadBody = await readJsonOrNullWithLimit(request, BODY_LIMITS.normalJson);
    if (!payloadBody.ok) return payloadBody.response;
    const parsed = patchEngagementSchema.safeParse(payloadBody.data);

    if (!parsed.success) {
      audit.warn("validation_failed", { issues: parsed.error.issues });
      return NextResponse.json({ error: "Invalid engagement patch payload" }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      audit.warn("unauthorized", { durationMs: Date.now() - startedAt });
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: membership, error: membershipError } = await supabase
      .from("workspace_members")
      .select("workspace_id, role")
      .eq("workspace_id", parsed.data.workspaceId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (membershipError || !membership) {
      audit.warn("workspace_membership_missing", {
        workspaceId: parsed.data.workspaceId,
        userId: user.id,
        message: membershipError?.message ?? null,
      });
      return NextResponse.json({ error: "Workspace access not found" }, { status: 403 });
    }

    if (!canAccessWorkspaceAction("invoices.write", membership.role)) {
      audit.warn("forbidden", { workspaceId: parsed.data.workspaceId, userId: user.id, role: membership.role });
      return NextResponse.json({ error: "Owner or admin role required for invoice writes" }, { status: 403 });
    }

    const { data: engagement, error: engagementError } = await supabase
      .from("invoicing_engagements")
      .select("id, workspace_id")
      .eq("id", parsedParams.data.engagementId)
      .single();

    if (engagementError || !engagement || engagement.workspace_id !== parsed.data.workspaceId) {
      audit.warn("engagement_workspace_mismatch", {
        engagementId: parsedParams.data.engagementId,
        workspaceId: parsed.data.workspaceId,
        message: engagementError?.message ?? null,
      });
      return NextResponse.json({ error: "Engagement is not available in the requested workspace" }, { status: 404 });
    }

    if (parsed.data.clientId) {
      const { data: clientRow, error: clientError } = await supabase
        .from("invoicing_clients")
        .select("id, workspace_id")
        .eq("id", parsed.data.clientId)
        .single();

      if (clientError || !clientRow || clientRow.workspace_id !== parsed.data.workspaceId) {
        audit.warn("client_workspace_mismatch", {
          workspaceId: parsed.data.workspaceId,
          clientId: parsed.data.clientId,
          message: clientError?.message ?? null,
        });
        return NextResponse.json({ error: "Client is not available in the requested workspace" }, { status: 400 });
      }
    }

    if (parsed.data.projectId) {
      const { data: project, error: projectError } = await supabase
        .from("projects")
        .select("id, workspace_id")
        .eq("id", parsed.data.projectId)
        .single();

      if (projectError || !project || project.workspace_id !== parsed.data.workspaceId) {
        audit.warn("project_workspace_mismatch", {
          workspaceId: parsed.data.workspaceId,
          projectId: parsed.data.projectId,
          message: projectError?.message ?? null,
        });
        return NextResponse.json({ error: "Project is not available in the requested workspace" }, { status: 400 });
      }
    }

    const update: Record<string, unknown> = {};
    if (parsed.data.clientId !== undefined) update.client_id = parsed.data.clientId;
    if (parsed.data.projectId !== undefined) update.project_id = parsed.data.projectId;
    if (parsed.data.title !== undefined) update.title = parsed.data.title;
    if (parsed.data.referenceCode !== undefined) update.reference_code = nullableText(parsed.data.referenceCode);
    if (parsed.data.engagementKind !== undefined) update.engagement_kind = parsed.data.engagementKind;
    if (parsed.data.billingBasis !== undefined) update.billing_basis = parsed.data.billingBasis;
    if (parsed.data.notToExceedAmount !== undefined) update.not_to_exceed_amount = parsed.data.notToExceedAmount;
    if (parsed.data.startDate !== undefined) update.start_date = nullableText(parsed.data.startDate);
    if (parsed.data.endDate !== undefined) update.end_date = nullableText(parsed.data.endDate);
    if (parsed.data.status !== undefined) update.status = parsed.data.status;
    if (parsed.data.notes !== undefined) update.notes = nullableText(parsed.data.notes);

    const { data, error } = await supabase
      .from("invoicing_engagements")
      .update(update)
      .eq("id", engagement.id)
      .select(ENGAGEMENT_SELECT)
      .single();

    if (error || !data) {
      audit.error("invoicing_engagement_update_failed", {
        engagementId: engagement.id,
        workspaceId: parsed.data.workspaceId,
        message: error?.message ?? "invoicing_engagement_update_returned_no_row",
      });
      return NextResponse.json({ error: "Failed to update engagement" }, { status: 500 });
    }

    audit.info("invoicing_engagement_updated", {
      engagementId: engagement.id,
      workspaceId: parsed.data.workspaceId,
      userId: user.id,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json({ engagement: data });
  } catch (error) {
    audit.error("invoicing_engagement_patch_unhandled_error", { durationMs: Date.now() - startedAt, error });
    return NextResponse.json({ error: "Unexpected error while updating engagement" }, { status: 500 });
  }
}
