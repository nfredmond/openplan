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

export type ProjectFundingProfileScanStatus = "ready" | "attention" | "blocked" | "not_started" | "unknown";

export type ProjectFundingProfileScanLane = {
  id: "funding_target" | "local_match" | "obligation" | "reimbursement" | "closeout" | "evidence_support";
  label: string;
  status: ProjectFundingProfileScanStatus;
  statusLabel: string;
  detail: string;
  nextAction: string;
  amount: number | null;
};

export type ProjectFundingProfileScan = {
  generatedAt: string;
  status: ProjectFundingProfileScanStatus;
  label: string;
  nextAction: string;
  lanes: ProjectFundingProfileScanLane[];
};

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

export type PortfolioFundingSnapshot = {
  capturedAt: string | null;
  latestSourceUpdatedAt: string | null;
  linkedProjectCount: number;
  trackedProjectCount: number;
  fundedProjectCount: number;
  likelyCoveredProjectCount: number;
  gapProjectCount: number;
  committedFundingAmount: number;
  likelyFundingAmount: number;
  totalPotentialFundingAmount: number;
  unfundedAfterLikelyAmount: number;
  paidReimbursementAmount: number;
  outstandingReimbursementAmount: number;
  uninvoicedAwardAmount: number;
  awardRiskCount: number;
  label: string;
  reason: string;
  reimbursementLabel: string;
  reimbursementReason: string;
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
    awardCount: awards.length,
    opportunityCount: opportunities.length,
    reimbursementPacketCount: invoices.length,
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

export type ProjectFundingStackSummary = ReturnType<typeof buildProjectFundingStackSummary>;

function scanStatusPriority(status: ProjectFundingProfileScanStatus): number {
  if (status === "blocked") return 0;
  if (status === "attention") return 1;
  if (status === "not_started") return 2;
  if (status === "unknown") return 3;
  return 4;
}

function daysUntil(value: string | null | undefined, now: Date): number | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return Math.ceil((parsed.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
}

function formatScanCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

export function projectFundingProfileScanTone(
  status: ProjectFundingProfileScanStatus
): "info" | "success" | "warning" | "danger" | "neutral" {
  if (status === "ready") return "success";
  if (status === "blocked") return "danger";
  if (status === "attention") return "warning";
  if (status === "not_started") return "neutral";
  return "neutral";
}

export function buildProjectFundingProfileScan(input: {
  summary: ProjectFundingStackSummary;
  hasComparisonEvidence?: boolean;
  unlinkedInvoiceCount?: number;
  unlinkedInvoiceAmount?: number;
  now?: Date | string;
}): ProjectFundingProfileScan {
  const summary = input.summary;
  const now = input.now instanceof Date ? input.now : new Date(input.now ?? Date.now());
  const obligationDaysUntil = daysUntil(summary.nextObligationAt, now);
  const lanes: ProjectFundingProfileScanLane[] = [];

  if (!summary.hasTargetNeed) {
    lanes.push({
      id: "funding_target",
      label: "Funding target",
      status: "not_started",
      statusLabel: "Target not set",
      detail: "No project-level funding need has been recorded yet.",
      nextAction: "Set the funding need and local match target before using this project in grant or RTP funding tables.",
      amount: null,
    });
  } else if (summary.unfundedAfterLikelyAmount > 0) {
    lanes.push({
      id: "funding_target",
      label: "Funding target",
      status: summary.committedFundingAmount > 0 || summary.likelyFundingAmount > 0 ? "attention" : "blocked",
      statusLabel: summary.pipelineLabel,
      detail: `${formatScanCurrency(summary.committedFundingAmount)} committed and ${formatScanCurrency(summary.likelyFundingAmount)} likely against a ${formatScanCurrency(summary.fundingNeedAmount)} target.`,
      nextAction: `Resolve the remaining ${formatScanCurrency(summary.unfundedAfterLikelyAmount)} funding gap or keep it explicit in RTP/grant packet language.`,
      amount: summary.unfundedAfterLikelyAmount,
    });
  } else {
    lanes.push({
      id: "funding_target",
      label: "Funding target",
      status: "ready",
      statusLabel: summary.pipelineLabel,
      detail: `${formatScanCurrency(summary.committedFundingAmount)} committed plus ${formatScanCurrency(summary.likelyFundingAmount)} likely covers the current target need.`,
      nextAction: "Keep the funding basis current when award, scope, or estimate records change.",
      amount: summary.totalPotentialFundingAmount,
    });
  }

  if (summary.localMatchNeedAmount <= 0) {
    lanes.push({
      id: "local_match",
      label: "Local match",
      status: "unknown",
      statusLabel: "Match target not set",
      detail: "No local match need is recorded on the funding profile.",
      nextAction: "Record a match target when the funding source requires local or partner match.",
      amount: null,
    });
  } else if (summary.committedMatchAmount >= summary.localMatchNeedAmount) {
    lanes.push({
      id: "local_match",
      label: "Local match",
      status: "ready",
      statusLabel: "Match covered",
      detail: `${formatScanCurrency(summary.committedMatchAmount)} committed against a ${formatScanCurrency(summary.localMatchNeedAmount)} match need.`,
      nextAction: "Preserve match source notes for reimbursement and board packet review.",
      amount: summary.committedMatchAmount,
    });
  } else {
    lanes.push({
      id: "local_match",
      label: "Local match",
      status: summary.committedMatchAmount > 0 ? "attention" : "blocked",
      statusLabel: summary.committedMatchAmount > 0 ? "Match gap" : "No match committed",
      detail: `${formatScanCurrency(summary.remainingMatchGap)} still missing against the current match need.`,
      nextAction: "Identify eligible match sources or mark the gap plainly before using the profile in a funding package.",
      amount: summary.remainingMatchGap,
    });
  }

  if (summary.awardCount === 0) {
    lanes.push({
      id: "obligation",
      label: "Obligation timing",
      status: "unknown",
      statusLabel: "No awards yet",
      detail: "No award records are attached, so obligation pressure cannot be computed.",
      nextAction: "Create award records when funding is committed, then add obligation dates for operations review.",
      amount: null,
    });
  } else if (!summary.nextObligationAt || obligationDaysUntil === null) {
    lanes.push({
      id: "obligation",
      label: "Obligation timing",
      status: "attention",
      statusLabel: "Date missing",
      detail: `${summary.awardCount} award record${summary.awardCount === 1 ? "" : "s"} exist, but no obligation date is available.`,
      nextAction: "Add the next obligation deadline before calling the award stack operations-ready.",
      amount: null,
    });
  } else if (obligationDaysUntil < 0) {
    lanes.push({
      id: "obligation",
      label: "Obligation timing",
      status: "blocked",
      statusLabel: "Overdue",
      detail: `Next obligation date is ${Math.abs(obligationDaysUntil)} day${Math.abs(obligationDaysUntil) === 1 ? "" : "s"} overdue.`,
      nextAction: "Review the award file and update obligation posture before relying on this profile for closeout or RTP readiness.",
      amount: null,
    });
  } else if (obligationDaysUntil <= 30) {
    lanes.push({
      id: "obligation",
      label: "Obligation timing",
      status: "attention",
      statusLabel: "Due soon",
      detail: `Next obligation date is due in ${obligationDaysUntil} day${obligationDaysUntil === 1 ? "" : "s"}.`,
      nextAction: "Confirm obligation evidence and owner before the date becomes a blocker.",
      amount: null,
    });
  } else {
    lanes.push({
      id: "obligation",
      label: "Obligation timing",
      status: "ready",
      statusLabel: "Scheduled",
      detail: `Next obligation date is ${obligationDaysUntil} day${obligationDaysUntil === 1 ? "" : "s"} out.`,
      nextAction: "Keep the date current as award agreements or delivery schedules change.",
      amount: null,
    });
  }

  lanes.push({
    id: "reimbursement",
    label: "Reimbursement chain",
    status:
      summary.reimbursementStatus === "paid"
        ? "ready"
        : summary.reimbursementStatus === "not_started"
          ? "blocked"
          : summary.reimbursementStatus === "unknown"
            ? "unknown"
            : "attention",
    statusLabel: summary.reimbursementLabel,
    detail:
      input.unlinkedInvoiceCount && input.unlinkedInvoiceCount > 0
        ? `${formatScanCurrency(summary.requestedReimbursementAmount)} requested on linked award invoices; ${input.unlinkedInvoiceCount} project invoice record${input.unlinkedInvoiceCount === 1 ? " is" : "s are"} unlinked and excluded from award posture.`
        : `${formatScanCurrency(summary.requestedReimbursementAmount)} requested, ${formatScanCurrency(summary.paidReimbursementAmount)} paid, and ${formatScanCurrency(summary.outstandingReimbursementAmount)} outstanding.`,
    nextAction:
      input.unlinkedInvoiceCount && input.unlinkedInvoiceCount > 0
        ? "Link project invoice records to funding awards before using reimbursement posture in closeout language."
        : summary.reimbursementReason,
    amount:
      input.unlinkedInvoiceAmount && input.unlinkedInvoiceAmount > 0
        ? input.unlinkedInvoiceAmount
        : summary.outstandingReimbursementAmount + summary.uninvoicedAwardAmount,
  });

  if (summary.awardRiskCount > 0) {
    lanes.push({
      id: "closeout",
      label: "Closeout posture",
      status: "attention",
      statusLabel: "Award risk flagged",
      detail: `${summary.awardRiskCount} award record${summary.awardRiskCount === 1 ? " has" : "s have"} watch or critical risk flags.`,
      nextAction: "Resolve or document award risk flags before treating this funding profile as closeout-ready.",
      amount: null,
    });
  } else if (summary.awardCount > 0 && summary.paidReimbursementAmount >= summary.committedFundingAmount && summary.uninvoicedAwardAmount === 0) {
    lanes.push({
      id: "closeout",
      label: "Closeout posture",
      status: "ready",
      statusLabel: "Closeout-ready posture",
      detail: "Committed award dollars are fully paid in linked reimbursement records, with no award risk flags.",
      nextAction: "Attach final evidence and operator review notes before any formal closeout claim.",
      amount: summary.paidReimbursementAmount,
    });
  } else if (summary.awardCount > 0) {
    lanes.push({
      id: "closeout",
      label: "Closeout posture",
      status: "attention",
      statusLabel: "Closeout not ready",
      detail: `${formatScanCurrency(summary.uninvoicedAwardAmount)} remains uninvoiced and ${formatScanCurrency(summary.outstandingReimbursementAmount)} remains outstanding.`,
      nextAction: "Finish invoice/reimbursement follow-through before using this record as closeout support.",
      amount: summary.uninvoicedAwardAmount + summary.outstandingReimbursementAmount,
    });
  } else {
    lanes.push({
      id: "closeout",
      label: "Closeout posture",
      status: "unknown",
      statusLabel: "No award closeout chain",
      detail: "Closeout posture starts after an award and linked reimbursement chain exist.",
      nextAction: "Create award and invoice records before evaluating closeout readiness.",
      amount: null,
    });
  }

  lanes.push({
    id: "evidence_support",
    label: "Planning evidence support",
    status: input.hasComparisonEvidence ? "ready" : "attention",
    statusLabel: input.hasComparisonEvidence ? "Evidence linked" : "Evidence not linked",
    detail: input.hasComparisonEvidence
      ? "A comparison-backed report is available as planning evidence for grant narrative review. It is not an award prediction."
      : "No comparison-backed report is linked to this project funding profile yet.",
    nextAction: input.hasComparisonEvidence
      ? "Review source context and funding-source criteria before reusing the evidence in a grant package."
      : "Attach a current report, analysis, or engagement source before using the profile in grant narrative language.",
    amount: null,
  });

  const firstActionLane = [...lanes].sort(
    (left, right) => scanStatusPriority(left.status) - scanStatusPriority(right.status)
  )[0];
  const hasBlocked = lanes.some((lane) => lane.status === "blocked");
  const hasAttention = lanes.some((lane) => lane.status === "attention");
  const hasNotStarted = lanes.some((lane) => lane.status === "not_started");
  const allReadyOrUnknown = lanes.every((lane) => lane.status === "ready" || lane.status === "unknown");

  return {
    generatedAt: now.toISOString(),
    status: hasBlocked ? "blocked" : hasAttention ? "attention" : hasNotStarted ? "not_started" : allReadyOrUnknown ? "ready" : "unknown",
    label: hasBlocked
      ? "Funding profile has blockers"
      : hasAttention
        ? "Funding profile needs operator review"
        : hasNotStarted
          ? "Funding profile needs setup"
          : "Funding profile scan is ready",
    nextAction: firstActionLane?.nextAction ?? "Review the funding profile before using it in grant or RTP materials.",
    lanes,
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

export function buildPortfolioFundingSnapshot(input: {
  projects: Array<{
    projectUpdatedAt?: string | null;
    profile: ProjectFundingProfileLike | null | undefined;
    awards: FundingAwardLike[];
    opportunities?: FundingOpportunityLike[];
    invoices?: FundingInvoiceLike[];
  }>;
  capturedAt?: string | null;
}): PortfolioFundingSnapshot {
  const projectSnapshots = input.projects.map((project) =>
    buildProjectFundingSnapshot({
      profile: project.profile,
      awards: project.awards,
      opportunities: project.opportunities ?? [],
      invoices: project.invoices ?? [],
      capturedAt: input.capturedAt ?? null,
      projectUpdatedAt: project.projectUpdatedAt ?? null,
    })
  );

  const linkedProjectCount = projectSnapshots.length;
  const trackedProjectCount = projectSnapshots.filter(
    (snapshot) =>
      snapshot.hasTargetNeed ||
      snapshot.awardCount > 0 ||
      snapshot.opportunityCount > 0 ||
      snapshot.reimbursementPacketCount > 0
  ).length;
  const fundedProjectCount = projectSnapshots.filter((snapshot) => snapshot.status === "funded").length;
  const likelyCoveredProjectCount = projectSnapshots.filter(
    (snapshot) => snapshot.status !== "funded" && snapshot.pipelineStatus === "likely_covered"
  ).length;
  const gapProjectCount = projectSnapshots.filter(
    (snapshot) => snapshot.pipelineStatus === "unfunded" || snapshot.pipelineStatus === "partially_covered"
  ).length;
  const committedFundingAmount = projectSnapshots.reduce((sum, snapshot) => sum + snapshot.committedFundingAmount, 0);
  const likelyFundingAmount = projectSnapshots.reduce((sum, snapshot) => sum + snapshot.likelyFundingAmount, 0);
  const totalPotentialFundingAmount = projectSnapshots.reduce(
    (sum, snapshot) => sum + snapshot.totalPotentialFundingAmount,
    0
  );
  const unfundedAfterLikelyAmount = projectSnapshots.reduce(
    (sum, snapshot) => sum + snapshot.unfundedAfterLikelyAmount,
    0
  );
  const paidReimbursementAmount = projectSnapshots.reduce(
    (sum, snapshot) => sum + snapshot.paidReimbursementAmount,
    0
  );
  const outstandingReimbursementAmount = projectSnapshots.reduce(
    (sum, snapshot) => sum + snapshot.outstandingReimbursementAmount,
    0
  );
  const uninvoicedAwardAmount = projectSnapshots.reduce(
    (sum, snapshot) => sum + snapshot.uninvoicedAwardAmount,
    0
  );
  const awardRiskCount = projectSnapshots.reduce((sum, snapshot) => sum + snapshot.awardRiskCount, 0);
  const latestSourceUpdatedAt = maxTimestamp(
    projectSnapshots.map((snapshot) => snapshot.latestSourceUpdatedAt)
  );

  let label = "No linked project funding";
  let reason = "No linked projects are attached to this RTP packet yet, so no portfolio funding posture can be reviewed.";

  if (linkedProjectCount > 0) {
    if (gapProjectCount === 0 && likelyCoveredProjectCount === 0 && fundedProjectCount === linkedProjectCount) {
      label = "All linked projects funded";
      reason = `${fundedProjectCount} of ${linkedProjectCount} linked projects are fully funded on committed dollars.`;
    } else if (gapProjectCount === 0) {
      label = "Cycle funding covered through pipeline";
      reason = `${fundedProjectCount} linked projects are fully funded and ${likelyCoveredProjectCount} more look covered through pursued funding.`;
    } else if (fundedProjectCount === 0 && likelyCoveredProjectCount === 0) {
      label = "Funding gaps across linked projects";
      reason = `${gapProjectCount} of ${linkedProjectCount} linked projects still show unresolved funding gaps.`;
    } else {
      label = "Mixed funding posture across linked projects";
      reason = `${fundedProjectCount} funded, ${likelyCoveredProjectCount} likely covered, and ${gapProjectCount} still carrying a gap.`;
    }
  }

  let reimbursementLabel = "No reimbursement tracking yet";
  let reimbursementReason = "No reimbursement posture is available for this linked project portfolio yet.";

  if (linkedProjectCount > 0) {
    if (outstandingReimbursementAmount > 0) {
      reimbursementLabel = "Reimbursement in flight";
      reimbursementReason = `Linked projects still have reimbursement packets outstanding against committed awards.`;
    } else if (uninvoicedAwardAmount > 0) {
      reimbursementLabel = "Awards awaiting reimbursement start";
      reimbursementReason = `Committed awards exist, but some reimbursement packets have not been started yet.`;
    } else if (paidReimbursementAmount > 0) {
      reimbursementLabel = "Reimbursement paid";
      reimbursementReason = `Linked reimbursement packets have been paid against the current award stack.`;
    } else {
      reimbursementLabel = "No reimbursement packets yet";
      reimbursementReason = `No linked reimbursement packets are recorded for the current RTP project portfolio.`;
    }
  }

  return {
    capturedAt: input.capturedAt ?? null,
    latestSourceUpdatedAt,
    linkedProjectCount,
    trackedProjectCount,
    fundedProjectCount,
    likelyCoveredProjectCount,
    gapProjectCount,
    committedFundingAmount,
    likelyFundingAmount,
    totalPotentialFundingAmount,
    unfundedAfterLikelyAmount,
    paidReimbursementAmount,
    outstandingReimbursementAmount,
    uninvoicedAwardAmount,
    awardRiskCount,
    label,
    reason,
    reimbursementLabel,
    reimbursementReason,
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
