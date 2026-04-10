export type ProjectFundingProfileLike = {
  funding_need_amount?: number | string | null;
  local_match_need_amount?: number | string | null;
};

export type FundingAwardLike = {
  awarded_amount?: number | string | null;
  match_amount?: number | string | null;
  risk_flag?: string | null;
  obligation_due_at?: string | null;
};

export type FundingOpportunityLike = {
  expected_award_amount?: number | string | null;
  decision_state?: string | null;
  opportunity_status?: string | null;
};

export type ProjectFundingStackStatus = "funded" | "partially_funded" | "unfunded" | "unknown";
export type ProjectFundingPipelineStatus = "funded" | "likely_covered" | "partially_covered" | "unfunded" | "unknown";

function toNumber(value: number | string | null | undefined): number {
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value ?? "0"));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function buildProjectFundingStackSummary(
  profile: ProjectFundingProfileLike | null | undefined,
  awards: FundingAwardLike[],
  opportunities: FundingOpportunityLike[] = []
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
    nextObligationAt,
    status,
    label,
    reason,
    pursuedOpportunityCount: pursuedOpportunities.length,
    pipelineStatus,
    pipelineLabel,
    pipelineReason,
    hasTargetNeed: fundingNeedAmount > 0,
    coverageRatio: fundingNeedAmount > 0 ? Math.min(committedFundingAmount / fundingNeedAmount, 1) : null,
    pipelineCoverageRatio: fundingNeedAmount > 0 ? Math.min(totalPotentialFundingAmount / fundingNeedAmount, 1) : null,
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
