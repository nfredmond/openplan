import { notFound, redirect } from "next/navigation";
import { RtpReportDetail } from "@/components/reports/rtp-report-detail";
import { summarizeEngagementItems } from "@/lib/engagement/summary";
import {
  loadWorkspaceOperationsSummaryForWorkspace,
  type WorkspaceOperationsSupabaseLike,
} from "@/lib/operations/workspace-summary";
import {
  buildPortfolioFundingSnapshot,
  buildProjectFundingSnapshot,
} from "@/lib/projects/funding";
import {
  buildRtpCycleReadiness,
  buildRtpCycleWorkflowSummary,
  buildRtpPublicReviewSummary,
} from "@/lib/rtp/catalog";
import { createClient } from "@/lib/supabase/server";
import {
  describeComparisonSnapshotAggregate,
  describeEvidenceChainSummary,
  describeFundingSnapshot,
  getRtpPacketPresetAlignment,
  parseStoredComparisonSnapshotAggregate,
  parseStoredEvidenceChainSummary,
  parseStoredFundingSnapshot,
  parseStoredScenarioSpineSummary,
  titleize,
} from "@/lib/reports/catalog";
import { PACKET_FRESHNESS_LABELS } from "@/lib/reports/packet-labels";
import { buildEvidenceChainSummary } from "@/lib/reports/evidence-chain";
import { extractEngagementCampaignId } from "@/lib/reports/engagement";
import { looksLikePendingScenarioSpineSchema } from "@/lib/scenarios/api";
import {
  buildProjectStageGateSummary,
  type ProjectStageGateSummary,
} from "@/lib/stage-gates/summary";
import {
  asEngagementCampaignSnapshot,
  asHtmlContent,
  asNullableNumber,
  asNullableString,
  asPortfolioFundingSnapshot,
  asProjectRecordSnapshotEntry,
  asRecord,
  asRunAudit,
  asScenarioSetLinks,
  asSourceContext,
  asStageGateSnapshot,
  buildCurrentProjectRecordEntry,
  formatCompactDateTime,
  formatCurrency,
  maxTimestamp,
  summarizeProjectRecordDrift,
} from "./_components/_helpers";
import type {
  CurrentProjectRecordEntry,
  DriftItem,
  DriftStatus,
  EngagementCampaignLinkRow,
  EngagementCategoryRow,
  EngagementItemRow,
  LinkedRunRow,
  ProjectRecordSnapshotEntry,
  ProjectRecordSnapshotKey,
  ReportArtifact,
  ScenarioSpineRow,
  StageGateDecisionRow,
} from "./_components/_types";
import { ReportStandardDetail } from "./_components/report-standard-detail";

type RouteParams = {
  params: Promise<{ reportId: string }>;
};

export default async function ReportDetailPage({ params }: RouteParams) {
  const { reportId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/sign-in");
  }

  const { data: report } = await supabase
    .from("reports")
    .select(
      "id, workspace_id, project_id, rtp_cycle_id, title, report_type, status, summary, generated_at, latest_artifact_url, latest_artifact_kind, created_at, updated_at, rtp_basis_stale, rtp_basis_stale_reason, rtp_basis_stale_run_id, rtp_basis_stale_marked_at"
    )
    .eq("id", reportId)
    .maybeSingle();

  if (!report) {
    notFound();
  }

  const [
    { data: project },
    { data: rtpCycle },
    { data: workspace },
    { data: sections },
    { data: reportRunLinks },
    { data: artifacts },
    { data: rtpChapters },
    { data: rtpProjectLinks },
    { data: rtpCampaigns },
    operationsSummary,
  ] = await Promise.all([
    supabase
      .from("projects")
        .select(
          "id, workspace_id, name, summary, status, plan_type, delivery_phase, updated_at"
        )
        .eq("id", report.project_id)
        .maybeSingle(),
    report.rtp_cycle_id
      ? supabase
          .from("rtp_cycles")
          .select(
            "id, title, status, summary, geography_label, horizon_start_year, horizon_end_year, adoption_target_date, public_review_open_at, public_review_close_at, updated_at"
          )
          .eq("id", report.rtp_cycle_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from("workspaces")
      .select("id, name, plan, slug")
      .eq("id", report.workspace_id)
      .maybeSingle(),
    supabase
      .from("report_sections")
      .select("id, section_key, title, enabled, sort_order, config_json")
      .eq("report_id", report.id)
      .order("sort_order", { ascending: true }),
    supabase
      .from("report_runs")
      .select("id, run_id, sort_order")
      .eq("report_id", report.id)
      .order("sort_order", { ascending: true }),
    supabase
      .from("report_artifacts")
      .select("id, artifact_kind, generated_at, metadata_json")
      .eq("report_id", report.id)
      .order("generated_at", { ascending: false }),
    report.rtp_cycle_id
      ? supabase
          .from("rtp_cycle_chapters")
          .select("id, status")
          .eq("rtp_cycle_id", report.rtp_cycle_id)
      : Promise.resolve({ data: [] }),
    report.rtp_cycle_id
      ? supabase
          .from("project_rtp_cycle_links")
          .select("id, project_id")
          .eq("rtp_cycle_id", report.rtp_cycle_id)
      : Promise.resolve({ data: [] }),
    report.rtp_cycle_id
      ? supabase
          .from("engagement_campaigns")
          .select("id, rtp_cycle_chapter_id")
          .eq("workspace_id", report.workspace_id)
          .eq("rtp_cycle_id", report.rtp_cycle_id)
      : Promise.resolve({ data: [] }),
    loadWorkspaceOperationsSummaryForWorkspace(
      supabase as unknown as WorkspaceOperationsSupabaseLike,
      report.workspace_id
    ),
  ]);

  const [fundingProfileResult, fundingAwardsResult, fundingOpportunitiesResult, billingInvoicesResult] =
    report.project_id
      ? await Promise.all([
          supabase
            .from("project_funding_profiles")
            .select("id, funding_need_amount, local_match_need_amount, notes, updated_at")
            .eq("project_id", report.project_id)
            .maybeSingle(),
          supabase
            .from("funding_awards")
            .select("id, awarded_amount, match_amount, risk_flag, obligation_due_at, updated_at, created_at")
            .eq("project_id", report.project_id)
            .order("updated_at", { ascending: false }),
          supabase
            .from("funding_opportunities")
            .select("id, expected_award_amount, decision_state, opportunity_status, closes_at, updated_at, created_at")
            .eq("project_id", report.project_id)
            .order("updated_at", { ascending: false }),
          supabase
            .from("billing_invoice_records")
            .select("id, funding_award_id, status, amount, retention_percent, retention_amount, net_amount, due_date, invoice_date, created_at")
            .eq("project_id", report.project_id)
            .order("created_at", { ascending: false }),
        ])
      : [
          { data: null, error: null },
          { data: [], error: null },
          { data: [], error: null },
          { data: [], error: null },
        ];

  const rtpLinkedProjectIds = report.rtp_cycle_id
    ? ((rtpProjectLinks ?? []) as Array<{ project_id: string | null }>).map((link) => link.project_id).filter((value): value is string => Boolean(value))
    : [];

  const [rtpFundingProfilesResult, rtpFundingAwardsResult, rtpFundingOpportunitiesResult, rtpBillingInvoicesResult] =
    report.rtp_cycle_id && rtpLinkedProjectIds.length > 0
      ? await Promise.all([
          supabase
            .from("project_funding_profiles")
            .select("project_id, funding_need_amount, local_match_need_amount, updated_at")
            .in("project_id", rtpLinkedProjectIds),
          supabase
            .from("funding_awards")
            .select("project_id, awarded_amount, match_amount, risk_flag, obligation_due_at, updated_at, created_at")
            .in("project_id", rtpLinkedProjectIds),
          supabase
            .from("funding_opportunities")
            .select("project_id, expected_award_amount, decision_state, opportunity_status, closes_at, updated_at, created_at")
            .in("project_id", rtpLinkedProjectIds),
          supabase
            .from("billing_invoice_records")
            .select("project_id, status, amount, retention_percent, retention_amount, net_amount, due_date, invoice_date, created_at")
            .in("project_id", rtpLinkedProjectIds),
        ])
      : [
          { data: [], error: null },
          { data: [], error: null },
          { data: [], error: null },
          { data: [], error: null },
        ];

  const runIds = (reportRunLinks ?? []).map((item) => item.run_id);
  const runsResult = runIds.length
    ? await supabase
        .from("runs")
        .select("id, title, summary_text, created_at")
        .in("id", runIds)
    : { data: [], error: null };

  const sectionList = sections ?? [];
  const engagementCampaignId = extractEngagementCampaignId(sectionList);
  const engagementCampaignResult = engagementCampaignId
    ? await supabase
        .from("engagement_campaigns")
        .select(
          "id, title, summary, public_description, status, engagement_type, share_token, allow_public_submissions, submissions_closed_at, updated_at"
        )
        .eq("workspace_id", report.workspace_id)
        .eq("id", engagementCampaignId)
        .maybeSingle()
    : { data: null, error: null };

  const runMap = new Map(
    (runsResult.data ?? []).map((run) => [run.id, run])
  );
  const runs = (reportRunLinks ?? [])
    .map((link) => runMap.get(link.run_id) ?? null)
    .filter((item): item is LinkedRunRow => Boolean(item));

  const latestArtifact = ((artifacts ?? []) as ReportArtifact[])[0] ?? null;
  const latestHtml = asHtmlContent(latestArtifact?.metadata_json);
  const runAudit = asRunAudit(latestArtifact?.metadata_json);
  const sourceContext = asSourceContext(latestArtifact?.metadata_json);
  const storedEvidenceChainSummary = parseStoredEvidenceChainSummary(
    latestArtifact?.metadata_json ?? null
  );
  const storedScenarioSpineSummary = parseStoredScenarioSpineSummary(
    latestArtifact?.metadata_json ?? null
  );
  const storedFundingSnapshot = parseStoredFundingSnapshot(
    latestArtifact?.metadata_json ?? null
  );
  const currentReportComparisonAggregate = parseStoredComparisonSnapshotAggregate(
    latestArtifact?.metadata_json ?? null
  );
  const currentReportComparisonDigest = describeComparisonSnapshotAggregate(
    currentReportComparisonAggregate
  );
  const liveFundingSnapshot = project
    ? buildProjectFundingSnapshot({
        profile: fundingProfileResult.data,
        awards: fundingAwardsResult.data ?? [],
        opportunities: fundingOpportunitiesResult.data ?? [],
        invoices: billingInvoicesResult.data ?? [],
        capturedAt: latestArtifact?.generated_at ?? null,
        projectUpdatedAt: project.updated_at,
      })
    : null;
  const engagementCampaign =
    (engagementCampaignResult.data as EngagementCampaignLinkRow | null) ?? null;
  const engagementPublicHref =
    engagementCampaign?.share_token && engagementCampaign.status === "active"
      ? `/engage/${engagementCampaign.share_token}`
      : null;
  const engagementSummaryText =
    engagementCampaign?.public_description ||
    engagementCampaign?.summary ||
    null;
  const reportOrigin = asNullableString(sourceContext?.reportOrigin);
  const reportReason = asNullableString(sourceContext?.reportReason);
  const engagementCountsSnapshot = asRecord(sourceContext?.engagementCountsSnapshot);
  const engagementSnapshotCapturedAt = asNullableString(
    sourceContext?.engagementSnapshotCapturedAt
  );
  const engagementSnapshotTotalItems = asNullableNumber(
    engagementCountsSnapshot?.totalItems
  );
  const engagementSnapshotReadyForHandoff = asNullableNumber(
    engagementCountsSnapshot?.readyForHandoffCount
  );
  const engagementCampaignSnapshot = asEngagementCampaignSnapshot(
    sourceContext?.engagementCampaignSnapshot
  );
  const stageGateSnapshot = asStageGateSnapshot(sourceContext?.stageGateSnapshot);
  const scenarioSetLinks = asScenarioSetLinks(sourceContext?.scenarioSetLinks);
  const fundingSnapshot = storedFundingSnapshot ?? liveFundingSnapshot;
  const fundingSummaryDigest = describeFundingSnapshot(fundingSnapshot);
  const projectRecordsSnapshotSource = asRecord(sourceContext?.projectRecordsSnapshot);
  const projectRecordsSnapshot = [
    {
      key: "deliverables",
      label: "Deliverables",
      anchor: "project-deliverables",
      value: asProjectRecordSnapshotEntry(projectRecordsSnapshotSource?.deliverables),
    },
    {
      key: "risks",
      label: "Risks",
      anchor: "project-risks",
      value: asProjectRecordSnapshotEntry(projectRecordsSnapshotSource?.risks),
    },
    {
      key: "issues",
      label: "Issues",
      anchor: "project-issues",
      value: asProjectRecordSnapshotEntry(projectRecordsSnapshotSource?.issues),
    },
    {
      key: "decisions",
      label: "Decisions",
      anchor: "project-decisions",
      value: asProjectRecordSnapshotEntry(projectRecordsSnapshotSource?.decisions),
    },
    {
      key: "meetings",
      label: "Meetings",
      anchor: "project-meetings",
      value: asProjectRecordSnapshotEntry(projectRecordsSnapshotSource?.meetings),
    },
  ].filter(
    (
      item
    ): item is {
      key: string;
      label: string;
      anchor: string;
      value: ProjectRecordSnapshotEntry;
    } => Boolean(item.value)
  );
  const artifactList = (artifacts ?? []) as ReportArtifact[];

  if (report.rtp_cycle_id) {
    const enabledSectionKeys = Array.isArray(sourceContext?.enabledSectionKeys)
      ? sourceContext.enabledSectionKeys.filter(
          (item): item is string => typeof item === "string" && item.trim().length > 0
        )
      : [];
    const readinessRecord = asRecord(sourceContext?.readiness);
    const workflowRecord = asRecord(sourceContext?.workflow);
    const publicReviewRecord = asRecord(sourceContext?.publicReviewSummary);
    const presetAlignmentRecord = asRecord(sourceContext?.packetPresetAlignment);
    const currentPacketPresetAlignment = getRtpPacketPresetAlignment({
      cycleStatus: rtpCycle?.status,
      sections: (sections ?? []).map((section) => ({
        sectionKey: section.section_key,
        enabled: section.enabled,
        sortOrder: section.sort_order,
      })),
    });
    const currentRtpReadiness = rtpCycle
      ? buildRtpCycleReadiness({
          geographyLabel: rtpCycle.geography_label,
          horizonStartYear: rtpCycle.horizon_start_year,
          horizonEndYear: rtpCycle.horizon_end_year,
          adoptionTargetDate: (rtpCycle as Record<string, unknown>).adoption_target_date as string | null | undefined,
          publicReviewOpenAt: (rtpCycle as Record<string, unknown>).public_review_open_at as string | null | undefined,
          publicReviewCloseAt: (rtpCycle as Record<string, unknown>).public_review_close_at as string | null | undefined,
        })
      : null;
    const currentRtpWorkflow = currentRtpReadiness
      ? buildRtpCycleWorkflowSummary({ status: rtpCycle?.status, readiness: currentRtpReadiness })
      : null;
    const storedRtpFundingSnapshot = asPortfolioFundingSnapshot(sourceContext?.rtpFundingSnapshot);
    const rtpFundingProfileByProjectId = new Map(
      ((rtpFundingProfilesResult.data ?? []) as Array<{ project_id: string; funding_need_amount: number | null; local_match_need_amount: number | null; updated_at: string | null }>).map((profile) => [profile.project_id, profile])
    );
    const rtpFundingAwardsByProjectId = new Map<string, Array<{ awarded_amount: number | string | null; match_amount: number | string | null; risk_flag: string | null; obligation_due_at: string | null; updated_at: string | null; created_at: string | null }>>();
    const rtpFundingOpportunitiesByProjectId = new Map<string, Array<{ expected_award_amount: number | string | null; decision_state: string | null; opportunity_status: string | null; closes_at: string | null; updated_at: string | null; created_at: string | null }>>();
    const rtpFundingInvoicesByProjectId = new Map<string, Array<{ status: string | null; amount: number | string | null; retention_percent: number | string | null; retention_amount: number | string | null; net_amount: number | string | null; due_date: string | null; invoice_date: string | null; created_at: string | null }>>();
    for (const award of (rtpFundingAwardsResult.data ?? []) as Array<{ project_id: string; awarded_amount: number | string | null; match_amount: number | string | null; risk_flag: string | null; obligation_due_at: string | null; updated_at: string | null; created_at: string | null }>) {
      const current = rtpFundingAwardsByProjectId.get(award.project_id) ?? [];
      current.push(award);
      rtpFundingAwardsByProjectId.set(award.project_id, current);
    }
    for (const opportunity of (rtpFundingOpportunitiesResult.data ?? []) as Array<{ project_id: string; expected_award_amount: number | string | null; decision_state: string | null; opportunity_status: string | null; closes_at: string | null; updated_at: string | null; created_at: string | null }>) {
      const current = rtpFundingOpportunitiesByProjectId.get(opportunity.project_id) ?? [];
      current.push(opportunity);
      rtpFundingOpportunitiesByProjectId.set(opportunity.project_id, current);
    }
    for (const invoice of (rtpBillingInvoicesResult.data ?? []) as Array<{ project_id: string; status: string | null; amount: number | string | null; retention_percent: number | string | null; retention_amount: number | string | null; net_amount: number | string | null; due_date: string | null; invoice_date: string | null; created_at: string | null }>) {
      const current = rtpFundingInvoicesByProjectId.get(invoice.project_id) ?? [];
      current.push(invoice);
      rtpFundingInvoicesByProjectId.set(invoice.project_id, current);
    }
    const currentRtpFundingSnapshot = buildPortfolioFundingSnapshot({
      projects: rtpLinkedProjectIds.map((projectId) => ({
        profile: rtpFundingProfileByProjectId.get(projectId) ?? null,
        awards: rtpFundingAwardsByProjectId.get(projectId) ?? [],
        opportunities: rtpFundingOpportunitiesByProjectId.get(projectId) ?? [],
        invoices: rtpFundingInvoicesByProjectId.get(projectId) ?? [],
      })),
      capturedAt: latestArtifact?.generated_at ?? null,
    });
    const rtpComparisonDigest = describeComparisonSnapshotAggregate(
      parseStoredComparisonSnapshotAggregate(latestArtifact?.metadata_json ?? null)
    );
    const currentRtpChapterRows = (rtpChapters ?? []) as Array<{ id: string; status: string | null }>;
    const currentRtpProjectLinks = (rtpProjectLinks ?? []) as Array<{ id: string }>;
    const currentRtpCampaigns = (rtpCampaigns ?? []) as Array<{ id: string; rtp_cycle_chapter_id: string | null }>;
    const currentRtpCampaignIds = currentRtpCampaigns.map((campaign) => campaign.id);
    const rtpEngagementItemsResult = currentRtpCampaignIds.length
      ? await supabase
          .from("engagement_items")
          .select(
            "id, campaign_id, category_id, status, source_type, latitude, longitude, moderation_notes, created_at, updated_at"
          )
          .in("campaign_id", currentRtpCampaignIds)
      : { data: [], error: null };
    const currentRtpEngagementCounts = summarizeEngagementItems(
      [],
      (rtpEngagementItemsResult.data ?? []) as Array<{
        id: string;
        campaign_id: string;
        category_id: string | null;
        status: string | null;
        source_type: string | null;
        latitude: number | null;
        longitude: number | null;
        moderation_notes: string | null;
        created_at: string | null;
        updated_at: string | null;
      }>
    );
    const cycleLevelCampaignCount = currentRtpCampaigns.filter((campaign) => !campaign.rtp_cycle_chapter_id).length;
    const chapterLevelCampaignCount = currentRtpCampaigns.length - cycleLevelCampaignCount;
    const currentRtpPublicReview = rtpCycle
      ? buildRtpPublicReviewSummary({
          status: rtpCycle.status,
          publicReviewOpenAt: (rtpCycle as Record<string, unknown>).public_review_open_at as string | null | undefined,
          publicReviewCloseAt: (rtpCycle as Record<string, unknown>).public_review_close_at as string | null | undefined,
          cycleLevelCampaignCount,
          chapterCampaignCount: chapterLevelCampaignCount,
          packetRecordCount: 1,
          generatedPacketCount: latestArtifact ? 1 : 0,
          pendingCommentCount: currentRtpEngagementCounts.moderationQueue.pendingCount,
          approvedCommentCount: currentRtpEngagementCounts.moderationQueue.approvedCount,
          readyCommentCount: currentRtpEngagementCounts.moderationQueue.readyForHandoffCount,
        })
      : null;
    return (
      <RtpReportDetail
        report={report}
        workspace={workspace}
        cycle={rtpCycle}
        sections={(sections ?? []).map((section) => ({
          id: section.id,
          section_key: section.section_key,
          title: section.title,
          enabled: section.enabled,
          sort_order: section.sort_order,
          config_json: (section.config_json as Record<string, unknown> | null) ?? {},
        }))}
        artifacts={artifactList.map((artifact) => ({
          id: artifact.id,
          artifact_kind: artifact.artifact_kind,
          generated_at: artifact.generated_at,
        }))}
        comparisonDigest={rtpComparisonDigest}
        latestHtml={latestHtml}
        generationContext={{
          generatedAt: latestArtifact?.generated_at ?? null,
          enabledSectionKeys,
          readinessLabel: asNullableString(readinessRecord?.label),
          readinessReason: asNullableString(readinessRecord?.reason),
          workflowLabel: asNullableString(workflowRecord?.label),
          workflowDetail: asNullableString(workflowRecord?.detail),
          chapterCount: asNullableNumber(sourceContext?.chapterCount),
          chapterCompleteCount: asNullableNumber(sourceContext?.chapterCompleteCount),
          chapterReadyForReviewCount: asNullableNumber(sourceContext?.chapterReadyForReviewCount),
          linkedProjectCount: asNullableNumber(sourceContext?.linkedProjectCount),
          engagementCampaignCount: asNullableNumber(sourceContext?.engagementCampaignCount),
          presetStage: asNullableString(presetAlignmentRecord?.presetStage),
          presetLabel: asNullableString(presetAlignmentRecord?.presetLabel),
          presetStatusLabel: asNullableString(presetAlignmentRecord?.statusLabel),
          presetDetail: asNullableString(presetAlignmentRecord?.detail),
          fundingSnapshot: storedRtpFundingSnapshot,
          publicReviewLabel: asNullableString(publicReviewRecord?.label),
          publicReviewDetail: asNullableString(publicReviewRecord?.detail),
          publicReviewTone: (asNullableString(publicReviewRecord?.tone) as "success" | "warning" | "neutral" | "info" | null) ?? null,
          cycleLevelCampaignCount: asNullableNumber(sourceContext?.cycleLevelCampaignCount),
          chapterLevelCampaignCount: asNullableNumber(sourceContext?.chapterLevelCampaignCount),
          pendingCommentCount: asNullableNumber(sourceContext?.engagementPendingCommentCount),
          approvedCommentCount: asNullableNumber(sourceContext?.engagementApprovedCommentCount),
          readyCommentCount: asNullableNumber(sourceContext?.engagementReadyCommentCount),
        }}
        currentContext={{
          enabledSectionKeys: (sections ?? [])
            .filter((section) => section.enabled)
            .map((section) => section.section_key),
          readinessLabel: currentRtpReadiness?.label ?? null,
          readinessReason: currentRtpReadiness?.reason ?? null,
          workflowLabel: currentRtpWorkflow?.label ?? null,
          workflowDetail: currentRtpWorkflow?.detail ?? null,
          chapterCount: currentRtpChapterRows.length,
          chapterCompleteCount: currentRtpChapterRows.filter((chapter) => chapter.status === "complete").length,
          chapterReadyForReviewCount: currentRtpChapterRows.filter((chapter) => chapter.status === "ready_for_review").length,
          linkedProjectCount: currentRtpProjectLinks.length,
          engagementCampaignCount: currentRtpCampaigns.length,
          cycleUpdatedAt: rtpCycle?.updated_at ?? null,
          presetStage: currentPacketPresetAlignment.presetStage,
          presetLabel: currentPacketPresetAlignment.presetLabel,
          presetStatusLabel: currentPacketPresetAlignment.statusLabel,
          presetDetail: currentPacketPresetAlignment.detail,
          fundingSnapshot: currentRtpFundingSnapshot,
          publicReviewLabel: currentRtpPublicReview?.label ?? null,
          publicReviewDetail: currentRtpPublicReview?.detail ?? null,
          publicReviewTone: currentRtpPublicReview?.tone ?? null,
          cycleLevelCampaignCount,
          chapterLevelCampaignCount,
          pendingCommentCount: currentRtpEngagementCounts.moderationQueue.pendingCount,
          approvedCommentCount: currentRtpEngagementCounts.moderationQueue.approvedCount,
          readyCommentCount: currentRtpEngagementCounts.moderationQueue.readyForHandoffCount,
        }}
        operationsSummary={operationsSummary}
      />
    );
  }

  const enabledSections = sectionList.filter((s) => s.enabled).length;
  const runTitleById = new Map(runs.map((run) => [run.id, run.title]));
  const liveScenarioSetIds = scenarioSetLinks.map((item) => item.scenarioSetId);
  const liveEvidenceChainSummary = buildEvidenceChainSummary({
    linkedRunCount: runs.length,
    scenarioSetLinks,
    projectRecordsSnapshot: {
      deliverables:
        asProjectRecordSnapshotEntry(projectRecordsSnapshotSource?.deliverables) ?? {
          count: 0,
          latestTitle: null,
          latestAt: null,
        },
      risks: asProjectRecordSnapshotEntry(projectRecordsSnapshotSource?.risks) ?? {
        count: 0,
        latestTitle: null,
        latestAt: null,
      },
      issues: asProjectRecordSnapshotEntry(projectRecordsSnapshotSource?.issues) ?? {
        count: 0,
        latestTitle: null,
        latestAt: null,
      },
      decisions:
        asProjectRecordSnapshotEntry(projectRecordsSnapshotSource?.decisions) ?? {
          count: 0,
          latestTitle: null,
          latestAt: null,
        },
      meetings: asProjectRecordSnapshotEntry(projectRecordsSnapshotSource?.meetings) ?? {
        count: 0,
        latestTitle: null,
        latestAt: null,
      },
    },
    engagementCampaignCurrent: engagementCampaign
      ? {
          status: engagementCampaign.status,
        }
      : null,
    engagementItemCount: asNullableNumber(sourceContext?.engagementItemCount) ?? 0,
    engagementReadyForHandoffCount:
      asNullableNumber(sourceContext?.engagementReadyForHandoffCount) ?? 0,
    stageGateSnapshot:
      stageGateSnapshot ?? {
        templateId: "unknown",
        templateVersion: "unknown",
        passCount: 0,
        holdCount: 0,
        notStartedCount: 0,
        blockedGate: null,
        nextGate: null,
        controlHealth: {
          totalOperatorControlEvidenceCount: 0,
          gatesWithOperatorControlsCount: 0,
        },
      },
  });

  const [
    engagementCategoriesResult,
    engagementItemsResult,
    scenarioSetsResult,
    scenarioAssumptionSetsResult,
    scenarioDataPackagesResult,
    scenarioIndicatorSnapshotsResult,
    scenarioComparisonSnapshotsResult,
    stageGateDecisionsResult,
    deliverablesResult,
    risksResult,
    issuesResult,
    decisionsResult,
    meetingsResult,
  ] = await Promise.all([
    engagementCampaign
      ? supabase
          .from("engagement_categories")
          .select("id, label, slug, description, sort_order, created_at, updated_at")
          .eq("campaign_id", engagementCampaign.id)
          .order("sort_order", { ascending: true })
          .order("created_at", { ascending: true })
      : Promise.resolve({ data: [], error: null }),
    engagementCampaign
      ? supabase
          .from("engagement_items")
          .select(
            "id, campaign_id, category_id, status, source_type, latitude, longitude, moderation_notes, created_at, updated_at"
          )
          .eq("campaign_id", engagementCampaign.id)
          .order("updated_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    liveScenarioSetIds.length > 0
      ? supabase
          .from("scenario_sets")
          .select("id, updated_at")
          .in("id", liveScenarioSetIds)
      : Promise.resolve({ data: [], error: null }),
    liveScenarioSetIds.length > 0
      ? supabase
          .from("scenario_assumption_sets")
          .select("scenario_set_id, updated_at")
          .in("scenario_set_id", liveScenarioSetIds)
      : Promise.resolve({ data: [], error: null }),
    liveScenarioSetIds.length > 0
      ? supabase
          .from("scenario_data_packages")
          .select("scenario_set_id, updated_at")
          .in("scenario_set_id", liveScenarioSetIds)
      : Promise.resolve({ data: [], error: null }),
    liveScenarioSetIds.length > 0
      ? supabase
          .from("scenario_indicator_snapshots")
          .select("scenario_set_id, snapshot_at")
          .in("scenario_set_id", liveScenarioSetIds)
      : Promise.resolve({ data: [], error: null }),
    liveScenarioSetIds.length > 0
      ? supabase
          .from("scenario_comparison_snapshots")
          .select("scenario_set_id, updated_at")
          .in("scenario_set_id", liveScenarioSetIds)
      : Promise.resolve({ data: [], error: null }),
    stageGateSnapshot
      ? supabase
          .from("stage_gate_decisions")
          .select("gate_id, decision, rationale, decided_at, missing_artifacts")
          .eq("workspace_id", report.workspace_id)
          .order("decided_at", { ascending: false })
          .limit(200)
      : Promise.resolve({ data: [], error: null }),
    projectRecordsSnapshot.some((item) => item.key === "deliverables")
      ? supabase
          .from("project_deliverables")
          .select("id, title, due_date, created_at")
          .eq("project_id", report.project_id)
          .order("updated_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    projectRecordsSnapshot.some((item) => item.key === "risks")
      ? supabase
          .from("project_risks")
          .select("id, title, created_at")
          .eq("project_id", report.project_id)
          .order("updated_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    projectRecordsSnapshot.some((item) => item.key === "issues")
      ? supabase
          .from("project_issues")
          .select("id, title, created_at")
          .eq("project_id", report.project_id)
          .order("updated_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    projectRecordsSnapshot.some((item) => item.key === "decisions")
      ? supabase
          .from("project_decisions")
          .select("id, title, decided_at, created_at")
          .eq("project_id", report.project_id)
          .order("updated_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    projectRecordsSnapshot.some((item) => item.key === "meetings")
      ? supabase
          .from("project_meetings")
          .select("id, title, meeting_at, created_at")
          .eq("project_id", report.project_id)
          .order("updated_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
  ]);

  const liveEngagementCounts = engagementCampaign
    ? summarizeEngagementItems(
        (engagementCategoriesResult.data ?? []) as EngagementCategoryRow[],
        (engagementItemsResult.data ?? []) as EngagementItemRow[]
      )
    : null;
  const liveScenarioSetsById = new Map(
    (((scenarioSetsResult.data ?? []) as Array<{ id: string; updated_at: string | null }>)).map((item) => [
      item.id,
      item.updated_at,
    ])
  );
  const liveScenarioSpinePending = [
    scenarioAssumptionSetsResult.error,
    scenarioDataPackagesResult.error,
    scenarioIndicatorSnapshotsResult.error,
    scenarioComparisonSnapshotsResult.error,
  ].some((error) => looksLikePendingScenarioSpineSchema(error?.message));
  const liveScenarioAssumptionRows = liveScenarioSpinePending
    ? []
    : ((scenarioAssumptionSetsResult.data ?? []) as ScenarioSpineRow[]);
  const liveScenarioDataPackageRows = liveScenarioSpinePending
    ? []
    : ((scenarioDataPackagesResult.data ?? []) as ScenarioSpineRow[]);
  const liveScenarioIndicatorRows = liveScenarioSpinePending
    ? []
    : ((scenarioIndicatorSnapshotsResult.data ?? []) as ScenarioSpineRow[]);
  const liveScenarioComparisonRows = liveScenarioSpinePending
    ? []
    : ((scenarioComparisonSnapshotsResult.data ?? []) as ScenarioSpineRow[]);
  const liveScenarioSpineSummaryById = new Map<string, {
    assumptionSetCount: number;
    dataPackageCount: number;
    indicatorSnapshotCount: number;
    comparisonSnapshotCount: number;
    latestAssumptionSetUpdatedAt: string | null;
    latestDataPackageUpdatedAt: string | null;
    latestIndicatorSnapshotAt: string | null;
    latestComparisonSnapshotUpdatedAt: string | null;
  }>();

  for (const scenarioSetId of liveScenarioSetIds) {
    const assumptionRows = liveScenarioAssumptionRows.filter((row) => row.scenario_set_id === scenarioSetId);
    const dataPackageRows = liveScenarioDataPackageRows.filter((row) => row.scenario_set_id === scenarioSetId);
    const indicatorRows = liveScenarioIndicatorRows.filter((row) => row.scenario_set_id === scenarioSetId);
    const comparisonRows = liveScenarioComparisonRows.filter((row) => row.scenario_set_id === scenarioSetId);

    liveScenarioSpineSummaryById.set(scenarioSetId, {
      assumptionSetCount: assumptionRows.length,
      dataPackageCount: dataPackageRows.length,
      indicatorSnapshotCount: indicatorRows.length,
      comparisonSnapshotCount: comparisonRows.length,
      latestAssumptionSetUpdatedAt: maxTimestamp(...assumptionRows.map((row) => row.updated_at ?? null)),
      latestDataPackageUpdatedAt: maxTimestamp(...dataPackageRows.map((row) => row.updated_at ?? null)),
      latestIndicatorSnapshotAt: maxTimestamp(...indicatorRows.map((row) => row.snapshot_at ?? null)),
      latestComparisonSnapshotUpdatedAt: maxTimestamp(...comparisonRows.map((row) => row.updated_at ?? null)),
    });
  }
  const currentStageGateSummary: ProjectStageGateSummary | null = stageGateSnapshot
    ? buildProjectStageGateSummary(
        (stageGateDecisionsResult.data ?? []) as StageGateDecisionRow[]
      )
    : null;
  const currentProjectRecordsByKey = new Map<ProjectRecordSnapshotKey, CurrentProjectRecordEntry>([
    [
      "deliverables",
      buildCurrentProjectRecordEntry(
        (deliverablesResult.data ?? []) as Array<{
          title: string | null;
          due_date: string | null;
          created_at: string | null;
        }>,
        (item) => item.due_date ?? item.created_at
      ),
    ],
    [
      "risks",
      buildCurrentProjectRecordEntry(
        (risksResult.data ?? []) as Array<{
          title: string | null;
          created_at: string | null;
        }>,
        (item) => item.created_at
      ),
    ],
    [
      "issues",
      buildCurrentProjectRecordEntry(
        (issuesResult.data ?? []) as Array<{
          title: string | null;
          created_at: string | null;
        }>,
        (item) => item.created_at
      ),
    ],
    [
      "decisions",
      buildCurrentProjectRecordEntry(
        (decisionsResult.data ?? []) as Array<{
          title: string | null;
          decided_at: string | null;
          created_at: string | null;
        }>,
        (item) => item.decided_at ?? item.created_at
      ),
    ],
    [
      "meetings",
      buildCurrentProjectRecordEntry(
        (meetingsResult.data ?? []) as Array<{
          title: string | null;
          meeting_at: string | null;
          created_at: string | null;
        }>,
        (item) => item.meeting_at ?? item.created_at
      ),
    ],
  ]);

  const evidenceChainSummary = storedEvidenceChainSummary ?? liveEvidenceChainSummary;
  const evidenceSummaryDigest = describeEvidenceChainSummary(
    sourceContext ? evidenceChainSummary : null
  );
  const driftItems: DriftItem[] = [];

  if (
    engagementCampaign &&
    liveEngagementCounts &&
    (engagementCampaignSnapshot ||
      engagementSnapshotCapturedAt ||
      engagementSnapshotTotalItems !== null ||
      engagementSnapshotReadyForHandoff !== null)
  ) {
    const snapshotStatus = engagementCampaignSnapshot?.status ?? null;
    const snapshotUpdatedAt =
      engagementCampaignSnapshot?.updatedAt ?? engagementSnapshotCapturedAt;
    const liveReadyForHandoff =
      liveEngagementCounts.moderationQueue.readyForHandoffCount;
    const liveTotalItems = liveEngagementCounts.totalItems;

    const status: DriftStatus =
      engagementSnapshotTotalItems !== null &&
      engagementSnapshotReadyForHandoff !== null &&
      (engagementSnapshotTotalItems !== liveTotalItems ||
        engagementSnapshotReadyForHandoff !== liveReadyForHandoff)
        ? "count changed"
        : snapshotStatus !== null && snapshotStatus !== engagementCampaign.status
          ? "updated"
          : snapshotUpdatedAt !== null &&
              snapshotUpdatedAt !== engagementCampaign.updated_at
            ? "updated"
            : "unchanged";

    driftItems.push({
      key: "engagement",
      label: "Engagement handoff",
      status,
      detail:
        `Snapshot ${snapshotStatus ? `${titleize(snapshotStatus)} · ` : ""}${engagementSnapshotReadyForHandoff ?? 0} ready / ${engagementSnapshotTotalItems ?? 0} items · ${formatCompactDateTime(snapshotUpdatedAt)}. ` +
        `Live ${titleize(engagementCampaign.status)} · ${liveReadyForHandoff} ready / ${liveTotalItems} items · ${formatCompactDateTime(engagementCampaign.updated_at)}.`,
    });
  }

  if (scenarioSetLinks.length > 0) {
    const scenarioChanges = scenarioSetLinks
      .map((link) => {
        const snapshotAt = maxTimestamp(
          link.scenarioSetUpdatedAt,
          link.latestMatchedEntryUpdatedAt,
          link.sharedSpine?.latestAssumptionSetUpdatedAt ?? null,
          link.sharedSpine?.latestDataPackageUpdatedAt ?? null,
          link.sharedSpine?.latestIndicatorSnapshotAt ?? null,
          link.sharedSpine?.latestComparisonSnapshotUpdatedAt ?? null
        );
        const currentSetAt = liveScenarioSetsById.get(link.scenarioSetId) ?? null;
        const currentSpine = liveScenarioSpineSummaryById.get(link.scenarioSetId) ?? null;
        const currentAt = maxTimestamp(
          currentSetAt,
          currentSpine?.latestAssumptionSetUpdatedAt ?? null,
          currentSpine?.latestDataPackageUpdatedAt ?? null,
          currentSpine?.latestIndicatorSnapshotAt ?? null,
          currentSpine?.latestComparisonSnapshotUpdatedAt ?? null
        );

        const countChanged = currentSpine
          ? link.sharedSpine
            ? link.sharedSpine.assumptionSetCount !== currentSpine.assumptionSetCount ||
              link.sharedSpine.dataPackageCount !== currentSpine.dataPackageCount ||
              link.sharedSpine.indicatorSnapshotCount !== currentSpine.indicatorSnapshotCount ||
              link.sharedSpine.comparisonSnapshotCount !== currentSpine.comparisonSnapshotCount
            : currentSpine.assumptionSetCount > 0 ||
              currentSpine.dataPackageCount > 0 ||
              currentSpine.indicatorSnapshotCount > 0 ||
              currentSpine.comparisonSnapshotCount > 0
          : false;

        if (!countChanged && (!currentAt || !snapshotAt || currentAt === snapshotAt)) {
          return null;
        }

        if (countChanged && currentSpine) {
          return `${link.scenarioSetTitle}: assumptions ${link.sharedSpine?.assumptionSetCount ?? 0} -> ${currentSpine.assumptionSetCount}, packages ${link.sharedSpine?.dataPackageCount ?? 0} -> ${currentSpine.dataPackageCount}, indicators ${link.sharedSpine?.indicatorSnapshotCount ?? 0} -> ${currentSpine.indicatorSnapshotCount}, comparisons ${link.sharedSpine?.comparisonSnapshotCount ?? 0} -> ${currentSpine.comparisonSnapshotCount}.`;
        }

        return `${link.scenarioSetTitle}: ${formatCompactDateTime(snapshotAt)} -> ${formatCompactDateTime(currentAt)}.`;
      })
      .filter((item): item is string => Boolean(item));

    driftItems.push({
      key: "scenario-basis",
      label: "Scenario basis",
      status: scenarioChanges.length > 0 ? "updated" : "unchanged",
      detail:
        scenarioChanges.length > 0
          ? scenarioChanges.join(" ")
          : "Scenario-set and shared-spine timing still matches the artifact snapshot.",
    });
  }

  if (projectRecordsSnapshot.length > 0) {
    const countChanges: string[] = [];
    const timingChanges: string[] = [];

    for (const item of projectRecordsSnapshot) {
      const currentEntry = currentProjectRecordsByKey.get(
        item.key as ProjectRecordSnapshotKey
      );

      if (!currentEntry) {
        continue;
      }

      if (item.value.count !== currentEntry.count) {
        countChanges.push(
          `${item.label}: ${item.value.count} -> ${currentEntry.count}.`
        );
        continue;
      }

      if (item.value.latestAt !== currentEntry.latestAt) {
        timingChanges.push(
          `${item.label}: ${formatCompactDateTime(item.value.latestAt)} -> ${formatCompactDateTime(currentEntry.latestAt)}.`
        );
      }
    }

    driftItems.push({
      key: "project-records",
      label: "Project records",
      status:
        countChanges.length > 0
          ? "count changed"
          : timingChanges.length > 0
            ? "updated"
            : "unchanged",
      detail: summarizeProjectRecordDrift(
        countChanges.length > 0 ? countChanges : timingChanges
      ),
    });
  }

  if (storedFundingSnapshot && liveFundingSnapshot) {
    const fundingCountChanges: string[] = [];
    const fundingValueChanges: string[] = [];
    const fundingLabelChanges: string[] = [];

    if (storedFundingSnapshot.awardCount !== liveFundingSnapshot.awardCount) {
      fundingCountChanges.push(
        `Awards: ${storedFundingSnapshot.awardCount} -> ${liveFundingSnapshot.awardCount}.`
      );
    }
    if (
      storedFundingSnapshot.pursuedOpportunityCount !==
      liveFundingSnapshot.pursuedOpportunityCount
    ) {
      fundingCountChanges.push(
        `Pursued opportunities: ${storedFundingSnapshot.pursuedOpportunityCount} -> ${liveFundingSnapshot.pursuedOpportunityCount}.`
      );
    }
    if (
      storedFundingSnapshot.reimbursementPacketCount !==
      liveFundingSnapshot.reimbursementPacketCount
    ) {
      fundingCountChanges.push(
        `Reimbursement packets: ${storedFundingSnapshot.reimbursementPacketCount} -> ${liveFundingSnapshot.reimbursementPacketCount}.`
      );
    }

    if (
      storedFundingSnapshot.committedFundingAmount !==
      liveFundingSnapshot.committedFundingAmount
    ) {
      fundingValueChanges.push(
        `Committed awards: ${formatCurrency(storedFundingSnapshot.committedFundingAmount)} -> ${formatCurrency(liveFundingSnapshot.committedFundingAmount)}.`
      );
    }
    if (
      storedFundingSnapshot.unfundedAfterLikelyAmount !==
      liveFundingSnapshot.unfundedAfterLikelyAmount
    ) {
      fundingValueChanges.push(
        `Uncovered after likely dollars: ${formatCurrency(storedFundingSnapshot.unfundedAfterLikelyAmount)} -> ${formatCurrency(liveFundingSnapshot.unfundedAfterLikelyAmount)}.`
      );
    }
    if (
      storedFundingSnapshot.uninvoicedAwardAmount !==
      liveFundingSnapshot.uninvoicedAwardAmount
    ) {
      fundingValueChanges.push(
        `Uninvoiced awards: ${formatCurrency(storedFundingSnapshot.uninvoicedAwardAmount)} -> ${formatCurrency(liveFundingSnapshot.uninvoicedAwardAmount)}.`
      );
    }

    if (storedFundingSnapshot.label !== liveFundingSnapshot.label) {
      fundingLabelChanges.push(
        `Funding posture: ${storedFundingSnapshot.label} -> ${liveFundingSnapshot.label}.`
      );
    }
    if (storedFundingSnapshot.pipelineLabel !== liveFundingSnapshot.pipelineLabel) {
      fundingLabelChanges.push(
        `Pipeline posture: ${storedFundingSnapshot.pipelineLabel} -> ${liveFundingSnapshot.pipelineLabel}.`
      );
    }
    if (
      storedFundingSnapshot.reimbursementLabel !==
      liveFundingSnapshot.reimbursementLabel
    ) {
      fundingLabelChanges.push(
        `Reimbursement posture: ${storedFundingSnapshot.reimbursementLabel} -> ${liveFundingSnapshot.reimbursementLabel}.`
      );
    }

    const fundingTimingChanged =
      storedFundingSnapshot.latestSourceUpdatedAt !== liveFundingSnapshot.latestSourceUpdatedAt;

    driftItems.push({
      key: "funding-posture",
      label: "Funding posture",
      status:
        fundingCountChanges.length > 0
          ? "count changed"
          : fundingValueChanges.length > 0 || fundingLabelChanges.length > 0 || fundingTimingChanged
            ? "updated"
            : "unchanged",
      detail:
        [
          ...fundingCountChanges,
          ...fundingValueChanges,
          ...fundingLabelChanges,
          fundingTimingChanged
            ? `Funding source timing: ${formatCompactDateTime(storedFundingSnapshot.latestSourceUpdatedAt)} -> ${formatCompactDateTime(liveFundingSnapshot.latestSourceUpdatedAt)}.`
            : null,
        ].filter((value): value is string => Boolean(value)).join(" ") ||
        "Funding counts, posture labels, and reimbursement state still match the latest artifact snapshot.",
    });
  }

  if (stageGateSnapshot && currentStageGateSummary) {
    const snapshotBlockedGateId = stageGateSnapshot.blockedGate?.gateId ?? null;
    const currentBlockedGateId = currentStageGateSummary.blockedGate?.gateId ?? null;
    const snapshotNextGateId = stageGateSnapshot.nextGate?.gateId ?? null;
    const currentNextGateId = currentStageGateSummary.nextGate?.gateId ?? null;
    const countsChanged =
      stageGateSnapshot.passCount !== currentStageGateSummary.passCount ||
      stageGateSnapshot.holdCount !== currentStageGateSummary.holdCount ||
      stageGateSnapshot.notStartedCount !== currentStageGateSummary.notStartedCount;
    const gatesChanged =
      snapshotBlockedGateId !== currentBlockedGateId ||
      snapshotNextGateId !== currentNextGateId;

    driftItems.push({
      key: "stage-gates",
      label: "Stage gates",
      status: gatesChanged
        ? "gate changed"
        : countsChanged
          ? "count changed"
          : "unchanged",
      detail: gatesChanged
        ? `Blocked ${snapshotBlockedGateId ?? "none"} -> ${currentBlockedGateId ?? "none"}. Next ${snapshotNextGateId ?? "complete"} -> ${currentNextGateId ?? "complete"}.`
        : countsChanged
          ? `Snapshot ${stageGateSnapshot.passCount} pass / ${stageGateSnapshot.holdCount} hold / ${stageGateSnapshot.notStartedCount} not started. Live ${currentStageGateSummary.passCount} pass / ${currentStageGateSummary.holdCount} hold / ${currentStageGateSummary.notStartedCount} not started.`
          : "Review counts and next steps still match the saved report snapshot.",
    });
  }

  const driftedItems = driftItems.filter((item) => item.status !== "unchanged");
  const currentReportPacketFreshness = latestArtifact?.generated_at ?? report.generated_at
    ? driftedItems.length > 0
      ? {
          label: PACKET_FRESHNESS_LABELS.REFRESH_RECOMMENDED,
          tone: "warning" as const,
          detail:
            "Live source changes are visible against the latest packet snapshot, so refresh this packet before leaning on it for grant prioritization or release review.",
        }
      : {
          label: PACKET_FRESHNESS_LABELS.CURRENT,
          tone: "success" as const,
          detail:
            "No live source drift is currently visible against the latest packet snapshot.",
        }
    : {
        label: PACKET_FRESHNESS_LABELS.NO_PACKET,
        tone: "warning" as const,
        detail:
          "Generate the first packet before treating this report as release-review evidence for grants or packet signoff.",
      };
  return (
    <ReportStandardDetail
      report={report}
      project={project}
      workspace={workspace}
      runs={runs}
      latestArtifact={latestArtifact}
      fundingSnapshot={fundingSnapshot}
      operationsSummary={operationsSummary}
      driftItems={driftItems}
      driftedItems={driftedItems}
      evidenceSummaryDigest={evidenceSummaryDigest}
      fundingSummaryDigest={fundingSummaryDigest}
      engagementCampaign={engagementCampaign}
      engagementPublicHref={engagementPublicHref}
      currentReportPacketFreshness={currentReportPacketFreshness}
      currentReportComparisonAggregate={currentReportComparisonAggregate}
      currentReportComparisonDigest={currentReportComparisonDigest}
      compositionAuditProps={{
        sectionList,
        enabledSectionsCount: enabledSections,
        runs,
        artifactList,
      }}
      provenanceAuditProps={{
        runAudit,
        runs,
        runTitleById,
        sourceContext,
        engagementCampaign,
        engagementPublicHref,
        engagementSummaryText,
        reportOrigin,
        reportReason,
        engagementSnapshotCapturedAt,
        engagementSnapshotTotalItems,
        engagementSnapshotReadyForHandoff,
        evidenceChainSummary,
        storedScenarioSpineSummary,
        projectId: project?.id ?? null,
        projectUpdatedAt: project?.updated_at ?? null,
        driftItems,
        stageGateSnapshot,
        projectRecordsSnapshot,
        scenarioSetLinks,
      }}
      navigationPreviewProps={{
        projectId: project?.id ?? null,
        engagementCampaign,
        engagementPublicHref,
        latestHtml,
        latestArtifact,
      }}
    />
  );
}
