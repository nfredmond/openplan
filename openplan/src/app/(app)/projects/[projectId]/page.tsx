import { notFound, redirect } from "next/navigation";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { CartographicSurfaceWide } from "@/components/cartographic/cartographic-surface-wide";
import { PilotWorkflowHandoff } from "@/components/operations/pilot-workflow-handoff";
import { WorkspaceCommandBoard } from "@/components/operations/workspace-command-board";
import { WorkspaceRuntimeCue } from "@/components/operations/workspace-runtime-cue";
import { ProjectRecordComposer } from "@/components/projects/project-record-composer";
import { ProjectStageGateBoard } from "@/components/projects/project-stage-gate-board";
import { summarizeBillingInvoiceRecords } from "@/lib/billing/invoice-records";
import {
  buildGrantDecisionModelingSupport,
  describeProjectGrantModelingReadiness,
} from "@/lib/grants/modeling-evidence";
import { loadWorkspaceOperationsSummaryForWorkspace, type WorkspaceOperationsSupabaseLike } from "@/lib/operations/workspace-summary";
import {
  buildAerialProjectPosture,
  describeAerialProjectPosture,
} from "@/lib/aerial/catalog";
import { buildProjectControlsSummary } from "@/lib/projects/controls";
import { buildProjectFundingStackSummary } from "@/lib/projects/funding";
import {
  describeComparisonSnapshotAggregate,
  describeEvidenceChainSummary,
  getReportNavigationHref,
  getReportPacketFreshness,
  getReportPacketPriority,
  parseStoredComparisonSnapshotAggregate,
  parseStoredEvidenceChainSummary,
} from "@/lib/reports/catalog";
import { PACKET_FRESHNESS_LABELS } from "@/lib/reports/packet-labels";
import { createClient } from "@/lib/supabase/server";
import { buildProjectStageGateSummary } from "@/lib/stage-gates/summary";
import { ProjectPostureHeader } from "./_components/project-posture-header";
import { ProjectPostureUnified } from "./_components/project-posture-unified";
import { ProjectFundingPanel } from "./_components/project-funding-panel";
import { ProjectDeliveryBoard } from "./_components/project-delivery-board";
import { ProjectRiskAndDecisionLog } from "./_components/project-risk-decision-log";
import { ProjectEvidenceAndActivity } from "./_components/project-evidence-activity";
import {
  fmtCurrency,
  titleize,
  toneForDecision,
  toneForDeliverableStatus,
  toneForInvoiceStatus,
  toneForMilestoneStatus,
  toneForRiskSeverity,
  toneForSubmittalStatus,
} from "./_components/_helpers";
import type {
  BillingInvoiceRow,
  FundingAwardRow,
  FundingOpportunityRow,
  LinkedDatasetItem,
  MilestoneRow,
  ProjectFundingProfileRow,
  ProjectReportRow,
  ProjectRow,
  ProjectRtpLinkRow,
  ReportArtifactRow,
  RtpCycleRow,
  SubmittalRow,
  TimelineItem,
} from "./_components/_types";

function parseSortableDate(value: string | null | undefined): number {
  if (!value) return Number.POSITIVE_INFINITY;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? Number.POSITIVE_INFINITY : parsed;
}

function compareDateValues(left: string | null | undefined, right: string | null | undefined): number {
  return parseSortableDate(left) - parseSortableDate(right);
}

function looksLikePendingSchema(message: string | null | undefined): boolean {
  return /relation .* does not exist|could not find the table|schema cache/i.test(message ?? "");
}

function milestonePriority(milestone: MilestoneRow, now: Date): number {
  if (milestone.status === "blocked") return 0;
  if (milestone.status !== "complete" && parseSortableDate(milestone.target_date) < now.getTime()) return 1;
  if (milestone.status !== "complete") return 2;
  return 3;
}

function submittalPriority(submittal: SubmittalRow, now: Date): number {
  if (submittal.status !== "accepted" && parseSortableDate(submittal.due_date) < now.getTime()) return 0;
  if (submittal.status !== "accepted") return 1;
  return 2;
}

function invoicePriority(invoice: BillingInvoiceRow, now: Date): number {
  const dueAt = parseSortableDate(invoice.due_date);
  if (!["paid", "rejected"].includes(invoice.status) && dueAt < now.getTime()) return 0;
  if (["internal_review", "submitted", "approved_for_payment"].includes(invoice.status)) return 1;
  if (invoice.status === "draft") return 2;
  return 3;
}

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/sign-in");
  }

  const { data: projectData } = await supabase
    .from("projects")
    .select(
      "id, workspace_id, name, summary, status, plan_type, delivery_phase, created_at, updated_at, rtp_posture, rtp_posture_updated_at, aerial_posture, aerial_posture_updated_at"
    )
    .eq("id", projectId)
    .single();

  if (!projectData) {
    notFound();
  }

  const project = projectData as ProjectRow;

  const { data: workspaceData } = await supabase
    .from("workspaces")
    .select("id, name, plan, slug, stage_gate_template_id, stage_gate_template_version, created_at")
    .eq("id", project.workspace_id)
    .single();

  const projectRtpLinkResult = await supabase
    .from("project_rtp_cycle_links")
    .select("id, rtp_cycle_id, portfolio_role, priority_rationale, created_at")
    .eq("project_id", project.id)
    .order("created_at", { ascending: false });

  const projectRtpLinkRows = looksLikePendingSchema(projectRtpLinkResult.error?.message)
    ? []
    : ((projectRtpLinkResult.data ?? []) as ProjectRtpLinkRow[]);
  const projectRtpLinksPending = looksLikePendingSchema(projectRtpLinkResult.error?.message);

  const linkedRtpCycleIds = projectRtpLinkRows.map((item) => item.rtp_cycle_id);
  const linkedRtpCyclesResult = linkedRtpCycleIds.length
    ? await supabase
        .from("rtp_cycles")
        .select("id, title, status, geography_label, horizon_start_year, horizon_end_year")
        .in("id", linkedRtpCycleIds)
    : { data: [], error: null };

  const linkedRtpCycles = looksLikePendingSchema(linkedRtpCyclesResult.error?.message)
    ? []
    : ((linkedRtpCyclesResult.data ?? []) as RtpCycleRow[]);

  const workspaceRtpCyclesResult = await supabase
    .from("rtp_cycles")
    .select("id, title, status, geography_label, horizon_start_year, horizon_end_year")
    .eq("workspace_id", project.workspace_id)
    .order("updated_at", { ascending: false });

  const workspaceRtpCycles = looksLikePendingSchema(workspaceRtpCyclesResult.error?.message)
    ? []
    : ((workspaceRtpCyclesResult.data ?? []) as RtpCycleRow[]);

  const rtpCycleById = new Map(linkedRtpCycles.map((cycle) => [cycle.id, cycle]));
  const existingRtpLinks = projectRtpLinkRows
    .map((link) => {
      const cycle = rtpCycleById.get(link.rtp_cycle_id);
      if (!cycle) return null;
      return {
        id: link.id,
        rtpCycleId: cycle.id,
        title: cycle.title,
        status: cycle.status,
        geographyLabel: cycle.geography_label,
        horizonStartYear: cycle.horizon_start_year,
        horizonEndYear: cycle.horizon_end_year,
        portfolioRole: link.portfolio_role,
        priorityRationale: link.priority_rationale,
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));

  const { data: recentRuns } = await supabase
    .from("runs")
    .select("id, title, created_at, summary_text")
    .eq("workspace_id", project.workspace_id)
    .order("created_at", { ascending: false })
    .limit(5);

  const operationsSummaryPromise = loadWorkspaceOperationsSummaryForWorkspace(
    supabase as unknown as WorkspaceOperationsSupabaseLike,
    project.workspace_id
  );

  const {
    data: projectReportData,
    count: projectReportCount,
  } = await supabase
    .from("reports")
    .select(
      "id, title, summary, report_type, status, updated_at, generated_at, latest_artifact_kind",
      { count: "exact" }
    )
    .eq("project_id", project.id)
    .order("updated_at", { ascending: false })
    .limit(4);

  const { data: recentGateDecisions } = await supabase
    .from("stage_gate_decisions")
    .select("id, gate_id, decision, rationale, decided_at, missing_artifacts")
    .eq("workspace_id", project.workspace_id)
    .order("decided_at", { ascending: false })
    .limit(200);

  const milestoneResult = await supabase
    .from("project_milestones")
    .select("id, title, summary, milestone_type, phase_code, status, owner_label, target_date, actual_date, notes, created_at")
    .eq("project_id", project.id)
    .order("target_date", { ascending: true })
    .limit(8);
  const milestones = looksLikePendingSchema(milestoneResult.error?.message) ? [] : ((milestoneResult.data ?? []) as MilestoneRow[]);
  const projectMilestonesPending = looksLikePendingSchema(milestoneResult.error?.message);

  const submittalResult = await supabase
    .from("project_submittals")
    .select("id, title, submittal_type, status, agency_label, reference_number, due_date, submitted_at, review_cycle, notes, created_at")
    .eq("project_id", project.id)
    .order("due_date", { ascending: true })
    .limit(8);
  const submittals = looksLikePendingSchema(submittalResult.error?.message) ? [] : ((submittalResult.data ?? []) as SubmittalRow[]);
  const projectSubmittalsPending = looksLikePendingSchema(submittalResult.error?.message);

  const { data: deliverables } = await supabase
    .from("project_deliverables")
    .select("id, title, summary, owner_label, due_date, status, created_at")
    .eq("project_id", project.id)
    .order("updated_at", { ascending: false })
    .limit(6);

  const { data: risks } = await supabase
    .from("project_risks")
    .select("id, title, description, severity, status, mitigation, created_at")
    .eq("project_id", project.id)
    .order("updated_at", { ascending: false })
    .limit(6);

  const { data: issues } = await supabase
    .from("project_issues")
    .select("id, title, description, severity, status, owner_label, created_at")
    .eq("project_id", project.id)
    .order("updated_at", { ascending: false })
    .limit(6);

  const { data: decisions } = await supabase
    .from("project_decisions")
    .select("id, title, rationale, status, impact_summary, decided_at, created_at")
    .eq("project_id", project.id)
    .order("updated_at", { ascending: false })
    .limit(6);

  const { data: meetings } = await supabase
    .from("project_meetings")
    .select("id, title, notes, meeting_at, attendees_summary, created_at")
    .eq("project_id", project.id)
    .order("updated_at", { ascending: false })
    .limit(6);

  const invoiceResult = await supabase
    .from("billing_invoice_records")
    .select(
      "id, funding_award_id, invoice_number, consultant_name, billing_basis, status, invoice_date, due_date, amount, retention_percent, retention_amount, net_amount, supporting_docs_status, submitted_to, caltrans_posture, notes, created_at, funding_awards(id, title)"
    )
    .eq("project_id", project.id)
    .order("created_at", { ascending: false })
    .limit(6);
  const projectInvoices = looksLikePendingSchema(invoiceResult.error?.message)
    ? []
    : ((invoiceResult.data ?? []) as BillingInvoiceRow[]).map((invoice) => ({
        ...invoice,
        fundingAward: Array.isArray(invoice.funding_awards) ? (invoice.funding_awards[0] ?? null) : invoice.funding_awards ?? null,
      }));
  const projectInvoicesPending = looksLikePendingSchema(invoiceResult.error?.message);

  const projectFundingProfileResult = await supabase
    .from("project_funding_profiles")
    .select("id, project_id, funding_need_amount, local_match_need_amount, notes, updated_at")
    .eq("project_id", project.id)
    .maybeSingle();
  const projectFundingProfile = looksLikePendingSchema(projectFundingProfileResult.error?.message)
    ? null
    : ((projectFundingProfileResult.data ?? null) as ProjectFundingProfileRow | null);
  const projectFundingProfilePending = looksLikePendingSchema(projectFundingProfileResult.error?.message);

  const fundingAwardsResult = await supabase
    .from("funding_awards")
    .select(
      "id, project_id, program_id, funding_opportunity_id, title, awarded_amount, match_amount, match_posture, obligation_due_at, spending_status, risk_flag, notes, updated_at, created_at, funding_opportunities(id, title), programs(id, title)"
    )
    .eq("project_id", project.id)
    .order("updated_at", { ascending: false })
    .limit(8);
  const fundingAwards = looksLikePendingSchema(fundingAwardsResult.error?.message)
    ? []
    : ((fundingAwardsResult.data ?? []) as FundingAwardRow[]).map((item) => ({
        ...item,
        opportunity: Array.isArray(item.funding_opportunities)
          ? (item.funding_opportunities[0] ?? null)
          : item.funding_opportunities ?? null,
        program: Array.isArray(item.programs) ? (item.programs[0] ?? null) : item.programs ?? null,
      }));
  const fundingAwardsPending = looksLikePendingSchema(fundingAwardsResult.error?.message);

  const fundingOpportunitiesResult = await supabase
    .from("funding_opportunities")
    .select(
      "id, program_id, project_id, title, opportunity_status, decision_state, agency_name, owner_label, cadence_label, expected_award_amount, opens_at, closes_at, decision_due_at, fit_notes, readiness_notes, decision_rationale, decided_at, summary, updated_at, created_at, programs(id, title)"
    )
    .eq("project_id", project.id)
    .order("updated_at", { ascending: false })
    .limit(6);
  const fundingOpportunities = looksLikePendingSchema(fundingOpportunitiesResult.error?.message)
    ? []
    : ((fundingOpportunitiesResult.data ?? []) as FundingOpportunityRow[]).map((item) => ({
        ...item,
        program: Array.isArray(item.programs) ? (item.programs[0] ?? null) : item.programs ?? null,
      }));
  const fundingOpportunitiesPending = looksLikePendingSchema(fundingOpportunitiesResult.error?.message);

  const datasetLinksResult = await supabase
    .from("data_dataset_project_links")
    .select("dataset_id, relationship_type, linked_at")
    .eq("project_id", project.id)
    .order("linked_at", { ascending: false });

  const datasetLinkRows = looksLikePendingSchema(datasetLinksResult.error?.message)
    ? []
    : ((datasetLinksResult.data ?? []) as Array<{
        dataset_id: string;
        relationship_type: string;
        linked_at: string;
      }>);

  const linkedDatasetIds = datasetLinkRows.map((item) => item.dataset_id);

  const datasetsResult = linkedDatasetIds.length
    ? await supabase
        .from("data_datasets")
        .select("id, connector_id, name, status, vintage_label, last_refreshed_at")
        .in("id", linkedDatasetIds)
    : { data: [], error: null };

  const linkedDatasetRows = looksLikePendingSchema(datasetsResult.error?.message)
    ? []
    : ((datasetsResult.data ?? []) as Array<{
        id: string;
        connector_id: string | null;
        name: string;
        status: string;
        vintage_label: string | null;
        last_refreshed_at: string | null;
      }>);

  const linkedConnectorIds = linkedDatasetRows
    .map((item) => item.connector_id)
    .filter((value): value is string => Boolean(value));

  const connectorsResult = linkedConnectorIds.length
    ? await supabase.from("data_connectors").select("id, display_name").in("id", linkedConnectorIds)
    : { data: [], error: null };

  const connectorMap = new Map(
    (looksLikePendingSchema(connectorsResult.error?.message)
      ? []
      : ((connectorsResult.data ?? []) as Array<{ id: string; display_name: string }>)).map((connector) => [
      connector.id,
      connector.display_name,
    ])
  );

  const datasetMap = new Map(linkedDatasetRows.map((dataset) => [dataset.id, dataset]));
  const linkedDatasets: LinkedDatasetItem[] = datasetLinkRows
    .map((link) => {
      const dataset = datasetMap.get(link.dataset_id);
      if (!dataset) return null;
      return {
        datasetId: dataset.id,
        name: dataset.name,
        status: dataset.status,
        relationshipType: link.relationship_type,
        connectorLabel: dataset.connector_id ? connectorMap.get(dataset.connector_id) ?? null : null,
        vintageLabel: dataset.vintage_label,
        lastRefreshedAt: dataset.last_refreshed_at,
      } satisfies LinkedDatasetItem;
    })
    .filter((item): item is LinkedDatasetItem => Boolean(item))
    .slice(0, 6);

  const dataHubMigrationPending = looksLikePendingSchema(datasetLinksResult.error?.message);

  const stageGateSummary = buildProjectStageGateSummary(recentGateDecisions as Array<{
    gate_id: string;
    decision: string;
    rationale: string | null;
    decided_at: string | null;
    missing_artifacts?: string[] | null;
  }>);

  const now = new Date();
  const prioritizedMilestones = [...milestones].sort((left, right) => {
    const priorityDiff = milestonePriority(left, now) - milestonePriority(right, now);
    if (priorityDiff !== 0) return priorityDiff;
    return compareDateValues(left.target_date, right.target_date);
  });
  const prioritizedSubmittals = [...submittals].sort((left, right) => {
    const priorityDiff = submittalPriority(left, now) - submittalPriority(right, now);
    if (priorityDiff !== 0) return priorityDiff;
    return compareDateValues(left.due_date, right.due_date);
  });
  const prioritizedProjectInvoices = [...projectInvoices].sort((left, right) => {
    const priorityDiff = invoicePriority(left, now) - invoicePriority(right, now);
    if (priorityDiff !== 0) return priorityDiff;
    return compareDateValues(left.due_date, right.due_date);
  });
  const firstBlockedMilestone = prioritizedMilestones.find((milestone) => milestone.status === "blocked") ?? null;
  const firstOverdueMilestone =
    prioritizedMilestones.find(
      (milestone) => milestone.status !== "complete" && parseSortableDate(milestone.target_date) < now.getTime()
    ) ?? null;
  const firstOverdueSubmittal =
    prioritizedSubmittals.find(
      (submittal) => submittal.status !== "accepted" && parseSortableDate(submittal.due_date) < now.getTime()
    ) ?? null;
  const firstOverdueInvoice =
    prioritizedProjectInvoices.find(
      (invoice) => !["paid", "rejected"].includes(invoice.status) && parseSortableDate(invoice.due_date) < now.getTime()
    ) ?? null;
  const awardLinkedProjectInvoices = projectInvoices.filter((invoice) => Boolean(invoice.funding_award_id));
  const fundingStackSummary = buildProjectFundingStackSummary(
    projectFundingProfile,
    fundingAwards,
    fundingOpportunities,
    awardLinkedProjectInvoices
  );
  const fundingNeedAmount = fundingStackSummary.fundingNeedAmount;
  const committedFundingAmount = fundingStackSummary.committedFundingAmount;
  const committedMatchAmount = fundingStackSummary.committedMatchAmount;
  const likelyFundingAmount = fundingStackSummary.likelyFundingAmount;
  const remainingFundingGap = fundingStackSummary.unfundedAfterLikelyAmount;
  const awardWatchCount = fundingStackSummary.awardRiskCount;
  const nextObligationAward = fundingAwards.find((award) => award.obligation_due_at === fundingStackSummary.nextObligationAt) ?? null;
  const pursueFundingCount = fundingOpportunities.filter((item) => item.decision_state === "pursue").length;
  const monitorFundingCount = fundingOpportunities.filter((item) => item.decision_state === "monitor").length;
  const skipFundingCount = fundingOpportunities.filter((item) => item.decision_state === "skip").length;
  const openFundingCount = fundingOpportunities.filter((item) => item.opportunity_status === "open").length;
  const pursuedFundingAmount = fundingOpportunities.reduce((sum, item) => {
    if (item.decision_state !== "pursue" || item.opportunity_status === "awarded" || item.opportunity_status === "archived") {
      return sum;
    }
    return sum + Number(item.expected_award_amount ?? 0);
  }, 0);
  const linkedRtpCycleCount = existingRtpLinks.length;
  const constrainedRtpLinkCount = existingRtpLinks.filter((link) => link.portfolioRole === "constrained").length;
  const illustrativeRtpLinkCount = existingRtpLinks.filter((link) => link.portfolioRole === "illustrative").length;
  const candidateRtpLinkCount = existingRtpLinks.filter((link) => link.portfolioRole === "candidate").length;
  const invoiceSummary = summarizeBillingInvoiceRecords(projectInvoices);
  const invoiceSummaryByFundingAwardId = new Map(
    fundingAwards.map((award) => [
      award.id,
      summarizeBillingInvoiceRecords(projectInvoices.filter((invoice) => invoice.funding_award_id === award.id)),
    ])
  );
  const invoiceRecordsByFundingAwardId = new Map(
    fundingAwards.map((award) => [award.id, projectInvoices.filter((invoice) => invoice.funding_award_id === award.id)])
  );
  const unlinkedProjectInvoices = projectInvoices.filter((invoice) => !invoice.funding_award_id);
  const unlinkedProjectInvoiceSummary = summarizeBillingInvoiceRecords(unlinkedProjectInvoices);
  const projectReportIds = ((projectReportData ?? []) as ProjectReportRow[]).map(
    (report) => report.id
  );
  const reportArtifactsResult = projectReportIds.length
    ? await supabase
        .from("report_artifacts")
        .select("report_id, generated_at, metadata_json")
        .in("report_id", projectReportIds)
        .order("generated_at", { ascending: false })
    : { data: [], error: null };
  const latestArtifactByReportId = new Map<string, ReportArtifactRow>();
  for (const artifact of (reportArtifactsResult.data ?? []) as ReportArtifactRow[]) {
    if (!latestArtifactByReportId.has(artifact.report_id)) {
      latestArtifactByReportId.set(artifact.report_id, artifact);
    }
  }

  const projectReports = ((projectReportData ?? []) as ProjectReportRow[])
    .map((report) => {
      const comparisonAggregate = parseStoredComparisonSnapshotAggregate(
        latestArtifactByReportId.get(report.id)?.metadata_json ?? null
      );
      const comparisonDigest = describeComparisonSnapshotAggregate(
        comparisonAggregate
      );
      const evidenceChainDigest = describeEvidenceChainSummary(
        parseStoredEvidenceChainSummary(
          latestArtifactByReportId.get(report.id)?.metadata_json ?? null
        )
      );

      return {
        ...report,
        packetFreshness: getReportPacketFreshness({
          latestArtifactKind: report.latest_artifact_kind,
          generatedAt: latestArtifactByReportId.get(report.id)?.generated_at ?? report.generated_at,
          updatedAt: report.updated_at,
        }),
        comparisonAggregate,
        comparisonDigest,
        evidenceChainDigest,
      };
    })
    .sort((left, right) => {
      const freshnessPriority =
        getReportPacketPriority(left.packetFreshness.label) -
        getReportPacketPriority(right.packetFreshness.label);
      if (freshnessPriority !== 0) {
        return freshnessPriority;
      }

      return new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime();
    });
  const reportRecordCount = projectReportCount ?? projectReports.length;
  const refreshRecommendedReportCount = projectReports.filter(
    (report) => report.packetFreshness.label === PACKET_FRESHNESS_LABELS.REFRESH_RECOMMENDED
  ).length;
  const noPacketReportCount = projectReports.filter(
    (report) => report.packetFreshness.label === PACKET_FRESHNESS_LABELS.NO_PACKET
  ).length;
  const evidenceBackedReportCount = projectReports.filter(
    (report) => Boolean(report.evidenceChainDigest)
  ).length;
  const comparisonBackedReportCount = projectReports.filter(
    (report) => Boolean(report.comparisonDigest)
  ).length;
  const governanceHoldReportCount = projectReports.filter(
    (report) => Boolean(report.evidenceChainDigest?.blockedGateDetail)
  ).length;
  const reportAttentionCount = refreshRecommendedReportCount + noPacketReportCount;
  const recommendedReport = projectReports[0] ?? null;
  const comparisonBackedFundingReport =
    projectReports.find((report) => Boolean(report.comparisonDigest)) ?? null;
  const projectGrantModelingEvidence =
    comparisonBackedFundingReport?.comparisonAggregate && comparisonBackedFundingReport.comparisonDigest
      ? {
          projectId: project.id,
          comparisonBackedCount: comparisonBackedReportCount,
          leadComparisonReport: {
            id: comparisonBackedFundingReport.id,
            title: comparisonBackedFundingReport.title,
            href: getReportNavigationHref(
              comparisonBackedFundingReport.id,
              comparisonBackedFundingReport.packetFreshness.label
            ),
            packetFreshness: comparisonBackedFundingReport.packetFreshness,
            comparisonAggregate: comparisonBackedFundingReport.comparisonAggregate,
            comparisonDigest: comparisonBackedFundingReport.comparisonDigest,
          },
        }
      : null;
  const projectGrantModelingReadiness = describeProjectGrantModelingReadiness(
    projectGrantModelingEvidence
  );
  const projectGrantModelingSupport = buildGrantDecisionModelingSupport(
    projectGrantModelingEvidence,
    project.name
  );
  const projectReportQueueItems = projectReports.slice(0, 4).map((report) => {
    const badges: Array<{ label: string; value?: string | number | null }> = [];
    if (report.packetFreshness.label !== PACKET_FRESHNESS_LABELS.CURRENT) {
      badges.push({ label: report.packetFreshness.label });
    }
    if (report.comparisonDigest) {
      badges.push({ label: "Comparison-backed" });
    }
    if (report.evidenceChainDigest?.blockedGateDetail) {
      badges.push({ label: "Governance hold" });
    }

    return {
      key: report.id,
      href: getReportNavigationHref(report.id, report.packetFreshness.label),
      title: report.title,
      subtitle:
        report.packetFreshness.label === PACKET_FRESHNESS_LABELS.REFRESH_RECOMMENDED
          ? `First action: refresh ${report.title}`
          : report.packetFreshness.label === PACKET_FRESHNESS_LABELS.NO_PACKET
            ? `First action: generate ${report.title}`
            : report.evidenceChainDigest?.blockedGateDetail
              ? `First action: review governance hold in ${report.title}`
              : report.comparisonDigest
                ? `First action: review comparison-backed packet ${report.title}`
                : `First action: review ${report.title}`,
      detail:
        report.evidenceChainDigest?.blockedGateDetail ??
        report.comparisonDigest?.detail ??
        report.packetFreshness.detail,
      badges,
    };
  });
  const projectControlsSummary = buildProjectControlsSummary(
    milestones,
    submittals,
    projectInvoices,
    {
      refreshRecommendedCount: refreshRecommendedReportCount,
      noPacketCount: noPacketReportCount,
      comparisonBackedCount: comparisonBackedReportCount,
      recommendedReportId: recommendedReport?.id ?? null,
      recommendedReportTitle: recommendedReport?.title ?? null,
    },
    now
  );

  const aerialMissionsResult = await supabase
    .from("aerial_missions")
    .select("id, title, status, mission_type, geography_label, collected_at, updated_at")
    .eq("project_id", project.id)
    .order("updated_at", { ascending: false });
  const aerialMissions = looksLikePendingSchema(aerialMissionsResult.error?.message)
    ? []
    : ((aerialMissionsResult.data ?? []) as Array<{
        id: string;
        title: string;
        status: string;
        mission_type: string;
        geography_label: string | null;
        collected_at: string | null;
        updated_at: string;
      }>);
  const aerialMissionIds = aerialMissions.map((m) => m.id);
  const aerialPackagesResult = aerialMissionIds.length
    ? await supabase
        .from("aerial_evidence_packages")
        .select("id, mission_id, title, package_type, status, verification_readiness, updated_at")
        .in("mission_id", aerialMissionIds)
        .order("updated_at", { ascending: false })
    : { data: [], error: null };
  const aerialPackages = looksLikePendingSchema(aerialPackagesResult.error?.message)
    ? []
    : ((aerialPackagesResult.data ?? []) as Array<{
        id: string;
        mission_id: string;
        title: string;
        package_type: string;
        status: string;
        verification_readiness: string;
        updated_at: string;
      }>);
  const aerialProjectPosture = buildAerialProjectPosture(aerialMissions, aerialPackages);
  const aerialProjectPostureDetail = describeAerialProjectPosture(aerialProjectPosture);

  const operationsSummary = await operationsSummaryPromise;

  const timelineItems: TimelineItem[] = [
    ...milestones.map((item) => ({
      id: `milestone-${item.id}`,
      type: "milestone",
      title: item.title,
      description: item.summary || item.notes || "Milestone added to the project control room.",
      at: item.actual_date || item.target_date || item.created_at,
      badge: `Milestone · ${titleize(item.status)}`,
      tone: toneForMilestoneStatus(item.status),
    })),
    ...submittals.map((item) => ({
      id: `submittal-${item.id}`,
      type: "submittal",
      title: item.title,
      description:
        item.notes ||
        `${titleize(item.submittal_type)}${item.agency_label ? ` · ${item.agency_label}` : ""}`,
      at: item.submitted_at || item.due_date || item.created_at,
      badge: `Submittal · ${titleize(item.status)}`,
      tone: toneForSubmittalStatus(item.status),
    })),
    ...projectInvoices.map((item) => ({
      id: `invoice-${item.id}`,
      type: "invoice",
      title: item.invoice_number,
      description: `${fmtCurrency(item.net_amount)} net${item.submitted_to ? ` · ${item.submitted_to}` : ""}`,
      at: item.invoice_date || item.created_at,
      badge: `Invoice · ${titleize(item.status)}`,
      tone: toneForInvoiceStatus(item.status),
    })),
    ...(deliverables ?? []).map((item) => ({
      id: `deliverable-${item.id}`,
      type: "deliverable",
      title: item.title,
      description: item.summary || "Deliverable added to project.",
      at: item.created_at,
      badge: `Deliverable · ${titleize(item.status)}`,
      tone: toneForDeliverableStatus(item.status),
    })),
    ...(risks ?? []).map((item) => ({
      id: `risk-${item.id}`,
      type: "risk",
      title: item.title,
      description: item.description || "Risk recorded for this project.",
      at: item.created_at,
      badge: `Risk · ${titleize(item.severity)}`,
      tone: toneForRiskSeverity(item.severity),
    })),
    ...(issues ?? []).map((item) => ({
      id: `issue-${item.id}`,
      type: "issue",
      title: item.title,
      description: item.description || "Issue logged for this project.",
      at: item.created_at,
      badge: `Issue · ${titleize(item.status)}`,
      tone: toneForRiskSeverity(item.severity),
    })),
    ...(decisions ?? []).map((item) => ({
      id: `decision-${item.id}`,
      type: "decision",
      title: item.title,
      description: item.rationale,
      at: item.decided_at || item.created_at,
      badge: `Decision · ${titleize(item.status)}`,
      tone: toneForDecision(item.status),
    })),
    ...(meetings ?? []).map((item) => ({
      id: `meeting-${item.id}`,
      type: "meeting",
      title: item.title,
      description: item.notes || item.attendees_summary || "Meeting logged for this project.",
      at: item.meeting_at || item.created_at,
      badge: "Meeting",
      tone: "info" as const,
    })),
    ...(recentRuns ?? []).map((item) => ({
      id: `run-${item.id}`,
      type: "run",
      title: item.title,
      description: item.summary_text || "Analysis run created.",
      at: item.created_at,
      badge: "Analysis Run",
      tone: "success" as const,
    })),
    ...(recentGateDecisions ?? []).map((item) => ({
      id: `gate-${item.id}`,
      type: "gate",
      title: item.gate_id,
      description: item.rationale,
      at: item.decided_at,
      badge: `Stage Gate · ${item.decision}`,
      tone: toneForDecision(item.decision),
    })),
  ]
    .sort((a, b) => {
      const aTime = a.at ? new Date(a.at).getTime() : 0;
      const bTime = b.at ? new Date(b.at).getTime() : 0;
      return bTime - aTime;
    })
    .slice(0, 12);

  const openRiskCount = (risks ?? []).filter((risk) => risk.status !== "closed" && risk.status !== "mitigated").length;
  const openIssueCount = (issues ?? []).filter((issue) => issue.status !== "resolved").length;

  return (
    <section className="module-page">
      <CartographicSurfaceWide />
      <div className="module-breadcrumb">
        <Link href="/projects" className="transition hover:text-foreground">
          Projects
        </Link>
        <ArrowRight className="h-4 w-4" />
        <span className="text-foreground">{project.name}</span>
      </div>

      <ProjectPostureHeader
        project={project}
        workspaceData={workspaceData}
        projectControlsSummary={projectControlsSummary}
        linkedRtpCycleCount={linkedRtpCycleCount}
        constrainedRtpLinkCount={constrainedRtpLinkCount}
        illustrativeRtpLinkCount={illustrativeRtpLinkCount}
        candidateRtpLinkCount={candidateRtpLinkCount}
        projectRtpLinksPending={projectRtpLinksPending}
        workspaceRtpCycles={workspaceRtpCycles}
        existingRtpLinks={existingRtpLinks}
        deliverableCount={deliverables?.length ?? 0}
        openRiskCount={openRiskCount}
        openIssueCount={openIssueCount}
        reportRecordCount={reportRecordCount}
        reportAttentionCount={reportAttentionCount}
        evidenceBackedReportCount={evidenceBackedReportCount}
        refreshRecommendedReportCount={refreshRecommendedReportCount}
        governanceHoldReportCount={governanceHoldReportCount}
        comparisonBackedReportCount={comparisonBackedReportCount}
        projectReports={projectReports}
        projectReportQueueItems={projectReportQueueItems}
        recommendedReport={recommendedReport}
        projectGrantModelingEvidence={projectGrantModelingEvidence}
        projectGrantModelingReadiness={projectGrantModelingReadiness}
        projectGrantModelingSupport={projectGrantModelingSupport}
      />

      <ProjectPostureUnified
        rtpPosture={project.rtp_posture}
        rtpPostureUpdatedAt={project.rtp_posture_updated_at}
        aerialPosture={project.aerial_posture}
        aerialPostureUpdatedAt={project.aerial_posture_updated_at}
      />

      <PilotWorkflowHandoff
        currentStep="context"
        projectId={project.id}
        title="Continue this pilot story"
        description={`${project.name} is the context anchor. Move next into analysis evidence, engagement signal, packet assembly, and readiness proof without losing the project thread.`}
      />

      <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <div className="space-y-6">
          <ProjectRecordComposer projectId={project.id} />
          <WorkspaceRuntimeCue summary={operationsSummary} />
          <WorkspaceCommandBoard
            summary={operationsSummary}
            label="Workspace command board"
            title="What should move around this project"
            description={`This project now sits inside the same shared workspace command queue as the dashboard, registries, detail pages, and assistant runtime. Use it to keep ${project.name} aligned with broader packet, funding-window, and setup pressure across the workspace.`}
          />
        </div>

        <ProjectStageGateBoard stageGateSummary={stageGateSummary} />
      </div>

      <ProjectFundingPanel
        projectId={project.id}
        projectFundingProfile={projectFundingProfile}
        projectFundingProfilePending={projectFundingProfilePending}
        fundingAwardsPending={fundingAwardsPending}
        fundingOpportunitiesPending={fundingOpportunitiesPending}
        fundingAwards={fundingAwards}
        fundingOpportunities={fundingOpportunities}
        fundingStackSummary={fundingStackSummary}
        fundingNeedAmount={fundingNeedAmount}
        committedFundingAmount={committedFundingAmount}
        committedMatchAmount={committedMatchAmount}
        likelyFundingAmount={likelyFundingAmount}
        remainingFundingGap={remainingFundingGap}
        awardWatchCount={awardWatchCount}
        nextObligationAward={nextObligationAward}
        pursueFundingCount={pursueFundingCount}
        monitorFundingCount={monitorFundingCount}
        skipFundingCount={skipFundingCount}
        pursuedFundingAmount={pursuedFundingAmount}
        openFundingCount={openFundingCount}
        invoiceSummaryByFundingAwardId={invoiceSummaryByFundingAwardId}
        invoiceRecordsByFundingAwardId={invoiceRecordsByFundingAwardId}
        unlinkedProjectInvoices={unlinkedProjectInvoices}
        unlinkedProjectInvoiceSummary={unlinkedProjectInvoiceSummary}
        comparisonBackedFundingReport={comparisonBackedFundingReport}
      />

      <ProjectDeliveryBoard
        project={project}
        projectControlsSummary={projectControlsSummary}
        invoiceSummary={invoiceSummary}
        recommendedReport={recommendedReport}
        firstBlockedMilestone={firstBlockedMilestone}
        firstOverdueMilestone={firstOverdueMilestone}
        firstOverdueSubmittal={firstOverdueSubmittal}
        firstOverdueInvoice={firstOverdueInvoice}
        projectMilestonesPending={projectMilestonesPending}
        milestones={milestones}
        prioritizedMilestones={prioritizedMilestones}
        projectSubmittalsPending={projectSubmittalsPending}
        submittals={submittals}
        prioritizedSubmittals={prioritizedSubmittals}
        projectInvoicesPending={projectInvoicesPending}
        projectInvoices={projectInvoices}
        prioritizedProjectInvoices={prioritizedProjectInvoices}
        deliverables={deliverables}
      />

      <ProjectRiskAndDecisionLog
        risks={risks}
        issues={issues}
        decisions={decisions}
        meetings={meetings}
      />

      <ProjectEvidenceAndActivity
        dataHubMigrationPending={dataHubMigrationPending}
        linkedDatasets={linkedDatasets}
        recentRuns={recentRuns}
        aerialProjectPosture={aerialProjectPosture}
        aerialProjectPostureDetail={aerialProjectPostureDetail}
        aerialMissions={aerialMissions}
        aerialPackages={aerialPackages}
        projectId={project.id}
        timelineItems={timelineItems}
      />
    </section>
  );
}
