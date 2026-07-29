import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { canAccessWorkspaceAction } from "@/lib/auth/role-matrix";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { withAssistantActionAudit } from "@/lib/observability/action-audit";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { verifyAssistantActionApproval } from "@/lib/assistant/action-approval-server";
import { BODY_LIMITS, readJsonOrNullWithLimit } from "@/lib/http/body-limit";
import { isWriteFailure, noRowsMatchedResponse, writeMatchedNoRows } from "@/lib/http/write-outcome";

const paramsSchema = z.object({
  invoiceId: z.string().uuid(),
});

const INVOICE_SELECT_LEGACY =
  "id, workspace_id, project_id, funding_award_id, invoice_number, consultant_name, billing_basis, status, period_start, period_end, invoice_date, due_date, amount, retention_percent, retention_amount, net_amount, supporting_docs_status, submitted_to, caltrans_posture, notes, created_at";

// caltrans_posture stays selected as the legacy read fallback for rows that
// predate the reimbursement-profile backfill (20260727000009).
const INVOICE_SELECT =
  `${INVOICE_SELECT_LEGACY}, reimbursement_profile_id, reimbursement_posture, reimbursement_profile_selection`;

/** PostgREST's shapes for "this deployment has not applied the profile-columns migration yet". */
function looksLikePendingProfileSchema(message: string | null | undefined): boolean {
  return /could not find the .* column|column .* does not exist|schema cache/i.test(message ?? "");
}

const patchBillingInvoiceSchema = z
  .object({
    workspaceId: z.string().uuid(),
    fundingAwardId: z.union([z.string().uuid(), z.null()]).optional(),
    status: z.enum(["draft", "internal_review", "submitted", "approved_for_payment", "paid", "rejected"]).optional(),
  })
  .refine((value) => value.fundingAwardId !== undefined || value.status !== undefined, {
    message: "At least one invoice patch field is required",
    path: ["fundingAwardId"],
  });

/**
 * The update changed nothing — carried out of the update body as its own error
 * so the handler can tell it apart from a database failure. It has to travel as
 * a throw rather than a return value because the update runs inside
 * `withAssistantActionAudit`, which records a *failed* execution only when the
 * body throws, and a patch that saved nothing is not a successful action.
 */
class InvoiceUpdateMatchedNoRowsError extends Error {
  constructor() {
    super("billing_invoice_update_matched_no_rows");
    this.name = "InvoiceUpdateMatchedNoRowsError";
  }
}

type RouteContext = {
  params: Promise<{ invoiceId: string }>;
};

export async function PATCH(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("billing.invoices.patch", request);
  const startedAt = Date.now();

  try {
    const routeParams = await context.params;
    const parsedParams = paramsSchema.safeParse(routeParams);
    if (!parsedParams.success) {
      audit.warn("params_validation_failed", { issues: parsedParams.error.issues });
      return NextResponse.json({ error: "Invalid invoice id" }, { status: 400 });
    }

    const payloadBody = await readJsonOrNullWithLimit(request, BODY_LIMITS.normalJson);

    if (!payloadBody.ok) return payloadBody.response;

    const payload = payloadBody.data;
    const parsed = patchBillingInvoiceSchema.safeParse(payload);
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
      audit.warn("forbidden", {
        workspaceId: parsed.data.workspaceId,
        userId: user.id,
        role: membership.role,
      });
      return NextResponse.json({ error: "Owner or admin role required for invoice writes" }, { status: 403 });
    }

    const { data: invoice, error: invoiceError } = await supabase
      .from("billing_invoice_records")
      .select("id, workspace_id, project_id, funding_award_id")
      .eq("id", parsedParams.data.invoiceId)
      .single();

    if (invoiceError || !invoice || invoice.workspace_id !== parsed.data.workspaceId) {
      audit.warn("invoice_workspace_mismatch", {
        invoiceId: parsedParams.data.invoiceId,
        workspaceId: parsed.data.workspaceId,
        message: invoiceError?.message ?? null,
      });
      return NextResponse.json({ error: "Invoice is not available in the requested workspace" }, { status: 404 });
    }

    let effectiveProjectId = invoice.project_id ?? null;
    let effectiveFundingAwardId: string | null =
      parsed.data.fundingAwardId === undefined ? invoice.funding_award_id ?? null : parsed.data.fundingAwardId;

    if (parsed.data.fundingAwardId) {
      const { data: fundingAward, error: fundingAwardError } = await supabase
        .from("funding_awards")
        .select("id, workspace_id, project_id")
        .eq("id", parsed.data.fundingAwardId)
        .single();

      if (fundingAwardError || !fundingAward || fundingAward.workspace_id !== parsed.data.workspaceId) {
        audit.warn("funding_award_workspace_mismatch", {
          workspaceId: parsed.data.workspaceId,
          fundingAwardId: parsed.data.fundingAwardId,
          message: fundingAwardError?.message ?? null,
        });
        return NextResponse.json({ error: "Funding award is not available in the requested workspace" }, { status: 400 });
      }

      if (effectiveProjectId && fundingAward.project_id && effectiveProjectId !== fundingAward.project_id) {
        return NextResponse.json({ error: "Funding award must match the linked invoice project" }, { status: 400 });
      }

      effectiveProjectId = effectiveProjectId ?? fundingAward.project_id ?? null;
      effectiveFundingAwardId = fundingAward.id;
    }

    const runUpdate = async () => {
      const updatePayload = {
        project_id: effectiveProjectId,
        funding_award_id: effectiveFundingAwardId,
        status: parsed.data.status ?? undefined,
      };
      let { data, error } = await supabase
        .from("billing_invoice_records")
        .update(updatePayload)
        .eq("id", invoice.id)
        .select(INVOICE_SELECT)
        .single();
      if (error && looksLikePendingProfileSchema(error.message)) {
        // This deployment's database predates the profile columns; the legacy
        // select keeps the patch working.
        ({ data, error } = await supabase
          .from("billing_invoice_records")
          .update(updatePayload)
          .eq("id", invoice.id)
          .select(INVOICE_SELECT_LEGACY)
          .single());
      }
      if (isWriteFailure(error)) {
        throw new Error(error?.message ?? "billing_invoice_update_failed");
      }
      if (writeMatchedNoRows({ data, error })) {
        throw new InvoiceUpdateMatchedNoRowsError();
      }
      return data;
    };

    const shouldAuditAsLink = parsed.data.fundingAwardId !== undefined;
    const shouldVerifyAssistantLink = parsed.data.fundingAwardId !== undefined && parsed.data.fundingAwardId !== null;
    const serviceSupabase = shouldAuditAsLink ? createServiceRoleClient() : null;
    let approval:
      | {
          approvalId: string | null;
          inputHash: string | null;
          executionSource: "manual" | "planner_agent_quick_link";
        }
      | null = null;
    if (shouldVerifyAssistantLink && serviceSupabase) {
      try {
        approval = await verifyAssistantActionApproval({
          request,
          serviceSupabase,
          userId: user.id,
          workspaceId: parsed.data.workspaceId,
          action: {
            kind: "link_billing_invoice_funding_award",
            workspaceId: parsed.data.workspaceId,
            invoiceId: invoice.id,
            fundingAwardId: parsed.data.fundingAwardId!,
          },
        });
      } catch (approvalError) {
        return NextResponse.json(
          { error: approvalError instanceof Error ? approvalError.message : "Planner Agent approval failed" },
          { status: 403 }
        );
      }
    }

    let updatedInvoice;
    try {
      updatedInvoice = shouldAuditAsLink
        ? await withAssistantActionAudit(
            serviceSupabase!,
            {
              actionKind: "link_billing_invoice_funding_award",
              workspaceId: parsed.data.workspaceId,
              userId: user.id,
              approvalId: approval?.approvalId ?? null,
              inputHash: approval?.inputHash ?? null,
              executionSource: approval?.executionSource ?? "manual",
              inputSummary: {
                invoiceId: invoice.id,
                fundingAwardId: parsed.data.fundingAwardId,
              },
            },
            runUpdate
          )
        : await runUpdate();
    } catch (updateErr) {
      if (updateErr instanceof InvoiceUpdateMatchedNoRowsError) {
        // The invoice row was read back through the caller's own client above
        // and cleared the membership and role checks, so an update that changes
        // nothing is the database refusing a write the application had allowed.
        audit.error("billing_invoice_update_matched_no_rows", {
          invoiceId: invoice.id,
          workspaceId: parsed.data.workspaceId,
          userId: user.id,
        });
        return noRowsMatchedResponse({ subject: "invoice", targetWasVerified: true });
      }

      audit.error("billing_invoice_update_failed", {
        invoiceId: invoice.id,
        workspaceId: parsed.data.workspaceId,
        userId: user.id,
        message: updateErr instanceof Error ? updateErr.message : String(updateErr),
      });
      return NextResponse.json({ error: "Failed to update invoice record" }, { status: 500 });
    }

    audit.info("billing_invoice_updated", {
      invoiceId: invoice.id,
      workspaceId: parsed.data.workspaceId,
      userId: user.id,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json({ invoice: updatedInvoice });
  } catch (error) {
    audit.error("billing_invoice_patch_unhandled_error", {
      error,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json({ error: "Unexpected error while updating invoice record" }, { status: 500 });
  }
}
