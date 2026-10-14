import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { canAccessWorkspaceAction } from "@/lib/auth/role-matrix";
import { computeLineItemAmount, summarizeClientInvoiceTotals } from "@/lib/invoicing/receivables";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { createClient } from "@/lib/supabase/server";
import { todayInWorkspace } from "@/lib/time/workspace-calendar";
import { BODY_LIMITS, readJsonOrNullWithLimit } from "@/lib/http/body-limit";
import {
  isWriteFailure,
  noRowsMatchedBody,
  noRowsMatchedStatus,
  writeMatchedNoRows,
} from "@/lib/http/write-outcome";

const CLIENT_INVOICE_SELECT =
  "id, workspace_id, client_id, engagement_id, project_id, invoice_number, status, sent_date, paid_date, period_start, period_end, invoice_date, due_date, subtotal_amount, retention_percent, retention_amount, total_amount, payment_terms, currency_code, notes, created_by, created_at, updated_at";

const LINE_ITEM_SELECT =
  "id, invoice_id, position, description, quantity, unit_label, unit_amount, amount, deliverable_id, milestone_id, created_at, updated_at";

// A sent invoice is a document the client may already hold; its lines are that
// document's content. Correction is by voiding and reissuing, never by editing
// what was sent.
const IMMUTABLE_LINES_REFUSAL =
  "Line items are immutable once an invoice has been sent — void it and reissue a corrected invoice";

const paramsSchema = z.object({
  invoiceId: z.string().uuid(),
});

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

const patchClientInvoiceSchema = z
  .object({
    workspaceId: z.string().uuid(),
    status: z.enum(["sent", "paid", "void"]).optional(),
    lineItems: z.array(lineItemSchema).min(1).max(200).optional(),
  })
  .refine((value) => value.status !== undefined || value.lineItems !== undefined, {
    message: "At least one invoice patch field is required",
    path: ["status"],
  });

type RouteContext = {
  params: Promise<{ invoiceId: string }>;
};

type SupabaseLike = Awaited<ReturnType<typeof createClient>>;

type CurrentLineRow = { id: string };

type ReplacedLineRow = { id: string };

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
 * Release every time entry stamped to the given line items back to the
 * unbilled pool. This is the void path's obligation: a voided invoice claims
 * no time, so the hours it had pulled become billable again.
 */
async function unstampTimeEntriesForLineItems(
  supabase: SupabaseLike,
  lineItemIds: readonly string[]
): Promise<{ message: string } | null> {
  if (lineItemIds.length === 0) return null;

  const { error } = await supabase
    .from("invoicing_time_entries")
    .update({ billed_line_item_id: null })
    .in("billed_line_item_id", [...lineItemIds]);

  return error ? { message: error.message } : null;
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("invoicing.client_invoices.patch", request);
  const startedAt = Date.now();

  try {
    const parsedParams = paramsSchema.safeParse(await context.params);
    if (!parsedParams.success) {
      audit.warn("params_validation_failed", { issues: parsedParams.error.issues });
      return NextResponse.json({ error: "Invalid invoice id" }, { status: 400 });
    }

    const payloadBody = await readJsonOrNullWithLimit(request, BODY_LIMITS.normalJson);
    if (!payloadBody.ok) return payloadBody.response;
    const parsed = patchClientInvoiceSchema.safeParse(payloadBody.data);

    if (!parsed.success) {
      audit.warn("validation_failed", { issues: parsed.error.issues });
      return NextResponse.json({ error: "Invalid invoice patch payload" }, { status: 400 });
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

    const { data: invoiceRow, error: invoiceError } = await supabase
      .from("client_invoices")
      .select("id, workspace_id, engagement_id, project_id, status, retention_percent")
      .eq("id", parsedParams.data.invoiceId)
      .single();

    const invoice = invoiceRow as {
      id: string;
      workspace_id: string;
      engagement_id: string | null;
      project_id: string | null;
      status: string;
      retention_percent: number | string | null;
    } | null;

    if (invoiceError || !invoice || invoice.workspace_id !== parsed.data.workspaceId) {
      audit.warn("invoice_workspace_mismatch", {
        invoiceId: parsedParams.data.invoiceId,
        workspaceId: parsed.data.workspaceId,
        message: invoiceError?.message ?? null,
      });
      return NextResponse.json({ error: "Invoice is not available in the requested workspace" }, { status: 404 });
    }

    if (parsed.data.lineItems && invoice.status !== "draft") {
      audit.warn("immutable_line_items_refused", {
        invoiceId: invoice.id,
        workspaceId: parsed.data.workspaceId,
        status: invoice.status,
      });
      return NextResponse.json({ error: IMMUTABLE_LINES_REFUSAL }, { status: 409 });
    }

    // The current line ids tell the time-entry check which stamps are this
    // invoice's own, and tell void which time to release.
    const { data: currentLineData, error: currentLinesError } = await supabase
      .from("client_invoice_line_items")
      .select("id")
      .eq("invoice_id", invoice.id);

    if (currentLinesError) {
      audit.error("client_invoice_lines_read_failed", {
        invoiceId: invoice.id,
        workspaceId: parsed.data.workspaceId,
        message: currentLinesError.message,
      });
      return NextResponse.json(
        { error: "Failed to load the invoice's line items; nothing was changed" },
        { status: 500 }
      );
    }

    const currentLines = (currentLineData ?? []) as CurrentLineRow[];
    const currentLineIds = currentLines.map((line) => line.id);
    let effectiveLineIds = currentLineIds;

    const update: Record<string, unknown> = {};
    let replacedLineRows: unknown[] | null = null;

    if (parsed.data.lineItems) {
      const lines = parsed.data.lineItems;

      // Deliverable / milestone coherence against the invoice's own project.
      const deliverableIds = [...new Set(lines.flatMap((line) => (line.deliverableId ? [line.deliverableId] : [])))];
      const milestoneIds = [...new Set(lines.flatMap((line) => (line.milestoneId ? [line.milestoneId] : [])))];

      if ((deliverableIds.length > 0 || milestoneIds.length > 0) && !invoice.project_id) {
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
          rows.some((row) => row.project_id !== invoice.project_id)
        ) {
          audit.warn("line_deliverable_project_mismatch", {
            invoiceId: invoice.id,
            workspaceId: parsed.data.workspaceId,
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
          rows.some((row) => row.project_id !== invoice.project_id)
        ) {
          audit.warn("line_milestone_project_mismatch", {
            invoiceId: invoice.id,
            workspaceId: parsed.data.workspaceId,
            milestoneIds,
            message: milestonesError?.message ?? null,
          });
          return NextResponse.json(
            { error: "Line item milestone does not belong to the invoice's project" },
            { status: 400 }
          );
        }
      }

      const { ids: timeEntryIds, duplicateId } = collectSourceTimeEntryIds(lines);
      if (duplicateId) {
        return NextResponse.json({ error: "A time entry may back only one line item" }, { status: 400 });
      }

      if (timeEntryIds.length > 0) {
        if (!invoice.engagement_id) {
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
            invoiceId: invoice.id,
            workspaceId: parsed.data.workspaceId,
            timeEntryIds,
            message: timeEntriesError?.message ?? null,
          });
          return NextResponse.json(
            { error: "Time entry is not available in the requested workspace" },
            { status: 400 }
          );
        }

        if (rows.some((row) => row.engagement_id !== invoice.engagement_id)) {
          return NextResponse.json(
            { error: "Time entry does not belong to the invoice's engagement" },
            { status: 400 }
          );
        }

        // Stamped to one of THIS invoice's current lines is fine — the
        // replacement re-stamps it. Stamped anywhere else is a conflict.
        const currentLineIdSet = new Set(currentLineIds);
        const billedElsewhere = rows.find(
          (row) => row.billed_line_item_id !== null && !currentLineIdSet.has(row.billed_line_item_id)
        );
        if (billedElsewhere) {
          audit.warn("billed_time_entry_refused", {
            invoiceId: invoice.id,
            workspaceId: parsed.data.workspaceId,
            timeEntryId: billedElsewhere.id,
            billedLineItemId: billedElsewhere.billed_line_item_id,
          });
          return NextResponse.json(
            { error: "Time entry is already billed on another invoice; void that invoice or remove its line item first" },
            { status: 409 }
          );
        }
      }

      const totals = summarizeClientInvoiceTotals(
        lines.map((line) => ({
          quantity: line.quantity ?? null,
          unit_amount: line.unitAmount ?? null,
          amount: line.amount ?? null,
        })),
        invoice.retention_percent
      );

      // One database transaction deletes the current lines, inserts the new
      // set, links its time entries and stores the totals. Any failure leaves
      // the previous lines, links and totals exactly as they were.
      const { data: newLineData, error: replaceError } = await supabase
        .rpc("replace_client_invoice_lines", {
          p_invoice_id: invoice.id,
          p_lines: lines.map((line) => ({
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
            source_time_entry_ids: line.sourceTimeEntryIds ?? [],
          })),
          p_subtotal_amount: totals.subtotalAmount,
          p_retention_amount: totals.retentionAmount,
          p_total_amount: totals.totalAmount,
        })
        .select(LINE_ITEM_SELECT);

      const newLines = (newLineData ?? []) as ReplacedLineRow[];

      if (replaceError || newLines.length !== lines.length) {
        audit.error("client_invoice_line_replace_failed", {
          invoiceId: invoice.id,
          workspaceId: parsed.data.workspaceId,
          message: replaceError?.message ?? "line replacement returned a short row set",
          code: replaceError?.code ?? null,
        });
        // PT409 is the function's own plain-language refusal: the invoice left
        // draft, or a concurrent invoice billed one of the time entries.
        if (replaceError?.code === "PT409") {
          return NextResponse.json({ error: replaceError.message }, { status: 409 });
        }
        if (replaceError?.code === "42501") {
          return NextResponse.json({ error: "Owner or admin role required for invoice writes" }, { status: 403 });
        }
        return NextResponse.json(
          { error: "Failed to replace the invoice's line items; nothing was changed" },
          { status: 500 }
        );
      }

      replacedLineRows = newLineData as unknown[];
      effectiveLineIds = newLines.map((line) => line.id);
    }

    const statusAfterLines = parsed.data.lineItems ? "draft" : invoice.status;

    if (parsed.data.status) {
      const requested = parsed.data.status;
      // Sent and paid dates are the workspace's calendar day, not the server's.
      const workspaceToday = async () => {
        const calendar = await todayInWorkspace(supabase, invoice.workspace_id);
        if (calendar.readError) {
          audit.warn("workspace_calendar_unreadable", { workspaceId: invoice.workspace_id, message: calendar.readError });
        }
        return calendar.today;
      };

      if (requested === "sent") {
        if (statusAfterLines !== "draft") {
          return NextResponse.json({ error: "Only a draft invoice can be sent" }, { status: 409 });
        }
        update.status = "sent";
        update.sent_date = await workspaceToday();
      } else if (requested === "paid") {
        if (statusAfterLines !== "sent") {
          return NextResponse.json({ error: "Only a sent invoice can be marked paid" }, { status: 409 });
        }
        update.status = "paid";
        update.paid_date = await workspaceToday();
      } else {
        // Void is reachable from any status and is deliberately idempotent:
        // re-voiding re-runs the time-entry release below, which is the
        // documented recovery when that release failed the first time.
        update.status = "void";
      }
    }

    if (Object.keys(update).length === 0) {
      // Lines only: the database function already stored the new totals, so
      // there is nothing left to write. Read the invoice back for the response.
      const { data: current, error: readError } = await supabase
        .from("client_invoices")
        .select(CLIENT_INVOICE_SELECT)
        .eq("id", invoice.id)
        .single();

      if (readError || !current) {
        audit.error("client_invoice_read_after_replace_failed", {
          invoiceId: invoice.id,
          workspaceId: parsed.data.workspaceId,
          message: readError?.message ?? "client_invoice_read_returned_no_row",
        });
        return NextResponse.json(
          { error: "The line items and totals were saved, but the invoice could not be read back. Reload to see it." },
          { status: 500 }
        );
      }

      audit.info("client_invoice_updated", {
        invoiceId: invoice.id,
        workspaceId: parsed.data.workspaceId,
        status: null,
        lineItemsReplaced: true,
        userId: user.id,
        durationMs: Date.now() - startedAt,
      });

      return NextResponse.json({ invoice: current, lineItems: replacedLineRows });
    }

    const { data: updated, error: updateError } = await supabase
      .from("client_invoices")
      .update(update)
      .eq("id", invoice.id)
      .select(CLIENT_INVOICE_SELECT)
      .single();

    if (isWriteFailure(updateError)) {
      audit.error("client_invoice_update_failed", {
        invoiceId: invoice.id,
        workspaceId: parsed.data.workspaceId,
        message: updateError?.message ?? "client_invoice_update_returned_no_row",
        lineItemsReplaced: replacedLineRows !== null,
      });
      return NextResponse.json(
        {
          error: replacedLineRows
            ? "The line items and totals were saved, but the status change failed"
            : "Failed to update invoice",
        },
        { status: 500 }
      );
    }

    if (writeMatchedNoRows({ data: updated, error: updateError })) {
      // The invoice row was read back through the caller's own client above and
      // cleared the membership and role checks, so a zero-row update is the
      // database refusing a write the application had allowed.
      const outcome = { subject: "invoice", targetWasVerified: true };
      audit.error("client_invoice_update_matched_no_rows", {
        invoiceId: invoice.id,
        workspaceId: parsed.data.workspaceId,
        userId: user.id,
        lineItemsReplaced: replacedLineRows !== null,
      });
      return NextResponse.json(
        // A replacement that already landed cannot borrow the shared "nothing
        // was saved" wording: the new lines and totals ARE stored, and only the
        // status change is not, which is what the caller has to act on.
        replacedLineRows
          ? {
              error: "The line items and totals were saved, but the status change was not",
              details:
                "The replacement line items and the invoice totals were saved together. The database then matched " +
                "no rows for the status change. This request passed every check the application makes, so that " +
                "write was refused below the application, most often by a row-level security policy that grants no " +
                "permissive write.",
            }
          : noRowsMatchedBody(outcome),
        { status: noRowsMatchedStatus(outcome) }
      );
    }

    // Voiding releases the invoice's time entries back to the unbilled pool.
    // The invoice is voided FIRST: if the release fails, stamped entries stay
    // un-billable until retried, which is recoverable — the reverse order
    // could leave released hours billable against a still-live invoice.
    if (parsed.data.status === "void") {
      const unstampFailure = await unstampTimeEntriesForLineItems(supabase, effectiveLineIds);
      if (unstampFailure) {
        audit.error("client_invoice_void_unstamp_failed", {
          invoiceId: invoice.id,
          workspaceId: parsed.data.workspaceId,
          message: unstampFailure.message,
        });
        return NextResponse.json(
          {
            error:
              "The invoice was voided, but its time entries could not be returned to the unbilled pool — retry voiding to release them",
          },
          { status: 500 }
        );
      }
    }

    audit.info("client_invoice_updated", {
      invoiceId: invoice.id,
      workspaceId: parsed.data.workspaceId,
      status: parsed.data.status ?? null,
      lineItemsReplaced: replacedLineRows !== null,
      userId: user.id,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json({
      invoice: updated,
      ...(replacedLineRows ? { lineItems: replacedLineRows } : {}),
    });
  } catch (error) {
    audit.error("client_invoice_patch_unhandled_error", { durationMs: Date.now() - startedAt, error });
    return NextResponse.json({ error: "Unexpected error while updating invoice" }, { status: 500 });
  }
}
