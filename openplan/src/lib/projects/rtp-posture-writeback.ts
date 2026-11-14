import { isWriteFailure, writeMatchedNoRows } from "@/lib/http/write-outcome";
import { assessedFundingNumber } from "@/lib/grants/award-handoff";
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
  sourceEpoch: number | string;
  comparableFunding?: import("@/lib/grants/award-handoff").ComparableFunding;
  status: ProjectFundingStackStatus;
  label: string;
  reason: string;
  pipelineStatus: ProjectFundingPipelineStatus;
  pipelineLabel: string;
  pipelineReason: string;
  reimbursementStatus: ProjectFundingReimbursementStatus;
  reimbursementLabel: string;
  reimbursementReason: string;
  fundingNeedAmount: number | null;
  localMatchNeedAmount: number | null;
  committedFundingAmount: number | null;
  committedMatchAmount: number | null;
  likelyFundingAmount: number | null;
  totalPotentialFundingAmount: number | null;
  remainingFundingGap: number | null;
  remainingMatchGap: number | null;
  unfundedAfterLikelyAmount: number | null;
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
  const invalidation=await supabase.from("projects").update({rtp_posture:null,rtp_posture_updated_at:null}).eq("id",projectId).eq("workspace_id",workspaceId).select("funding_source_epoch").maybeSingle();
  if (writeMatchedNoRows(invalidation)) return {posture:null,updatedAt:null,error:{code:"PT409",message:"No project matched posture invalidation. No rebuild was persisted."}};
  if(isWriteFailure(invalidation.error))return {posture:null,updatedAt:null,error:{message:"Cannot invalidate previous RTP posture before rebuild",code:invalidation.error?.code}};
  const epoch: number | string | undefined = invalidation.data?.funding_source_epoch;
  if (epoch === undefined || (typeof epoch === 'number' ? !Number.isSafeInteger(epoch) || epoch < 0 : !/^\d+$/.test(epoch))) return {posture:null,updatedAt:null,error:{message:"Exact funding source epoch unavailable; posture remains invalidated"}};
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
    .select("awarded_amount, match_amount, risk_flag, obligation_due_at, updated_at, created_at, id, latest_handoff_revision_id, current_handoff_revision_id, currency_code, has_source_backed_issuance", {count:"exact"})
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
    .select("expected_award_amount, decision_state, opportunity_status, closes_at, updated_at, created_at, has_source_backed_issuance", {count:"exact"})
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
    .select("status, amount, retention_percent, retention_amount, net_amount, due_date, invoice_date, created_at, award_handoff_revision_id, currency_code, handoff_applicable_revision_id", {count:"exact"})
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

  if([awardsResult,opportunitiesResult,invoicesResult].some((r)=>r.count!==r.data?.length))return {posture:null,updatedAt:null,error:{message:"Complete financial source sets unavailable; posture invalidated"}};
  const profile = (profileResult.data ?? null) as ProjectFundingProfileLike | null;
  const awards = (awardsResult.data ?? []) as FundingAwardLike[];
  const opportunities = (opportunitiesResult.data ?? []) as FundingOpportunityLike[];
  const invoices = (invoicesResult.data ?? []) as FundingInvoiceLike[];

  const summary = buildProjectFundingStackSummary(profile, awards, opportunities, invoices);

  const posture: ProjectRtpPosture = {
    sourceEpoch: epoch,
    comparableFunding: summary.comparableFunding,
    status: summary.status,
    label: summary.label,
    reason: summary.reason,
    pipelineStatus: summary.pipelineStatus,
    pipelineLabel: summary.pipelineLabel,
    pipelineReason: summary.pipelineReason,
    reimbursementStatus: summary.reimbursementStatus,
    reimbursementLabel: summary.reimbursementLabel,
    reimbursementReason: summary.reimbursementReason,
    fundingNeedAmount: assessedFundingNumber(summary.fundingNeedAmount),
    localMatchNeedAmount: assessedFundingNumber(summary.localMatchNeedAmount),
    committedFundingAmount: assessedFundingNumber(summary.committedFundingAmount),
    committedMatchAmount: assessedFundingNumber(summary.committedMatchAmount),
    likelyFundingAmount: assessedFundingNumber(summary.likelyFundingAmount),
    totalPotentialFundingAmount: assessedFundingNumber(summary.totalPotentialFundingAmount),
    remainingFundingGap: assessedFundingNumber(summary.remainingFundingGap),
    remainingMatchGap: assessedFundingNumber(summary.remainingMatchGap),
    unfundedAfterLikelyAmount: assessedFundingNumber(summary.unfundedAfterLikelyAmount),
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
    .eq("workspace_id", workspaceId)
    .eq("funding_source_epoch", epoch)
    .select("id")
    .maybeSingle();

  if (writeMatchedNoRows(updateResult)) return {posture:null,updatedAt:null,error:{code:"PT409",message:"Funding sources changed during rebuild. Stale posture was not persisted; rebuild from current sources."}};
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
