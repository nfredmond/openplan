import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { canAccessWorkspaceAction } from "@/lib/auth/role-matrix";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { createClient } from "@/lib/supabase/server";
import { BODY_LIMITS, readJsonOrNullWithLimit } from "@/lib/http/body-limit";

const STAFF_SELECT =
  "id, workspace_id, name, title, user_id, default_labor_category, active, created_by, created_at, updated_at";

const paramsSchema = z.object({
  staffId: z.string().uuid(),
});

const patchStaffSchema = z
  .object({
    workspaceId: z.string().uuid(),
    name: z.string().trim().min(1).max(160).optional(),
    title: z.union([z.string().trim().max(160), z.null()]).optional(),
    userId: z.union([z.string().uuid(), z.null()]).optional(),
    defaultLaborCategory: z.union([z.string().trim().max(120), z.null()]).optional(),
    active: z.boolean().optional(),
  })
  .refine(
    (value) =>
      value.name !== undefined ||
      value.title !== undefined ||
      value.userId !== undefined ||
      value.defaultLaborCategory !== undefined ||
      value.active !== undefined,
    { message: "At least one staff patch field is required", path: ["name"] }
  );

type RouteContext = {
  params: Promise<{ staffId: string }>;
};

export async function PATCH(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("invoicing.staff.patch", request);
  const startedAt = Date.now();

  try {
    const parsedParams = paramsSchema.safeParse(await context.params);
    if (!parsedParams.success) {
      audit.warn("params_validation_failed", { issues: parsedParams.error.issues });
      return NextResponse.json({ error: "Invalid staff id" }, { status: 400 });
    }

    const payloadBody = await readJsonOrNullWithLimit(request, BODY_LIMITS.normalJson);
    if (!payloadBody.ok) return payloadBody.response;
    const parsed = patchStaffSchema.safeParse(payloadBody.data);

    if (!parsed.success) {
      audit.warn("validation_failed", { issues: parsed.error.issues });
      return NextResponse.json({ error: "Invalid staff patch payload" }, { status: 400 });
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

    const { data: staffRow, error: staffError } = await supabase
      .from("invoicing_staff")
      .select("id, workspace_id")
      .eq("id", parsedParams.data.staffId)
      .single();

    if (staffError || !staffRow || staffRow.workspace_id !== parsed.data.workspaceId) {
      audit.warn("staff_workspace_mismatch", {
        staffId: parsedParams.data.staffId,
        workspaceId: parsed.data.workspaceId,
        message: staffError?.message ?? null,
      });
      return NextResponse.json({ error: "Staff record is not available in the requested workspace" }, { status: 404 });
    }

    if (parsed.data.userId) {
      const { data: linkedMember, error: linkedMemberError } = await supabase
        .from("workspace_members")
        .select("workspace_id, user_id")
        .eq("workspace_id", parsed.data.workspaceId)
        .eq("user_id", parsed.data.userId)
        .maybeSingle();

      if (linkedMemberError || !linkedMember) {
        audit.warn("staff_user_workspace_mismatch", {
          workspaceId: parsed.data.workspaceId,
          linkedUserId: parsed.data.userId,
          message: linkedMemberError?.message ?? null,
        });
        return NextResponse.json({ error: "Linked user is not a member of the requested workspace" }, { status: 400 });
      }
    }

    const update: Record<string, unknown> = {};
    if (parsed.data.name !== undefined) update.name = parsed.data.name;
    if (parsed.data.title !== undefined) update.title = parsed.data.title === null ? null : parsed.data.title.trim() || null;
    if (parsed.data.userId !== undefined) update.user_id = parsed.data.userId;
    if (parsed.data.defaultLaborCategory !== undefined) {
      update.default_labor_category =
        parsed.data.defaultLaborCategory === null ? null : parsed.data.defaultLaborCategory.trim() || null;
    }
    if (parsed.data.active !== undefined) update.active = parsed.data.active;

    const { data, error } = await supabase
      .from("invoicing_staff")
      .update(update)
      .eq("id", staffRow.id)
      .select(STAFF_SELECT)
      .single();

    if (error || !data) {
      audit.error("invoicing_staff_update_failed", {
        staffId: staffRow.id,
        workspaceId: parsed.data.workspaceId,
        message: error?.message ?? "invoicing_staff_update_returned_no_row",
      });
      return NextResponse.json({ error: "Failed to update staff record" }, { status: 500 });
    }

    audit.info("invoicing_staff_updated", {
      staffId: staffRow.id,
      workspaceId: parsed.data.workspaceId,
      userId: user.id,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json({ staffMember: data });
  } catch (error) {
    audit.error("invoicing_staff_patch_unhandled_error", { durationMs: Date.now() - startedAt, error });
    return NextResponse.json({ error: "Unexpected error while updating staff record" }, { status: 500 });
  }
}
