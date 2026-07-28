import {
  summarizeBillingInvoiceRecords,
  type BillingInvoiceRecordLike,
} from "@/lib/invoicing/invoice-records";
import { summarizeReceivables, type ClientInvoiceRecordLike } from "@/lib/invoicing/receivables";
import { createClient } from "@/lib/supabase/server";
import { formatCurrency, insetClass, looksLikePendingSchema } from "./invoicing-page-helpers";

/**
 * The cross-direction cash position, rendered above BOTH invoicing lanes:
 * what this workspace's clients owe it (client_invoices, the receivable
 * direction) beside what it has claimed from its funders
 * (billing_invoice_records, the reimbursement direction).
 *
 * Each side is honest about absence: a database whose tables are still
 * pending, or a workspace with no records yet, says so plainly instead of
 * presenting $0.00 as a computed position.
 */

/**
 * Mirrors the register reads each lane makes: the reimbursement lane
 * summarizes its 20 most recent register records, so the strip does too —
 * the two numbers must never disagree. The receivable side uses the same
 * 500-row cap as the invoicing list routes.
 */
const REIMBURSEMENT_STRIP_LIMIT = 20;
const RECEIVABLE_STRIP_LIMIT = 500;

type StripQueryResult = { data: unknown[] | null; error: { message?: string } | null };

export async function InvoicingCashStrip({ workspaceId }: { workspaceId: string }) {
  const supabase = await createClient();

  const [receivableRead, reimbursementRead] = (await Promise.all([
    supabase
      .from("client_invoices")
      .select("id, status, engagement_id, subtotal_amount, retention_percent, retention_amount, total_amount, due_date")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(RECEIVABLE_STRIP_LIMIT),
    supabase
      .from("billing_invoice_records")
      .select("id, status, amount, retention_percent, retention_amount, due_date")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(REIMBURSEMENT_STRIP_LIMIT),
  ])) as [StripQueryResult, StripQueryResult];

  const receivablesPending = Boolean(receivableRead.error) && looksLikePendingSchema(receivableRead.error?.message);
  const receivablesUnavailable = Boolean(receivableRead.error);
  const clientInvoices = receivablesUnavailable ? [] : ((receivableRead.data ?? []) as ClientInvoiceRecordLike[]);
  const receivableSummary = summarizeReceivables(clientInvoices);

  const reimbursementPending = Boolean(reimbursementRead.error) && looksLikePendingSchema(reimbursementRead.error?.message);
  const reimbursementUnavailable = Boolean(reimbursementRead.error);
  const reimbursementRecords = reimbursementUnavailable
    ? []
    : ((reimbursementRead.data ?? []) as BillingInvoiceRecordLike[]);
  const reimbursementSummary = summarizeBillingInvoiceRecords(reimbursementRecords);

  return (
    <div className={`${insetClass()} grid gap-px bg-border/80 sm:grid-cols-2`}>
      <div className="bg-background/70 px-4 py-4">
        <p className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          Owed to you by clients
        </p>
        {receivablesUnavailable ? (
          <p className="mt-2 text-sm text-muted-foreground">
            {receivablesPending
              ? "Not set up yet — the client invoicing tables are pending in this database. Apply the latest migrations to start billing clients."
              : "Client invoice records could not be loaded right now."}
          </p>
        ) : clientInvoices.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            Not set up yet — no client invoices recorded in this workspace. The receivables lane is where they start.
          </p>
        ) : (
          <>
            <p className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
              {formatCurrency(receivableSummary.outstandingAmount)}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {receivableSummary.sentCount} sent invoice{receivableSummary.sentCount === 1 ? "" : "s"} outstanding
              {receivableSummary.overdueCount > 0
                ? ` · ${receivableSummary.overdueCount} overdue totaling ${formatCurrency(receivableSummary.overdueAmount)}`
                : " · none overdue"}
              .
            </p>
          </>
        )}
      </div>

      <div className="bg-background/70 px-4 py-4">
        <p className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          Claimed from funders
        </p>
        {reimbursementUnavailable ? (
          <p className="mt-2 text-sm text-muted-foreground">
            {reimbursementPending
              ? "Not set up yet — the reimbursement register tables are pending in this database. Apply the Lane C migration to track funder draws."
              : "Reimbursement invoice records could not be loaded right now."}
          </p>
        ) : reimbursementRecords.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            Not set up yet — no reimbursement invoice records in this workspace. The reimbursement lane is where funder draws are logged.
          </p>
        ) : (
          <>
            <p className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
              {formatCurrency(reimbursementSummary.outstandingNetAmount)}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {reimbursementSummary.submittedCount} record{reimbursementSummary.submittedCount === 1 ? "" : "s"} in review or payment flow
              {reimbursementSummary.overdueCount > 0
                ? ` · ${reimbursementSummary.overdueCount} overdue totaling ${formatCurrency(reimbursementSummary.overdueNetAmount)}`
                : " · none overdue"}
              .
            </p>
          </>
        )}
      </div>
    </div>
  );
}
