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

export type ProjectFundingStackStatus = "funded" | "partially_funded" | "unfunded" | "unknown";

function toNumber(value: number | string | null | undefined): number {
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value ?? "0"));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function buildProjectFundingStackSummary(
  profile: ProjectFundingProfileLike | null | undefined,
  awards: FundingAwardLike[]
) {
  const fundingNeedAmount = toNumber(profile?.funding_need_amount);
  const localMatchNeedAmount = toNumber(profile?.local_match_need_amount);
  const committedFundingAmount = awards.reduce((sum, award) => sum + toNumber(award.awarded_amount), 0);
  const committedMatchAmount = awards.reduce((sum, award) => sum + toNumber(award.match_amount), 0);
  const remainingFundingGap = Math.max(fundingNeedAmount - committedFundingAmount, 0);
  const remainingMatchGap = Math.max(localMatchNeedAmount - committedMatchAmount, 0);
  const awardRiskCount = awards.filter((award) => award.risk_flag === "watch" || award.risk_flag === "critical").length;
  const nextObligationAt = awards
    .map((award) => award.obligation_due_at)
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => new Date(left).getTime() - new Date(right).getTime())[0] ?? null;

  let status: ProjectFundingStackStatus = "unknown";
  let label = "Funding posture unknown";
  let reason = "Add a project funding need or award records to compute funding posture.";

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

  return {
    fundingNeedAmount,
    localMatchNeedAmount,
    committedFundingAmount,
    committedMatchAmount,
    remainingFundingGap,
    remainingMatchGap,
    awardRiskCount,
    nextObligationAt,
    status,
    label,
    reason,
    hasTargetNeed: fundingNeedAmount > 0,
    coverageRatio: fundingNeedAmount > 0 ? Math.min(committedFundingAmount / fundingNeedAmount, 1) : null,
  };
}

export function projectFundingStackTone(
  status: ProjectFundingStackStatus
): "info" | "success" | "warning" | "danger" | "neutral" {
  if (status === "funded") return "success";
  if (status === "partially_funded") return "warning";
  if (status === "unfunded") return "danger";
  return "neutral";
}
