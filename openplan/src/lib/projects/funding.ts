import { summarizeBillingInvoiceRecords, type BillingInvoiceRecordLike } from "@/lib/billing/invoice-records";

export type ProjectFundingProfileLike = {
  funding_need_amount?: number | string | null;
  local_match_need_amount?: number | string | null;
  updated_at?: string | null;
};

export type FundingAwardLike = {
  awarded_amount?: number | string | null;
  match_amount?: number | string | null;
  risk_flag?: string | null;
  obligation_due_at?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
};

export type FundingOpportunityLike = {
  expected_award_amount?: number | string | null;
  decision_state?: string | null;
  opportunity_status?: string | null;
  closes_at?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
};

export type FundingInvoiceLike = BillingInvoiceRecordLike & {
  created_at?: string | null;
  invoice_date?: string | null;
};

export type ProjectFundingStackStatus = "funded" | "partially_funded" | "unfunded" | "unknown";
export type ProjectFundingPipelineStatus = "funded" | "likely_covered" | "partially_covered" | "unfunded" | "unknown";
export type ProjectFundingReimbursementStatus =
  | "unknown"
  | "not_started"
  | "drafting"
  | "in_review"
  | "partially_paid"
  | "paid";

export type ProjectFundingSnapshot = {
  capturedAt: string | null;
  projectUpdatedAt: string | null;
  latestSourceUpdatedAt: string | null;
  fundingNeedAmount: number;
  localMatchNeedAmount: number;
  committedFundingAmount: number;
  committedMatchAmount: number;
  likelyFundingAmount: number;
  totalPotentialFundingAmount: number;
  remainingFundingGap: number;
  remainingMatchGap: number;
  unfundedAfterLikelyAmount: number;
  requestedReimbursementAmount: number;
  paidReimbursementAmount: number;
  outstandingReimbursementAmount: number;
  draftReimbursementAmount: number;
  uninvoicedAwardAmount: number;
  nextObligationAt: string | null;
  awardRiskCount: number;
  awardCount: number;
  opportunityCount: number;
  openOpportunityCount: number;
  pursuedOpportunityCount: number;
  awardedOpportunityCount: number;
  closingSoonOpportunityCount: number;
  reimbursementPacketCount: number;
  status: ProjectFundingStackStatus;
  label: string;
  reason: string;
  pipelineStatus: ProjectFundingPipelineStatus;
  pipelineLabel: string;
  pipelineReason: string;
  reimbursementStatus: ProjectFundingReimbursementStatus;
  reimbursementLabel: string;
  reimbursementReason: string;
  hasTargetNeed: boolean;
  coverageRatio: number | null;
  pipelineCoverageRatio: number | null;
  reimbursementCoverageRatio: number | null;
  paidReimbursementCoverageRatio: number | null;
};

function toNumber(value: number | string | null | undefined): number {
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value ?? "0"));
  return Number.isFinite(parsed) ? parsed : 0;
}

function isClosingSoon(value: string | null | undefined): boolean {
  if (!value) return false;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return false;
  const diffMs = parsed.getTime() - Date.now();
  return diffMs >= 0 && diffMs <= 14 * 24 * 60 * 60 * 1000;
}

function maxTimestamp(values: Array<string | null | undefined>): string | null {
  const timestamps = values
    .map((value) => (value ? new Date(value).getTime() : Number.NaN))
    .filter((value) => Number.isFinite(value));

  if (timestamps.length === 0) {
    return null;
  }

  return new Date(Math.max(...timestamps)).toISOString();
}

export function buildProjectFundingStackSummary(
  profile: ProjectFundingProfileLike | null | undefined,
  awards: FundingAwardLike[],
  opportunities: FundingOpportunityLike[] = [],
  invoices: FundingInvoiceLike[] = []
) {
  const fundingNeedAmount = toNumber(profile?.funding_need_amount);
  const localMatchNeedAmount = toNumber(profile?.local_match_need_amount);
  const committedFundingAmount = awards.reduce((sum, award) => sum + toNumber(award.awarded_amount), 0);
  const committedMatchAmount = awards.reduce((sum, award) => sum + toNumber(award.match_amount), 0);
  const remainingFundingGap = Math.max(fundingNeedAmount - committedFundingAmount, 0);
  const remainingMatchGap = Math.max(localMatchNeedAmount - committedMatchAmount, 0);
  const pursuedOpportunities = opportunities.filter(
    (opportunity) =>
      opportunity.decision_state === "pursue" &&
      opportunity.opportunity_status !== "awarded" &&
      opportunity.opportunity_status !== "archived"
  );
  const likelyFundingAmount = pursuedOpportunities.reduce(
    (sum, opportunity) => sum + toNumber(opportunity.expected_award_amount),
    0
  );
  const totalPotentialFundingAmount = committedFundingAmount + likelyFundingAmount;
  const unfundedAfterLikelyAmount = Math.max(fundingNeedAmount - totalPotentialFundingAmount, 0);
  const awardRiskCount = awards.filter((award) => award.risk_flag === "watch" || award.risk_flag === "critical").length;
  const reimbursementSummary = summarizeBillingInvoiceRecords(invoices);
  const requestedReimbursementAmount = reimbursementSummary.totalNetAmount;
  const paidReimbursementAmount = reimbursementSummary.paidNetAmount;
  const outstandingReimbursementAmount = reimbursementSummary.outstandingNetAmount;
  const draftReimbursementAmount = reimbursementSummary.draftNetAmount;
  const uninvoicedAwardAmount = Math.max(committedFundingAmount - requestedReimbursementAmount, 0);
  const nextObligationAt = awards
    .map((award) => award.obligation_due_at)
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => new Date(left).getTime() - new Date(right).getTime())[0] ?? null;

  let status: ProjectFundingStackStatus = "unknown";
  let label = "Funding posture unknown";
  let reason = "Add a project funding need or award records to compute funding posture.";
  let pipelineStatus: ProjectFundingPipelineStatus = "unknown";
  let pipelineLabel = "Funding pipeline unknown";
  let pipelineReason = "Add a project funding need, pursued opportunity amount, or award records to compute pipeline posture.";
  let reimbursementStatus: ProjectFundingReimbursementStatus = "unknown";
  let reimbursementLabel = "Reimbursement posture unknown";
  let reimbursementReason = "Link award-backed invoice requests to compute reimbursement posture.";

  if (fundingNeedAmount > 0) {
    if (committedFundingAmount >= fundingNeedAmount) {
      status = "funded";
      label = "Funded";
      reason = "Committed awards meet or exceed the current project funding need.";
    } else if (committedFundingAmount > 0) {
      status = "partially_funded";
      label = "Partially funded";
      reason = "Committed awards cover part of the current project funding need, but a gap remains.";
    } else {
      status = "unfunded";
      label = "Unfunded";
      reason = "No committed award dollars are attached against the current project funding need.";
    }
  } else if (committedFundingAmount > 0) {
    status = "unknown";
    label = "Awards recorded";
    reason = "Awards are recorded, but no project funding need exists yet to classify posture.";
  }

  if (fundingNeedAmount > 0) {
    if (committedFundingAmount >= fundingNeedAmount) {
      pipelineStatus = "funded";
      pipelineLabel = "Funded";
      pipelineReason = "Committed awards meet or exceed the current project funding need.";
    } else if (totalPotentialFundingAmount >= fundingNeedAmount && likelyFundingAmount > 0) {
      pipelineStatus = "likely_covered";
      pipelineLabel = "Likely covered";
      pipelineReason = "Committed awards plus actively pursued opportunities now cover the current project funding need, pending award outcomes.";
    } else if (totalPotentialFundingAmount > 0) {
      pipelineStatus = "partially_covered";
      pipelineLabel = "Gap remains";
      pipelineReason = "Committed awards plus pursued opportunities cover part of the current funding need, but a gap still remains.";
    } else {
      pipelineStatus = "unfunded";
      pipelineLabel = "Unfunded";
      pipelineReason = "No committed awards or pursued opportunity dollars are attached against the current project funding need.";
    }
  } else if (totalPotentialFundingAmount > 0) {
    pipelineStatus = "unknown";
    pipelineLabel = "Funding pipeline logged";
    pipelineReason = "Funding dollars are recorded in awards or pursued opportunities, but no project funding need exists yet to classify posture.";
  }

  if (committedFundingAmount > 0) {
    if (paidReimbursementAmount >= committedFundingAmount) {
      reimbursementStatus = "paid";
      reimbursementLabel = "Awarded dollars reimbursed";
      reimbursementReason = "Linked award invoices marked paid now match or exceed the committed award total.";
    } else if (outstandingReimbursementAmount > 0) {
      reimbursementStatus = "in_review";
      reimbursementLabel = "Reimbursement in flight";
      reimbursementReason = "Linked award invoices are currently under review, submitted, or approved for payment.";
    } else if (paidReimbursementAmount > 0) {
      reimbursementStatus = "partially_paid";
      reimbursementLabel = "Partially reimbursed";
      reimbursementReason = "Some linked award invoices are already paid, but additional committed award dollars remain uninvoiced or unpaid.";
    } else if (draftReimbursementAmount > 0 || requestedReimbursementAmount > 0) {
      reimbursementStatus = "drafting";
      reimbursementLabel = "Invoice drafting started";
      reimbursementReason = "Linked award invoices exist, but none have reached submitted or paid status yet.";
    } else {
      reimbursementStatus = "not_started";
      reimbursementLabel = "No reimbursement requests yet";
      reimbursementReason = "Committed awards exist, but no linked invoice requests have been recorded against them yet.";
    }
  } else if (requestedReimbursementAmount > 0) {
    reimbursementStatus = "unknown";
    reimbursementLabel = "Linked invoices recorded";
    reimbursementReason = "Linked invoice requests exist, but no committed award total is available to classify reimbursement posture.";
  }

  return {
    fundingNeedAmount,
    localMatchNeedAmount,
    committedFundingAmount,
    committedMatchAmount,
    likelyFundingAmount,
    totalPotentialFundingAmount,
    remainingFundingGap,
    remainingMatchGap,
    unfundedAfterLikelyAmount,
    awardRiskCount,
    requestedReimbursementAmount,
    paidReimbursementAmount,
    outstandingReimbursementAmount,
    draftReimbursementAmount,
    uninvoicedAwardAmount,
    nextObligationAt,
    status,
    label,
    reason,
    pursuedOpportunityCount: pursuedOpportunities.length,
    pipelineStatus,
    pipelineLabel,
    pipelineReason,
    reimbursementStatus,
    reimbursementLabel,
    reimbursementReason,
    hasTargetNeed: fundingNeedAmount > 0,
    coverageRatio: fundingNeedAmount > 0 ? Math.min(committedFundingAmount / fundingNeedAmount, 1) : null,
    pipelineCoverageRatio: fundingNeedAmount > 0 ? Math.min(totalPotentialFundingAmount / fundingNeedAmount, 1) : null,
    reimbursementCoverageRatio:
      committedFundingAmount > 0 ? Math.min(requestedReimbursementAmount / committedFundingAmount, 1) : null,
    paidReimbursementCoverageRatio:
      committedFundingAmount > 0 ? Math.min(paidReimbursementAmount / committedFundingAmount, 1) : null,
  };
}

export function buildProjectFundingSnapshot(input: {
  profile: ProjectFundingProfileLike | null | undefined;
  awards: FundingAwardLike[];
  opportunities?: FundingOpportunityLike[];
  invoices?: FundingInvoiceLike[];
  capturedAt?: string | null;
  projectUpdatedAt?: string | null;
}): ProjectFundingSnapshot {
  const opportunities = input.opportunities ?? [];
  const invoices = input.invoices ?? [];
  const summary = buildProjectFundingStackSummary(
    input.profile,
    input.awards,
    opportunities,
    invoices
  );

  const openOpportunityCount = opportunities.filter(
    (opportunity) => opportunity.opportunity_status === "open"
  ).length;
  const pursuedOpportunityCount = opportunities.filter(
    (opportunity) => opportunity.decision_state === "pursue"
  ).length;
  const awardedOpportunityCount = opportunities.filter(
    (opportunity) => opportunity.opportunity_status === "awarded"
  ).length;
  const closingSoonOpportunityCount = opportunities.filter((opportunity) =>
    isClosingSoon(opportunity.closes_at)
  ).length;
  const reimbursementPacketCount = invoices.length;

  return {
    capturedAt: input.capturedAt ?? null,
    projectUpdatedAt: input.projectUpdatedAt ?? null,
    latestSourceUpdatedAt: maxTimestamp([
      input.projectUpdatedAt ?? null,
      input.profile?.updated_at ?? null,
      ...input.awards.map((award) => award.updated_at ?? award.created_at ?? null),
      ...opportunities.map((opportunity) => opportunity.updated_at ?? opportunity.created_at ?? null),
      ...invoices.map((invoice) => invoice.invoice_date ?? invoice.created_at ?? invoice.due_date ?? null),
    ]),
    fundingNeedAmount: summary.fundingNeedAmount,
    localMatchNeedAmount: summary.localMatchNeedAmount,
    committedFundingAmount: summary.committedFundingAmount,
    committedMatchAmount: summary.committedMatchAmount,
    likelyFundingAmount: summary.likelyFundingAmount,
    totalPotentialFundingAmount: summary.totalPotentialFundingAmount,
    remainingFundingGap: summary.remainingFundingGap,
    remainingMatchGap: summary.remainingMatchGap,
    unfundedAfterLikelyAmount: summary.unfundedAfterLikelyAmount,
    requestedReimbursementAmount: summary.requestedReimbursementAmount,
    paidReimbursementAmount: summary.paidReimbursementAmount,
    outstandingReimbursementAmount: summary.outstandingReimbursementAmount,
    draftReimbursementAmount: summary.draftReimbursementAmount,
    uninvoicedAwardAmount: summary.uninvoicedAwardAmount,
    nextObligationAt: summary.nextObligationAt,
    awardRiskCount: summary.awardRiskCount,
    awardCount: input.awards.length,
    opportunityCount: opportunities.length,
    openOpportunityCount,
    pursuedOpportunityCount,
    awardedOpportunityCount,
    closingSoonOpportunityCount,
    reimbursementPacketCount,
    status: summary.status,
    label: summary.label,
    reason: summary.reason,
    pipelineStatus: summary.pipelineStatus,
    pipelineLabel: summary.pipelineLabel,
    pipelineReason: summary.pipelineReason,
    reimbursementStatus: summary.reimbursementStatus,
    reimbursementLabel: summary.reimbursementLabel,
    reimbursementReason: summary.reimbursementReason,
    hasTargetNeed: summary.hasTargetNeed,
    coverageRatio: summary.coverageRatio,
    pipelineCoverageRatio: summary.pipelineCoverageRatio,
    reimbursementCoverageRatio: summary.reimbursementCoverageRatio,
    paidReimbursementCoverageRatio: summary.paidReimbursementCoverageRatio,
  };
}

export function projectFundingStackTone(
  status: ProjectFundingStackStatus | ProjectFundingPipelineStatus
): "info" | "success" | "warning" | "danger" | "neutral" {
  if (status === "funded") return "success";
  if (status === "likely_covered") return "info";
  if (status === "partially_covered") return "warning";
  if (status === "partially_funded") return "warning";
  if (status === "unfunded") return "danger";
  return "neutral";
}

export function projectFundingReimbursementTone(
  status: ProjectFundingReimbursementStatus
): "info" | "success" | "warning" | "danger" | "neutral" {
  if (status === "paid") return "success";
  if (status === "in_review") return "info";
  if (status === "partially_paid") return "warning";
  if (status === "not_started") return "warning";
  if (status === "drafting") return "neutral";
  return "neutral";
}
