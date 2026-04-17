import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildProjectFundingStackSummary,
  type FundingAwardLike,
  type FundingInvoiceLike,
  type FundingOpportunityLike,
  type ProjectFundingProfileLike,
  type ProjectFundingPipelineStatus,
  type ProjectFundingReimbursementStatus,
  type ProjectFundingStackStatus,
} from "@/lib/projects/funding";

export type ProjectRtpPosture = {
  status: ProjectFundingStackStatus;
  label: string;
  reason: string;
  pipelineStatus: ProjectFundingPipelineStatus;
  pipelineLabel: string;
  pipelineReason: string;
  reimbursementStatus: ProjectFundingReimbursementStatus;
  reimbursementLabel: string;
  reimbursementReason: string;
  fundingNeedAmount: number;
  localMatchNeedAmount: number;
  committedFundingAmount: number;
  committedMatchAmount: number;
  likelyFundingAmount: number;
  totalPotentialFundingAmount: number;
  remainingFundingGap: number;
  remainingMatchGap: number;
  unfundedAfterLikelyAmount: number;
  nextObligationAt: string | null;
  awardRiskCount: number;
  awardCount: number;
  pursuedOpportunityCount: number;
};

export type RtpPostureWritebackSupabaseLike = Pick<SupabaseClient, "from">;

export type RtpPostureWritebackResult = {
  posture: ProjectRtpPosture | null;
  updatedAt: string | null;
  error: { message: string; code?: string | null } | null;
};

export type RebuildProjectRtpPostureInput = {
  supabase: RtpPostureWritebackSupabaseLike;
  projectId: string;
  workspaceId: string;
  now?: () => Date;
};

export async function rebuildProjectRtpPosture({
  supabase,
  projectId,
  workspaceId,
  now = () => new Date(),
}: RebuildProjectRtpPostureInput): Promise<RtpPostureWritebackResult> {
  const profileResult = await supabase
    .from("project_funding_profiles")
    .select("funding_need_amount, local_match_need_amount, updated_at")
    .eq("project_id", projectId)
    .maybeSingle();

  if (profileResult.error) {
    return {
      posture: null,
      updatedAt: null,
      error: {
        message: profileResult.error.message,
        code: profileResult.error.code ?? null,
      },
    };
  }

  const awardsResult = await supabase
    .from("funding_awards")
    .select("awarded_amount, match_amount, risk_flag, obligation_due_at, updated_at, created_at")
    .eq("workspace_id", workspaceId)
    .eq("project_id", projectId);

  if (awardsResult.error) {
    return {
      posture: null,
      updatedAt: null,
      error: {
        message: awardsResult.error.message,
        code: awardsResult.error.code ?? null,
      },
    };
  }

  const opportunitiesResult = await supabase
    .from("funding_opportunities")
    .select("expected_award_amount, decision_state, opportunity_status, closes_at, updated_at, created_at")
    .eq("workspace_id", workspaceId)
    .eq("project_id", projectId);

  if (opportunitiesResult.error) {
    return {
      posture: null,
      updatedAt: null,
      error: {
        message: opportunitiesResult.error.message,
        code: opportunitiesResult.error.code ?? null,
      },
    };
  }

  const invoicesResult = await supabase
    .from("billing_invoice_records")
    .select("status, amount, retention_percent, retention_amount, net_amount, due_date, invoice_date, created_at")
    .eq("workspace_id", workspaceId)
    .eq("project_id", projectId);

  if (invoicesResult.error) {
    return {
      posture: null,
      updatedAt: null,
      error: {
        message: invoicesResult.error.message,
        code: invoicesResult.error.code ?? null,
      },
    };
  }

  const profile = (profileResult.data ?? null) as ProjectFundingProfileLike | null;
  const awards = (awardsResult.data ?? []) as FundingAwardLike[];
  const opportunities = (opportunitiesResult.data ?? []) as FundingOpportunityLike[];
  const invoices = (invoicesResult.data ?? []) as FundingInvoiceLike[];

  const summary = buildProjectFundingStackSummary(profile, awards, opportunities, invoices);

  const posture: ProjectRtpPosture = {
    status: summary.status,
    label: summary.label,
    reason: summary.reason,
    pipelineStatus: summary.pipelineStatus,
    pipelineLabel: summary.pipelineLabel,
    pipelineReason: summary.pipelineReason,
    reimbursementStatus: summary.reimbursementStatus,
    reimbursementLabel: summary.reimbursementLabel,
    reimbursementReason: summary.reimbursementReason,
    fundingNeedAmount: summary.fundingNeedAmount,
    localMatchNeedAmount: summary.localMatchNeedAmount,
    committedFundingAmount: summary.committedFundingAmount,
    committedMatchAmount: summary.committedMatchAmount,
    likelyFundingAmount: summary.likelyFundingAmount,
    totalPotentialFundingAmount: summary.totalPotentialFundingAmount,
    remainingFundingGap: summary.remainingFundingGap,
    remainingMatchGap: summary.remainingMatchGap,
    unfundedAfterLikelyAmount: summary.unfundedAfterLikelyAmount,
    nextObligationAt: summary.nextObligationAt,
    awardRiskCount: summary.awardRiskCount,
    awardCount: awards.length,
    pursuedOpportunityCount: summary.pursuedOpportunityCount,
  };

  const updatedAt = now().toISOString();

  const updateResult = await supabase
    .from("projects")
    .update({
      rtp_posture: posture,
      rtp_posture_updated_at: updatedAt,
    })
    .eq("id", projectId)
    .eq("workspace_id", workspaceId);

  if (updateResult.error) {
    return {
      posture,
      updatedAt: null,
      error: {
        message: updateResult.error.message,
        code: updateResult.error.code ?? null,
      },
    };
  }

  return { posture, updatedAt, error: null };
}
