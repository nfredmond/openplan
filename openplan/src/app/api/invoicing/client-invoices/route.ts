import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { canAccessWorkspaceAction } from "@/lib/auth/role-matrix";
import {
  buildEngagementBilledSummary,
  computeLineItemAmount,
  summarizeClientInvoiceTotals,
} from "@/lib/invoicing/receivables";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { BODY_LIMITS, readJsonOrNullWithLimit } from "@/lib/http/body-limit";

const CLIENT_INVOICE_SELECT =
  "id, workspace_id, client_id, engagement_id, project_id, invoice_number, status, sent_date, paid_date, period_start, period_end, invoice_date, due_date, subtotal_amount, retention_percent, retention_amount, total_amount, payment_terms, currency_code, notes, created_by, created_at, updated_at";

const LINE_ITEM_SELECT =
  "id, invoice_id, position, description, quantity, unit_label, unit_amount, amount, deliverable_id, milestone_id, created_at, updated_at";

/**
 * List cap, disclosed via hasMore exactly like the time-entry ledger: at most
 * this many invoices come back, newest update first, and hasMore is true
 * exactly when the page sits at the cap.
 */
const CLIENT_INVOICE_LIST_LIMIT = 500;

/** Postgres unique-violation SQLSTATE — the workspace invoice-number index. */
const UNIQUE_VIOLATION = "23505";

const lineItemSchema = z.object({
  description: z.string().trim().min(1).max(2000),
  quantity: z.coerce.number().min(0).optional(),
  unitLabel: z.string().trim().max(60).optional(),
  unitAmount: z.coerce.number().min(0).optional(),
  amount: z.coerce.number().min(0).optional(),
  deliverableId: z.string().uuid().optional(),
  milestoneId: z.string().uuid().optional(),
  sourceTimeEntryIds: z.array(z.string().uuid()).max(500).optional(),
});

type LineItemInput = z.infer<typeof lineItemSchema>;

const createClientInvoiceSchema = z.object({
  workspaceId: z.string().uuid(),
  clientId: z.string().uuid(),
  engagementId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  invoiceNumber: z.string().trim().min(1).max(120),
  // An invoice is composed as a draft and becomes anything else only through
  // an explicit status transition on the detail route.
  status: z.literal("draft").optional(),
  invoiceDate: z.string().trim().max(30).optional(),
  periodStart: z.string().trim().max(30).optional(),
  periodEnd: z.string().trim().max(30).optional(),
  dueDate: z.string().trim().max(30).optional(),
  retentionPercent: z.coerce.number().min(0).max(100).optional(),
  paymentTerms: z.string().trim().max(2000).optional(),
  notes: z.string().trim().max(4000).optional(),
  lineItems: z.array(lineItemSchema).min(1).max(200),
});

const listClientInvoicesQuerySchema = z.object({
  workspaceId: z.string().uuid(),
  clientId: z.string().uuid().optional(),
  engagementId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  status: z.enum(["draft", "sent", "paid", "void"]).optional(),
});

type SupabaseLike = Awaited<ReturnType<typeof createClient>>;

/**
 * The union of every line's sourceTimeEntryIds. A time entry backs at most ONE
 * line item (billed_line_item_id is a single column), so an id repeated across
 * lines is a payload defect, reported rather than silently last-writer-wins.
 */
function collectSourceTimeEntryIds(lines: readonly LineItemInput[]): {
  ids: string[];
  duplicateId: string | null;
} {
  const seen = new Set<string>();
  for (const line of lines) {
    for (const id of line.sourceTimeEntryIds ?? []) {
      if (seen.has(id)) {
        return { ids: [...seen], duplicateId: id };
      }
      seen.add(id);
    }
  }
  return { ids: [...seen], duplicateId: null };
}

/**
 * Stamp each line's source time entries with the inserted line item's id.
 * Insert order is preserved by PostgREST, so lineRows[i] is lines[i].
 * Returns the first failure, or null when every stamp landed.
 *
 * The stamp is CONDITIONAL on the entry still being unbilled and the updated
 * row count is verified — the pre-insert already-billed check is a separate
 * read, so two concurrent creates could both pass it and bill the same hours
 * twice. The condition makes the database the arbiter: the loser of the race
 * stamps fewer rows than it sent and the whole create is rolled back.
 */
async function stampTimeEntriesToLines(
  supabase: SupabaseLike,
  lines: readonly LineItemInput[],
  lineRows: ReadonlyArray<{ id: string }>
): Promise<{ message: string; raced?: boolean } | null> {
  for (let index = 0; index < lines.length; index += 1) {
    const sourceIds = lines[index].sourceTimeEntryIds ?? [];
    if (sourceIds.length === 0) continue;

    const { data: stamped, error } = await supabase
      .from("invoicing_time_entries")
      .update({ billed_line_item_id: lineRows[index].id })
      .in("id", sourceIds)
      .is("billed_line_item_id", null)
      .select("id");

    if (error) {
      return { message: error.message };
    }

    if (((stamped ?? []) as Array<{ id: string }>).length !== sourceIds.length) {
      return {
        message:
          "One or more time entries were billed by a concurrent invoice; nothing from this invoice was kept",
        raced: true,
      };
    }
  }
  return null;
}

export async function POST(request: NextRequest) {
  const audit = createApiAuditLogger("invoicing.client_invoices.create", request);
  const startedAt = Date.now();

  try {
    const payloadBody = await readJsonOrNullWithLimit(request, BODY_LIMITS.normalJson);
    if (!payloadBody.ok) return payloadBody.response;
    const parsed = createClientInvoiceSchema.safeParse(payloadBody.data);

    if (!parsed.success) {
      audit.warn("validation_failed", { issues: parsed.error.issues });
      return NextResponse.json({ error: "Invalid client invoice payload" }, { status: 400 });
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

    type EngagementRow = {
      id: string;
      workspace_id: string;
      client_id: string;
      project_id: string | null;
      not_to_exceed_amount: number | string | null;
    };
    let engagement: EngagementRow | null = null;

    if (parsed.data.engagementId) {
      const { data: engagementRow, error: engagementError } = await supabase
        .from("invoicing_engagements")
        .select("id, workspace_id, client_id, project_id, not_to_exceed_amount")
        .eq("id", parsed.data.engagementId)
        .single();

      if (engagementError || !engagementRow || engagementRow.workspace_id !== parsed.data.workspaceId) {
        audit.warn("engagement_workspace_mismatch", {
          workspaceId: parsed.data.workspaceId,
          engagementId: parsed.data.engagementId,
          message: engagementError?.message ?? null,
        });
        return NextResponse.json({ error: "Engagement is not available in the requested workspace" }, { status: 400 });
      }

      if (engagementRow.client_id !== parsed.data.clientId) {
        audit.warn("engagement_client_mismatch", {
          workspaceId: parsed.data.workspaceId,
          engagementId: parsed.data.engagementId,
          clientId: parsed.data.clientId,
        });
        return NextResponse.json({ error: "Engagement does not belong to the selected client" }, { status: 400 });
      }

      engagement = engagementRow as EngagementRow;
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

      if (engagement?.project_id && engagement.project_id !== parsed.data.projectId) {
        return NextResponse.json({ error: "Engagement is linked to a different project" }, { status: 400 });
      }
    }

    const effectiveProjectId = parsed.data.projectId ?? engagement?.project_id ?? null;

    // Deliverable / milestone coherence: both are project subrecords, so a
    // line may reference them only when the invoice itself references their
    // project. (The project was already workspace-checked above, so project
    // coherence implies workspace coherence.)
    const deliverableIds = [
      ...new Set(parsed.data.lineItems.flatMap((line) => (line.deliverableId ? [line.deliverableId] : []))),
    ];
    const milestoneIds = [
      ...new Set(parsed.data.lineItems.flatMap((line) => (line.milestoneId ? [line.milestoneId] : []))),
    ];

    if ((deliverableIds.length > 0 || milestoneIds.length > 0) && !effectiveProjectId) {
      return NextResponse.json(
        { error: "Line items reference deliverables or milestones, but the invoice references no project" },
        { status: 400 }
      );
    }

    if (deliverableIds.length > 0) {
      const { data: deliverables, error: deliverablesError } = await supabase
        .from("project_deliverables")
        .select("id, project_id")
        .in("id", deliverableIds);

      const rows = (deliverables ?? []) as Array<{ id: string; project_id: string }>;
      if (
        deliverablesError ||
        rows.length !== deliverableIds.length ||
        rows.some((row) => row.project_id !== effectiveProjectId)
      ) {
        audit.warn("line_deliverable_project_mismatch", {
          workspaceId: parsed.data.workspaceId,
          projectId: effectiveProjectId,
          deliverableIds,
          message: deliverablesError?.message ?? null,
        });
        return NextResponse.json(
          { error: "Line item deliverable does not belong to the invoice's project" },
          { status: 400 }
        );
      }
    }

    if (milestoneIds.length > 0) {
      const { data: milestones, error: milestonesError } = await supabase
        .from("project_milestones")
        .select("id, project_id")
        .in("id", milestoneIds);

      const rows = (milestones ?? []) as Array<{ id: string; project_id: string }>;
      if (
        milestonesError ||
        rows.length !== milestoneIds.length ||
        rows.some((row) => row.project_id !== effectiveProjectId)
      ) {
        audit.warn("line_milestone_project_mismatch", {
          workspaceId: parsed.data.workspaceId,
          projectId: effectiveProjectId,
          milestoneIds,
          message: milestonesError?.message ?? null,
        });
        return NextResponse.json(
          { error: "Line item milestone does not belong to the invoice's project" },
          { status: 400 }
        );
      }
    }

    // Source time entries: workspace + engagement coherent, unbilled, and each
    // backing at most one line.
    const { ids: timeEntryIds, duplicateId } = collectSourceTimeEntryIds(parsed.data.lineItems);
    if (duplicateId) {
      return NextResponse.json({ error: "A time entry may back only one line item" }, { status: 400 });
    }

    if (timeEntryIds.length > 0) {
      if (!engagement) {
        return NextResponse.json(
          { error: "Time-entry-backed line items require the invoice to reference an engagement" },
          { status: 400 }
        );
      }

      const { data: timeEntries, error: timeEntriesError } = await supabase
        .from("invoicing_time_entries")
        .select("id, workspace_id, engagement_id, billed_line_item_id")
        .in("id", timeEntryIds);

      const rows = (timeEntries ?? []) as Array<{
        id: string;
        workspace_id: string;
        engagement_id: string;
        billed_line_item_id: string | null;
      }>;

      if (
        timeEntriesError ||
        rows.length !== timeEntryIds.length ||
        rows.some((row) => row.workspace_id !== parsed.data.workspaceId)
      ) {
        audit.warn("time_entry_workspace_mismatch", {
          workspaceId: parsed.data.workspaceId,
          timeEntryIds,
          message: timeEntriesError?.message ?? null,
        });
        return NextResponse.json(
          { error: "Time entry is not available in the requested workspace" },
          { status: 400 }
        );
      }

      if (rows.some((row) => row.engagement_id !== engagement?.id)) {
        return NextResponse.json(
          { error: "Time entry does not belong to the invoice's engagement" },
          { status: 400 }
        );
      }

      const alreadyBilled = rows.find((row) => row.billed_line_item_id !== null);
      if (alreadyBilled) {
        audit.warn("billed_time_entry_refused", {
          workspaceId: parsed.data.workspaceId,
          timeEntryId: alreadyBilled.id,
          billedLineItemId: alreadyBilled.billed_line_item_id,
        });
        return NextResponse.json(
          { error: "Time entry is already billed on an invoice; void that invoice or remove its line item first" },
          { status: 409 }
        );
      }
    }

    // Billed position BEFORE this invoice, for the not-to-exceed warning. Read
    // ahead of the insert so the new invoice cannot count against itself.
    let priorBilledToDate: number | null = null;
    let notToExceed: number | null = null;

    if (engagement) {
      const { data: engagementInvoices, error: engagementInvoicesError } = await supabase
        .from("client_invoices")
        .select("id, status, engagement_id, subtotal_amount, retention_percent, retention_amount, total_amount")
        .eq("engagement_id", engagement.id);

      if (!engagementInvoicesError) {
        const summary = buildEngagementBilledSummary(
          engagement,
          (engagementInvoices ?? []) as Parameters<typeof buildEngagementBilledSummary>[1]
        );
        priorBilledToDate = summary.billedToDate;
        notToExceed = summary.notToExceed;
      } else {
        // The warning is best-effort; a failed read must not block the create,
        // but it is audited so a silent NTE blind spot cannot form.
        audit.warn("nte_position_read_failed", {
          workspaceId: parsed.data.workspaceId,
          engagementId: engagement.id,
          message: engagementInvoicesError.message,
        });
      }
    }

    const totals = summarizeClientInvoiceTotals(
      parsed.data.lineItems.map((line) => ({
        quantity: line.quantity ?? null,
        unit_amount: line.unitAmount ?? null,
        amount: line.amount ?? null,
      })),
      parsed.data.retentionPercent ?? 0
    );

    const { data: invoice, error: invoiceError } = await supabase
      .from("client_invoices")
      .insert({
        workspace_id: parsed.data.workspaceId,
        client_id: parsed.data.clientId,
        engagement_id: engagement?.id ?? null,
        project_id: effectiveProjectId,
        invoice_number: parsed.data.invoiceNumber,
        status: "draft",
        invoice_date: parsed.data.invoiceDate?.trim() || null,
        period_start: parsed.data.periodStart?.trim() || null,
        period_end: parsed.data.periodEnd?.trim() || null,
        due_date: parsed.data.dueDate?.trim() || null,
        subtotal_amount: totals.subtotalAmount,
        retention_percent: totals.retentionPercent,
        retention_amount: totals.retentionAmount,
        total_amount: totals.totalAmount,
        payment_terms: parsed.data.paymentTerms?.trim() || null,
        notes: parsed.data.notes?.trim() || null,
        created_by: user.id,
      })
      .select(CLIENT_INVOICE_SELECT)
      .single();

    if (invoiceError || !invoice) {
      if (invoiceError?.code === UNIQUE_VIOLATION) {
        audit.warn("client_invoice_number_taken", {
          workspaceId: parsed.data.workspaceId,
          invoiceNumber: parsed.data.invoiceNumber,
        });
        return NextResponse.json(
          { error: `Invoice number "${parsed.data.invoiceNumber}" is already used in this workspace` },
          { status: 409 }
        );
      }

      audit.error("client_invoice_insert_failed", {
        message: invoiceError?.message ?? "client_invoice_insert_returned_no_row",
        code: invoiceError?.code ?? null,
        workspaceId: parsed.data.workspaceId,
      });
      return NextResponse.json({ error: "Failed to create client invoice" }, { status: 500 });
    }

    const invoiceRow = invoice as { id: string };

    const { data: lineRows, error: lineInsertError } = await supabase
      .from("client_invoice_line_items")
      .insert(
        parsed.data.lineItems.map((line, position) => ({
          invoice_id: invoiceRow.id,
          position,
          description: line.description,
          quantity: line.quantity ?? null,
          unit_label: line.unitLabel?.trim() || null,
          unit_amount: line.unitAmount ?? null,
          amount: computeLineItemAmount({
            quantity: line.quantity ?? null,
            unit_amount: line.unitAmount ?? null,
            amount: line.amount ?? null,
          }),
          deliverable_id: line.deliverableId ?? null,
          milestone_id: line.milestoneId ?? null,
        }))
      )
      .select(LINE_ITEM_SELECT);

    const insertedLines = (lineRows ?? []) as Array<{ id: string }>;

    const rollBackInvoice = async (reason: string, message: string | null) => {
      // client_invoices deliberately has no RLS DELETE policy (correction is
      // by voiding), so this compensating delete — removing a half-created
      // draft shell before anyone could have seen it — goes through the
      // service-role client. The cascade removes any inserted lines, and the
      // billed_line_item_id FK's ON DELETE SET NULL releases any stamps.
      try {
        const serviceSupabase = createServiceRoleClient();
        const { error: deleteError } = await serviceSupabase
          .from("client_invoices")
          .delete()
          .eq("id", invoiceRow.id);

        audit.error(reason, {
          workspaceId: parsed.data.workspaceId,
          invoiceId: invoiceRow.id,
          message,
          compensatingDelete: deleteError ? `failed: ${deleteError.message}` : "completed",
        });
        return deleteError === null;
      } catch (cleanupError) {
        audit.error(reason, {
          workspaceId: parsed.data.workspaceId,
          invoiceId: invoiceRow.id,
          message,
          compensatingDelete: `failed: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`,
        });
        return false;
      }
    };

    if (lineInsertError || insertedLines.length !== parsed.data.lineItems.length) {
      const cleaned = await rollBackInvoice(
        "client_invoice_line_insert_failed_invoice_rolled_back",
        lineInsertError?.message ?? "line insert returned a short row set"
      );
      return NextResponse.json(
        {
          error: cleaned
            ? "Failed to create invoice line items; the invoice was rolled back"
            : "Failed to create invoice line items, and the draft invoice shell could not be removed — delete it by voiding",
        },
        { status: 500 }
      );
    }

    const stampFailure = await stampTimeEntriesToLines(supabase, parsed.data.lineItems, insertedLines);
    if (stampFailure) {
      // Rolling back the invoice cascades the line items away, and the
      // billed_line_item_id FK's ON DELETE SET NULL releases any stamps this
      // invoice DID land before the failure — no hours stay claimed by it.
      const cleaned = await rollBackInvoice(
        "client_invoice_time_entry_stamp_failed_invoice_rolled_back",
        stampFailure.message
      );
      if (stampFailure.raced && cleaned) {
        return NextResponse.json({ error: stampFailure.message }, { status: 409 });
      }
      return NextResponse.json(
        {
          error: cleaned
            ? "Failed to link time entries to the invoice; the invoice was rolled back"
            : "Failed to link time entries to the invoice, and the draft invoice shell could not be removed — delete it by voiding",
        },
        { status: 500 }
      );
    }

    // Not-to-exceed overruns WARN and never block: the ceiling is the
    // engagement's business context, and the planner composing the invoice is
    // the one who has to negotiate it — hiding the invoice would not.
    let nteWarning: { billedToDate: number; notToExceed: number; overBy: number } | undefined;
    if (notToExceed !== null && priorBilledToDate !== null) {
      const projected = Math.round((priorBilledToDate + totals.totalAmount) * 100) / 100;
      if (projected > notToExceed) {
        nteWarning = {
          billedToDate: priorBilledToDate,
          notToExceed,
          overBy: Math.round((projected - notToExceed) * 100) / 100,
        };
      }
    }

    audit.info("client_invoice_created", {
      workspaceId: parsed.data.workspaceId,
      invoiceId: invoiceRow.id,
      clientId: parsed.data.clientId,
      engagementId: engagement?.id ?? null,
      lineItemCount: insertedLines.length,
      nteOverBy: nteWarning?.overBy ?? null,
      userId: user.id,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json(
      { invoice, lineItems: lineRows, ...(nteWarning ? { nteWarning } : {}) },
      { status: 201 }
    );
  } catch (error) {
    audit.error("client_invoice_create_unhandled_error", { durationMs: Date.now() - startedAt, error });
    return NextResponse.json({ error: "Unexpected error while creating client invoice" }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  const audit = createApiAuditLogger("invoicing.client_invoices.list", request);
  const startedAt = Date.now();

  try {
    const parsed = listClientInvoicesQuerySchema.safeParse(
      Object.fromEntries(request.nextUrl.searchParams.entries())
    );
    if (!parsed.success) {
      audit.warn("validation_failed", { issues: parsed.error.issues });
      return NextResponse.json({ error: "Invalid client invoice query" }, { status: 400 });
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
      .from("client_invoices")
      .select(`${CLIENT_INVOICE_SELECT}, invoicing_clients(name), invoicing_engagements(title)`)
      .eq("workspace_id", parsed.data.workspaceId);

    if (parsed.data.clientId) {
      query = query.eq("client_id", parsed.data.clientId);
    }
    if (parsed.data.engagementId) {
      query = query.eq("engagement_id", parsed.data.engagementId);
    }
    if (parsed.data.projectId) {
      query = query.eq("project_id", parsed.data.projectId);
    }
    if (parsed.data.status) {
      query = query.eq("status", parsed.data.status);
    }

    const { data, error } = await query
      .order("updated_at", { ascending: false })
      .limit(CLIENT_INVOICE_LIST_LIMIT);

    if (error) {
      audit.error("client_invoices_list_failed", {
        message: error.message,
        workspaceId: parsed.data.workspaceId,
      });
      return NextResponse.json({ error: "Failed to load client invoices" }, { status: 500 });
    }

    const invoices = data ?? [];
    return NextResponse.json({
      invoices,
      // True exactly when the CLIENT_INVOICE_LIST_LIMIT cap truncated the list.
      hasMore: invoices.length === CLIENT_INVOICE_LIST_LIMIT,
    });
  } catch (error) {
    audit.error("client_invoices_list_unhandled_error", { durationMs: Date.now() - startedAt, error });
    return NextResponse.json({ error: "Unexpected error while loading client invoices" }, { status: 500 });
  }
}
