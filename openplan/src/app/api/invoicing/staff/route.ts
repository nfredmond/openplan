import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { canAccessWorkspaceAction } from "@/lib/auth/role-matrix";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { createClient } from "@/lib/supabase/server";
import { BODY_LIMITS, readJsonOrNullWithLimit } from "@/lib/http/body-limit";

const STAFF_SELECT =
  "id, workspace_id, name, title, user_id, default_labor_category, active, created_by, created_at, updated_at";

const listStaffQuerySchema = z.object({
  workspaceId: z.string().uuid(),
});

const createStaffSchema = z.object({
  workspaceId: z.string().uuid(),
  name: z.string().trim().min(1).max(160),
  title: z.string().trim().max(160).optional(),
  userId: z.string().uuid().optional(),
  defaultLaborCategory: z.string().trim().max(120).optional(),
  active: z.boolean().optional(),
});

export async function GET(request: NextRequest) {
  const audit = createApiAuditLogger("invoicing.staff.list", request);
  const startedAt = Date.now();

  try {
    const parsed = listStaffQuerySchema.safeParse(
      Object.fromEntries(request.nextUrl.searchParams.entries())
    );
    if (!parsed.success) {
      audit.warn("validation_failed", { issues: parsed.error.issues });
      return NextResponse.json({ error: "Invalid staff query" }, { status: 400 });
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

    if (!canAccessWorkspaceAction("invoices.read", membership.role)) {
      audit.warn("forbidden", { workspaceId: parsed.data.workspaceId, userId: user.id, role: membership.role });
      return NextResponse.json({ error: "Workspace role cannot read invoicing records" }, { status: 403 });
    }

    const { data, error } = await supabase
      .from("invoicing_staff")
      .select(STAFF_SELECT)
      .eq("workspace_id", parsed.data.workspaceId)
      .order("updated_at", { ascending: false });

    if (error) {
      audit.error("invoicing_staff_list_failed", {
        message: error.message,
        workspaceId: parsed.data.workspaceId,
      });
      return NextResponse.json({ error: "Failed to load staff" }, { status: 500 });
    }

    return NextResponse.json({ staff: data ?? [] });
  } catch (error) {
    audit.error("invoicing_staff_list_unhandled_error", { durationMs: Date.now() - startedAt, error });
    return NextResponse.json({ error: "Unexpected error while loading staff" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const audit = createApiAuditLogger("invoicing.staff.create", request);
  const startedAt = Date.now();

  try {
    const payloadBody = await readJsonOrNullWithLimit(request, BODY_LIMITS.normalJson);
    if (!payloadBody.ok) return payloadBody.response;
    const parsed = createStaffSchema.safeParse(payloadBody.data);

    if (!parsed.success) {
      audit.warn("validation_failed", { issues: parsed.error.issues });
      return NextResponse.json({ error: "Invalid staff payload" }, { status: 400 });
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

    // A staff row may optionally link to a workspace member's account; a user
    // outside this workspace is a cross-workspace link and is refused.
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

    const { data, error } = await supabase
      .from("invoicing_staff")
      .insert({
        workspace_id: parsed.data.workspaceId,
        name: parsed.data.name,
        title: parsed.data.title?.trim() || null,
        user_id: parsed.data.userId ?? null,
        default_labor_category: parsed.data.defaultLaborCategory?.trim() || null,
        active: parsed.data.active ?? true,
        created_by: user.id,
      })
      .select(STAFF_SELECT)
      .single();

    if (error) {
      audit.error("invoicing_staff_insert_failed", {
        message: error.message,
        code: error.code ?? null,
        workspaceId: parsed.data.workspaceId,
      });
      return NextResponse.json({ error: "Failed to create staff record", details: error.message }, { status: 500 });
    }

    audit.info("invoicing_staff_created", {
      workspaceId: parsed.data.workspaceId,
      userId: user.id,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json({ staffMember: data }, { status: 201 });
  } catch (error) {
    audit.error("invoicing_staff_create_unhandled_error", { durationMs: Date.now() - startedAt, error });
    return NextResponse.json({ error: "Unexpected error while creating staff record" }, { status: 500 });
  }
}
