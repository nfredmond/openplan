import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { canAccessWorkspaceAction } from "@/lib/auth/role-matrix";
import { computeNetInvoiceAmount, computeRetentionAmount } from "@/lib/billing/invoice-records";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { createClient } from "@/lib/supabase/server";

const createBillingInvoiceSchema = z.object({
  workspaceId: z.string().uuid(),
  projectId: z.string().uuid().optional(),
  invoiceNumber: z.string().trim().min(1).max(120),
  consultantName: z.string().trim().max(160).optional(),
  billingBasis: z.enum(["lump_sum", "time_and_materials", "cost_plus", "milestone", "progress_payment"]).optional(),
  status: z.enum(["draft", "internal_review", "submitted", "approved_for_payment", "paid", "rejected"]).optional(),
  periodStart: z.string().trim().max(30).optional(),
  periodEnd: z.string().trim().max(30).optional(),
  invoiceDate: z.string().trim().max(30).optional(),
  dueDate: z.string().trim().max(30).optional(),
  amount: z.coerce.number().min(0),
  retentionPercent: z.coerce.number().min(0).max(100).optional(),
  supportingDocsStatus: z.enum(["pending", "partial", "complete", "accepted"]).optional(),
  submittedTo: z.string().trim().max(160).optional(),
  caltransPosture: z.enum(["local_agency_consulting", "federal_aid_candidate", "deferred_exact_forms"]).optional(),
  notes: z.string().trim().max(4000).optional(),
});

export async function POST(request: NextRequest) {
  const audit = createApiAuditLogger("billing.invoices.create", request);
  const startedAt = Date.now();

  try {
    const payload = await request.json().catch(() => null);
    const parsed = createBillingInvoiceSchema.safeParse(payload);

    if (!parsed.success) {
      audit.warn("validation_failed", { issues: parsed.error.issues });
      return NextResponse.json({ error: "Invalid invoice payload" }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      audit.warn("unauthorized", { durationMs: Date.now() - startedAt });
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const membershipQuery = supabase
      .from("workspace_members")
      .select("workspace_id, role")
      .eq("workspace_id", parsed.data.workspaceId)
      .eq("user_id", user.id)
      .maybeSingle();

    const { data: membership, error: membershipError } = await membershipQuery;

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

    const amount = parsed.data.amount;
    const retentionPercent = parsed.data.retentionPercent ?? 0;
    const retentionAmount = computeRetentionAmount(amount, retentionPercent);
    const netAmount = computeNetInvoiceAmount(amount, retentionAmount, retentionPercent);

    const { data, error } = await supabase
      .from("billing_invoice_records")
      .insert({
        workspace_id: parsed.data.workspaceId,
        project_id: parsed.data.projectId ?? null,
        invoice_number: parsed.data.invoiceNumber,
        consultant_name: parsed.data.consultantName?.trim() || null,
        billing_basis: parsed.data.billingBasis ?? "time_and_materials",
        status: parsed.data.status ?? "draft",
        period_start: parsed.data.periodStart?.trim() || null,
        period_end: parsed.data.periodEnd?.trim() || null,
        invoice_date: parsed.data.invoiceDate?.trim() || null,
        due_date: parsed.data.dueDate?.trim() || null,
        amount,
        retention_percent: retentionPercent,
        retention_amount: retentionAmount,
        net_amount: netAmount,
        supporting_docs_status: parsed.data.supportingDocsStatus ?? "pending",
        submitted_to: parsed.data.submittedTo?.trim() || null,
        caltrans_posture: parsed.data.caltransPosture ?? "deferred_exact_forms",
        notes: parsed.data.notes?.trim() || null,
        created_by: user.id,
      })
      .select(
        "id, workspace_id, project_id, invoice_number, consultant_name, billing_basis, status, period_start, period_end, invoice_date, due_date, amount, retention_percent, retention_amount, net_amount, supporting_docs_status, submitted_to, caltrans_posture, notes, created_at"
      )
      .single();

    if (error) {
      audit.error("billing_invoice_insert_failed", {
        message: error.message,
        code: error.code ?? null,
        workspaceId: parsed.data.workspaceId,
      });
      return NextResponse.json({ error: "Failed to create invoice record", details: error.message }, { status: 500 });
    }

    audit.info("billing_invoice_created", {
      workspaceId: parsed.data.workspaceId,
      projectId: parsed.data.projectId ?? null,
      userId: user.id,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json({ invoice: data }, { status: 201 });
  } catch (error) {
    audit.error("billing_invoice_create_unhandled_error", {
      durationMs: Date.now() - startedAt,
      error,
    });

    return NextResponse.json({ error: "Unexpected error while creating invoice record" }, { status: 500 });
  }
}
