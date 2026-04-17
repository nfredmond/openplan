import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { BillingTriageLinkCopy } from "@/components/billing/billing-triage-link-copy";
import { InvoiceRecordComposer } from "@/components/billing/invoice-record-composer";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/state-block";
import {
  projectFundingReimbursementTone,
  type ProjectFundingReimbursementStatus,
} from "@/lib/projects/funding";
import { buildBillingInvoiceTriageHref } from "@/lib/billing/triage-links";
import type { BillingInvoiceRow, FundingAwardRow } from "@/lib/grants/page-helpers";
import {
  formatCurrency,
  formatDateTime,
  getReimbursementActionLabel,
  isDecisionSoon,
  isInvoiceOverdue,
  resolveProjectExactBillingTriageTarget,
} from "@/lib/grants/page-helpers";

type ProjectFundingStack = {
  project: { id: string; name: string };
  awards: FundingAwardRow[];
  summary: {
    reimbursementStatus: ProjectFundingReimbursementStatus;
    reimbursementLabel: string;
    reimbursementReason: string;
    awardRiskCount: number;
    nextObligationAt: string | null;
    committedFundingAmount: number;
    committedMatchAmount: number;
    requestedReimbursementAmount: number;
    paidReimbursementAmount: number;
    outstandingReimbursementAmount: number;
    uninvoicedAwardAmount: number;
  };
  linkedInvoices: BillingInvoiceRow[];
  nextObligationAward: { id: string; title: string } | null;
  latestAwardUpdatedAt: string | null;
};

export type ReimbursementComposerStack = {
  project: { id: string; name: string };
  awards: { id: string; title: string }[];
  summary: { uninvoicedAwardAmount: number };
  nextObligationAward: { id: string } | null;
};

export function GrantsAwardsReimbursementSection({
  fundingAwardsCount,
  fundingProjectStacks,
  committedAwardAmount,
  trackedMatchAmount,
  uninvoicedCommittedAmount,
  awardWatchCount,
  linkedInvoiceSummary,
  reimbursementNotStartedCount,
  reimbursementActiveCount,
  reimbursementPaidCount,
  reimbursementComposerStack,
  activeFocusedProjectId,
  workspaceId,
  canWriteInvoices,
}: {
  fundingAwardsCount: number;
  fundingProjectStacks: ProjectFundingStack[];
  committedAwardAmount: number;
  trackedMatchAmount: number;
  uninvoicedCommittedAmount: number;
  awardWatchCount: number;
  linkedInvoiceSummary: { totalNetAmount: number; paidNetAmount: number; outstandingNetAmount: number };
  reimbursementNotStartedCount: number;
  reimbursementActiveCount: number;
  reimbursementPaidCount: number;
  reimbursementComposerStack: ReimbursementComposerStack | null;
  activeFocusedProjectId: string | null;
  workspaceId: string;
  canWriteInvoices: boolean;
}) {
  return (
    <article id="grants-awards-reimbursement" className="module-section-surface">
      <div className="module-section-header">
        <div className="module-section-heading">
          <p className="module-section-label">Committed awards</p>
          <h2 className="module-section-title">Workspace award stack and reimbursement posture</h2>
          <p className="module-section-description">
            Reuse the same funding-stack truth from project detail, but surface it here as one workspace lane so operators can see where award dollars are still uninvoiced, in flight, or fully reimbursed.
          </p>
        </div>
        <StatusBadge tone={fundingProjectStacks.length > 0 ? "info" : "neutral"}>
          {fundingProjectStacks.length > 0 ? `${fundingProjectStacks.length} project stacks` : "No award stacks yet"}
        </StatusBadge>
      </div>

      <div className="module-summary-grid cols-6 mt-5">
        <div className="module-summary-card">
          <p className="module-summary-label">Award records</p>
          <p className="module-summary-value">{fundingAwardsCount}</p>
          <p className="module-summary-detail">Committed awards recorded in the current workspace.</p>
        </div>
        <div className="module-summary-card">
          <p className="module-summary-label">Committed dollars</p>
          <p className="module-summary-value text-base leading-tight">{formatCurrency(committedAwardAmount)}</p>
          <p className="module-summary-detail">Awarded funding already committed to projects.</p>
        </div>
        <div className="module-summary-card">
          <p className="module-summary-label">Match tracked</p>
          <p className="module-summary-value text-base leading-tight">{formatCurrency(trackedMatchAmount)}</p>
          <p className="module-summary-detail">Local or partner match attached to committed awards.</p>
        </div>
        <div className="module-summary-card">
          <p className="module-summary-label">Requested</p>
          <p className="module-summary-value text-base leading-tight">{formatCurrency(linkedInvoiceSummary.totalNetAmount)}</p>
          <p className="module-summary-detail">Award-linked invoice dollars already in reimbursement flow.</p>
        </div>
        <div className="module-summary-card">
          <p className="module-summary-label">Uninvoiced</p>
          <p className="module-summary-value text-base leading-tight">{formatCurrency(uninvoicedCommittedAmount)}</p>
          <p className="module-summary-detail">Committed award dollars not yet reflected in invoice records.</p>
        </div>
        <div className="module-summary-card">
          <p className="module-summary-label">Award risk</p>
          <p className="module-summary-value">{awardWatchCount}</p>
          <p className="module-summary-detail">Award records currently flagged watch or critical.</p>
        </div>
      </div>

      <div className="module-inline-list">
        <span className="module-inline-item"><strong>{reimbursementNotStartedCount}</strong> not started</span>
        <span className="module-inline-item"><strong>{reimbursementActiveCount}</strong> active reimbursement</span>
        <span className="module-inline-item"><strong>{reimbursementPaidCount}</strong> fully reimbursed</span>
        <span className="module-inline-item"><strong>{formatCurrency(linkedInvoiceSummary.paidNetAmount)}</strong> paid</span>
        <span className="module-inline-item"><strong>{formatCurrency(linkedInvoiceSummary.outstandingNetAmount)}</strong> outstanding</span>
      </div>

      {fundingProjectStacks.length === 0 ? (
        <div className="mt-5">
          <EmptyState
            title="No committed award stacks yet"
            description="Once award records exist, this workspace lane will show which project stacks still need reimbursement starts, invoice follow-through, or obligation attention."
          />
        </div>
      ) : (
        <>
          {reimbursementComposerStack ? (
            <div
              id="grants-reimbursement-composer"
              className={`mt-5 scroll-mt-24 rounded-3xl ${
                activeFocusedProjectId === reimbursementComposerStack.project.id
                  ? "ring-2 ring-sky-400/80 ring-offset-2 ring-offset-background shadow-[0_0_0_1px_rgba(56,189,248,0.15)]"
                  : ""
              }`}
            >
              {activeFocusedProjectId === reimbursementComposerStack.project.id ? (
                <div className="mb-3 rounded-2xl border border-sky-300/70 bg-sky-50/80 px-4 py-3 text-sm text-sky-950 dark:border-sky-700/60 dark:bg-sky-950/25 dark:text-sky-100">
                  <p className="font-semibold tracking-tight">Focused from workspace queue</p>
                  <p className="mt-1">This reimbursement composer is pre-targeted to {reimbursementComposerStack.project.name} so the grants command board can start the exact packet it flagged next.</p>
                </div>
              ) : null}
              <InvoiceRecordComposer
                workspaceId={workspaceId}
                projects={[reimbursementComposerStack.project]}
                fundingAwards={reimbursementComposerStack.awards.map((award) => ({
                  id: award.id,
                  title: award.title,
                  projectId: reimbursementComposerStack.project.id,
                }))}
                canWrite={canWriteInvoices}
                defaultProjectId={reimbursementComposerStack.project.id}
                defaultFundingAwardId={reimbursementComposerStack.nextObligationAward?.id ?? reimbursementComposerStack.awards[0]?.id ?? null}
                defaultInvoiceNumber={`${reimbursementComposerStack.project.name.replace(/\s+/g, " ").trim().slice(0, 32)} reimbursement`}
                defaultAmount={
                  reimbursementComposerStack.summary.uninvoicedAwardAmount > 0
                    ? String(reimbursementComposerStack.summary.uninvoicedAwardAmount)
                    : undefined
                }
                titleLabel="Start the lead reimbursement record now"
                description="Seed the first award-linked invoice directly from /grants so reimbursement work starts in the shared workspace lane before deeper billing follow-through moves into project detail."
              />
            </div>
          ) : null}

          <div className="mt-5 module-record-list">
            {fundingProjectStacks.map((item) => {
              const exactBillingTriageInvoice = resolveProjectExactBillingTriageTarget(item.linkedInvoices);
              const exactBillingTriageHref = exactBillingTriageInvoice
                ? buildBillingInvoiceTriageHref({
                    workspaceId,
                    invoiceId: exactBillingTriageInvoice.id,
                    linkage: "linked",
                    overdue: isInvoiceOverdue(exactBillingTriageInvoice.status, exactBillingTriageInvoice.due_date) ? "overdue" : "all",
                    projectId: item.project.id,
                  })
                : null;

              return (
                <div
                  key={`award-stack-${item.project.id}`}
                  id={`award-stack-${item.project.id}`}
                  className={`module-record-row scroll-mt-24 ${
                    activeFocusedProjectId === item.project.id
                      ? "ring-2 ring-sky-400/80 ring-offset-2 ring-offset-background shadow-[0_0_0_1px_rgba(56,189,248,0.15)]"
                      : ""
                  }`}
                >
                  <div className="module-record-main">
                    <div className="module-record-kicker">
                      <StatusBadge tone={projectFundingReimbursementTone(item.summary.reimbursementStatus)}>
                        {item.summary.reimbursementLabel}
                      </StatusBadge>
                      {activeFocusedProjectId === item.project.id ? <StatusBadge tone="info">Focused from workspace queue</StatusBadge> : null}
                      <StatusBadge tone="info">{item.awards.length} award{item.awards.length === 1 ? "" : "s"}</StatusBadge>
                      {item.summary.awardRiskCount > 0 ? (
                        <StatusBadge tone="warning">{item.summary.awardRiskCount} at risk</StatusBadge>
                      ) : null}
                      {item.summary.nextObligationAt && isDecisionSoon(item.summary.nextObligationAt) ? (
                        <StatusBadge tone="warning">Obligation soon</StatusBadge>
                      ) : null}
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <h3 className="module-record-title">{item.project.name}</h3>
                        <p className="module-record-stamp">Updated {formatDateTime(item.latestAwardUpdatedAt)}</p>
                      </div>
                      <p className="module-record-summary">{item.summary.reimbursementReason}</p>
                    </div>

                    <div className="module-record-meta">
                      <span className="module-record-chip">Committed {formatCurrency(item.summary.committedFundingAmount)}</span>
                      <span className="module-record-chip">Match {formatCurrency(item.summary.committedMatchAmount)}</span>
                      <span className="module-record-chip">Requested {formatCurrency(item.summary.requestedReimbursementAmount)}</span>
                      <span className="module-record-chip">Paid {formatCurrency(item.summary.paidReimbursementAmount)}</span>
                      <span className="module-record-chip">Outstanding {formatCurrency(item.summary.outstandingReimbursementAmount)}</span>
                      <span className="module-record-chip">Uninvoiced {formatCurrency(item.summary.uninvoicedAwardAmount)}</span>
                      <span className="module-record-chip">Next obligation {item.nextObligationAward ? `${item.nextObligationAward.title} · ${formatDateTime(item.summary.nextObligationAt)}` : "Not set"}</span>
                    </div>

                    <div className="mt-4 flex flex-wrap gap-3 text-sm font-semibold">
                      <Link
                        href={exactBillingTriageHref ?? `/projects/${item.project.id}#project-invoices`}
                        className="inline-flex items-center gap-2 text-[color:var(--pine)] transition hover:text-[color:var(--pine-deep)]"
                      >
                        {exactBillingTriageHref
                          ? `${getReimbursementActionLabel(item.summary.reimbursementStatus)} in billing triage`
                          : getReimbursementActionLabel(item.summary.reimbursementStatus)}
                        <ArrowRight className="h-4 w-4" />
                      </Link>
                      {exactBillingTriageHref ? <BillingTriageLinkCopy href={exactBillingTriageHref} /> : null}
                      <Link href={`/projects/${item.project.id}#project-funding-opportunities`} className="inline-flex items-center gap-2 text-muted-foreground transition hover:text-foreground">
                        Open project funding lane
                        <ArrowRight className="h-4 w-4" />
                      </Link>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </article>
  );
}
