import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { canAccessWorkspaceAction } from "@/lib/auth/role-matrix";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { createClient } from "@/lib/supabase/server";

const paramsSchema = z.object({
  invoiceId: z.string().uuid(),
});

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

    const payload = await request.json().catch(() => null);
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

    if (!canAccessWorkspaceAction("billing.invoices.write", membership.role)) {
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

    const { data: updatedInvoice, error: updateError } = await supabase
      .from("billing_invoice_records")
      .update({
        project_id: effectiveProjectId,
        funding_award_id: effectiveFundingAwardId,
        status: parsed.data.status ?? undefined,
      })
      .eq("id", invoice.id)
      .select(
        "id, workspace_id, project_id, funding_award_id, invoice_number, consultant_name, billing_basis, status, period_start, period_end, invoice_date, due_date, amount, retention_percent, retention_amount, net_amount, supporting_docs_status, submitted_to, caltrans_posture, notes, created_at"
      )
      .single();

    if (updateError || !updatedInvoice) {
      audit.error("billing_invoice_update_failed", {
        invoiceId: invoice.id,
        workspaceId: parsed.data.workspaceId,
        userId: user.id,
        message: updateError?.message ?? "unknown",
        code: updateError?.code ?? null,
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
