import { summarizeReceivables, type ClientInvoiceRecordLike } from "@/lib/invoicing/receivables";
import { createClient } from "@/lib/supabase/server";
import { formatCurrency, looksLikePendingSchema, panelClass } from "./invoicing-page-helpers";

/**
 * The receivable direction of the invoicing module: this workspace invoicing
 * ITS OWN CLIENTS (client_invoices and the tables around them). This is the
 * lane skeleton — the register, composers, and time ledger render here.
 */
export async function ReceivablesLane({
  workspaceId,
}: {
  workspaceId: string;
  canWriteInvoices: boolean;
}) {
  const supabase = await createClient();

  const invoicesRead = (await supabase
    .from("client_invoices")
    .select("id, status, engagement_id, subtotal_amount, retention_percent, retention_amount, total_amount, due_date")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(500)) as { data: unknown[] | null; error: { message?: string } | null };

  const receivablesPending = Boolean(invoicesRead.error) && looksLikePendingSchema(invoicesRead.error?.message);
  const receivablesUnavailable = Boolean(invoicesRead.error);
  const clientInvoices = receivablesUnavailable ? [] : ((invoicesRead.data ?? []) as ClientInvoiceRecordLike[]);
  const receivableSummary = summarizeReceivables(clientInvoices);

  return (
    <section className="space-y-4">
      <article className={panelClass()}>
        <div className="space-y-1 border-b border-border/60 pb-4">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Client invoices</p>
          <h2 className="text-lg font-semibold tracking-tight text-foreground">Receivable register</h2>
        </div>

        {receivablesUnavailable ? (
          <p className="mt-4 text-sm text-muted-foreground">
            {receivablesPending
              ? "The client invoicing tables are pending in this database. Apply the latest migrations before expecting client invoices to render here."
              : "Client invoice records could not be loaded right now."}
          </p>
        ) : clientInvoices.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">
            No client invoices recorded yet for this workspace.
          </p>
        ) : (
          <div className="mt-4 grid gap-px border border-border/60 bg-border/80 sm:grid-cols-2 xl:grid-cols-4">
            <div className="bg-background/70 px-4 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Invoices</p>
              <p className="mt-2 text-2xl font-semibold tracking-tight text-foreground">{receivableSummary.totalCount}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {receivableSummary.draftCount} draft, {receivableSummary.sentCount} sent, {receivableSummary.paidCount} paid, {receivableSummary.voidCount} void.
              </p>
            </div>
            <div className="bg-background/70 px-4 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Outstanding</p>
              <p className="mt-2 text-2xl font-semibold tracking-tight text-foreground">{formatCurrency(receivableSummary.outstandingAmount)}</p>
              <p className="mt-1 text-sm text-muted-foreground">Sent invoices not yet paid or voided.</p>
            </div>
            <div className="bg-background/70 px-4 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Overdue</p>
              <p className="mt-2 text-2xl font-semibold tracking-tight text-foreground">{formatCurrency(receivableSummary.overdueAmount)}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {receivableSummary.overdueCount} invoice{receivableSummary.overdueCount === 1 ? "" : "s"} past due date.
              </p>
            </div>
            <div className="bg-background/70 px-4 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Paid</p>
              <p className="mt-2 text-2xl font-semibold tracking-tight text-foreground">{formatCurrency(receivableSummary.paidAmount)}</p>
              <p className="mt-1 text-sm text-muted-foreground">Settled receivable value.</p>
            </div>
          </div>
        )}
      </article>
    </section>
  );
}
