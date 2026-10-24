import { assertCompleteFundingRead } from "@/lib/grants/award-handoff";
import { completeReportSourceReviewSummary } from "@/lib/reports/source-review-posture";
import { reportJurisdictionState } from "@/lib/reports/jurisdiction-freshness";
import { objectRecord, type GuidedComparisonSelectionV1 } from "@/lib/reports/guided-comparison";
import { readScopedGuidedComparisonBinding } from "@/lib/reports/guided-comparison-binding";
import { getReportPacketFreshness } from "@/lib/reports/catalog";
import { artifactGenerationWritebackIsCurrent } from "@/lib/reports/report-registry-freshness";
import { notFound, redirect } from "next/navigation";
import { ReportReadFailureDisclosure, ReportUnreadableShell } from "@/components/reports/report-read-failure-notice";
import { RtpReportDetail } from "@/components/reports/rtp-report-detail";
import { summarizeEngagementItems } from "@/lib/engagement/summary";
import { buildPortfolioFundingSnapshot, buildProjectFundingSnapshot } from "@/lib/projects/funding";
import {
  buildRtpCycleReadiness,
  buildRtpCycleWorkflowSummary,
  buildRtpPublicReviewSummary,
} from "@/lib/rtp/catalog";
import { createClient } from "@/lib/supabase/server";
import { ReadFailureLog } from "@/lib/ui/read-failures";
import {
  describeComparisonSnapshotAggregate,
  describeEvidenceChainSummary,
  describeFundingSnapshot,
  getRtpPacketPresetAlignment,
  parseStoredComparisonSnapshotAggregate,
  parseStoredEvidenceChainSummary,
  parseStoredFundingSnapshot,
  parseStoredScenarioSpineSummary,
} from "@/lib/reports/catalog";
import { PACKET_FRESHNESS_LABELS } from "@/lib/reports/packet-labels";
import { buildEvidenceChainSummary } from "@/lib/reports/evidence-chain";
import { parseReportAerialEvidenceSourceContext } from "@/lib/reports/aerial-source-context";
import {
  buildReportDatasetOutputContexts,
  buildReportRefreshLogNote,
  type ReportDataHubDatasetRow,
  type ReportDataHubProjectLinkRow,
  type ReportDataHubRefreshJobRow,
} from "@/lib/reports/data-lineage-output-contexts";
import { extractEngagementCampaignId } from "@/lib/reports/engagement";
import { buildReportGenerationReadiness } from "@/lib/reports/generation-readiness";
import { loadReportDualDemandAgreementPanel } from "@/lib/reports/dual-demand-agreement";
import { loadReportAerialOrthoCatalog, readReportAerialOrthoSelections } from "@/lib/reports/aerial-ortho-evidence-server";
import { loadReportSafetyIngestOptions, readReportSafetyIngestSelections } from "@/lib/reports/safety-evidence-selection";
import { buildTypedRunCitations, loadCiteableModelRuns, loadReportRunCitationLinks, resolveCitedRuns } from "@/lib/reports/run-citations";
import { looksLikePendingScenarioSpineSchema } from "@/lib/scenarios/api";
import {
  loadProjectStageGateBoard,
  type StageGateDecisionQuerySupabaseLike,
} from "@/lib/stage-gates/decision-queries";
import { STAGE_GATE_BINDING_WORKSPACE_COLUMNS } from "@/lib/stage-gates/rebind";
import { resolveBoundStageGateTemplate } from "@/lib/stage-gates/bound-template";
import type { ProjectStageGateSummary } from "@/lib/stage-gates/summary";
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
  loadAiNarrativeDraftPanelInputs,
  loadProjectFundingSourceRows,
  loadReportDetailRow,
  maxTimestamp,
  summarizeProjectRecordDrift,
} from "./_components/_helpers";
import type {
  CurrentProjectRecordEntry,
  DriftItem,
  EngagementCampaignLinkRow,
  EngagementCategoryRow,
  EngagementItemRow,
  LinkedRunRow,
  ProjectRecordSnapshotEntry,
  ProjectRecordSnapshotKey,
  ReportArtifact,
  ScenarioSpineRow,
  ReportDetailRouteParams,
} from "./_components/_types";
import { buildFundingPostureDriftItem } from "./_components/_funding-drift";
import { buildEngagementDriftItem } from "./_components/_engagement-drift";
import { buildStageGateDriftItem, describeStageGateReadFailure } from "./_components/_stage-gate-drift";
import { buildArtifactSafetyReadDriftItem, buildProjectSafetyDriftItem, describeSafetyEvidenceReadFailure, loadLatestProjectSafetyIngest, type ReportSafetyFreshnessSupabaseLike } from "./_components/_safety-drift";
import {
  checkLiveScenarioSpineReads,
  checkRtpFundingReads,
  collectProjectRecordReadFailures,
  describeUncoveredProjectRecords,
  PACKET_FRESHNESS_WHEN_ARTIFACTS_UNREADABLE,
  registerReportDetailReads,
  buildReportUnreadableByTab,
} from "./_components/_read-failures";
import { ReportStandardDetail } from "./_components/report-standard-detail";
import { loadSpecializedReportPage } from "@/components/reports/specialized-report-page";
import { PlanningContextStripForProject } from "@/components/projects/planning-context-strip";
export default async function ReportDetailPage({ params, searchParams }: ReportDetailRouteParams) {
  const { reportId } = await params; const query = searchParams ? await searchParams : {}; const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect("/sign-in");
  }

  const reportResult = await loadReportDetailRow(supabase, reportId);

  // A 404 on a FAILED read is the same defect wearing a different face: it tells
  // a planner "this report does not exist" when the truth is "this report could
  // not be read". A genuine absence still 404s below; a failed read renders the
  // page shell and says which one happened. This is an internal page, so the
  // database's own message is shown to the person who can act on it.
  if (reportResult.error) {
    return <ReportUnreadableShell message={reportResult.error.message} />;
  }

  const report = reportResult.data;

  if (!report) {
    notFound();
  }

  const specializedReport = await loadSpecializedReportPage(supabase, report, user.id, query);
  if (specializedReport) return specializedReport;

  /**
   * What this render could not read. Everything below is a side panel or a
   * comparison input: one failing does not make the packet worthless, but every
   * one of them, on failure, produces an EMPTY value that this page would
   * otherwise render as an answer — no generated packet, no sections, no linked
   * projects, and drift rows reporting an outage as records lost since
   * generation. Collect, render what loaded, and disclose the rest by name.
   */
  const reads = new ReadFailureLog();

  const [
    projectResult,
    rtpCycleResult,
    workspaceResult,
    sectionsResult,
    reportRunCitationLinks,
    artifactsResult,
    rtpChaptersResult,
    rtpProjectLinksResult,
    rtpCampaignsResult,
  ] = await Promise.all([
    supabase
      .from("projects")
        .select(
          "workspace_id, name, summary, status, plan_type, delivery_phase, id, updated_at, jurisdiction_context, place_label, place_country_code, place_subdivision_code"
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
      : Promise.resolve({ data: null, error: null }),
    supabase
      .from("workspaces")
      // The binding columns come along so the live gate board below can render
      // under the template this workspace is BOUND to, not the registry
      // default. `STAGE_GATE_BINDING_WORKSPACE_COLUMNS` is imported rather than
      // retyped — retyping the projection is the known failure mode.
      .select(`id, name, slug, ${STAGE_GATE_BINDING_WORKSPACE_COLUMNS}`)
      .eq("id", report.workspace_id)
      .maybeSingle(),
    supabase
      .from("report_sections")
      .select("id, section_key, title, enabled, sort_order, config_json")
      .eq("report_id", report.id)
      .order("sort_order", { ascending: true }),
    loadReportRunCitationLinks(supabase, report.id),
    supabase
      .from("report_artifacts")
      .select("id, artifact_kind, generated_at, storage_path, metadata_json")
      .eq("report_id", report.id)
      .order("generated_at", { ascending: false }),
    report.rtp_cycle_id
      ? supabase
          .from("rtp_cycle_chapters")
          .select("id, status")
          .eq("rtp_cycle_id", report.rtp_cycle_id)
      : Promise.resolve({ data: [], error: null }),
    report.rtp_cycle_id
      ? supabase
          .from("project_rtp_cycle_links")
          .select("id, project_id")
          .eq("rtp_cycle_id", report.rtp_cycle_id)
      : Promise.resolve({ data: [], error: null }),
    report.rtp_cycle_id
      ? supabase
          .from("engagement_campaigns")
          .select("id, rtp_cycle_chapter_id")
          .eq("workspace_id", report.workspace_id)
          .eq("rtp_cycle_id", report.rtp_cycle_id)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const {
    artifactsUnreadable,
    sectionsUnreadable,
    rtpChaptersUnreadable,
    rtpProjectLinksUnreadable,
    rtpCampaignsUnreadable,
  } = registerReportDetailReads(reads, {
    project: projectResult,
    rtpCycle: rtpCycleResult,
    workspace: workspaceResult,
    sections: sectionsResult,
    artifacts: artifactsResult,
    rtpChapters: rtpChaptersResult,
    rtpProjectLinks: rtpProjectLinksResult,
    rtpCampaigns: rtpCampaignsResult,
  });

  const project = projectResult.data;
  const rtpCycle = rtpCycleResult.data;
  // Cast because the projection is now a template literal (the binding columns
  // are interpolated from STAGE_GATE_BINDING_WORKSPACE_COLUMNS), which the
  // client's string-parser cannot type — the repo convention is to cast query
  // results deliberately (see CLAUDE.md on untyped Supabase clients).
  const workspace = workspaceResult.data as { id: string; name: string | null; slug: string | null } | null;
  const sections = sectionsResult.data;
  const artifacts = artifactsResult.data;
  const rtpChapters = rtpChaptersResult.data;
  const rtpProjectLinks = rtpProjectLinksResult.data;
  const rtpCampaigns = rtpCampaignsResult.data;

  // Which template the LIVE gate board renders under is a fact about the
  // workspace row — the binding of record reconciled against the workspace's
  // own geography — resolved here once from the widened read above. Threading
  // it into the board loader is what keeps the drift comparison honest when
  // more than one template is registered: built on the registry default
  // instead, a differently-bound workspace's recorded decisions would match no
  // gate and the drift row would report gates lost since generation.
  //
  // When the workspace read failed (already registered in `reads` above), or
  // the stored template is not registered in this deployment, there is no
  // honest template to render — the stage-gate check below reports itself
  // uncovered rather than rendering default gates.
  const { templateId: boundStageGateTemplateId, unavailableReason: stageGateBindingUnavailableReason } =
    resolveBoundStageGateTemplate(workspace, workspaceResult.error);

  const projectFundingRows = await loadProjectFundingSourceRows(supabase, report.project_id);
  // The live funding board behind this project's posture. The loader keeps its
  // empty arrays on failure (a page that 500s because one panel broke is worse),
  // so the failure is registered here and the DRIFT COMPARISON is withheld
  // below — an unread awards table otherwise publishes "Committed awards:
  // $8,000,000 -> $0." against the packet's frozen snapshot.
  if (projectFundingRows.unreadable) {
    reads.check("this project's live funding awards, opportunities and invoices", {
      error: { message: projectFundingRows.unreadableMessage },
    });
  }

  const projectDatasetLinksResult = report.project_id
    ? await supabase
        .from("data_dataset_project_links")
        .select("dataset_id, project_id, relationship_type, linked_at")
        .eq("project_id", report.project_id)
        .order("linked_at", { ascending: false })
    : { data: [], error: null };
  const projectDatasetLinks = (projectDatasetLinksResult.data ?? []) as ReportDataHubProjectLinkRow[];
  const projectDatasetIds = Array.from(
    new Set(projectDatasetLinks.map((link) => link.dataset_id).filter(Boolean))
  );
  const [projectDatasetsResult, projectDatasetRefreshJobsResult] = projectDatasetIds.length
    ? await Promise.all([
        supabase
          .from("data_datasets")
          .select(
            "id, name, status, geography_scope, geometry_attachment, thematic_metric_key, citation_text, source_url, license_label, vintage_label, schema_version, checksum, row_count, last_refreshed_at"
          )
          .in("id", projectDatasetIds),
        supabase
          .from("data_refresh_jobs")
          .select("dataset_id, status, refresh_mode, started_at, completed_at, created_at")
          .in("dataset_id", projectDatasetIds)
          .order("created_at", { ascending: false }),
      ])
    : [
        { data: [], error: null },
        { data: [], error: null },
      ];
  const projectDatasetRefreshJobs = (projectDatasetRefreshJobsResult.data ?? []) as ReportDataHubRefreshJobRow[];
  const datasetOutputContexts = buildReportDatasetOutputContexts({
    datasets: (projectDatasetsResult.data ?? []) as ReportDataHubDatasetRow[],
    links: projectDatasetLinks,
    refreshJobs: projectDatasetRefreshJobs,
  });

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
            .select("project_id, awarded_amount, match_amount, risk_flag, obligation_due_at, updated_at, created_at, id, latest_handoff_revision_id, current_handoff_revision_id, currency_code, has_source_backed_issuance",{count:"exact"})
            .in("project_id", rtpLinkedProjectIds),
          supabase
            .from("funding_opportunities")
            .select("project_id, expected_award_amount, decision_state, opportunity_status, closes_at, updated_at, created_at, has_source_backed_issuance",{count:"exact"})
            .in("project_id", rtpLinkedProjectIds),
          supabase
            .from("billing_invoice_records")
            .select("project_id, status, amount, retention_percent, retention_amount, net_amount, due_date, invoice_date, created_at, funding_award_id, award_handoff_revision_id, currency_code, handoff_applicable_revision_id",{count:"exact"})
            .in("project_id", rtpLinkedProjectIds),
        ])
      : [
          { data: [], error: null },
          { data: [], error: null },
          { data: [], error: null },
          { data: [], error: null },
        ];

  const rtpFundingUnreadable = checkRtpFundingReads(reads, {
    profiles: rtpFundingProfilesResult,
    awards: rtpFundingAwardsResult,
    opportunities: rtpFundingOpportunitiesResult,
    invoices: rtpBillingInvoicesResult,
  });

  const reportRunLinks = reportRunCitationLinks.links;
  const runIds = reportRunLinks.map((item) => item.run_id).filter((value): value is string => Boolean(value));
  const runsResult = runIds.length
    ? await supabase
        .from("runs")
        .select("id, title, summary_text, metrics, created_at")
        .in("id", runIds)
    : { data: [], error: null };
  const { citedModelRuns, citedCountyRuns } = await resolveCitedRuns(supabase, reportRunLinks);
  // Typed evidence must belong to the report's project as well as its workspace.
  const citeableModelRuns = !report.rtp_cycle_id && report.project_id
    ? await loadCiteableModelRuns(supabase, { projectId: report.project_id }) : [];

  const sectionList = sections ?? [];
  // A campaign-targeted report names its campaign directly; handoff packets
  // created against a project carry the campaign id inside section config.
  const engagementCampaignId =
    (typeof report.engagement_campaign_id === "string" ? report.engagement_campaign_id : null) ??
    extractEngagementCampaignId(sectionList);
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

  const runMap = new Map((runsResult.data ?? []).map((run) => [run.id, run]));
  const runs = reportRunLinks
    .map((link): LinkedRunRow | null => (link.run_id ? runMap.get(link.run_id) ?? null : null))
    .filter((item): item is LinkedRunRow => Boolean(item));
  // Typed citations resolved for display: kind label + honest title/status.
  const typedRunCitations = buildTypedRunCitations(reportRunLinks, citedModelRuns, citedCountyRuns);
  const citedModelRunIdsInOrder = typedRunCitations.filter((citation) => citation.kind === "model").map((citation) => citation.runId);
  const agreementPanel = project ? await loadReportDualDemandAgreementPanel({ supabase, modelRunIds: citedModelRunIdsInOrder, workspaceId: report.workspace_id, projectId: project.id, reportMetadata: report.metadata_json }) : { evidence: [], selections: [] };
  let guidedSelection: GuidedComparisonSelectionV1 | null = null;
  let guidedProblem: string | null = null;
  try {
    guidedSelection = readScopedGuidedComparisonBinding({ reportId, report, project });
  } catch (error) {
    guidedProblem = error instanceof Error ? error.message : "The saved comparison binding could not be checked.";
  }
  const guidedPanel = project && report.report_type === "analysis_summary" ? {
    projectId: project.id, snapshotId: guidedSelection?.snapshotId ?? null,
    bindingSha256: guidedSelection?.bindingSha256 ?? null, problem: guidedProblem,
    liveEvidenceStatus: guidedSelection ? "unassessed" as const : undefined,
    includedRunIds: guidedSelection?.payload.sources.map((source) => source.runId) ?? [],
  } : undefined;
  const aerialOrthoCatalog = project ? await loadReportAerialOrthoCatalog({ supabase, workspaceId: report.workspace_id, projectId: project.id }) : { state: "absent" as const, layers: [], notes: [] };
  const safetyIngestOptionsResult = project
    ? await loadReportSafetyIngestOptions(supabase, report.workspace_id, project.id)
    : { data: [], error: null };
  reads.check("this project's selectable crash evidence", safetyIngestOptionsResult);
  const safetyIngestOptions = safetyIngestOptionsResult.data ?? [];
  const requestedSafetyIngestId = Array.isArray(query.safetyIngestId)
    ? query.safetyIngestId[0] ?? null
    : query.safetyIngestId ?? null;

  const latestArtifact = ((artifacts ?? []) as ReportArtifact[])[0] ?? null;
  const latestHtml = asHtmlContent(latestArtifact?.metadata_json);
  const runAudit = asRunAudit(latestArtifact?.metadata_json);
  const sourceContext = asSourceContext(latestArtifact?.metadata_json);
  const aerialEvidenceSourceContext = parseReportAerialEvidenceSourceContext(sourceContext?.aerialEvidenceSourceContext);
  const storedEvidenceChainSummary = parseStoredEvidenceChainSummary(latestArtifact?.metadata_json ?? null);
  const storedScenarioSpineSummary = parseStoredScenarioSpineSummary(latestArtifact?.metadata_json ?? null);
  const storedFundingSnapshot = parseStoredFundingSnapshot(latestArtifact?.metadata_json ?? null);
  const currentReportComparisonAggregate = parseStoredComparisonSnapshotAggregate(latestArtifact?.metadata_json ?? null);
  const currentReportComparisonDigest = describeComparisonSnapshotAggregate(currentReportComparisonAggregate);
  const liveFundingSnapshot = project
    ? buildProjectFundingSnapshot({
        ...projectFundingRows,
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
    // Failed reads keep their named disclosure below; successful partial sets still refuse.
    if (rtpLinkedProjectIds.length) assertCompleteFundingRead(...[rtpFundingAwardsResult, rtpFundingOpportunitiesResult, rtpBillingInvoicesResult].filter((result) => !result.error));
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
    // The comment counts below drive this cycle's public-review posture. An
    // unread items table would report a zero pending queue — "nothing is waiting
    // on you" — from a broken query, so the failure is disclosed AND the counts
    // are withheld: disclosure alone leaves the drift table still publishing
    // "Pending comments: generated with 31, current source is 0".
    const rtpCommentsUnreadable = reads.check(
      "the public comments on this RTP cycle",
      rtpEngagementItemsResult
    );
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
          // This page IS a packet record, and it can see whether that record
          // has a generated artifact — so it examined one packet record.
          packets: { examined: true, recordCount: 1, generatedCount: latestArtifact ? 1 : 0 },
          pendingCommentCount: currentRtpEngagementCounts.moderationQueue.pendingCount,
          approvedCommentCount: currentRtpEngagementCounts.moderationQueue.approvedCount,
          readyCommentCount: currentRtpEngagementCounts.moderationQueue.readyForHandoffCount,
        })
      : null;
    return (
      <>
      <ReportReadFailureDisclosure reads={reads} />
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
          metadata_json: artifact.metadata_json,
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
        // EVERY live value here is one half of a published comparison, so a read
        // that failed is passed as `null` — "unknown" — rather than as the zero
        // its empty array produces. `null` makes the drift row withhold itself;
        // the disclosure at the top of the page names which read failed. The
        // alternative is the defect this whole lane exists for, wearing a drift
        // row: an outage printed to a funder as chapters, projects, comments and
        // committed dollars that disappeared since the packet was generated.
        currentContext={{
          enabledSectionKeys: sectionsUnreadable
            ? null
            : (sections ?? []).filter((section) => section.enabled).map((section) => section.section_key),
          readinessLabel: currentRtpReadiness?.label ?? null,
          readinessReason: currentRtpReadiness?.reason ?? null,
          workflowLabel: currentRtpWorkflow?.label ?? null,
          workflowDetail: currentRtpWorkflow?.detail ?? null,
          chapterCount: rtpChaptersUnreadable ? null : currentRtpChapterRows.length,
          chapterCompleteCount: rtpChaptersUnreadable
            ? null
            : currentRtpChapterRows.filter((chapter) => chapter.status === "complete").length,
          chapterReadyForReviewCount: rtpChaptersUnreadable
            ? null
            : currentRtpChapterRows.filter((chapter) => chapter.status === "ready_for_review").length,
          linkedProjectCount: rtpProjectLinksUnreadable ? null : currentRtpProjectLinks.length,
          engagementCampaignCount: rtpCampaignsUnreadable ? null : currentRtpCampaigns.length,
          cycleUpdatedAt: rtpCycle?.updated_at ?? null,
          presetStage: currentPacketPresetAlignment.presetStage,
          presetLabel: currentPacketPresetAlignment.presetLabel,
          presetStatusLabel: currentPacketPresetAlignment.statusLabel,
          presetDetail: currentPacketPresetAlignment.detail,
          fundingSnapshot: rtpFundingUnreadable ? null : currentRtpFundingSnapshot,
          publicReviewLabel: currentRtpPublicReview?.label ?? null,
          publicReviewDetail: currentRtpPublicReview?.detail ?? null,
          publicReviewTone: currentRtpPublicReview?.tone ?? null,
          cycleLevelCampaignCount: rtpCampaignsUnreadable ? null : cycleLevelCampaignCount,
          chapterLevelCampaignCount: rtpCampaignsUnreadable ? null : chapterLevelCampaignCount,
          pendingCommentCount: rtpCommentsUnreadable
            ? null
            : currentRtpEngagementCounts.moderationQueue.pendingCount,
          approvedCommentCount: rtpCommentsUnreadable
            ? null
            : currentRtpEngagementCounts.moderationQueue.approvedCount,
          readyCommentCount: rtpCommentsUnreadable
            ? null
            : currentRtpEngagementCounts.moderationQueue.readyForHandoffCount,
        }}
      />
      </>
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
    stageGateBoard,
    deliverablesResult,
    risksResult,
    issuesResult,
    decisionsResult,
    meetingsResult,
    latestSafetyIngestResult,
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
          .select("id, scenario_set_id, updated_at")
          .in("scenario_set_id", liveScenarioSetIds)
      : Promise.resolve({ data: [], error: null }),
    // The LIVE board this packet's frozen snapshot is compared against. It goes
    // through the shared loader because the comparison is only meaningful if
    // both sides are about the same project — a workspace-wide read here put
    // another project's verdict on this packet's drift row, and this packet is
    // a document an agency sends to a funder. `report.project_id` is null on an
    // RTP- or campaign-targeted report, which has no project board to compare
    // against at all. The board renders under the workspace's BOUND template,
    // resolved above; with no resolvable binding the loader is not called and
    // the packet-freshness line names the uncovered check instead.
    stageGateSnapshot && report.project_id && boundStageGateTemplateId
      ? loadProjectStageGateBoard(supabase as unknown as StageGateDecisionQuerySupabaseLike, {
          workspaceId: report.workspace_id,
          projectId: report.project_id,
          templateId: boundStageGateTemplateId,
        })
      : Promise.resolve(null),
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
    loadLatestProjectSafetyIngest(
      supabase as unknown as ReportSafetyFreshnessSupabaseLike,
      report.workspace_id,
      report.project_id
    ),
  ]);

  /**
   * A drift row is a COMPARISON, and every status one could carry — "unchanged",
   * "count changed" — is a claim about the LIVE side. When the live read failed
   * the live side is unknown, and its zero counts would be published as
   * "Deliverables: 12 -> 0", i.e. an outage reported to a funder as records
   * deleted since this packet was generated. The precedent is the stage-gate
   * block below, which already withholds its verdict for exactly this reason;
   * these follow it rather than inventing a second rule.
   *
   * Written as separate statements, not `a || b`, because `||` short-circuits
   * and the second read would then never be registered.
   */
  const liveEngagementReadFailure = [
    reads.check("this campaign's live engagement categories", engagementCategoriesResult),
    reads.check("this campaign's live engagement items", engagementItemsResult),
  ].some(Boolean);

  const projectRecordReadFailures = collectProjectRecordReadFailures(reads, {
    deliverables: deliverablesResult,
    risks: risksResult,
    issues: issuesResult,
    decisions: decisionsResult,
    meetings: meetingsResult,
  });
  const safetyEvidenceLiveReadFailure = reads.check(
    "this project's linked crash evidence",
    latestSafetyIngestResult,
  );
  const safetyEvidenceLiveReadFailureReason = describeSafetyEvidenceReadFailure(
    safetyEvidenceLiveReadFailure,
    latestSafetyIngestResult
  );

  const liveEngagementCounts = engagementCampaign && !liveEngagementReadFailure
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
  // Classified first (a pending spine migration has a truer thing to say), then
  // collected: a spine read that failed for any other reason leaves every live
  // count at zero, which the comparison below would publish as the scenario
  // basis having lost its assumption sets since the packet was generated.
  const liveScenarioReadFailure = checkLiveScenarioSpineReads(reads, liveScenarioSpinePending, {
    sets: scenarioSetsResult,
    assumptionSets: scenarioAssumptionSetsResult,
    dataPackages: scenarioDataPackagesResult,
    indicatorSnapshots: scenarioIndicatorSnapshotsResult,
    comparisonSnapshots: scenarioComparisonSnapshotsResult,
  });
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
  const currentStageGateSummary: ProjectStageGateSummary | null = stageGateBoard?.summary ?? null;
  // An unreadable live board is not the same as no gate board (`null` above). The workspace binding may be unresolved, or
  // the decision log may fail. The drift check below withholds its verdict, so
  // an outage cannot be read here as "nothing changed".
  const stageGateLiveReadFailure = describeStageGateReadFailure(
    stageGateSnapshot, report.project_id, stageGateBindingUnavailableReason, currentStageGateSummary);
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
  const frozenGuided = objectRecord(latestArtifact?.metadata_json?.guidedComparisonSelectionV1);
  if (guidedSelection || frozenGuided || guidedProblem) driftItems.push({ key: "guided_comparison", label: "Selected guided comparison",
    status: guidedProblem || frozenGuided?.bindingSha256 !== guidedSelection?.bindingSha256 ? "updated" : "unchanged",
    detail: guidedProblem ?? (frozenGuided?.bindingSha256 !== guidedSelection?.bindingSha256
      ? "The saved report selection differs from the retained artifact. Historical downloads keep their original comparison."
      : "The saved binding digest matches the digest recorded on the retained artifact. Live files and their source history are unassessed on this page; generation checks them again.") });

  const packetGeneratedAt = latestArtifact?.generated_at ?? report.generated_at;
  const artifactSafetyDriftItem = buildArtifactSafetyReadDriftItem(latestArtifact?.metadata_json);
  if (artifactSafetyDriftItem) driftItems.push(artifactSafetyDriftItem);
  const safetyDriftItem = buildProjectSafetyDriftItem({
    readFailed: safetyEvidenceLiveReadFailure,
    result: latestSafetyIngestResult,
    packetGeneratedAt,
  });
  if (safetyDriftItem) driftItems.push(safetyDriftItem);

  const engagementDriftItem = buildEngagementDriftItem({
    campaign: engagementCampaign,
    snapshot: engagementCampaignSnapshot,
    snapshotCapturedAt: engagementSnapshotCapturedAt,
    snapshotTotalItems: engagementSnapshotTotalItems,
    snapshotReadyForHandoff: engagementSnapshotReadyForHandoff,
    liveCounts: liveEngagementCounts,
  });
  if (engagementDriftItem) driftItems.push(engagementDriftItem);

  if (scenarioSetLinks.length > 0 && !liveScenarioReadFailure) {
    const scenarioChanges: string[] = [];
    const unassessedSets: string[] = [];
    const pendingLiveSets: string[] = [];
    for (const link of scenarioSetLinks) {
      const currentSetAt = liveScenarioSetsById.get(link.scenarioSetId) ?? null;
      // Pending reads discard the rows above; their synthetic zeros are not a live census.
      const currentSpine = liveScenarioSpinePending ? undefined : liveScenarioSpineSummaryById.get(link.scenarioSetId);
      const retainedSpine = link.sharedSpine?.schemaPending ? undefined : link.sharedSpine;
      const countChanged = retainedSpine && currentSpine && (retainedSpine.assumptionSetCount !== currentSpine.assumptionSetCount ||
        retainedSpine.dataPackageCount !== currentSpine.dataPackageCount ||
        retainedSpine.indicatorSnapshotCount !== currentSpine.indicatorSnapshotCount ||
        retainedSpine.comparisonSnapshotCount !== currentSpine.comparisonSnapshotCount
      );
      // A selected legacy snapshot is a known member, not a complete historical census.
      if (!retainedSpine) unassessedSets.push(link.scenarioSetTitle);
      if (!currentSpine) pendingLiveSets.push(link.scenarioSetTitle);
      const timestampChanged = Boolean(!scenarioSetsResult.error && link.scenarioSetUpdatedAt && currentSetAt &&
        link.scenarioSetUpdatedAt !== currentSetAt) || Boolean(retainedSpine && currentSpine && (
        retainedSpine.latestAssumptionSetUpdatedAt !== currentSpine.latestAssumptionSetUpdatedAt ||
        retainedSpine.latestDataPackageUpdatedAt !== currentSpine.latestDataPackageUpdatedAt ||
        retainedSpine.latestIndicatorSnapshotAt !== currentSpine.latestIndicatorSnapshotAt ||
        retainedSpine.latestComparisonSnapshotUpdatedAt !== currentSpine.latestComparisonSnapshotUpdatedAt
      ));
      const retainedSnapshots = Array.isArray(link.comparisonSnapshots) ? link.comparisonSnapshots : [];
      const snapshotChanged = !liveScenarioSpinePending && retainedSnapshots.some((snapshot) => {
        const current = liveScenarioComparisonRows.find((row) => row.scenario_set_id === link.scenarioSetId && row.id === snapshot.comparisonSnapshotId);
        return !current || Boolean(snapshot.updatedAt && current.updated_at !== snapshot.updatedAt);
      });
      if (countChanged) {
        scenarioChanges.push(`${link.scenarioSetTitle}: assumptions ${retainedSpine.assumptionSetCount} -> ${currentSpine.assumptionSetCount}, packages ${retainedSpine.dataPackageCount} -> ${currentSpine.dataPackageCount}, indicators ${retainedSpine.indicatorSnapshotCount} -> ${currentSpine.indicatorSnapshotCount}, comparisons ${retainedSpine.comparisonSnapshotCount} -> ${currentSpine.comparisonSnapshotCount}.`);
      } else if (timestampChanged || snapshotChanged) {
        scenarioChanges.push(`${link.scenarioSetTitle}: ${formatCompactDateTime(link.scenarioSetUpdatedAt)} -> ${formatCompactDateTime(currentSetAt)}. Scenario-set timing or a retained comparison snapshot changed since generation.`);
      }
    }
    driftItems.push({
      key: "scenario-basis",
      label: "Scenario basis",
      status: scenarioChanges.length > 0 ? "updated" : unassessedSets.length > 0 || pendingLiveSets.length > 0 ? "unassessed" : "unchanged",
      detail: [
        ...scenarioChanges,
        unassessedSets.length > 0 ? `Historical shared-spine totals are not recorded for ${unassessedSets.join(", ")}. Those counts remain unassessed; missing fields do not establish zero or a source change.` : null,
        pendingLiveSets.length > 0 ? `Live shared-spine queries are pending for ${pendingLiveSets.join(", ")}. Live counts, shared-spine timing and retained snapshot presence remain unassessed; unavailable rows do not establish a source change.` : null,
        scenarioChanges.length === 0 && unassessedSets.length === 0 && pendingLiveSets.length === 0 ? "Scenario-set and shared-spine timing still matches the artifact snapshot." : null,
      ].filter(Boolean).join(" "),
    });
  }

  const comparableProjectRecords = projectRecordsSnapshot.filter(
    (item) => !projectRecordReadFailures.has(item.key as ProjectRecordSnapshotKey)
  );

  // No drift row at all when NONE of the snapshotted record types could be read
  // live: with nothing comparable left there is no comparison to report, and
  // "unchanged" would be a verdict on a live board this render never saw.
  if (comparableProjectRecords.length > 0) {
    const countChanges: string[] = [];
    const timingChanges: string[] = [];

    for (const item of comparableProjectRecords) {
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
      // The second half names what this comparison did NOT cover, so a partial
      // check is not read as a whole one.
      detail: [
        summarizeProjectRecordDrift(countChanges.length > 0 ? countChanges : timingChanges),
        describeUncoveredProjectRecords(projectRecordReadFailures),
      ]
        .filter((value): value is string => Boolean(value))
        .join(" "),
    });
  }

  // Withheld when the live funding reads failed, for the same reason the
  // scenario, engagement and project-record rows above are: every status this
  // row can carry — "unchanged" included — is a claim about a live side this
  // render never saw, and here the claim is denominated in dollars.
  const fundingPostureDrift = projectFundingRows.unreadable
    ? null
    : buildFundingPostureDriftItem(storedFundingSnapshot, liveFundingSnapshot);
  if (fundingPostureDrift) {
    driftItems.push(fundingPostureDrift);
  }

  const stageGateDrift = buildStageGateDriftItem(stageGateSnapshot, currentStageGateSummary, Boolean(stageGateLiveReadFailure));
  if (stageGateDrift) driftItems.push(stageGateDrift);

  const unassessedItems = driftItems.filter((item) => item.status === "unassessed");
  const driftedItems = driftItems.filter((item) => item.status !== "unchanged" && item.status !== "unassessed");
  // A failed live read leaves that source unassessed. It does not establish
  // a source change or justify calling the packet current.
  const jurisdictionState = artifactsUnreadable ? "unavailable" : reportJurisdictionState(latestArtifact?.metadata_json, project);
  const generationWritebackCurrent = artifactGenerationWritebackIsCurrent(latestArtifact?.metadata_json, report.updated_at);
  const sourceReviewSummary = completeReportSourceReviewSummary({ changedCount: driftedItems.length, totalCount: driftItems.length,
    labels: driftedItems.map((item) => item.label), unassessedLabels: unassessedItems.map((item) => item.label),
  }, { jurisdictionState, generationWritebackCurrent, unassessedLabels: [
    ...(stageGateLiveReadFailure ? ["Live stage gates unavailable"] : []), ...(safetyEvidenceLiveReadFailure ? ["Live crash evidence unavailable"] : []),
    ...(artifactsUnreadable ? ["Retained artifacts unavailable"] : []), ...(projectFundingRows.unreadable ? ["Live funding evidence unavailable"] : []),
    ...(projectRecordReadFailures.size ? ["Live project records unavailable"] : []), ...(liveEngagementReadFailure ? ["Live engagement evidence unavailable"] : []), ...(liveScenarioReadFailure ? ["Live scenario evidence unavailable"] : []),
  ] });
  const sourceUnassessedLabels = sourceReviewSummary.unassessedLabels ?? [];
  const jurisdictionFreshness = getReportPacketFreshness({ latestArtifactKind: report.latest_artifact_kind,
    generatedAt: latestArtifact?.generated_at ?? report.generated_at, updatedAt: null, jurisdictionState });
  const jurisdictionNeedsRefresh = jurisdictionFreshness.label === PACKET_FRESHNESS_LABELS.REFRESH_RECOMMENDED;
  const currentReportPacketFreshness = artifactsUnreadable ? PACKET_FRESHNESS_WHEN_ARTIFACTS_UNREADABLE
    : latestArtifact?.generated_at ?? report.generated_at
    ? driftedItems.length > 0 || (generationWritebackCurrent === false) || jurisdictionNeedsRefresh
      ? {
          label: PACKET_FRESHNESS_LABELS.REFRESH_RECOMMENDED, tone: "warning" as const,
          detail: [
            jurisdictionNeedsRefresh ? jurisdictionFreshness.detail : null, sourceUnassessedLabels.length ? `${sourceUnassessedLabels.join("; ")}. These inputs remain unassessed.` : null,
            (generationWritebackCurrent === false) ? "The report revision differs from its completed generation writeback, or generation did not finish recording it." : null,
            driftedItems.length > 0
              ? "Live source changes are visible against the latest packet snapshot, so refresh this packet before leaning on it for grant prioritization or release review."
              : "Do not treat this packet as verified against live sources yet.",
            stageGateLiveReadFailure ? `The live stage-gate board could not be checked (${stageGateLiveReadFailure}), so this check did not cover stage gates. That is an unchecked source, not a finding that gates changed.` : null,
            safetyEvidenceLiveReadFailure ? `The project's linked crash evidence could not be checked (${safetyEvidenceLiveReadFailureReason}), so this is an unchecked source rather than a finding that no newer crash acquisition exists.` : null,
          ]
            .filter((value): value is string => Boolean(value))
            .join(" "),
        }
      : {
          label: guidedSelection ? "Comparison evidence unassessed" : sourceUnassessedLabels.length > 0 ? "Source evidence unassessed" : PACKET_FRESHNESS_LABELS.CURRENT,
          tone: guidedSelection || sourceUnassessedLabels.length > 0 ? "warning" as const : "success" as const,
          detail: guidedSelection
            ? "The saved comparison binding is intact. Live files and their source history are unassessed on this page; generation checks them again."
            : sourceUnassessedLabels.length > 0 ? [`${sourceUnassessedLabels.join("; ")}. Missing evidence does not establish a source change or unchanged evidence.`,
                stageGateLiveReadFailure ? `The live stage-gate board could not be checked (${stageGateLiveReadFailure}).` : null,
                safetyEvidenceLiveReadFailure ? `The project's linked crash evidence could not be checked (${safetyEvidenceLiveReadFailureReason}).` : null].filter(Boolean).join(" ")
            : "No live source drift is currently visible against the latest packet snapshot.",
        }
    : {
        label: PACKET_FRESHNESS_LABELS.NO_PACKET,
        tone: "warning" as const,
        detail: "Generate the first packet before treating this report as release-review evidence for grants or packet signoff.",
      };
  const generationReadiness = buildReportGenerationReadiness({
    hasGeneratedArtifact: Boolean(latestArtifact?.generated_at ?? report.generated_at), sourceContext,
    driftedSourceCount: sourceReviewSummary.changedCount, sourceReviewSummary, unassessedSourceCount: unassessedItems.length,
    comparisonAggregate: currentReportComparisonAggregate,
    guidedComparison: guidedPanel || guidedProblem ? { selected: Boolean(guidedSelection), problem: guidedProblem } : undefined,
    fundingSnapshot, datasetOutputContexts,
    // Refresh-log rows are operator-recorded, never executed by OpenPlan; a
    // latest entry still reading "queued"/"running" is said so in readiness.
    refreshLogNote: buildReportRefreshLogNote(projectDatasetRefreshJobs),
  });
  // The shared readiness helper describes missing history; this page also knows when live reads are pending.
  const pendingScenarioBasis = liveScenarioSpinePending ? driftItems.find((item) => item.key === "scenario-basis") : undefined;
  if (pendingScenarioBasis) {
    generationReadiness.checks = generationReadiness.checks.map((check) => check.id === "source_context" && check.status === "unknown"
      ? { ...check, statusLabel: "Live scenario evidence unassessed", detail: pendingScenarioBasis.detail,
          nextAction: "Retry the live scenario reads and review the unassessed evidence before release use." }
      : check);
  }

  const narrativeDraftPanelProps = await loadAiNarrativeDraftPanelInputs(supabase, report, sectionList);
  return (
    <>
    <PlanningContextStripForProject requestedProjectId={query.projectId} project={project} error={projectResult.error} className="mb-4" /><ReportReadFailureDisclosure reads={reads} />
    <ReportStandardDetail
      guidedComparison={guidedPanel}
      searchParams={query}
      unreadableByTab={buildReportUnreadableByTab({ artifactsUnreadable, sectionsUnreadable, projectRecordsUnreadable: projectRecordReadFailures.size > 0, stageGatesUnreadable: Boolean(stageGateLiveReadFailure), crashEvidenceUnreadable: Boolean(safetyEvidenceLiveReadFailure) })}
      report={report}
      project={project}
      workspace={workspace}
      runs={runs}
      latestArtifact={latestArtifact}
      fundingSnapshot={fundingSnapshot}
      sourceReviewSummary={sourceReviewSummary}
      evidenceSummaryDigest={evidenceSummaryDigest}
      fundingSummaryDigest={fundingSummaryDigest}
      engagementCampaign={engagementCampaign}
      engagementPublicHref={engagementPublicHref}
      currentReportPacketFreshness={currentReportPacketFreshness}
      generationReadiness={generationReadiness}
      currentReportComparisonAggregate={currentReportComparisonAggregate}
      currentReportComparisonDigest={currentReportComparisonDigest}
      citeableModelRuns={citeableModelRuns}
      citedModelRunIds={citedModelRunIdsInOrder}
      agreementEvidence={agreementPanel.evidence} agreementCorridorSelections={agreementPanel.selections}
      aerialOrthoCatalog={aerialOrthoCatalog} aerialOrthoSelections={readReportAerialOrthoSelections(report.metadata_json)}
      safetyIngestOptions={safetyIngestOptions}
      safetyIngestSelections={readReportSafetyIngestSelections(report.metadata_json)}
      initialSafetyIngestId={requestedSafetyIngestId}
      narrativeDraftPanelProps={narrativeDraftPanelProps}
      compositionAuditProps={{
        reportId: report.id,
        sectionList,
        enabledSectionsCount: enabledSections,
        runs,
        typedCitations: typedRunCitations,
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
        aerialEvidenceSourceContext,
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
        reportId: report.id,
        projectId: project?.id ?? null,
        engagementCampaign,
        engagementPublicHref,
        latestHtml,
        latestArtifact,
      }}
    />
    </>
  );
}
