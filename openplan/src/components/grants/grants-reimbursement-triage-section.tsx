import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { BillingTriageLinkCopy } from "@/components/billing/billing-triage-link-copy";
import { InvoiceFundingAwardLinker } from "@/components/billing/invoice-funding-award-linker";
import { InvoiceStatusAdvanceButton } from "@/components/billing/invoice-status-advance-button";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/state-block";
import {
  invoiceNeedsAwardRelink,
  resolveExactBillingInvoiceAwardMatch,
} from "@/lib/billing/invoice-records";
import { buildBillingInvoiceTriageHref } from "@/lib/billing/triage-links";
import type { BillingInvoiceRow, FundingAwardRow } from "@/lib/grants/page-helpers";
import {
  formatCurrency,
  formatDateTime,
  formatInvoiceQueueReason,
  isInvoiceOverdue,
  titleize,
  toneForInvoiceStatus,
} from "@/lib/grants/page-helpers";

type PriorityQueueEntry = {
  record: BillingInvoiceRow;
  reason: string;
  isExactRelink: boolean;
};

type FundingAwardOption = {
  id: string;
  title: string;
  projectId: string | null;
};

type FundingAwardProjectRow = {
  id: string;
  project_id: string | null;
  title: string;
};

export function GrantsReimbursementTriageSection({
  reimbursementPriorityQueue,
  awardLinkedInvoicesCount,
  overdueLinkedInvoiceCount,
  draftLinkedInvoiceCount,
  inFlightLinkedInvoiceCount,
  exactRelinkReadyCount,
  fundingAwardById,
  projectNameById,
  fundingInvoices,
  fundingAwardProjectRows,
  fundingAwardOptions,
  activeFocusedInvoiceId,
  activeRelinkedInvoiceId,
  workspaceId,
  canWriteInvoices,
  reimbursementCommandCallout,
}: {
  reimbursementPriorityQueue: PriorityQueueEntry[];
  awardLinkedInvoicesCount: number;
  overdueLinkedInvoiceCount: number;
  draftLinkedInvoiceCount: number;
  inFlightLinkedInvoiceCount: number;
  exactRelinkReadyCount: number;
  fundingAwardById: Map<string, FundingAwardRow>;
  projectNameById: Map<string, string>;
  fundingInvoices: BillingInvoiceRow[];
  fundingAwardProjectRows: FundingAwardProjectRow[];
  fundingAwardOptions: FundingAwardOption[];
  activeFocusedInvoiceId: string | null;
  activeRelinkedInvoiceId: string | null;
  workspaceId: string;
  canWriteInvoices: boolean;
  reimbursementCommandCallout: ReactNode | null;
}) {
  return (
    <article id="grants-reimbursement-triage" className="module-section-surface">
      <div className="module-section-header">
        <div className="module-section-heading">
          <p className="module-section-label">Reimbursement triage</p>
          <h2 className="module-section-title">Workspace reimbursement follow-through queue</h2>
          <p className="module-section-description">
            Keep award-linked invoices moving. This queue surfaces overdue reimbursement risk, in-flight payment posture, and draft packets that still need operator follow-through.
          </p>
        </div>
        <StatusBadge tone={reimbursementPriorityQueue.length > 0 ? "warning" : "success"}>
          {reimbursementPriorityQueue.length > 0 ? `${reimbursementPriorityQueue.length} active follow-ups` : "Queue clear"}
        </StatusBadge>
      </div>

      {reimbursementCommandCallout}

      <div className="module-summary-grid cols-5 mt-5">
        <div className="module-summary-card">
          <p className="module-summary-label">Award-linked records</p>
          <p className="module-summary-value">{awardLinkedInvoicesCount}</p>
          <p className="module-summary-detail">Invoice records already tied to committed awards.</p>
        </div>
        <div className="module-summary-card">
          <p className="module-summary-label">Overdue</p>
          <p className="module-summary-value">{overdueLinkedInvoiceCount}</p>
          <p className="module-summary-detail">Linked reimbursement records already past due.</p>
        </div>
        <div className="module-summary-card">
          <p className="module-summary-label">Drafting</p>
          <p className="module-summary-value">{draftLinkedInvoiceCount}</p>
          <p className="module-summary-detail">Started, but not yet in review or payment flow.</p>
        </div>
        <div className="module-summary-card">
          <p className="module-summary-label">In flight</p>
          <p className="module-summary-value">{inFlightLinkedInvoiceCount}</p>
          <p className="module-summary-detail">Internal review, submitted, or approved for payment.</p>
        </div>
        <div className="module-summary-card">
          <p className="module-summary-label">Exact relink ready</p>
          <p className="module-summary-value">{exactRelinkReadyCount}</p>
          <p className="module-summary-detail">Unlinked invoice records with a single exact funding-award match.</p>
        </div>
      </div>

      {reimbursementPriorityQueue.length === 0 ? (
        <div className="mt-5">
          <EmptyState
            title="No reimbursement triage items right now"
            description="Once award-linked invoice records exist and need follow-through, this queue will surface the most urgent reimbursement work across the workspace."
          />
        </div>
      ) : (
        <div className="mt-5 module-record-list">
          {reimbursementPriorityQueue.map((entry) => {
            const invoice = entry.record;
            const award = invoice.funding_award_id ? fundingAwardById.get(invoice.funding_award_id) ?? null : null;
            const projectName = invoice.project_id ? projectNameById.get(invoice.project_id) ?? null : null;
            const overdue = isInvoiceOverdue(invoice.status, invoice.due_date);
            const exactMatchFundingAward = resolveExactBillingInvoiceAwardMatch(invoice, fundingInvoices, fundingAwardProjectRows);
            const isFocusedRow = activeFocusedInvoiceId === invoice.id;
            const isJustRelinkedRow = activeRelinkedInvoiceId === invoice.id;
            const triageHref = buildBillingInvoiceTriageHref({
              workspaceId,
              invoiceId: invoice.id,
              linkage: invoice.funding_award_id ? "linked" : "unlinked",
              overdue: overdue ? "overdue" : "all",
              projectId: invoice.project_id,
              relinkedInvoiceId: isJustRelinkedRow ? invoice.id : null,
            });

            return (
              <div
                id={`invoice-record-${invoice.id}`}
                key={`reimbursement-queue-${invoice.id}`}
                className={`module-record-row scroll-mt-24 ${isFocusedRow ? "ring-2 ring-sky-400/80 ring-offset-2 ring-offset-background shadow-[0_0_0_1px_rgba(56,189,248,0.15)]" : ""}`}
              >
                <div className="module-record-main">
                  <div className="module-record-kicker">
                    <StatusBadge tone={toneForInvoiceStatus(invoice.status)}>{titleize(invoice.status)}</StatusBadge>
                    {overdue ? <StatusBadge tone="danger">Overdue</StatusBadge> : null}
                    {entry.isExactRelink ? <StatusBadge tone="success">Exact relink ready</StatusBadge> : null}
                    {award ? <StatusBadge tone="info">{award.title}</StatusBadge> : null}
                    {isFocusedRow ? <StatusBadge tone="info">Focused from triage</StatusBadge> : null}
                    {isJustRelinkedRow ? <StatusBadge tone="success">Relink just saved</StatusBadge> : null}
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <h3 className="module-record-title">{invoice.invoice_number ?? "Draft reimbursement record"}</h3>
                      <p className="module-record-stamp">{formatCurrency(invoice.net_amount ?? invoice.amount)}</p>
                    </div>
                    <p className="module-record-summary">{formatInvoiceQueueReason(entry.reason)}</p>
                  </div>

                  {isJustRelinkedRow && award ? (
                    <div className="mt-3 border-l-2 border-emerald-300/80 bg-emerald-50/80 px-4 py-3 text-sm text-emerald-950 dark:border-emerald-700/60 dark:bg-emerald-950/25 dark:text-emerald-100">
                      <p className="font-semibold tracking-tight">Relink saved in this grants queue</p>
                      <p className="mt-1">This reimbursement record now contributes to workspace award posture through {award.title}.</p>
                    </div>
                  ) : null}

                  <div className="module-record-meta">
                    <span className="module-record-chip">Project {projectName ?? "Not linked"}</span>
                    <span className="module-record-chip">Award {award?.title ?? exactMatchFundingAward?.title ?? "Not linked"}</span>
                    <span className="module-record-chip">Due {formatDateTime(invoice.due_date)}</span>
                    <span className="module-record-chip">Net {formatCurrency(invoice.net_amount ?? invoice.amount)}</span>
                  </div>

                  <div className="mt-4 flex flex-wrap items-start gap-3 text-sm font-semibold">
                    {invoice.project_id && invoiceNeedsAwardRelink(invoice.status, invoice.funding_award_id) ? (
                      <div className="min-w-[280px] flex-1">
                        <InvoiceFundingAwardLinker
                          invoiceId={invoice.id}
                          workspaceId={workspaceId}
                          projectId={invoice.project_id}
                          currentFundingAwardId={invoice.funding_award_id}
                          exactMatchFundingAwardId={exactMatchFundingAward?.id ?? null}
                          autoSelectExactMatch={isFocusedRow}
                          fundingAwards={fundingAwardOptions}
                          canWrite={canWriteInvoices}
                        />
                      </div>
                    ) : (
                      <InvoiceStatusAdvanceButton
                        invoiceId={invoice.id}
                        workspaceId={workspaceId}
                        currentStatus={invoice.status}
                        canWrite={canWriteInvoices}
                      />
                    )}
                    <Link href={triageHref} className="inline-flex items-center gap-2 text-[color:var(--pine)] transition hover:text-[color:var(--pine-deep)]">
                      Open billing triage
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                    <BillingTriageLinkCopy href={triageHref} />
                    {invoice.project_id ? (
                      <Link href={`/projects/${invoice.project_id}#project-funding-opportunities`} className="inline-flex items-center gap-2 text-muted-foreground transition hover:text-foreground">
                        Open funding lane
                        <ArrowRight className="h-4 w-4" />
                      </Link>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </article>
  );
}
