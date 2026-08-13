import { FileSpreadsheet } from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";
import type { BillingInvoiceSummary } from "@/lib/invoicing/invoice-records";
import { postureLabel } from "@/lib/invoicing/reimbursement-profile-binding";
import { reimbursementProfileRegistry } from "@/lib/invoicing/reimbursement-profiles";
import { fmtCurrency, fmtDateTime, titleize, toneForInvoiceStatus } from "./_helpers";
import type { BillingInvoice } from "./_types";

/**
 * Label the reimbursement posture with the row's OWN profile vocabulary —
 * never another profile's. A row whose profile this deployment does not
 * register gets its raw posture id humanized rather than another profile's
 * label. An un-backfilled row (no profile id of its own — the legacy-select
 * path, or a row written by a pre-profile deployment) falls back to its raw
 * legacy caltrans_posture value, humanized; no resolved profile's vocabulary
 * is ever applied to a row that did not record that profile.
 */
function invoicePostureLabel(invoice: BillingInvoice): string {
  if (!invoice.reimbursement_profile_id) {
    return titleize(invoice.caltrans_posture);
  }
  return postureLabel(
    reimbursementProfileRegistry.get(invoice.reimbursement_profile_id)?.postureOptions ?? null,
    invoice.reimbursement_posture ?? invoice.caltrans_posture
  );
}

/**
 * The project's invoice register, lifted out of the delivery board so it sits
 * with the rest of this project's funding rather than beside its milestones.
 *
 * The markup is the delivery board's verbatim — same anchor ids
 * (`project-invoices`, `project-invoice-<id>`), same badges, same failed-read
 * sentence, which is the one line that must not drift: an invoice read that
 * failed says so instead of rendering as a project that has invoiced nothing.
 */
export function ProjectInvoiceRegister({
  invoiceSummary,
  projectInvoicesPending,
  projectInvoices,
  invoicesReadFailed = false,
  prioritizedProjectInvoices,
}: {
  invoiceSummary: BillingInvoiceSummary;
  projectInvoicesPending: boolean;
  projectInvoices: BillingInvoice[];
  invoicesReadFailed?: boolean;
  prioritizedProjectInvoices: BillingInvoice[];
}) {
  return (
    <article id="project-invoices" className="module-section-surface scroll-mt-24">
      <div className="module-section-header">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-[0.5rem] bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
            <FileSpreadsheet className="h-5 w-5" />
          </span>
          <div className="module-section-heading">
            <p className="module-section-label">Invoices</p>
            <h2 className="module-section-title">Project-linked billing register</h2>
          </div>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <StatusBadge tone={invoiceSummary.overdueCount > 0 ? "danger" : "info"}>{invoiceSummary.overdueCount} overdue</StatusBadge>
        <StatusBadge tone="neutral">{invoiceSummary.submittedCount} in review/payment</StatusBadge>
        <StatusBadge tone="info">Outstanding {fmtCurrency(invoiceSummary.outstandingNetAmount)}</StatusBadge>
      </div>
      {projectInvoicesPending ? (
        <div className="module-alert mt-5 text-sm">Invoice records will appear after the Lane C migration is applied to the database.</div>
      ) : projectInvoices.length === 0 ? (
        <div className="module-empty-state mt-5 text-sm">
          {invoicesReadFailed
            ? "Invoice records could not be read, so none are listed. This is a failed lookup, not a project that has invoiced nothing."
            : "No invoice records linked to this project yet."}
        </div>
      ) : (
        <div className="mt-5 module-record-list">
          {prioritizedProjectInvoices.map((invoice) => (
            <div key={invoice.id} id={`project-invoice-${invoice.id}`} className="module-record-row scroll-mt-24">
              <div className="module-record-main">
                <div className="module-record-kicker">
                  <StatusBadge tone={toneForInvoiceStatus(invoice.status)}>{titleize(invoice.status)}</StatusBadge>
                  <StatusBadge tone="info">{titleize(invoice.billing_basis)}</StatusBadge>
                  <StatusBadge tone="neutral">{titleize(invoice.supporting_docs_status)}</StatusBadge>
                  {invoice.fundingAward ? <StatusBadge tone="neutral">Award {invoice.fundingAward.title}</StatusBadge> : null}
                </div>
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <h3 className="module-record-title">{invoice.invoice_number}</h3>
                    <p className="module-record-stamp">{fmtCurrency(invoice.net_amount)}</p>
                  </div>
                  <p className="module-record-summary">
                    {invoice.notes || `${invoicePostureLabel(invoice)}${invoice.submitted_to ? ` · ${invoice.submitted_to}` : ""}`}
                  </p>
                </div>
                <p className="mt-1.5 text-[0.73rem] text-muted-foreground">
                  {invoice.invoice_date ? `Invoice ${fmtDateTime(invoice.invoice_date)}` : ""}
                  {invoice.due_date ? ` · Due ${fmtDateTime(invoice.due_date)}` : ""}
                  {invoice.fundingAward ? ` · ${invoice.fundingAward.title}` : ""}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </article>
  );
}
