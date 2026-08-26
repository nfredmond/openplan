import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { canAccessWorkspaceAction } from "@/lib/auth/role-matrix";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { resolveInvoicePdfBytes } from "@/lib/project-evidence-bundles/bytes";
import { createClient } from "@/lib/supabase/server";

const CLIENT_INVOICE_SELECT =
  "id, workspace_id, client_id, engagement_id, project_id, invoice_number, status, sent_date, paid_date, period_start, period_end, invoice_date, due_date, subtotal_amount, retention_percent, retention_amount, total_amount, payment_terms, currency_code, notes, created_by, created_at, updated_at";

const paramsSchema = z.object({
  invoiceId: z.string().uuid(),
});

type RouteContext = {
  params: Promise<{ invoiceId: string }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("invoicing.client_invoices.pdf", request);
  const startedAt = Date.now();

  try {
    const parsedParams = paramsSchema.safeParse(await context.params);
    if (!parsedParams.success) {
      audit.warn("params_validation_failed", { issues: parsedParams.error.issues });
      return NextResponse.json({ error: "Invalid invoice id" }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      audit.warn("unauthorized", { durationMs: Date.now() - startedAt });
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // The read is RLS-scoped, so another workspace's invoice already reads as
    // absent here; the membership lookup below then gates the role.
    const { data: invoiceData, error: invoiceError } = await supabase
      .from("client_invoices")
      .select(CLIENT_INVOICE_SELECT)
      .eq("id", parsedParams.data.invoiceId)
      .single();

    const invoice = invoiceData as { id: string; workspace_id: string } | null;

    if (invoiceError || !invoice) {
      audit.warn("invoice_not_found", {
        invoiceId: parsedParams.data.invoiceId,
        message: invoiceError?.message ?? null,
      });
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }

    const { data: membership, error: membershipError } = await supabase
      .from("workspace_members")
      .select("workspace_id, role")
      .eq("workspace_id", invoice.workspace_id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (membershipError || !membership) {
      audit.warn("workspace_membership_missing", {
        workspaceId: invoice.workspace_id,
        userId: user.id,
        message: membershipError?.message ?? null,
      });
      return NextResponse.json({ error: "Workspace access not found" }, { status: 403 });
    }

    if (!canAccessWorkspaceAction("invoices.read", membership.role)) {
      audit.warn("forbidden", { workspaceId: invoice.workspace_id, userId: user.id, role: membership.role });
      return NextResponse.json({ error: "Workspace role cannot read invoicing records" }, { status: 403 });
    }

    // Bundle freezing and individual downloads intentionally render through
    // the same tenant-scoped byte resolver.
    const rendered = await resolveInvoicePdfBytes(supabase, invoice.id);

    if (rendered.engine === "builtin") {
      audit.warn("client_invoice_pdf_builtin_typesetter_used", {
        invoiceId: invoice.id,
        pageCount: rendered.pageCount,
      });
    }

    audit.info("client_invoice_pdf_generated", {
      invoiceId: invoice.id,
      workspaceId: invoice.workspace_id,
      engine: rendered.engine,
      userId: user.id,
      durationMs: Date.now() - startedAt,
    });

    const pdfBuffer = rendered.bytes.buffer.slice(
      rendered.bytes.byteOffset,
      rendered.bytes.byteOffset + rendered.bytes.byteLength
    ) as ArrayBuffer;

    return new NextResponse(pdfBuffer, {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="${rendered.filename}"`,
        "x-openplan-pdf-engine": rendered.engine,
      },
    });
  } catch (error) {
    audit.error("client_invoice_pdf_unhandled_error", { durationMs: Date.now() - startedAt, error });
    return NextResponse.json({ error: "Unexpected error while generating the invoice PDF" }, { status: 500 });
  }
}
