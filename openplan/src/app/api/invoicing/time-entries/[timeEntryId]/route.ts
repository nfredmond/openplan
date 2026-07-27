import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { canAccessWorkspaceAction } from "@/lib/auth/role-matrix";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { createClient } from "@/lib/supabase/server";
import { BODY_LIMITS, readJsonOrNullWithLimit } from "@/lib/http/body-limit";

const TIME_ENTRY_SELECT =
  "id, workspace_id, staff_id, engagement_id, deliverable_id, entry_date, hours, notes, billable, labor_category, billed_line_item_id, created_by, created_at, updated_at";

// A time entry already pulled onto an invoice is part of that invoice's
// backup. The schema cannot express this cleanly in RLS (the billing stamp is
// itself a legitimate update), so THIS layer is the enforcement point — see
// the header of 20260727000011_invoicing_time_and_rates.sql.
const BILLED_ENTRY_REFUSAL =
  "Time entry is already billed on an invoice; void the invoice or remove its line item first";

const paramsSchema = z.object({
  timeEntryId: z.string().uuid(),
});

const patchTimeEntrySchema = z
  .object({
    workspaceId: z.string().uuid(),
    staffId: z.string().uuid().optional(),
    deliverableId: z.union([z.string().uuid(), z.null()]).optional(),
    entryDate: z.string().trim().min(1).max(30).optional(),
    hours: z.coerce.number().gt(0).max(24).optional(),
    notes: z.union([z.string().trim().max(4000), z.null()]).optional(),
    billable: z.boolean().optional(),
    laborCategory: z.union([z.string().trim().max(120), z.null()]).optional(),
  })
  .refine(
    (value) =>
      value.staffId !== undefined ||
      value.deliverableId !== undefined ||
      value.entryDate !== undefined ||
      value.hours !== undefined ||
      value.notes !== undefined ||
      value.billable !== undefined ||
      value.laborCategory !== undefined,
    { message: "At least one time entry patch field is required", path: ["hours"] }
  );

const deleteTimeEntryQuerySchema = z.object({
  workspaceId: z.string().uuid(),
});

type RouteContext = {
  params: Promise<{ timeEntryId: string }>;
};

export async function PATCH(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("invoicing.time_entries.patch", request);
  const startedAt = Date.now();

  try {
    const parsedParams = paramsSchema.safeParse(await context.params);
    if (!parsedParams.success) {
      audit.warn("params_validation_failed", { issues: parsedParams.error.issues });
      return NextResponse.json({ error: "Invalid time entry id" }, { status: 400 });
    }

    const payloadBody = await readJsonOrNullWithLimit(request, BODY_LIMITS.normalJson);
    if (!payloadBody.ok) return payloadBody.response;
    const parsed = patchTimeEntrySchema.safeParse(payloadBody.data);

    if (!parsed.success) {
      audit.warn("validation_failed", { issues: parsed.error.issues });
      return NextResponse.json({ error: "Invalid time entry patch payload" }, { status: 400 });
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

    const { data: timeEntry, error: timeEntryError } = await supabase
      .from("invoicing_time_entries")
      .select("id, workspace_id, billed_line_item_id")
      .eq("id", parsedParams.data.timeEntryId)
      .single();

    if (timeEntryError || !timeEntry || timeEntry.workspace_id !== parsed.data.workspaceId) {
      audit.warn("time_entry_workspace_mismatch", {
        timeEntryId: parsedParams.data.timeEntryId,
        workspaceId: parsed.data.workspaceId,
        message: timeEntryError?.message ?? null,
      });
      return NextResponse.json({ error: "Time entry is not available in the requested workspace" }, { status: 404 });
    }

    if (timeEntry.billed_line_item_id) {
      audit.warn("billed_time_entry_update_refused", {
        timeEntryId: timeEntry.id,
        billedLineItemId: timeEntry.billed_line_item_id,
        workspaceId: parsed.data.workspaceId,
      });
      return NextResponse.json({ error: BILLED_ENTRY_REFUSAL }, { status: 409 });
    }

    if (parsed.data.staffId) {
      const { data: staffRow, error: staffError } = await supabase
        .from("invoicing_staff")
        .select("id, workspace_id")
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
    }

    if (parsed.data.deliverableId) {
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

    const update: Record<string, unknown> = {};
    if (parsed.data.staffId !== undefined) update.staff_id = parsed.data.staffId;
    if (parsed.data.deliverableId !== undefined) update.deliverable_id = parsed.data.deliverableId;
    if (parsed.data.entryDate !== undefined) update.entry_date = parsed.data.entryDate;
    if (parsed.data.hours !== undefined) update.hours = parsed.data.hours;
    if (parsed.data.notes !== undefined) {
      update.notes = parsed.data.notes === null ? null : parsed.data.notes.trim() || null;
    }
    if (parsed.data.billable !== undefined) update.billable = parsed.data.billable;
    if (parsed.data.laborCategory !== undefined) {
      update.labor_category = parsed.data.laborCategory === null ? null : parsed.data.laborCategory.trim() || null;
    }

    const { data, error } = await supabase
      .from("invoicing_time_entries")
      .update(update)
      .eq("id", timeEntry.id)
      .select(TIME_ENTRY_SELECT)
      .single();

    if (error || !data) {
      audit.error("invoicing_time_entry_update_failed", {
        timeEntryId: timeEntry.id,
        workspaceId: parsed.data.workspaceId,
        message: error?.message ?? "invoicing_time_entry_update_returned_no_row",
      });
      return NextResponse.json({ error: "Failed to update time entry" }, { status: 500 });
    }

    audit.info("invoicing_time_entry_updated", {
      timeEntryId: timeEntry.id,
      workspaceId: parsed.data.workspaceId,
      userId: user.id,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json({ timeEntry: data });
  } catch (error) {
    audit.error("invoicing_time_entry_patch_unhandled_error", { durationMs: Date.now() - startedAt, error });
    return NextResponse.json({ error: "Unexpected error while updating time entry" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("invoicing.time_entries.delete", request);
  const startedAt = Date.now();

  try {
    const parsedParams = paramsSchema.safeParse(await context.params);
    if (!parsedParams.success) {
      audit.warn("params_validation_failed", { issues: parsedParams.error.issues });
      return NextResponse.json({ error: "Invalid time entry id" }, { status: 400 });
    }

    const parsed = deleteTimeEntryQuerySchema.safeParse(
      Object.fromEntries(request.nextUrl.searchParams.entries())
    );
    if (!parsed.success) {
      audit.warn("validation_failed", { issues: parsed.error.issues });
      return NextResponse.json({ error: "Invalid time entry delete query" }, { status: 400 });
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

    const { data: timeEntry, error: timeEntryError } = await supabase
      .from("invoicing_time_entries")
      .select("id, workspace_id, billed_line_item_id")
      .eq("id", parsedParams.data.timeEntryId)
      .single();

    if (timeEntryError || !timeEntry || timeEntry.workspace_id !== parsed.data.workspaceId) {
      audit.warn("time_entry_workspace_mismatch", {
        timeEntryId: parsedParams.data.timeEntryId,
        workspaceId: parsed.data.workspaceId,
        message: timeEntryError?.message ?? null,
      });
      return NextResponse.json({ error: "Time entry is not available in the requested workspace" }, { status: 404 });
    }

    if (timeEntry.billed_line_item_id) {
      audit.warn("billed_time_entry_delete_refused", {
        timeEntryId: timeEntry.id,
        billedLineItemId: timeEntry.billed_line_item_id,
        workspaceId: parsed.data.workspaceId,
      });
      return NextResponse.json({ error: BILLED_ENTRY_REFUSAL }, { status: 409 });
    }

    const { error } = await supabase.from("invoicing_time_entries").delete().eq("id", timeEntry.id);

    if (error) {
      audit.error("invoicing_time_entry_delete_failed", {
        timeEntryId: timeEntry.id,
        workspaceId: parsed.data.workspaceId,
        message: error.message,
      });
      return NextResponse.json({ error: "Failed to delete time entry" }, { status: 500 });
    }

    audit.info("invoicing_time_entry_deleted", {
      timeEntryId: timeEntry.id,
      workspaceId: parsed.data.workspaceId,
      userId: user.id,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json({ deleted: true });
  } catch (error) {
    audit.error("invoicing_time_entry_delete_unhandled_error", { durationMs: Date.now() - startedAt, error });
    return NextResponse.json({ error: "Unexpected error while deleting time entry" }, { status: 500 });
  }
}
