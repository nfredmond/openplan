import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { canAccessWorkspaceAction } from "@/lib/auth/role-matrix";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { createClient } from "@/lib/supabase/server";
import { BODY_LIMITS, readJsonOrNullWithLimit } from "@/lib/http/body-limit";

const TIME_ENTRY_SELECT =
  "id, workspace_id, staff_id, engagement_id, deliverable_id, entry_date, hours, notes, billable, labor_category, billed_line_item_id, created_by, created_at, updated_at";

/**
 * List cap: at most this many rows come back, newest entry_date first. The
 * response discloses truncation via hasMore (true exactly when the page sits
 * at the cap) so a consumer can narrow the query (engagementId / staffId /
 * unbilled) instead of mistaking a truncated page for the whole ledger.
 */
const TIME_ENTRY_LIST_LIMIT = 500;

const listTimeEntriesQuerySchema = z.object({
  workspaceId: z.string().uuid(),
  engagementId: z.string().uuid().optional(),
  staffId: z.string().uuid().optional(),
  unbilled: z.enum(["1", "true"]).optional(),
});

const createTimeEntrySchema = z.object({
  workspaceId: z.string().uuid(),
  staffId: z.string().uuid(),
  engagementId: z.string().uuid(),
  deliverableId: z.string().uuid().optional(),
  entryDate: z.string().trim().min(1).max(30),
  hours: z.coerce.number().gt(0).max(24),
  notes: z.string().trim().max(4000).optional(),
  billable: z.boolean().optional(),
  laborCategory: z.string().trim().max(120).optional(),
});

export async function GET(request: NextRequest) {
  const audit = createApiAuditLogger("invoicing.time_entries.list", request);
  const startedAt = Date.now();

  try {
    const parsed = listTimeEntriesQuerySchema.safeParse(
      Object.fromEntries(request.nextUrl.searchParams.entries())
    );
    if (!parsed.success) {
      audit.warn("validation_failed", { issues: parsed.error.issues });
      return NextResponse.json({ error: "Invalid time entry query" }, { status: 400 });
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

    let query = supabase
      .from("invoicing_time_entries")
      .select(TIME_ENTRY_SELECT)
      .eq("workspace_id", parsed.data.workspaceId);

    if (parsed.data.engagementId) {
      query = query.eq("engagement_id", parsed.data.engagementId);
    }
    if (parsed.data.staffId) {
      query = query.eq("staff_id", parsed.data.staffId);
    }
    if (parsed.data.unbilled) {
      query = query.is("billed_line_item_id", null).eq("billable", true);
    }

    const { data, error } = await query
      .order("entry_date", { ascending: false })
      .limit(TIME_ENTRY_LIST_LIMIT);

    if (error) {
      audit.error("invoicing_time_entries_list_failed", {
        message: error.message,
        workspaceId: parsed.data.workspaceId,
      });
      return NextResponse.json({ error: "Failed to load time entries" }, { status: 500 });
    }

    const timeEntries = data ?? [];
    return NextResponse.json({
      timeEntries,
      // True exactly when the TIME_ENTRY_LIST_LIMIT cap truncated the list.
      hasMore: timeEntries.length === TIME_ENTRY_LIST_LIMIT,
    });
  } catch (error) {
    audit.error("invoicing_time_entries_list_unhandled_error", { durationMs: Date.now() - startedAt, error });
    return NextResponse.json({ error: "Unexpected error while loading time entries" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const audit = createApiAuditLogger("invoicing.time_entries.create", request);
  const startedAt = Date.now();

  try {
    const payloadBody = await readJsonOrNullWithLimit(request, BODY_LIMITS.normalJson);
    if (!payloadBody.ok) return payloadBody.response;
    const parsed = createTimeEntrySchema.safeParse(payloadBody.data);

    if (!parsed.success) {
      audit.warn("validation_failed", { issues: parsed.error.issues });
      return NextResponse.json({ error: "Invalid time entry payload" }, { status: 400 });
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
      .select("id, workspace_id, default_labor_category")
      .eq("id", parsed.data.staffId)
      .single();

    if (staffError || !staffRow || staffRow.workspace_id !== parsed.data.workspaceId) {
      audit.warn("staff_workspace_mismatch", {
        workspaceId: parsed.data.workspaceId,
        staffId: parsed.data.staffId,
        message: staffError?.message ?? null,
      });
      return NextResponse.json({ error: "Staff record is not available in the requested workspace" }, { status: 400 });
    }

    const { data: engagement, error: engagementError } = await supabase
      .from("invoicing_engagements")
      .select("id, workspace_id")
      .eq("id", parsed.data.engagementId)
      .single();

    if (engagementError || !engagement || engagement.workspace_id !== parsed.data.workspaceId) {
      audit.warn("engagement_workspace_mismatch", {
        workspaceId: parsed.data.workspaceId,
        engagementId: parsed.data.engagementId,
        message: engagementError?.message ?? null,
      });
      return NextResponse.json({ error: "Engagement is not available in the requested workspace" }, { status: 400 });
    }

    if (parsed.data.deliverableId) {
      // Deliverables are project-scoped; the workspace check goes through the
      // parent project.
      const { data: deliverable, error: deliverableError } = await supabase
        .from("project_deliverables")
        .select("id, project_id, projects(workspace_id)")
        .eq("id", parsed.data.deliverableId)
        .single();

      const deliverableWorkspaceId =
        (deliverable?.projects as { workspace_id?: string | null } | null)?.workspace_id ?? null;

      if (deliverableError || !deliverable || deliverableWorkspaceId !== parsed.data.workspaceId) {
        audit.warn("deliverable_workspace_mismatch", {
          workspaceId: parsed.data.workspaceId,
          deliverableId: parsed.data.deliverableId,
          message: deliverableError?.message ?? null,
        });
        return NextResponse.json({ error: "Deliverable is not available in the requested workspace" }, { status: 400 });
      }
    }

    const laborCategory =
      parsed.data.laborCategory?.trim() ||
      (typeof staffRow.default_labor_category === "string" ? staffRow.default_labor_category : null) ||
      null;

    const { data, error } = await supabase
      .from("invoicing_time_entries")
      .insert({
        workspace_id: parsed.data.workspaceId,
        staff_id: parsed.data.staffId,
        engagement_id: parsed.data.engagementId,
        deliverable_id: parsed.data.deliverableId ?? null,
        entry_date: parsed.data.entryDate,
        hours: parsed.data.hours,
        notes: parsed.data.notes?.trim() || null,
        billable: parsed.data.billable ?? true,
        labor_category: laborCategory,
        created_by: user.id,
      })
      .select(TIME_ENTRY_SELECT)
      .single();

    if (error) {
      audit.error("invoicing_time_entry_insert_failed", {
        message: error.message,
        code: error.code ?? null,
        workspaceId: parsed.data.workspaceId,
      });
      return NextResponse.json({ error: "Failed to create time entry", details: error.message }, { status: 500 });
    }

    audit.info("invoicing_time_entry_created", {
      workspaceId: parsed.data.workspaceId,
      engagementId: parsed.data.engagementId,
      userId: user.id,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json({ timeEntry: data }, { status: 201 });
  } catch (error) {
    audit.error("invoicing_time_entry_create_unhandled_error", { durationMs: Date.now() - startedAt, error });
    return NextResponse.json({ error: "Unexpected error while creating time entry" }, { status: 500 });
  }
}
