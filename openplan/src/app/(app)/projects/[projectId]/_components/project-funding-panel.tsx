import Link from "next/link";
import { CalendarClock } from "lucide-react";
import { FundingOpportunityDecisionControls } from "@/components/programs/funding-opportunity-decision-controls";
import { ProjectFundingAwardCreator } from "@/components/projects/project-funding-award-creator";
import { ProjectFundingProfileEditor } from "@/components/projects/project-funding-profile-editor";
import { StatusBadge } from "@/components/ui/status-badge";
import type { BillingInvoiceSummary } from "@/lib/billing/invoice-records";
import {
  formatFundingAwardMatchPostureLabel,
  formatFundingAwardRiskFlagLabel,
  formatFundingAwardSpendingStatusLabel,
  formatFundingOpportunityDecisionLabel,
  formatFundingOpportunityStatusLabel,
  fundingAwardMatchPostureTone,
  fundingAwardRiskFlagTone,
  fundingAwardSpendingStatusTone,
  fundingOpportunityDecisionTone,
  fundingOpportunityStatusTone,
} from "@/lib/programs/catalog";
import {
  buildProjectFundingStackSummary,
  projectFundingReimbursementTone,
  projectFundingStackTone,
} from "@/lib/projects/funding";
import {
  fmtCurrency,
  fmtDateTime,
  titleize,
  toneForInvoiceStatus,
} from "./_helpers";
import type {
  BillingInvoice,
  FundingAward,
  FundingOpportunity,
  ProjectFundingProfileRow,
} from "./_types";

type FundingStackSummary = ReturnType<typeof buildProjectFundingStackSummary>;

type ComparisonBackedFundingReport = {
  id: string;
  title: string;
  comparisonDigest: { headline: string; detail: string } | null;
} | null;

type ProjectFundingPanelProps = {
  projectId: string;
  projectFundingProfile: ProjectFundingProfileRow | null;
  projectFundingProfilePending: boolean;
  fundingAwardsPending: boolean;
  fundingOpportunitiesPending: boolean;
  fundingAwards: FundingAward[];
  fundingOpportunities: FundingOpportunity[];
  fundingStackSummary: FundingStackSummary;
  fundingNeedAmount: number;
  committedFundingAmount: number;
  committedMatchAmount: number;
  likelyFundingAmount: number;
  remainingFundingGap: number;
  awardWatchCount: number;
  nextObligationAward: FundingAward | null;
  pursueFundingCount: number;
  monitorFundingCount: number;
  skipFundingCount: number;
  pursuedFundingAmount: number;
  openFundingCount: number;
  invoiceSummaryByFundingAwardId: Map<string, BillingInvoiceSummary>;
  invoiceRecordsByFundingAwardId: Map<string, BillingInvoice[]>;
  unlinkedProjectInvoices: BillingInvoice[];
  unlinkedProjectInvoiceSummary: BillingInvoiceSummary;
  comparisonBackedFundingReport: ComparisonBackedFundingReport;
};

export function ProjectFundingPanel({
  projectId,
  projectFundingProfile,
  projectFundingProfilePending,
  fundingAwardsPending,
  fundingOpportunitiesPending,
  fundingAwards,
  fundingOpportunities,
  fundingStackSummary,
  fundingNeedAmount,
  committedFundingAmount,
  committedMatchAmount,
  likelyFundingAmount,
  remainingFundingGap,
  awardWatchCount,
  nextObligationAward,
  pursueFundingCount,
  monitorFundingCount,
  skipFundingCount,
  pursuedFundingAmount,
  openFundingCount,
  invoiceSummaryByFundingAwardId,
  invoiceRecordsByFundingAwardId,
  unlinkedProjectInvoices,
  unlinkedProjectInvoiceSummary,
  comparisonBackedFundingReport,
}: ProjectFundingPanelProps) {
  return (
    <article id="project-funding-opportunities" className="module-section-surface">
      <div className="module-section-header">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-[0.5rem] bg-amber-500/10 text-amber-700 dark:text-amber-300">
            <CalendarClock className="h-5 w-5" />
          </span>
          <div className="module-section-heading">
            <p className="module-section-label">Funding strategy</p>
            <h2 className="module-section-title">Candidate funding opportunities</h2>
            <p className="module-section-description">
              This project can now carry real pursue, monitor, or skip decisions against funding opportunities, with fit and readiness notes kept on the record.
            </p>
          </div>
        </div>
      </div>

      {projectFundingProfilePending || fundingAwardsPending ? (
        <div className="module-alert mt-5 text-sm">Funding stack and award records will appear after the funding award migrations are applied to the database.</div>
      ) : (
        <>
          <div className="module-summary-grid cols-6 mt-5">
            <div className="module-summary-card">
              <p className="module-summary-label">Funding need</p>
              <p className="module-summary-value text-base leading-tight">{fmtCurrency(fundingNeedAmount)}</p>
              <p className="module-summary-detail">Current project-level target need for funding stack planning.</p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Committed awards</p>
              <p className="module-summary-value text-base leading-tight">{fmtCurrency(committedFundingAmount)}</p>
              <p className="module-summary-detail">Awarded dollars already attached to this project.</p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Likely pursued</p>
              <p className="module-summary-value text-base leading-tight">{fmtCurrency(likelyFundingAmount)}</p>
              <p className="module-summary-detail">Expected dollars tied to opportunities currently marked pursue.</p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Still unfunded</p>
              <p className="module-summary-value text-base leading-tight">{fmtCurrency(remainingFundingGap)}</p>
              <p className="module-summary-detail">Gap still remaining after committed awards and likely pursued dollars.</p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Match tracked</p>
              <p className="module-summary-value text-base leading-tight">{fmtCurrency(committedMatchAmount)}</p>
              <p className="module-summary-detail">Local or partner match currently attached to awards.</p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Award risk</p>
              <p className="module-summary-value">{awardWatchCount}</p>
              <p className="module-summary-detail">Award record(s) flagged watch or critical.</p>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-3 mt-5">
            <div className="rounded-[0.75rem] border border-border/70 bg-background/80 p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Funding stack posture</p>
              <div className="mt-2">
                <StatusBadge tone={projectFundingStackTone(fundingStackSummary.pipelineStatus)}>{fundingStackSummary.pipelineLabel}</StatusBadge>
              </div>
              <h3 className="mt-2 text-sm font-semibold text-foreground">
                {fundingStackSummary.hasTargetNeed
                  ? `${Math.round((fundingStackSummary.pipelineCoverageRatio ?? 0) * 100)}% covered by committed + likely funding`
                  : "Funding target not set yet"}
              </h3>
              <p className="mt-2 text-sm text-muted-foreground">
                {fundingStackSummary.hasTargetNeed
                  ? `${fmtCurrency(committedFundingAmount)} committed, ${fmtCurrency(likelyFundingAmount)} likely, leaving ${fmtCurrency(remainingFundingGap)} still unfunded against a ${fmtCurrency(fundingNeedAmount)} target need.`
                  : fundingStackSummary.pipelineReason}
              </p>
              {comparisonBackedFundingReport?.comparisonDigest ? (
                <div className="module-note mt-3 text-sm">
                  Saved comparison context from {comparisonBackedFundingReport.title} can support grant planning language or prioritization framing for this funding stack. It is planning evidence to review against each funding source, not proof of award likelihood.
                </div>
              ) : null}
            </div>
            <div className="rounded-[0.75rem] border border-border/70 bg-background/80 p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Reimbursement posture</p>
              <div className="mt-2">
                <StatusBadge tone={projectFundingReimbursementTone(fundingStackSummary.reimbursementStatus)}>
                  {fundingStackSummary.reimbursementLabel}
                </StatusBadge>
              </div>
              <h3 className="mt-2 text-sm font-semibold text-foreground">
                {committedFundingAmount > 0
                  ? `${Math.round((fundingStackSummary.reimbursementCoverageRatio ?? 0) * 100)}% of committed awards invoiced`
                  : "No committed awards yet"}
              </h3>
              <p className="mt-2 text-sm text-muted-foreground">
                {committedFundingAmount > 0
                  ? `${fmtCurrency(fundingStackSummary.requestedReimbursementAmount)} requested on linked award invoices, ${fmtCurrency(fundingStackSummary.paidReimbursementAmount)} paid, ${fmtCurrency(fundingStackSummary.outstandingReimbursementAmount)} outstanding, and ${fmtCurrency(fundingStackSummary.uninvoicedAwardAmount)} still not yet invoiced.`
                  : fundingStackSummary.reimbursementReason}
              </p>
              {unlinkedProjectInvoices.length > 0 ? (
                <div className="module-note mt-3 text-sm">
                  {unlinkedProjectInvoices.length} project invoice record{unlinkedProjectInvoices.length === 1 ? " is" : "s are"} still unlinked to a funding award, totaling {fmtCurrency(unlinkedProjectInvoiceSummary.totalNetAmount)}. Those records are excluded from award reimbursement posture until linked in the billing register below.
                </div>
              ) : null}
            </div>
            <div className="rounded-[0.75rem] border border-border/70 bg-background/80 p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Next obligation</p>
              <h3 className="mt-2 text-sm font-semibold text-foreground">{nextObligationAward?.title ?? "No obligation date recorded"}</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                {nextObligationAward
                  ? `Obligation due ${fmtDateTime(nextObligationAward.obligation_due_at)}.`
                  : "Record obligation timing on awards so reimbursement and delivery risk can surface earlier."}
              </p>
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr] mt-5">
            <ProjectFundingProfileEditor
              projectId={projectId}
              initialFundingNeedAmount={projectFundingProfile?.funding_need_amount ?? null}
              initialLocalMatchNeedAmount={projectFundingProfile?.local_match_need_amount ?? null}
              initialNotes={projectFundingProfile?.notes ?? null}
            />

            <ProjectFundingAwardCreator
              projectId={projectId}
              opportunityOptions={fundingOpportunities.map((opportunity) => ({ id: opportunity.id, title: opportunity.title }))}
            />
          </div>

          {projectFundingProfile?.notes ? (
            <div className="module-note mt-5 text-sm">Funding notes: {projectFundingProfile.notes}</div>
          ) : null}

          {unlinkedProjectInvoices.length > 0 ? (
            <div className="module-alert mt-5 text-sm">
              {unlinkedProjectInvoices.length} project invoice record{unlinkedProjectInvoices.length === 1 ? " is" : "s are"} not yet linked to a funding award. Reimbursement posture for the award stack only counts linked invoice chains, so review the billing register below to resolve the mismatch.
            </div>
          ) : null}

          {fundingAwards.length === 0 ? (
            <div className="module-empty-state mt-5 text-sm">No funding awards are recorded for this project yet.</div>
          ) : (
            <div className="mt-5 module-record-list">
              {fundingAwards.map((award) => {
                const awardInvoiceSummary = invoiceSummaryByFundingAwardId.get(award.id);
                const awardInvoices = invoiceRecordsByFundingAwardId.get(award.id) ?? [];

                return (
                  <div key={award.id} className="module-record-row">
                    <div className="module-record-main">
                      <div className="module-record-kicker">
                        <StatusBadge tone={fundingAwardMatchPostureTone(award.match_posture)}>
                          {formatFundingAwardMatchPostureLabel(award.match_posture)}
                        </StatusBadge>
                        <StatusBadge tone={fundingAwardSpendingStatusTone(award.spending_status)}>
                          {formatFundingAwardSpendingStatusLabel(award.spending_status)}
                        </StatusBadge>
                        <StatusBadge tone={fundingAwardRiskFlagTone(award.risk_flag)}>
                          {formatFundingAwardRiskFlagLabel(award.risk_flag)}
                        </StatusBadge>
                        {award.program ? <StatusBadge tone="info">{award.program.title}</StatusBadge> : null}
                      </div>

                      <div className="space-y-1.5">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <h3 className="module-record-title">{award.title}</h3>
                          <p className="module-record-stamp">Updated {fmtDateTime(award.updated_at)}</p>
                        </div>
                        <p className="module-record-summary">{award.notes || "No award notes recorded yet."}</p>
                      </div>

                      <p className="mt-1.5 text-[0.73rem] text-muted-foreground">
                        Awarded {fmtCurrency(award.awarded_amount)} · Match {fmtCurrency(award.match_amount)} · Reimbursed {fmtCurrency(awardInvoiceSummary?.paidNetAmount ?? 0)} · Outstanding {fmtCurrency(awardInvoiceSummary?.outstandingNetAmount ?? 0)} · Obligation {fmtDateTime(award.obligation_due_at)}{award.opportunity?.title ? ` · ${award.opportunity.title}` : ""}
                      </p>

                      <div className="mt-4 rounded-[0.5rem] border border-border/60 bg-background/70 px-4 py-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <p className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                              Linked invoice chain
                            </p>
                            <p className="mt-1 text-sm text-muted-foreground">
                              {awardInvoices.length > 0
                                ? `${awardInvoices.length} linked invoice record${awardInvoices.length === 1 ? "" : "s"} totaling ${fmtCurrency(awardInvoiceSummary?.totalNetAmount ?? 0)} net requested.`
                                : "No invoice records are linked to this award yet."}
                            </p>
                          </div>
                          <Link href="#project-invoices" className="module-inline-action w-fit">
                            Review billing register
                          </Link>
                        </div>

                        {awardInvoices.length > 0 ? (
                          <div className="mt-3 space-y-2">
                            {awardInvoices.map((invoice) => (
                              <div key={invoice.id} className="rounded-[0.5rem] border border-border/60 bg-muted/20 px-3 py-3">
                                <div className="flex flex-wrap items-center gap-2">
                                  <StatusBadge tone={toneForInvoiceStatus(invoice.status)}>{titleize(invoice.status)}</StatusBadge>
                                  <StatusBadge tone="info">{titleize(invoice.billing_basis)}</StatusBadge>
                                  <StatusBadge tone="neutral">{fmtCurrency(invoice.net_amount)}</StatusBadge>
                                </div>
                                <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
                                  <div>
                                    <p className="text-sm font-semibold text-foreground">{invoice.invoice_number}</p>
                                    <p className="mt-1 text-xs text-muted-foreground">
                                      {invoice.invoice_date ? `Invoice ${fmtDateTime(invoice.invoice_date)}` : "Invoice date not set"}
                                      {invoice.due_date ? ` · Due ${fmtDateTime(invoice.due_date)}` : ""}
                                      {invoice.submitted_to ? ` · ${invoice.submitted_to}` : ""}
                                    </p>
                                  </div>
                                  <p className="text-xs text-muted-foreground">
                                    Gross {fmtCurrency(invoice.amount)}
                                    {Number(invoice.retention_amount ?? 0) > 0 ? ` · Retention ${fmtCurrency(invoice.retention_amount)}` : ""}
                                  </p>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {fundingOpportunitiesPending ? (
        <div className="module-alert mt-5 text-sm">Funding opportunities will appear after the funding catalog migrations are applied to the database.</div>
      ) : (
        <>
          <div className="module-summary-grid cols-6 mt-5">
            <div className="module-summary-card">
              <p className="module-summary-label">Tracked</p>
              <p className="module-summary-value">{fundingOpportunities.length}</p>
              <p className="module-summary-detail">Open and upcoming opportunities linked to this project.</p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Pursue</p>
              <p className="module-summary-value">{pursueFundingCount}</p>
              <p className="module-summary-detail">Opportunities the team intends to actively package.</p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Monitor</p>
              <p className="module-summary-value">{monitorFundingCount}</p>
              <p className="module-summary-detail">Watchlist opportunities not yet fully committed.</p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Likely dollars</p>
              <p className="module-summary-value text-base leading-tight">{fmtCurrency(pursuedFundingAmount)}</p>
              <p className="module-summary-detail">Expected dollars attached to pursue decisions.</p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Skip</p>
              <p className="module-summary-value">{skipFundingCount}</p>
              <p className="module-summary-detail">Intentionally declined opportunities with rationale recorded.</p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Open now</p>
              <p className="module-summary-value">{openFundingCount}</p>
              <p className="module-summary-detail">Current calls that can move into active pursuit.</p>
            </div>
          </div>

          {fundingOpportunities.length === 0 ? (
            <div className="module-empty-state mt-5 text-sm">No funding opportunities are linked to this project yet.</div>
          ) : (
            <div className="mt-5 module-record-list">
              {fundingOpportunities.map((opportunity) => (
                <div key={opportunity.id} className="module-record-row">
                  <div className="module-record-main">
                    <div className="module-record-kicker">
                      <StatusBadge tone={fundingOpportunityStatusTone(opportunity.opportunity_status)}>
                        {formatFundingOpportunityStatusLabel(opportunity.opportunity_status)}
                      </StatusBadge>
                      <StatusBadge tone={fundingOpportunityDecisionTone(opportunity.decision_state)}>
                        {formatFundingOpportunityDecisionLabel(opportunity.decision_state)}
                      </StatusBadge>
                      {opportunity.program ? <StatusBadge tone="info">{opportunity.program.title}</StatusBadge> : null}
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <h3 className="module-record-title">{opportunity.title}</h3>
                        <p className="module-record-stamp">Updated {fmtDateTime(opportunity.updated_at)}</p>
                      </div>
                      <p className="module-record-summary">
                        {opportunity.summary || "No summary recorded yet for this funding opportunity."}
                      </p>
                    </div>

                    <p className="mt-1.5 text-[0.73rem] text-muted-foreground">
                      {fmtCurrency(opportunity.expected_award_amount)} likely · Closes {fmtDateTime(opportunity.closes_at)}{opportunity.agency_name ? ` · ${opportunity.agency_name}` : ""}
                    </p>

                    <div className="mt-4 grid gap-3 md:grid-cols-3">
                      <div className="rounded-[0.5rem] border border-border/60 bg-background/70 px-4 py-3 text-sm text-muted-foreground">
                        <p className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-foreground">Fit notes</p>
                        <p className="mt-2">{opportunity.fit_notes || "No fit notes recorded yet."}</p>
                      </div>
                      <div className="rounded-[0.5rem] border border-border/60 bg-background/70 px-4 py-3 text-sm text-muted-foreground">
                        <p className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-foreground">Readiness notes</p>
                        <p className="mt-2">{opportunity.readiness_notes || "No readiness notes recorded yet."}</p>
                      </div>
                      <div className="rounded-[0.5rem] border border-border/60 bg-background/70 px-4 py-3 text-sm text-muted-foreground">
                        <p className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-foreground">Decision rationale</p>
                        <p className="mt-2">{opportunity.decision_rationale || "No decision rationale recorded yet."}</p>
                      </div>
                    </div>

                    <div className="mt-4">
                      <FundingOpportunityDecisionControls
                        opportunityId={opportunity.id}
                        initialDecisionState={opportunity.decision_state as "monitor" | "pursue" | "skip"}
                        initialExpectedAwardAmount={opportunity.expected_award_amount}
                        initialFitNotes={opportunity.fit_notes}
                        initialReadinessNotes={opportunity.readiness_notes}
                        initialDecisionRationale={opportunity.decision_rationale}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </article>
  );
}
