import { redirect } from "next/navigation";
import { WorkspaceMembershipRequired } from "@/components/workspaces/workspace-membership-required";
import { buildProjectFundingStackSummary } from "@/lib/projects/funding";
import { resolveRtpFundingFollowThrough } from "@/lib/operations/grants-links";
import {
  getReportNavigationHref,
  getReportPacketFreshness,
  getRtpPacketPresetAlignment,
} from "@/lib/reports/catalog";
import { buildProjectGrantModelingEvidenceByProjectId } from "@/lib/grants/modeling-evidence";
import { createClient } from "@/lib/supabase/server";
import {
  buildRtpCycleReadiness,
  buildRtpCycleWorkflowSummary,
} from "@/lib/rtp/catalog";
import {
  PACKET_FRESHNESS_DETAIL,
  PACKET_FRESHNESS_LABELS,
  PACKET_POSTURE_DETAIL,
  PACKET_POSTURE_LABELS,
} from "@/lib/reports/packet-labels";
import {
  loadCurrentWorkspaceMembership,
} from "@/lib/workspaces/current";
import { RtpRegistryOverview } from "./_components/rtp-registry-overview";
import { RtpCycleRegistryTable } from "./_components/rtp-cycle-registry-table";
import { RtpRegistryAdvisoryPanel } from "./_components/rtp-registry-advisory-panel";
import { RtpQueueOperationsBoard } from "./_components/rtp-queue-operations-board";
import { buildRtpRegistryHref } from "./_components/_helpers";
import {
  buildPacketActivityTrace,
  buildPacketFundingReview,
  buildPacketOperatorStatus,
  buildPacketQueueTrace,
  buildPacketQueueTraceState,
  getPacketAttentionPriority,
  getQueueTraceStatePriority,
  looksLikePendingSchema,
  matchesPacketAttentionFilter,
  matchesQueueActionFilter,
  matchesQueueTraceStateFilter,
  normalizePacketAttentionFilter,
  normalizeQueueActionFilter,
  normalizeQueueTraceStateFilter,
  normalizeRecentQueueFilter,
} from "./_components/_packet-state";
import type { DominantActionKey, RtpPacketReportRow } from "./_components/_types";

type RtpPageSearchParams = Promise<{
  status?: string;
  packet?: string;
  recent?: string;
  queueAction?: string;
  queueTraceState?: string;
}>;

type RtpCycleRow = {
  id: string;
  workspace_id: string;
  title: string;
  status: string;
  geography_label: string | null;
  horizon_start_year: number | null;
  horizon_end_year: number | null;
  adoption_target_date: string | null;
  public_review_open_at: string | null;
  public_review_close_at: string | null;
  summary: string | null;
  created_at: string;
  updated_at: string;
};

type ProjectRtpLinkRow = {
  id: string;
  project_id: string;
  rtp_cycle_id: string;
  portfolio_role: string;
};

type ProjectFundingProfileRow = {
  project_id: string;
  funding_need_amount: number | null;
  local_match_need_amount: number | null;
};

type FundingAwardRow = {
  project_id: string;
  awarded_amount: number | string;
  match_amount: number | string;
  risk_flag: string;
  obligation_due_at: string | null;
};

type FundingOpportunityRow = {
  project_id: string;
  decision_state: string;
  opportunity_status: string;
  expected_award_amount: number | string | null;
};

type BillingInvoiceRow = {
  project_id: string;
  funding_award_id: string | null;
  status: string;
  amount: number | string | null;
  retention_percent: number | string | null;
  retention_amount: number | string | null;
  net_amount: number | string | null;
  due_date: string | null;
};

type ReportSectionRow = {
  id: string;
  report_id: string;
  section_key: string;
  enabled: boolean;
  sort_order: number;
};

type ProjectReportRow = {
  id: string;
  project_id: string;
  title: string;
  updated_at: string;
  generated_at: string | null;
  latest_artifact_kind: string | null;
};

type ProjectReportArtifactRow = {
  report_id: string;
  generated_at: string;
  metadata_json: Record<string, unknown> | null;
};

type ModelingClaimDecisionDefaultRow = {
  county_run_id: string | null;
};

export default async function RtpPage({ searchParams }: { searchParams: RtpPageSearchParams }) {
  const filters = await searchParams;
  const selectedPacketFilter = normalizePacketAttentionFilter(filters.packet);
  const recentOnly = normalizeRecentQueueFilter(filters.recent);
  const selectedQueueActionFilter = normalizeQueueActionFilter(filters.queueAction);
  const selectedQueueTraceStateFilter = normalizeQueueTraceStateFilter(filters.queueTraceState);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/sign-in");
  }

  const { membership, workspace } = await loadCurrentWorkspaceMembership(supabase, user.id);

  if (!membership || !workspace) {
    return (
      <WorkspaceMembershipRequired
        moduleLabel="RTP"
        title="RTP cycles need a provisioned workspace"
        description="RTP cycles only appear inside a real workspace. You are signed in, but no workspace membership was found for this account, so the registry would otherwise look empty for ambiguous reasons."
      />
    );
  }

  const [rtpCyclesResult, defaultModelingClaimResult] = await Promise.all([
    supabase
      .from("rtp_cycles")
      .select(
        "id, workspace_id, title, status, geography_label, horizon_start_year, horizon_end_year, adoption_target_date, public_review_open_at, public_review_close_at, summary, created_at, updated_at"
      )
      .order("updated_at", { ascending: false }),
    supabase
      .from("modeling_claim_decisions")
      .select("county_run_id")
      .eq("workspace_id", membership.workspace_id)
      .eq("track", "assignment")
      .not("county_run_id", "is", null)
      .order("decided_at", { ascending: false })
      .limit(1),
  ]);

  const rtpCyclesData = rtpCyclesResult.data ?? [];
  const defaultModelingCountyRunId = looksLikePendingSchema(defaultModelingClaimResult.error?.message)
    ? null
    : (((defaultModelingClaimResult.data ?? []) as ModelingClaimDecisionDefaultRow[])[0]?.county_run_id ?? null);
  const rtpCycleIds = ((rtpCyclesData ?? []) as RtpCycleRow[]).map((cycle) => cycle.id);
  const [projectRtpLinksResult, initialPacketReportsResult] = await Promise.all([
    rtpCycleIds.length
      ? supabase
          .from("project_rtp_cycle_links")
          .select("id, project_id, rtp_cycle_id, portfolio_role")
          .in("rtp_cycle_id", rtpCycleIds)
      : Promise.resolve({ data: [], error: null }),
    rtpCycleIds.length
      ? supabase
          .from("reports")
          .select("id, rtp_cycle_id, title, report_type, status, generated_at, latest_artifact_kind, metadata_json, updated_at")
          .in("rtp_cycle_id", rtpCycleIds)
          .eq("report_type", "board_packet")
          .order("updated_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
  ]);

  const packetReportsResult =
    initialPacketReportsResult.error && looksLikePendingSchema(initialPacketReportsResult.error.message)
      ? await supabase
          .from("reports")
          .select("id, rtp_cycle_id, title, report_type, status, generated_at, latest_artifact_kind, updated_at")
          .in("rtp_cycle_id", rtpCycleIds)
          .eq("report_type", "board_packet")
          .order("updated_at", { ascending: false })
      : initialPacketReportsResult;

  const projectRtpLinks = looksLikePendingSchema(projectRtpLinksResult.error?.message)
    ? []
    : ((projectRtpLinksResult.data ?? []) as ProjectRtpLinkRow[]);
  const linkedProjectIds = [...new Set(projectRtpLinks.map((link) => link.project_id))];

  const [fundingProfilesResult, fundingAwardsResult, fundingOpportunitiesResult, billingInvoicesResult, linkedProjectReportsResult] = await Promise.all([
    linkedProjectIds.length
      ? supabase
          .from("project_funding_profiles")
          .select("project_id, funding_need_amount, local_match_need_amount")
          .in("project_id", linkedProjectIds)
      : Promise.resolve({ data: [], error: null }),
    linkedProjectIds.length
      ? supabase
          .from("funding_awards")
          .select("project_id, awarded_amount, match_amount, risk_flag, obligation_due_at")
          .in("project_id", linkedProjectIds)
      : Promise.resolve({ data: [], error: null }),
    linkedProjectIds.length
      ? supabase
          .from("funding_opportunities")
          .select("project_id, decision_state, opportunity_status, expected_award_amount")
          .in("project_id", linkedProjectIds)
      : Promise.resolve({ data: [], error: null }),
    linkedProjectIds.length
      ? supabase
          .from("billing_invoice_records")
          .select("project_id, funding_award_id, status, amount, retention_percent, retention_amount, net_amount, due_date")
          .in("project_id", linkedProjectIds)
      : Promise.resolve({ data: [], error: null }),
    linkedProjectIds.length
      ? supabase
          .from("reports")
          .select("id, project_id, title, updated_at, generated_at, latest_artifact_kind")
          .in("project_id", linkedProjectIds)
          .order("updated_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
  ]);

  const fundingProfiles = looksLikePendingSchema(fundingProfilesResult.error?.message)
    ? []
    : ((fundingProfilesResult.data ?? []) as ProjectFundingProfileRow[]);
  const fundingAwards = looksLikePendingSchema(fundingAwardsResult.error?.message)
    ? []
    : ((fundingAwardsResult.data ?? []) as FundingAwardRow[]);
  const fundingOpportunities = looksLikePendingSchema(fundingOpportunitiesResult.error?.message)
    ? []
    : ((fundingOpportunitiesResult.data ?? []) as FundingOpportunityRow[]);
  const billingInvoices = looksLikePendingSchema(billingInvoicesResult.error?.message)
    ? []
    : ((billingInvoicesResult.data ?? []) as BillingInvoiceRow[]);

  const linkedProjectReports = (linkedProjectReportsResult.data ?? []) as ProjectReportRow[];
  const linkedProjectReportIds = linkedProjectReports.map((r) => r.id);
  const linkedProjectReportArtifactsResult = linkedProjectReportIds.length
    ? await supabase
        .from("report_artifacts")
        .select("report_id, generated_at, metadata_json")
        .in("report_id", linkedProjectReportIds)
        .order("generated_at", { ascending: false })
    : { data: [], error: null };
  const linkedProjectReportArtifacts = (linkedProjectReportArtifactsResult.data ?? []) as ProjectReportArtifactRow[];
  const projectGrantModelingEvidenceByProjectId = buildProjectGrantModelingEvidenceByProjectId(
    linkedProjectReports,
    linkedProjectReportArtifacts
  );

  const fundingProfileByProjectId = new Map(fundingProfiles.map((profile) => [profile.project_id, profile]));
  const fundingAwardsByProjectId = new Map<string, FundingAwardRow[]>();
  const fundingOpportunitiesByProjectId = new Map<string, FundingOpportunityRow[]>();
  const fundingInvoicesByProjectId = new Map<string, BillingInvoiceRow[]>();
  for (const award of fundingAwards) {
    const current = fundingAwardsByProjectId.get(award.project_id) ?? [];
    current.push(award);
    fundingAwardsByProjectId.set(award.project_id, current);
  }
  for (const opportunity of fundingOpportunities) {
    const current = fundingOpportunitiesByProjectId.get(opportunity.project_id) ?? [];
    current.push(opportunity);
    fundingOpportunitiesByProjectId.set(opportunity.project_id, current);
  }
  for (const invoice of billingInvoices) {
    if (!invoice.funding_award_id) continue;
    const current = fundingInvoicesByProjectId.get(invoice.project_id) ?? [];
    current.push(invoice);
    fundingInvoicesByProjectId.set(invoice.project_id, current);
  }

  const linksByCycleId = new Map<string, ProjectRtpLinkRow[]>();
  for (const link of projectRtpLinks) {
    const current = linksByCycleId.get(link.rtp_cycle_id) ?? [];
    current.push(link);
    linksByCycleId.set(link.rtp_cycle_id, current);
  }

  const packetReports = looksLikePendingSchema(packetReportsResult.error?.message)
    ? []
    : ((packetReportsResult.data ?? []) as RtpPacketReportRow[]);
  const latestPacketReportByCycleId = new Map<string, RtpPacketReportRow>();
  for (const report of packetReports) {
    if (!latestPacketReportByCycleId.has(report.rtp_cycle_id)) {
      latestPacketReportByCycleId.set(report.rtp_cycle_id, report);
    }
  }

  const latestPacketReportIds = [...latestPacketReportByCycleId.values()].map((report) => report.id);
  const packetSectionsResult = latestPacketReportIds.length
    ? await supabase
        .from("report_sections")
        .select("id, report_id, section_key, enabled, sort_order")
        .in("report_id", latestPacketReportIds)
    : { data: [], error: null };

  const packetSections = looksLikePendingSchema(packetSectionsResult.error?.message)
    ? []
    : ((packetSectionsResult.data ?? []) as ReportSectionRow[]);
  const packetSectionsByReportId = new Map<string, ReportSectionRow[]>();
  for (const section of packetSections) {
    const current = packetSectionsByReportId.get(section.report_id) ?? [];
    current.push(section);
    packetSectionsByReportId.set(section.report_id, current);
  }

  const allCycles = ((rtpCyclesData ?? []) as RtpCycleRow[])
    .map((cycle) => {
      const cycleLinks = linksByCycleId.get(cycle.id) ?? [];
      const packetReport = latestPacketReportByCycleId.get(cycle.id) ?? null;
      const packetSectionsForReport = packetReport ? packetSectionsByReportId.get(packetReport.id) ?? [] : [];
      const readiness = buildRtpCycleReadiness({
        geographyLabel: cycle.geography_label,
        horizonStartYear: cycle.horizon_start_year,
        horizonEndYear: cycle.horizon_end_year,
        adoptionTargetDate: cycle.adoption_target_date,
        publicReviewOpenAt: cycle.public_review_open_at,
        publicReviewCloseAt: cycle.public_review_close_at,
      });
      const packetFreshness = packetReport
        ? getReportPacketFreshness({
            latestArtifactKind: packetReport.latest_artifact_kind,
            generatedAt: packetReport.generated_at,
            // Report row writes happen during generation; compare freshness to the upstream RTP source.
            updatedAt: cycle.updated_at,
          })
        : {
            label: PACKET_FRESHNESS_LABELS.NO_PACKET,
            tone: "warning" as const,
            detail: PACKET_FRESHNESS_DETAIL.NO_PACKET_FOR_CYCLE,
          };
      const packetPresetAlignment = packetReport
        ? getRtpPacketPresetAlignment({
            cycleStatus: cycle.status,
            sections: packetSectionsForReport.map((section) => ({
              sectionKey: section.section_key,
              enabled: section.enabled,
              sortOrder: section.sort_order,
            })),
          })
        : null;
      const packetPresetPosture = !packetReport
        ? {
            label: PACKET_POSTURE_LABELS.NO_RECORD,
            tone: "warning" as const,
            detail: PACKET_POSTURE_DETAIL.NO_RECORD,
          }
        : packetFreshness.label === PACKET_FRESHNESS_LABELS.REFRESH_RECOMMENDED && packetPresetAlignment && !packetPresetAlignment.aligned
          ? {
              label: PACKET_POSTURE_LABELS.NEEDS_RESET,
              tone: "warning" as const,
              detail: `The latest packet is stale and its structure has diverged from the ${packetPresetAlignment.presetLabel.toLowerCase()} for this cycle phase.`,
            }
          : packetPresetAlignment
            ? {
                label: packetPresetAlignment.statusLabel,
                tone: packetPresetAlignment.tone,
                detail: packetPresetAlignment.detail,
              }
            : {
                label: PACKET_POSTURE_LABELS.PRESET_UNKNOWN,
                tone: "neutral" as const,
                detail: PACKET_POSTURE_DETAIL.PRESET_UNKNOWN,
              };
      const packetNavigationHref = packetReport
        ? getReportNavigationHref(packetReport.id, packetFreshness.label)
        : `/rtp/${cycle.id}`;
      const packetQueueTrace = buildPacketQueueTrace(packetReport);
      const packetQueueTraceState = buildPacketQueueTraceState({
        actedAt: packetQueueTrace.actedAt,
        sortTimestamp: packetQueueTrace.sortTimestamp,
        cycleUpdatedAt: cycle.updated_at,
      });
      const cycleFundingSummaries = cycleLinks.map((link) =>
        buildProjectFundingStackSummary(
          fundingProfileByProjectId.get(link.project_id) ?? null,
          fundingAwardsByProjectId.get(link.project_id) ?? [],
          fundingOpportunitiesByProjectId.get(link.project_id) ?? [],
          fundingInvoicesByProjectId.get(link.project_id) ?? []
        )
      );
      const packetAttention = !packetReport
        ? ("missing" as const)
        : packetPresetPosture.label === PACKET_POSTURE_LABELS.NEEDS_RESET
          ? ("reset" as const)
          : packetFreshness.label === PACKET_FRESHNESS_LABELS.NO_PACKET
            ? ("generate" as const)
            : packetFreshness.label === PACKET_FRESHNESS_LABELS.REFRESH_RECOMMENDED
            ? ("refresh" as const)
            : ("current" as const);
      const packetFundingReview = buildPacketFundingReview({
        linkedProjectCount: cycleLinks.length,
        fundedProjectCount: cycleFundingSummaries.filter((summary) => summary.status === "funded").length,
        likelyCoveredProjectCount: cycleFundingSummaries.filter(
          (summary) => summary.status !== "funded" && summary.pipelineStatus === "likely_covered"
        ).length,
        unfundedProjectCount: cycleFundingSummaries.filter(
          (summary) => summary.pipelineStatus === "unfunded" || summary.pipelineStatus === "partially_covered"
        ).length,
        reimbursementInFlightCount: cycleFundingSummaries.filter(
          (summary) => summary.reimbursementStatus === "in_review"
        ).length,
        outstandingReimbursementAmount: cycleFundingSummaries.reduce(
          (sum, summary) => sum + summary.outstandingReimbursementAmount,
          0
        ),
        uninvoicedAwardAmount: cycleFundingSummaries.reduce(
          (sum, summary) => sum + summary.uninvoicedAwardAmount,
          0
        ),
      });
      const grantsFollowThrough = resolveRtpFundingFollowThrough({
        unfundedAfterLikelyAmount: cycleFundingSummaries.reduce(
          (sum, summary) => sum + summary.unfundedAfterLikelyAmount,
          0
        ),
        outstandingReimbursementAmount: cycleFundingSummaries.reduce(
          (sum, summary) => sum + summary.outstandingReimbursementAmount,
          0
        ),
        uninvoicedAwardAmount: cycleFundingSummaries.reduce(
          (sum, summary) => sum + summary.uninvoicedAwardAmount,
          0
        ),
        likelyCoveredProjectCount: cycleFundingSummaries.filter(
          (summary) => summary.status !== "funded" && summary.pipelineStatus === "likely_covered"
        ).length,
      });

      return {
        ...cycle,
        linkedProjectCount: cycleLinks.length,
        constrainedProjectCount: cycleLinks.filter((link) => link.portfolio_role === "constrained").length,
        illustrativeProjectCount: cycleLinks.filter((link) => link.portfolio_role === "illustrative").length,
        fundedProjectCount: cycleFundingSummaries.filter((summary) => summary.status === "funded").length,
        likelyCoveredProjectCount: cycleFundingSummaries.filter(
          (summary) => summary.status !== "funded" && summary.pipelineStatus === "likely_covered"
        ).length,
        unfundedProjectCount: cycleFundingSummaries.filter(
          (summary) => summary.pipelineStatus === "unfunded" || summary.pipelineStatus === "partially_covered"
        ).length,
        paidReimbursementAmount: cycleFundingSummaries.reduce(
          (sum, summary) => sum + summary.paidReimbursementAmount,
          0
        ),
        outstandingReimbursementAmount: cycleFundingSummaries.reduce(
          (sum, summary) => sum + summary.outstandingReimbursementAmount,
          0
        ),
        uninvoicedAwardAmount: cycleFundingSummaries.reduce(
          (sum, summary) => sum + summary.uninvoicedAwardAmount,
          0
        ),
        reimbursementInFlightCount: cycleFundingSummaries.filter(
          (summary) => summary.reimbursementStatus === "in_review"
        ).length,
        packetReport,
        packetFreshness,
        packetPresetPosture,
        packetAttention,
        packetOperatorStatus: buildPacketOperatorStatus({
          packetReport,
          packetFreshness,
          packetPresetPosture,
          packetQueueTraceState,
          packetFundingReview,
        }),
        packetFundingReview,
        packetQueueTrace,
        packetQueueTraceState,
        packetActivityTrace: buildPacketActivityTrace({
          packetReport,
          packetFreshness,
          packetAttention,
        }),
        packetNavigationHref,
        grantsFollowThrough,
        readiness,
        workflow: buildRtpCycleWorkflowSummary({ status: cycle.status, readiness }),
        modelingCountyRunId: defaultModelingCountyRunId,
        comparisonBackedProjectCount: cycleLinks.filter(
          (link) => Boolean(projectGrantModelingEvidenceByProjectId.get(link.project_id))
        ).length,
        staleModelingProjectCount: cycleLinks.filter((link) => {
          const evidence = projectGrantModelingEvidenceByProjectId.get(link.project_id);
          return evidence?.leadComparisonReport.packetFreshness.label === PACKET_FRESHNESS_LABELS.REFRESH_RECOMMENDED;
        }).length,
      };
    })
    .filter((cycle) => (filters.status ? cycle.status === filters.status : true));

  const packetAttentionCounts = {
    reset: allCycles.filter((cycle) => cycle.packetAttention === "reset").length,
    generate: allCycles.filter((cycle) => cycle.packetAttention === "generate").length,
    refresh: allCycles.filter((cycle) => cycle.packetAttention === "refresh").length,
    missing: allCycles.filter((cycle) => cycle.packetAttention === "missing").length,
    current: allCycles.filter((cycle) => cycle.packetAttention === "current").length,
  };

  const queueActionScopedCycles = [...allCycles]
    .filter((cycle) => matchesPacketAttentionFilter(selectedPacketFilter, cycle.packetAttention))
    .filter((cycle) => (recentOnly ? cycle.packetQueueTrace.isRecent : true));

  const queueActionCounts = {
    createRecord: queueActionScopedCycles.filter((cycle) => cycle.packetQueueTrace.action === "create_record").length,
    resetLayout: queueActionScopedCycles.filter((cycle) => cycle.packetQueueTrace.action === "reset_layout").length,
    generateFirstArtifact: queueActionScopedCycles.filter(
      (cycle) => cycle.packetQueueTrace.action === "generate_first_artifact"
    ).length,
    refreshArtifact: queueActionScopedCycles.filter((cycle) => cycle.packetQueueTrace.action === "refresh_artifact").length,
  };

  const queueTraceStateScopedCycles = queueActionScopedCycles.filter((cycle) =>
    matchesQueueActionFilter(selectedQueueActionFilter, cycle.packetQueueTrace.action)
  );

  const queueTraceStateCounts = {
    outpaced: queueTraceStateScopedCycles.filter((cycle) => cycle.packetQueueTraceState.state === "outpaced").length,
    aligned: queueTraceStateScopedCycles.filter((cycle) => cycle.packetQueueTraceState.state === "aligned").length,
    unrecorded: queueTraceStateScopedCycles.filter((cycle) => cycle.packetQueueTraceState.state === "unrecorded").length,
  };

  const typedCycles = queueTraceStateScopedCycles
    .filter((cycle) => matchesQueueTraceStateFilter(selectedQueueTraceStateFilter, cycle.packetQueueTraceState.state))
    .sort((left, right) => {
      const priorityDelta = getPacketAttentionPriority(left.packetAttention) - getPacketAttentionPriority(right.packetAttention);
      if (priorityDelta !== 0) {
        return priorityDelta;
      }

      const queueTraceStateDelta =
        getQueueTraceStatePriority(left.packetQueueTraceState.state) -
        getQueueTraceStatePriority(right.packetQueueTraceState.state);
      if (queueTraceStateDelta !== 0) {
        return queueTraceStateDelta;
      }

      const queueTraceDelta = right.packetQueueTrace.sortTimestamp - left.packetQueueTrace.sortTimestamp;
      if (queueTraceDelta !== 0) {
        return queueTraceDelta;
      }

      return new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime();
    });

  const draftCount = typedCycles.filter((cycle) => cycle.status === "draft").length;
  const publicReviewCount = typedCycles.filter((cycle) => cycle.status === "public_review").length;
  const adoptedCount = typedCycles.filter((cycle) => cycle.status === "adopted").length;
  const readyFoundationCount = typedCycles.filter((cycle) => cycle.readiness.ready).length;
  const linkedProjectCount = typedCycles.reduce((sum, cycle) => sum + cycle.linkedProjectCount, 0);
  const fundedProjectCount = typedCycles.reduce((sum, cycle) => sum + cycle.fundedProjectCount, 0);
  const likelyCoveredProjectCount = typedCycles.reduce((sum, cycle) => sum + cycle.likelyCoveredProjectCount, 0);
  const unfundedProjectCount = typedCycles.reduce((sum, cycle) => sum + cycle.unfundedProjectCount, 0);
  const paidReimbursementTotal = typedCycles.reduce((sum, cycle) => sum + cycle.paidReimbursementAmount, 0);
  const outstandingReimbursementTotal = typedCycles.reduce(
    (sum, cycle) => sum + cycle.outstandingReimbursementAmount,
    0
  );
  const uninvoicedAwardTotal = typedCycles.reduce((sum, cycle) => sum + cycle.uninvoicedAwardAmount, 0);
  const recentQueueActivityCount = typedCycles.filter((cycle) => cycle.packetQueueTrace.isRecent).length;
  const outpacedQueueTraceCount = typedCycles.filter((cycle) => cycle.packetQueueTraceState.label === "Outpaced by source").length;
  const outpacedQueueCycles = allCycles.filter((cycle) => cycle.packetQueueTraceState.state === "outpaced");
  const outpacedQueueMix = {
    reset: outpacedQueueCycles.filter((cycle) => cycle.packetAttention === "reset").length,
    refresh: outpacedQueueCycles.filter((cycle) => cycle.packetAttention === "refresh").length,
    generate: outpacedQueueCycles.filter((cycle) => cycle.packetAttention === "generate").length,
    current: outpacedQueueCycles.filter((cycle) => cycle.packetAttention === "current").length,
  };
  const unrecordedQueueCycles = allCycles.filter((cycle) => cycle.packetQueueTraceState.state === "unrecorded");
  const unrecordedQueueMix = {
    missing: unrecordedQueueCycles.filter((cycle) => cycle.packetAttention === "missing").length,
    generate: unrecordedQueueCycles.filter((cycle) => cycle.packetAttention === "generate").length,
    refresh: unrecordedQueueCycles.filter((cycle) => cycle.packetAttention === "refresh").length,
    current: unrecordedQueueCycles.filter((cycle) => cycle.packetAttention === "current").length,
  };
  const latestQueueActionAt = typedCycles
    .map((cycle) => cycle.packetQueueTrace.actedAt)
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0] ?? null;
  const recentQueueActionBreakdown = {
    createRecord: typedCycles.filter(
      (cycle) => cycle.packetQueueTrace.isRecent && cycle.packetQueueTrace.action === "create_record"
    ).length,
    resetLayout: typedCycles.filter(
      (cycle) => cycle.packetQueueTrace.isRecent && cycle.packetQueueTrace.action === "reset_layout"
    ).length,
    generateFirstArtifact: typedCycles.filter(
      (cycle) => cycle.packetQueueTrace.isRecent && cycle.packetQueueTrace.action === "generate_first_artifact"
    ).length,
    refreshArtifact: typedCycles.filter(
      (cycle) => cycle.packetQueueTrace.isRecent && cycle.packetQueueTrace.action === "refresh_artifact"
    ).length,
  };
  const currentViewActionCounts = {
    createPacket: typedCycles.filter((cycle) => cycle.packetAttention === "missing").length,
    resetAndRegenerate: typedCycles.filter((cycle) => cycle.packetAttention === "reset").length,
    generateFirstArtifact: typedCycles.filter((cycle) => cycle.packetAttention === "generate").length,
    refreshArtifact: typedCycles.filter((cycle) => cycle.packetAttention === "refresh").length,
    releaseReview: typedCycles.filter(
      (cycle) => cycle.packetAttention === "current" && cycle.packetQueueTraceState.state === "aligned"
    ).length,
    traceFollowUp: typedCycles.filter(
      (cycle) => cycle.packetAttention === "current" && cycle.packetQueueTraceState.state !== "aligned"
    ).length,
  };
  const dominantCurrentViewAction = [
    { key: "createPacket", label: "Create missing packet records", count: currentViewActionCounts.createPacket },
    { key: "resetAndRegenerate", label: "Reset and regenerate packets", count: currentViewActionCounts.resetAndRegenerate },
    { key: "generateFirstArtifact", label: "Generate first packet artifacts", count: currentViewActionCounts.generateFirstArtifact },
    { key: "refreshArtifact", label: "Refresh stale packet artifacts", count: currentViewActionCounts.refreshArtifact },
    { key: "releaseReview", label: "Run release review on current packets", count: currentViewActionCounts.releaseReview },
    { key: "traceFollowUp", label: "Review trace follow-up gaps", count: currentViewActionCounts.traceFollowUp },
  ] satisfies Array<{ key: DominantActionKey; label: string; count: number }>;
  const orderedCurrentViewActions = [...dominantCurrentViewAction].sort((left, right) => right.count - left.count);
  const rankedCurrentViewActions = orderedCurrentViewActions.filter((action) => action.count > 0);
  const dominantCurrentViewActionSelection = orderedCurrentViewActions[0];
  const runnerUpCurrentViewActionSelection = orderedCurrentViewActions.find(
    (action) => action.key !== dominantCurrentViewActionSelection.key && action.count > 0
  );
  const actionHrefByKey: Record<DominantActionKey, string> = {
    createPacket: buildRtpRegistryHref({
      status: filters.status ?? null,
      packet: "missing",
      recent: recentOnly,
      queueAction: selectedQueueActionFilter,
      queueTraceState: selectedQueueTraceStateFilter,
    }),
    resetAndRegenerate: buildRtpRegistryHref({
      status: filters.status ?? null,
      packet: "reset",
      recent: recentOnly,
      queueAction: selectedQueueActionFilter,
      queueTraceState: selectedQueueTraceStateFilter,
    }),
    generateFirstArtifact: buildRtpRegistryHref({
      status: filters.status ?? null,
      packet: "generate",
      recent: recentOnly,
      queueAction: selectedQueueActionFilter,
      queueTraceState: selectedQueueTraceStateFilter,
    }),
    refreshArtifact: buildRtpRegistryHref({
      status: filters.status ?? null,
      packet: "refresh",
      recent: recentOnly,
      queueAction: selectedQueueActionFilter,
      queueTraceState: selectedQueueTraceStateFilter,
    }),
    releaseReview: buildRtpRegistryHref({
      status: filters.status ?? null,
      packet: "current",
      recent: recentOnly,
      queueAction: selectedQueueActionFilter,
      queueTraceState: "aligned",
    }),
    traceFollowUp: buildRtpRegistryHref({
      status: filters.status ?? null,
      packet: "current",
      recent: recentOnly,
      queueAction: selectedQueueActionFilter,
      queueTraceState: selectedQueueTraceStateFilter === "all" ? "outpaced" : selectedQueueTraceStateFilter,
    }),
  };
  const dominantActionCycles = typedCycles.filter((cycle) => {
    switch (dominantCurrentViewActionSelection.key) {
      case "createPacket":
        return cycle.packetAttention === "missing";
      case "resetAndRegenerate":
        return cycle.packetAttention === "reset";
      case "generateFirstArtifact":
        return cycle.packetAttention === "generate";
      case "refreshArtifact":
        return cycle.packetAttention === "refresh";
      case "releaseReview":
        return cycle.packetAttention === "current" && cycle.packetQueueTraceState.state === "aligned";
      case "traceFollowUp":
        return cycle.packetAttention === "current" && cycle.packetQueueTraceState.state !== "aligned";
      default:
        return false;
    }
  });
  const dominantActionHref = actionHrefByKey[dominantCurrentViewActionSelection.key];
  const dominantActionCycleIds = dominantActionCycles.map((cycle) => cycle.id);
  const dominantActionReportIds = dominantActionCycles
    .map((cycle) => cycle.packetReport?.id ?? null)
    .filter((value): value is string => Boolean(value));
  const currentFundingReviewCount = typedCycles.filter(
    (cycle) => cycle.packetAttention === "current" && cycle.packetFundingReview.needsAttention
  ).length;
  const currentFundingGapReviewCount = typedCycles.filter(
    (cycle) => cycle.packetAttention === "current" && cycle.packetFundingReview.label === "Funding gap review"
  ).length;
  const currentReimbursementFollowThroughCount = typedCycles.filter(
    (cycle) =>
      cycle.packetAttention === "current" &&
      (cycle.uninvoicedAwardAmount > 0 || cycle.outstandingReimbursementAmount > 0 || cycle.reimbursementInFlightCount > 0)
  ).length;
  const dominantTraceFollowUpCounts = {
    outpaced: dominantActionCycles.filter((cycle) => cycle.packetQueueTraceState.state === "outpaced").length,
    unrecorded: dominantActionCycles.filter((cycle) => cycle.packetQueueTraceState.state === "unrecorded").length,
    aligned: dominantActionCycles.filter((cycle) => cycle.packetQueueTraceState.state === "aligned").length,
  };
  const totalActionableCurrentViewCount = orderedCurrentViewActions.reduce((sum, action) => sum + action.count, 0);
  const dominantActionImpactPercent =
    totalActionableCurrentViewCount > 0
      ? Math.round((dominantCurrentViewActionSelection.count / totalActionableCurrentViewCount) * 100)
      : 0;
  const remainingActionableAfterDominantCount = Math.max(
    totalActionableCurrentViewCount - dominantCurrentViewActionSelection.count,
    0
  );
  const runnerUpActionHref = runnerUpCurrentViewActionSelection ? actionHrefByKey[runnerUpCurrentViewActionSelection.key] : null;

  return (
    <section className="module-page">
      <RtpRegistryOverview
        cycleCount={typedCycles.length}
        draftCount={draftCount}
        publicReviewCount={publicReviewCount}
        adoptedCount={adoptedCount}
        readyFoundationCount={readyFoundationCount}
        linkedProjectCount={linkedProjectCount}
        fundedProjectCount={fundedProjectCount}
        likelyCoveredProjectCount={likelyCoveredProjectCount}
        unfundedProjectCount={unfundedProjectCount}
        paidReimbursementTotal={paidReimbursementTotal}
        outstandingReimbursementTotal={outstandingReimbursementTotal}
        uninvoicedAwardTotal={uninvoicedAwardTotal}
      />

      <div className="module-grid-layout mt-6 gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(24rem,0.9fr)]">
        <RtpCycleRegistryTable
          typedCycles={typedCycles}
          allCyclesCount={allCycles.length}
          recentQueueCyclesCount={allCycles.filter((cycle) => cycle.packetQueueTrace.isRecent).length}
          filtersStatus={filters.status ?? null}
          selectedPacketFilter={selectedPacketFilter}
          recentOnly={recentOnly}
          selectedQueueActionFilter={selectedQueueActionFilter}
          selectedQueueTraceStateFilter={selectedQueueTraceStateFilter}
          packetAttentionCounts={packetAttentionCounts}
          queueActionScopedCyclesCount={queueActionScopedCycles.length}
          queueActionCounts={queueActionCounts}
          queueTraceStateScopedCyclesCount={queueTraceStateScopedCycles.length}
          queueTraceStateCounts={queueTraceStateCounts}
          currentFundingReviewCount={currentFundingReviewCount}
          currentFundingGapReviewCount={currentFundingGapReviewCount}
          currentReimbursementFollowThroughCount={currentReimbursementFollowThroughCount}
        />

        <aside className="space-y-4">
          <RtpRegistryAdvisoryPanel
            typedCyclesLength={typedCycles.length}
            dominantCurrentViewActionSelection={dominantCurrentViewActionSelection}
            rankedCurrentViewActions={rankedCurrentViewActions}
            actionHrefByKey={actionHrefByKey}
            totalActionableCurrentViewCount={totalActionableCurrentViewCount}
            dominantActionImpactPercent={dominantActionImpactPercent}
            remainingActionableAfterDominantCount={remainingActionableAfterDominantCount}
            runnerUpCurrentViewActionSelection={runnerUpCurrentViewActionSelection}
            runnerUpActionHref={runnerUpActionHref}
            dominantActionHref={dominantActionHref}
            dominantActionCycleIds={dominantActionCycleIds}
            dominantActionReportIds={dominantActionReportIds}
            dominantActionCycles={dominantActionCycles}
            dominantTraceFollowUpCounts={dominantTraceFollowUpCounts}
            currentViewActionCounts={currentViewActionCounts}
            unrecordedQueueCycles={unrecordedQueueCycles}
            unrecordedQueueMix={unrecordedQueueMix}
            outpacedQueueCycles={outpacedQueueCycles}
            outpacedQueueMix={outpacedQueueMix}
            recentQueueActivityCount={recentQueueActivityCount}
            recentQueueActionBreakdown={recentQueueActionBreakdown}
            outpacedQueueTraceCount={outpacedQueueTraceCount}
            latestQueueActionAt={latestQueueActionAt}
            filtersStatus={filters.status ?? null}
            selectedPacketFilter={selectedPacketFilter}
            recentOnly={recentOnly}
            selectedQueueActionFilter={selectedQueueActionFilter}
            selectedQueueTraceStateFilter={selectedQueueTraceStateFilter}
            modelingCountyRunId={defaultModelingCountyRunId}
          />

          <RtpQueueOperationsBoard
            packetAttentionCounts={packetAttentionCounts}
            resetCycleIds={allCycles.filter((cycle) => cycle.packetAttention === "reset").map((cycle) => cycle.id)}
            missingCycleIds={allCycles.filter((cycle) => cycle.packetAttention === "missing").map((cycle) => cycle.id)}
            generateFirstReportIds={[
              ...new Set(
                allCycles
                  .filter((cycle) => cycle.packetAttention === "generate")
                  .map((cycle) => cycle.packetReport?.id)
                  .filter((reportId): reportId is string => Boolean(reportId))
              ),
            ]}
            refreshReportIds={[
              ...new Set(
                allCycles
                  .filter(
                    (cycle) =>
                      cycle.packetAttention === "reset" ||
                      cycle.packetAttention === "refresh"
                  )
                  .map((cycle) => cycle.packetReport?.id)
                  .filter((reportId): reportId is string => Boolean(reportId))
              ),
            ]}
            generateReportIds={allCycles
              .filter((cycle) => cycle.packetAttention === "generate")
              .map((cycle) => cycle.packetReport?.id)
              .filter((reportId): reportId is string => Boolean(reportId))}
            refreshOnlyReportIds={allCycles
              .filter((cycle) => cycle.packetAttention === "refresh")
              .map((cycle) => cycle.packetReport?.id)
              .filter((reportId): reportId is string => Boolean(reportId))}
            modelingCountyRunId={defaultModelingCountyRunId}
          />
        </aside>
      </div>
    </section>
  );
}
