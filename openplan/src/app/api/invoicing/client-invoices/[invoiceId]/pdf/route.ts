import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { canAccessWorkspaceAction } from "@/lib/auth/role-matrix";
import {
  buildClientInvoiceHtml,
  type ClientInvoicePdfClient,
  type ClientInvoicePdfEngagement,
  type ClientInvoicePdfInvoice,
  type ClientInvoicePdfLineItem,
} from "@/lib/invoicing/invoice-pdf";
import { buildEngagementBilledSummary, type EngagementBilledSummary } from "@/lib/invoicing/receivables";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { renderReportPdf } from "@/lib/reports/pdf";
import { createClient } from "@/lib/supabase/server";

const CLIENT_INVOICE_SELECT =
  "id, workspace_id, client_id, engagement_id, project_id, invoice_number, status, sent_date, paid_date, period_start, period_end, invoice_date, due_date, subtotal_amount, retention_percent, retention_amount, total_amount, payment_terms, currency_code, notes, created_by, created_at, updated_at";

const paramsSchema = z.object({
  invoiceId: z.string().uuid(),
});

type RouteContext = {
  params: Promise<{ invoiceId: string }>;
};

/** The invoice number as a safe download filename: `invoice-inv-001.pdf`. */
function invoicePdfFilename(invoiceNumber: string): string {
  const slug = invoiceNumber
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return `invoice-${slug || "document"}.pdf`;
}

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

    const invoice = invoiceData as
      | (ClientInvoicePdfInvoice & {
          id: string;
          workspace_id: string;
          client_id: string;
          engagement_id: string | null;
        })
      | null;

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

    const [workspaceResult, clientResult, lineItemsResult] = await Promise.all([
      supabase.from("workspaces").select("id, name").eq("id", invoice.workspace_id).single(),
      supabase
        .from("invoicing_clients")
        .select("name, billing_address, contact_name, contact_email")
        .eq("id", invoice.client_id)
        .single(),
      supabase
        .from("client_invoice_line_items")
        .select("description, quantity, unit_label, unit_amount, amount, position")
        .eq("invoice_id", invoice.id)
        .order("position", { ascending: true }),
    ]);

    // Issuer, bill-to and the line set are the document's substance — a PDF
    // silently missing any of them would be a wrong document, not a degraded
    // one, so any of these read failures refuses.
    if (workspaceResult.error || clientResult.error || lineItemsResult.error) {
      audit.error("invoice_document_assembly_failed", {
        invoiceId: invoice.id,
        workspaceError: workspaceResult.error?.message ?? null,
        clientError: clientResult.error?.message ?? null,
        lineItemsError: lineItemsResult.error?.message ?? null,
      });
      return NextResponse.json({ error: "Failed to assemble the invoice document" }, { status: 500 });
    }

    let engagement: ClientInvoicePdfEngagement = null;
    let engagementBilled: EngagementBilledSummary | null = null;

    if (invoice.engagement_id) {
      const { data: engagementData, error: engagementError } = await supabase
        .from("invoicing_engagements")
        .select("id, title, reference_code, not_to_exceed_amount")
        .eq("id", invoice.engagement_id)
        .single();

      if (engagementError || !engagementData) {
        audit.error("invoice_engagement_read_failed", {
          invoiceId: invoice.id,
          engagementId: invoice.engagement_id,
          message: engagementError?.message ?? null,
        });
        return NextResponse.json({ error: "Failed to assemble the invoice document" }, { status: 500 });
      }

      const engagementRow = engagementData as {
        id: string;
        title: string;
        reference_code: string | null;
        not_to_exceed_amount: number | string | null;
      };
      engagement = engagementRow;

      if (engagementRow.not_to_exceed_amount !== null) {
        // The billed position is context, not substance: a failed read drops
        // the context line and is audited, rather than blocking the document.
        const { data: engagementInvoices, error: engagementInvoicesError } = await supabase
          .from("client_invoices")
          .select("id, status, engagement_id, subtotal_amount, retention_percent, retention_amount, total_amount")
          .eq("engagement_id", engagementRow.id);

        if (engagementInvoicesError) {
          audit.warn("nte_position_read_failed", {
            invoiceId: invoice.id,
            engagementId: engagementRow.id,
            message: engagementInvoicesError.message,
          });
        } else {
          engagementBilled = buildEngagementBilledSummary(
            engagementRow,
            (engagementInvoices ?? []) as Parameters<typeof buildEngagementBilledSummary>[1]
          );
        }
      }
    }

    const workspaceRow = workspaceResult.data as { id: string; name: string | null };

    const html = buildClientInvoiceHtml({
      workspace: { name: workspaceRow.name },
      client: clientResult.data as ClientInvoicePdfClient,
      invoice,
      lineItems: (lineItemsResult.data ?? []) as ClientInvoicePdfLineItem[],
      engagement,
      engagementBilled,
    });

    // Generated on demand, never stored: the invoice row and its lines stay
    // the single source of truth, and every download reflects them as-is.
    const rendered = await renderReportPdf(html, {
      title: `Invoice ${invoice.invoice_number}`,
      generatedAt: invoice.invoice_date ?? null,
      footerLabel: "OpenPlan client invoice",
    });

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
        "content-disposition": `attachment; filename="${invoicePdfFilename(invoice.invoice_number)}"`,
        "x-openplan-pdf-engine": rendered.engine,
      },
    });
  } catch (error) {
    audit.error("client_invoice_pdf_unhandled_error", { durationMs: Date.now() - startedAt, error });
    return NextResponse.json({ error: "Unexpected error while generating the invoice PDF" }, { status: 500 });
  }
}
