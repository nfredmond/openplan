import { ReadFailureLog } from "@/lib/ui/read-failures";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowRight,
  FileStack,
  Sparkles,
} from "lucide-react";
import { CartographicSelectionLink } from "@/components/cartographic/cartographic-selection-link";
import { navLabel } from "@/components/nav/nav-registry";
import { ReportPacketCommandQueue } from "@/components/reports/report-packet-command-queue";
import { ReportCreator, type ModelingCountyRunOption } from "@/components/reports/report-creator";
import { FigureRow } from "@/components/ui/figure-row";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/state-block";
import { WorkspaceMembershipRequired } from "@/components/workspaces/workspace-membership-required";
import {
  buildGrantDecisionModelingSupport,
  describeProjectGrantModelingReadiness,
} from "@/lib/grants/modeling-evidence";
import {
  buildRtpReleaseReviewSummary,
  parseStoredRtpPublicReviewSummary,
} from "@/lib/rtp/catalog";
import { parseStoredRtpFundingReview } from "@/lib/operations/workspace-summary";
import {
  loadReportRegistryRows,
  type ReportRegistryRow as ReportRow,
} from "@/lib/reports/api";
import { createClient } from "@/lib/supabase/server";
import { loadCurrentWorkspaceMembership } from "@/lib/workspaces/current";
import {
  describeComparisonSnapshotAggregate,
  describeFundingSnapshot,
  describeEvidenceChainSummary,
  formatDateTime,
  formatReportStatusLabel,
  formatReportTypeLabel,
  getReportNavigationHref,
  getReportPacketActionLabel,
  getReportPacketFreshness,
  getReportPacketPriority,
  getReportPacketWorkStatus,
  matchesReportFreshnessFilter,
  matchesReportPostureFilter,
  normalizeReportFreshnessFilter,
  normalizeReportPostureFilter,
  parseStoredComparisonSnapshotAggregate,
  parseStoredEvidenceChainSummary,
  parseStoredFundingSnapshot,
  parseStoredScenarioSpineSummary,
  reportStatusTone,
  titleize,
  type ReportFreshnessFilter,
  type ReportPostureFilter,
} from "@/lib/reports/catalog";
import { PACKET_FRESHNESS_LABELS } from "@/lib/reports/packet-labels";
import {
  describeReportSourceReviewPosture,
} from "@/lib/reports/source-review-posture";
import {
  artifactSafetyEvidenceReadFailed,
  buildReportRegistryDriftSummary,
  resolveTrackedReportSourceUpdatedAt,
} from "@/lib/reports/report-registry-freshness";
import { resolveRtpFundingFollowThrough } from "@/lib/operations/grants-links";
import type { ModelingClaimStatus } from "@/lib/models/evidence-backbone";
import { moduleMetadata } from "@/lib/ui/page-title";
import { ReadFailureNotice } from "@/components/ui/read-failure-notice";
import { formatMoney } from "@/lib/money/format";
import { PlanningContextStrip } from "@/components/projects/planning-context-strip";
import {
  resolvePlanningContext,
  withPlanningContext,
} from "@/lib/projects/planning-context";

export const metadata = moduleMetadata("Reports");

type ReportsPageSearchParams = Promise<{
  freshness?: string;
  posture?: string;
  projectId?: string;
}>;

type ReportArtifactRow = {
  report_id: string;
  generated_at: string;
  metadata_json: Record<string, unknown> | null;
};

type CountyRunModelingOptionRow = {
  id: string;
  workspace_id: string;
  run_name: string;
  geography_label: string | null;
  stage: string | null;
  updated_at: string | null;
};

type ModelingClaimDecisionOptionRow = {
  county_run_id: string | null;
  claim_status: ModelingClaimStatus;
  status_reason: string | null;
  validation_summary_json: Record<string, unknown> | null;
  decided_at: string | null;
};

function buildReportsFilterHref(filters: {
  freshness: ReportFreshnessFilter;
  posture: ReportPostureFilter;
  projectId?: string | null;
}) {
  const params = new URLSearchParams();
  if (filters.freshness !== "all") {
    params.set("freshness", filters.freshness);
  }
  if (filters.posture !== "all") {
    params.set("posture", filters.posture);
  }
  if (filters.projectId) {
    params.set("projectId", filters.projectId);
  }

  const query = params.toString();
  return query ? `/reports?${query}` : "/reports";
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: ReportsPageSearchParams;
}) {
  const filters = await searchParams;
  const selectedFreshnessFilter = normalizeReportFreshnessFilter(filters.freshness);
  const selectedPostureFilter = normalizeReportPostureFilter(filters.posture);
  const projectFilterId = filters.projectId?.trim() || null;
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
        moduleLabel="Reports"
        title="Reports need a workspace"
        description="Report packets, run attachments, and artifact history only exist inside a workspace. You are signed in, but this account is not attached to one yet."
      />
    );
  }

  const [
    reportsRead,
    projectsRead,
    runsRead,
    countyRunsRead,
    modelingClaimDecisionsRead,
  ] =
    await Promise.all([
      loadReportRegistryRows(supabase, membership.workspace_id),
      // Scoped like the county_runs/claims reads below always were — the page
      // was internally inconsistent about which workspace it described, and
      // the unscoped runs .limit(30) could crowd the active workspace's runs
      // out of its own picker for multi-workspace members (2026-08-03 review).
      supabase
        .from("projects")
        .select("id, workspace_id, name")
        .eq("workspace_id", membership.workspace_id)
        .order("updated_at", { ascending: false }),
      supabase
        .from("runs")
        .select("id, workspace_id, title, created_at")
        .eq("workspace_id", membership.workspace_id)
        .order("created_at", { ascending: false })
        .limit(30),
      supabase
        .from("county_runs")
        .select("id, workspace_id, run_name, geography_label, stage, updated_at")
        .eq("workspace_id", membership.workspace_id)
        .order("updated_at", { ascending: false })
        .limit(20),
      supabase
        .from("modeling_claim_decisions")
        .select("county_run_id, claim_status, status_reason, validation_summary_json, decided_at")
        .eq("workspace_id", membership.workspace_id)
        .eq("track", "assignment")
        .not("county_run_id", "is", null)
        .order("decided_at", { ascending: false })
        .limit(100),
    ]);

  /**
   * WHAT COULD NOT BE READ ON THIS PAGE.
   *
   * The registry's empty state invites a planner to generate their first report.
   * Rendered after a failed read it invites them to regenerate work the workspace
   * already holds — and the evidence pickers below it (runs, county runs, claim
   * decisions) would silently offer a shorter list, so a report could be composed
   * citing less evidence than exists without anything saying so.
   */
  const reads = new ReadFailureLog();
  const reportsReadFailed = reads.check("this workspace's reports", reportsRead);
  const projectsReadFailed = reads.check("this workspace's projects", projectsRead);
  reads.check("model runs available as evidence", runsRead);
  reads.check("county runs available as evidence", countyRunsRead);
  reads.check("recorded modeling claim decisions", modelingClaimDecisionsRead);

  const reportsData = reportsRead.data;
  const projectsData = projectsRead.data;
  const runsData = runsRead.data;
  const countyRunsData = countyRunsRead.data;
  const modelingClaimDecisionsData = modelingClaimDecisionsRead.data;
  const planningContext = resolvePlanningContext(
    projectFilterId,
    projectFilterId
      ? ((projectsData ?? []) as Array<{ id: string; name: string }>).find(
          (project) => project.id === projectFilterId
        ) ?? null
      : null,
    projectFilterId && projectsReadFailed
      ? projectsRead.error ?? { message: "Project context could not be read." }
      : null
  );

  const projectIds = ((reportsData ?? []) as ReportRow[])
    .map((report) => report.project_id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  const safetyIngestRead = projectIds.length
    ? await supabase
        .from("safety_crash_ingests")
        .select("project_id, created_at")
        .eq("workspace_id", membership.workspace_id)
        .in("project_id", projectIds)
        .order("created_at", { ascending: false })
    : { data: [], error: null };
  const safetyIngestReadFailed = reads.check(
    "project-linked crash evidence used for packet freshness",
    safetyIngestRead,
  );
  const latestSafetyAtByProjectId = new Map<string, string>();
  for (const row of (safetyIngestRead.data ?? []) as Array<{ project_id: string | null; created_at: string }>) {
    if (row.project_id && !latestSafetyAtByProjectId.has(row.project_id)) {
      latestSafetyAtByProjectId.set(row.project_id, row.created_at);
    }
  }

  const reportIds = ((reportsData ?? []) as ReportRow[]).map((report) => report.id);
  const { data: artifactsData } = reportIds.length
    ? await supabase
        .from("report_artifacts")
        .select("report_id, generated_at, metadata_json")
        .in("report_id", reportIds)
        .order("generated_at", { ascending: false })
    : { data: [] };

  const latestArtifactByReportId = new Map<string, ReportArtifactRow>();
  for (const artifact of (artifactsData ?? []) as ReportArtifactRow[]) {
    if (!latestArtifactByReportId.has(artifact.report_id)) {
      latestArtifactByReportId.set(artifact.report_id, artifact);
    }
  }
  const modelingClaimByCountyRunId = new Map<string, ModelingClaimDecisionOptionRow>();
  for (const decision of (modelingClaimDecisionsData ?? []) as ModelingClaimDecisionOptionRow[]) {
    if (decision.county_run_id && !modelingClaimByCountyRunId.has(decision.county_run_id)) {
      modelingClaimByCountyRunId.set(decision.county_run_id, decision);
    }
  }
  const modelingCountyRuns: ModelingCountyRunOption[] = ((countyRunsData ?? []) as CountyRunModelingOptionRow[]).map(
    (run) => {
      const claimDecision = modelingClaimByCountyRunId.get(run.id) ?? null;

      return {
        id: run.id,
        workspace_id: run.workspace_id,
        runName: run.run_name,
        geographyLabel: run.geography_label,
        stage: run.stage,
        updatedAt: run.updated_at,
        claimStatus: claimDecision?.claim_status ?? null,
        statusReason: claimDecision?.status_reason ?? null,
        validationSummary: claimDecision?.validation_summary_json ?? null,
        decidedAt: claimDecision?.decided_at ?? null,
      };
    }
  );

  const reports = ((reportsData ?? []) as ReportRow[])
    .filter((report) => (projectFilterId ? report.project_id === projectFilterId : true))
    .map((report) => {
      const latestArtifact = latestArtifactByReportId.get(report.id) ?? null;
      const evidenceChainSummary = parseStoredEvidenceChainSummary(
        latestArtifact?.metadata_json ?? null
      );
      const scenarioSpineSummary = parseStoredScenarioSpineSummary(
        latestArtifact?.metadata_json ?? null
      );
      const comparisonSnapshotAggregate = parseStoredComparisonSnapshotAggregate(
        latestArtifact?.metadata_json ?? null
      );
      const fundingSnapshot = parseStoredFundingSnapshot(
        latestArtifact?.metadata_json ?? null
      );
      const storedRtpFundingReview = parseStoredRtpFundingReview(
        latestArtifact?.metadata_json ?? null
      );
      const storedRtpPublicReviewSummary = parseStoredRtpPublicReviewSummary(
        latestArtifact?.metadata_json ?? null
      );
      const rtpCycle = Array.isArray(report.rtp_cycles)
        ? report.rtp_cycles[0] ?? null
        : report.rtp_cycles ?? null;
      const packetGeneratedAt = latestArtifact?.generated_at ?? report.generated_at;
      const safetyUpdatedAt = report.project_id
        ? latestSafetyAtByProjectId.get(report.project_id) ?? null
        : null;
      const computedPacketFreshness = getReportPacketFreshness({
        latestArtifactKind: report.latest_artifact_kind,
        generatedAt: packetGeneratedAt,
        updatedAt: resolveTrackedReportSourceUpdatedAt({
          generatedAt: packetGeneratedAt,
          reportUpdatedAt: report.updated_at,
          cycleUpdatedAt: rtpCycle?.updated_at ?? null,
          artifactMetadata: latestArtifact?.metadata_json ?? null,
          safetyUpdatedAt,
        }),
      });
      const packetSafetyEvidenceReadFailed = artifactSafetyEvidenceReadFailed(
        latestArtifact?.metadata_json
      );
      const packetFreshness =
        (packetSafetyEvidenceReadFailed || (safetyIngestReadFailed && report.project_id)) &&
        computedPacketFreshness.label === PACKET_FRESHNESS_LABELS.CURRENT
          ? {
              label: PACKET_FRESHNESS_LABELS.REFRESH_RECOMMENDED,
              tone: "warning" as const,
              detail: packetSafetyEvidenceReadFailed
                ? "This packet recorded a failed project crash-evidence read and is not ready until it regenerates successfully."
                : "Project-linked crash evidence could not be checked, so this packet is not verified against every live source.",
            }
          : computedPacketFreshness;
      const grantsFollowThrough = resolveRtpFundingFollowThrough(fundingSnapshot);
      const sourceReviewDriftSummary = buildReportRegistryDriftSummary({
        packetFreshnessLabel: packetFreshness.label,
        generatedAt: packetGeneratedAt,
        reportUpdatedAt: report.updated_at,
        rtpCycleUpdatedAt: rtpCycle?.updated_at ?? null,
        safetyUpdatedAt,
        safetyEvidenceReadFailed: packetSafetyEvidenceReadFailed,
      });
      const evidenceChainDigest = describeEvidenceChainSummary(evidenceChainSummary);
      const sourceReviewPosture = describeReportSourceReviewPosture({
        hasGeneratedArtifact: Boolean(report.latest_artifact_kind),
        evidenceSummary: evidenceChainDigest,
        driftSummary: sourceReviewDriftSummary,
      });
      const rtpReleaseReviewSummary = storedRtpPublicReviewSummary
        ? buildRtpReleaseReviewSummary({
            packetFreshnessLabel: packetFreshness.label,
            publicReviewSummary: storedRtpPublicReviewSummary,
          })
        : null;
      const project = Array.isArray(report.projects)
        ? report.projects[0] ?? null
        : report.projects ?? null;
      const engagementCampaign = Array.isArray(report.engagement_campaigns)
        ? report.engagement_campaigns[0] ?? null
        : report.engagement_campaigns ?? null;
      const landUsePlan = Array.isArray(report.land_use_plans)
        ? report.land_use_plans[0] ?? null
        : report.land_use_plans ?? null;
      const targetLabel = rtpCycle ? `RTP cycle · ${rtpCycle.title}` : engagementCampaign ? `Campaign · ${engagementCampaign.title}` : landUsePlan ? `Land use plan · ${landUsePlan.title}` : project?.name ?? "No project";
      const comparisonSnapshotDigest = describeComparisonSnapshotAggregate(
        comparisonSnapshotAggregate
      );
      const grantModelingEvidence =
        project && comparisonSnapshotAggregate && comparisonSnapshotDigest
          ? {
              projectId: project.id,
              comparisonBackedCount: 1,
              leadComparisonReport: {
                id: report.id,
                title: report.title,
                href: `/reports/${report.id}#packet-release-review`,
                packetFreshness,
                comparisonAggregate: comparisonSnapshotAggregate,
                comparisonDigest: comparisonSnapshotDigest,
              },
            }
          : null;
      const grantModelingReadiness = describeProjectGrantModelingReadiness(
        grantModelingEvidence
      );
      const grantModelingSupport = buildGrantDecisionModelingSupport(
        grantModelingEvidence,
        project?.name ?? null
      );

      return {
        ...report,
        latestArtifact,
        project,
        rtpCycle,
        engagementCampaign,
        landUsePlan,
        targetLabel,
        packetFreshness,
        evidenceChainSummary,
        scenarioSpineSummary,
        comparisonSnapshotAggregate,
        comparisonSnapshotDigest,
        fundingSnapshot,
        storedRtpFundingReview,
        storedRtpPublicReviewSummary,
        rtpReleaseReviewSummary,
        evidenceChainDigest,
        sourceReviewDriftSummary,
        sourceReviewPosture,
        fundingDigest: describeFundingSnapshot(fundingSnapshot),
        grantsFollowThrough,
        grantModelingEvidence,
        grantModelingReadiness,
        grantModelingSupport,
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
  const generatedCount = reports.filter(
    (report) => report.status === "generated"
  ).length;
  const draftCount = reports.filter(
    (report) => report.status === "draft"
  ).length;
  const refreshRecommendedCount = reports.filter(
    (report) => report.packetFreshness.label === PACKET_FRESHNESS_LABELS.REFRESH_RECOMMENDED
  ).length;
  const noPacketCount = reports.filter(
    (report) => report.packetFreshness.label === PACKET_FRESHNESS_LABELS.NO_PACKET
  ).length;
  const currentPacketCount = reports.filter(
    (report) => report.packetFreshness.label === PACKET_FRESHNESS_LABELS.CURRENT
  ).length;
  const evidenceBackedCount = reports.filter(
    (report) => report.evidenceChainDigest?.hasEvidence === true
  ).length;
  const blockedGovernanceCount = reports.filter(
    (report) => Boolean(report.evidenceChainDigest?.blockedGateDetail)
  ).length;
  const comparisonSnapshotVisibleCount = reports.filter(
    (report) => (report.comparisonSnapshotAggregate?.comparisonSnapshotCount ?? 0) > 0
  ).length;
  const filteredReports = reports.filter(
    (report) =>
      matchesReportFreshnessFilter(
        selectedFreshnessFilter,
        report.packetFreshness.label
      ) &&
      matchesReportPostureFilter(selectedPostureFilter, {
        hasEvidenceChain: report.evidenceChainDigest?.hasEvidence === true,
        hasComparisonBacked:
          (report.comparisonSnapshotAggregate?.comparisonSnapshotCount ?? 0) > 0,
        hasBlockedGovernance: Boolean(report.evidenceChainDigest?.blockedGateDetail),
      })
  );
  const reportQueueItems = reports
    .filter(
      (report) =>
        report.packetFreshness.label !== PACKET_FRESHNESS_LABELS.CURRENT ||
        Boolean(report.grantsFollowThrough) ||
        Boolean(report.storedRtpFundingReview?.needsAttention) ||
        report.rtpReleaseReviewSummary?.state === "review-loop-open" ||
        report.rtpReleaseReviewSummary?.state === "comment-basis-forming" ||
        Boolean(report.evidenceChainDigest?.blockedGateDetail) ||
        (report.comparisonSnapshotAggregate?.comparisonSnapshotCount ?? 0) > 0
    )
    .slice(0, 5)
    .map((report) => {
      const packetWorkStatus = getReportPacketWorkStatus(report.packetFreshness.label);
      const releaseReviewSummary = report.rtpReleaseReviewSummary;
      const grantsFollowThroughFirst =
        packetWorkStatus.key === "release-review" ? report.grantsFollowThrough : null;
      const badges: Array<{ label: string; value?: string | number | null }> = [];
      badges.push({ label: releaseReviewSummary?.label ?? packetWorkStatus.label });
      if (report.packetFreshness.label !== PACKET_FRESHNESS_LABELS.CURRENT) {
        badges.push({ label: report.packetFreshness.label });
      }
      if (report.storedRtpFundingReview?.needsAttention) {
        badges.push({ label: report.storedRtpFundingReview.label });
      }
      if (grantsFollowThroughFirst) {
        badges.push({ label: "Grants follow-through" });
      }
      if ((report.comparisonSnapshotAggregate?.comparisonSnapshotCount ?? 0) > 0) {
        badges.push({
          label: "Comparison-backed",
          value: report.comparisonSnapshotAggregate?.comparisonSnapshotCount ?? 0,
        });
      }
      if (report.evidenceChainDigest?.blockedGateDetail) {
        badges.push({ label: "Governance hold" });
      }

      return {
        key: report.id,
        href: grantsFollowThroughFirst
          ? grantsFollowThroughFirst.href
          : getReportNavigationHref(report.id, report.packetFreshness.label),
        title: report.title,
        subtitle:
          grantsFollowThroughFirst
            ? `First action: ${grantsFollowThroughFirst.actionLabel.toLowerCase()} in Grants for ${report.title}`
            : report.storedRtpFundingReview?.needsAttention
              ? `First action: run funding-backed release review on ${report.title}`
              : releaseReviewSummary && releaseReviewSummary.state !== "ready"
                ? `First action: ${releaseReviewSummary.nextActionLabel.toLowerCase()} for ${report.title}`
              : report.evidenceChainDigest?.blockedGateDetail
                ? `First action: review governance hold in ${report.title}`
                : packetWorkStatus.key === "generate-first"
                  ? `First action: generate the first packet for ${report.title}`
                  : packetWorkStatus.key === "refresh"
                    ? `First action: refresh ${report.title}`
                    : `First action: run release review on ${report.title}`,
        detail:
          (grantsFollowThroughFirst ? grantsFollowThroughFirst.title : null) ??
          report.storedRtpFundingReview?.detail ??
          (releaseReviewSummary ? releaseReviewSummary.detail : null) ??
          report.evidenceChainDigest?.blockedGateDetail ??
          ((report.comparisonSnapshotAggregate?.comparisonSnapshotCount ?? 0) > 0 &&
          report.grantModelingEvidence
            ? report.grantModelingSupport.recommendedNextActionSummary
            : (report.comparisonSnapshotAggregate?.comparisonSnapshotCount ?? 0) > 0
              ? `${report.comparisonSnapshotAggregate?.comparisonSnapshotCount ?? 0} saved comparison${(report.comparisonSnapshotAggregate?.comparisonSnapshotCount ?? 0) === 1 ? " can" : "s can"} support grant planning language or prioritization framing for this packet. Treat it as planning support, not proof of award likelihood or a replacement for funding-source review.`
              : packetWorkStatus.detail),
        badges,
      };
    });
  const distinctProjects = new Set(
    reports.map((report) => report.project_id).filter(Boolean)
  ).size;
  const freshnessFilters: Array<{
    value: ReportFreshnessFilter;
    label: string;
    count: number;
    href: string;
  }> = [
    {
      value: "all",
      label: "All packets",
      count: reports.length,
      href: buildReportsFilterHref({
        freshness: "all",
        posture: selectedPostureFilter,
        projectId: projectFilterId,
      }),
    },
    {
      value: "refresh",
      label: "Needs refresh",
      count: refreshRecommendedCount,
      href: buildReportsFilterHref({
        freshness: "refresh",
        posture: selectedPostureFilter,
        projectId: projectFilterId,
      }),
    },
    {
      value: "missing",
      label: PACKET_FRESHNESS_LABELS.NO_PACKET,
      count: noPacketCount,
      href: buildReportsFilterHref({
        freshness: "missing",
        posture: selectedPostureFilter,
        projectId: projectFilterId,
      }),
    },
    {
      value: "current",
      label: PACKET_FRESHNESS_LABELS.CURRENT,
      count: currentPacketCount,
      href: buildReportsFilterHref({
        freshness: "current",
        posture: selectedPostureFilter,
        projectId: projectFilterId,
      }),
    },
  ];

  const postureFilters: Array<{
    value: ReportPostureFilter;
    label: string;
    count: number;
    href: string;
  }> = [
    {
      value: "all",
      label: "All reports",
      count: reports.length,
      href: buildReportsFilterHref({
        freshness: selectedFreshnessFilter,
        posture: "all",
        projectId: projectFilterId,
      }),
    },
    {
      value: "evidence-backed",
      label: "Evidence-backed",
      count: evidenceBackedCount,
      href: buildReportsFilterHref({
        freshness: selectedFreshnessFilter,
        posture: "evidence-backed",
        projectId: projectFilterId,
      }),
    },
    {
      value: "comparison-backed",
      label: "Comparison-backed",
      count: comparisonSnapshotVisibleCount,
      href: buildReportsFilterHref({
        freshness: selectedFreshnessFilter,
        posture: "comparison-backed",
        projectId: projectFilterId,
      }),
    },
    {
      value: "governance-hold",
      label: "Governance hold",
      count: blockedGovernanceCount,
      href: buildReportsFilterHref({
        freshness: selectedFreshnessFilter,
        posture: "governance-hold",
        projectId: projectFilterId,
      }),
    },
    {
      value: "no-evidence",
      label: "No evidence attached",
      count: reports.length - evidenceBackedCount,
      href: buildReportsFilterHref({
        freshness: selectedFreshnessFilter,
        posture: "no-evidence",
        projectId: projectFilterId,
      }),
    },
  ];

  const reportGuidanceByProject = reports.reduce<Record<string, {
    reportCount: number;
    refreshRecommendedCount: number;
    noPacketCount: number;
    comparisonBackedCount: number;
    recommendedReportId: string | null;
    recommendedReportTitle: string | null;
    latestReportId: string | null;
    latestReportTitle: string | null;
  }>>((acc, report) => {
    const projectId = report.project_id;
    if (!projectId) {
      return acc;
    }

    const current =
      acc[projectId] ??
      {
        reportCount: 0,
        refreshRecommendedCount: 0,
        noPacketCount: 0,
        comparisonBackedCount: 0,
        recommendedReportId: null,
        recommendedReportTitle: null,
        latestReportId: null,
        latestReportTitle: null,
      };

    current.reportCount += 1;
    if (!current.latestReportId) {
      current.latestReportId = report.id;
      current.latestReportTitle = report.title;
    }
    if (report.packetFreshness.label === PACKET_FRESHNESS_LABELS.REFRESH_RECOMMENDED) {
      current.refreshRecommendedCount += 1;
      if (!current.recommendedReportId) {
        current.recommendedReportId = report.id;
        current.recommendedReportTitle = report.title;
      }
    }
    if (report.packetFreshness.label === PACKET_FRESHNESS_LABELS.NO_PACKET) {
      current.noPacketCount += 1;
      if (!current.recommendedReportId) {
        current.recommendedReportId = report.id;
        current.recommendedReportTitle = report.title;
      }
    }
    if ((report.comparisonSnapshotAggregate?.comparisonSnapshotCount ?? 0) > 0) {
      current.comparisonBackedCount += 1;
    }

    acc[projectId] = current;
    return acc;
  }, {});

  for (const summary of Object.values(reportGuidanceByProject)) {
    if (!summary.recommendedReportId) {
      summary.recommendedReportId = summary.latestReportId;
      summary.recommendedReportTitle = summary.latestReportTitle;
    }
  }

  return (
    <section className="module-page">
      <PlanningContextStrip context={planningContext} className="mb-4" />
      {/* Internal, membership-gated: the database's own words stay on the page,
          inside the notice's operator disclosure. The public surfaces omit them
          entirely. */}
      <ReadFailureNotice className="mb-4" reads={reads} />
      <PageHeader
        title={navLabel("/reports")}
        description="Report packets for your projects, and the evidence each one rests on."
        actions={
          // The id stays on this wrapper, which the page owns, so the empty
          // state's link to #create-report still lands on the button.
          <div id="create-report" className="scroll-mt-24">
            <ReportCreator
              projects={projectsData ?? []}
              projectsUnreadable={projectsReadFailed}
              initialProjectId={planningContext.status === "active" ? planningContext.project.id : null}
              runs={runsData ?? []}
              modelingCountyRuns={modelingCountyRuns}
              reportGuidanceByProject={reportGuidanceByProject}
            />
          </div>
        }
      >
        <FigureRow
          label="Report figures"
          figures={[
            { label: "Reports", value: reports.length, note: `${distinctProjects} projects covered` },
            { label: "Generated", value: generatedCount, note: `${currentPacketCount} current` },
            { label: "Needs refresh", value: refreshRecommendedCount },
            { label: "Governance holds", value: blockedGovernanceCount },
          ]}
        />
      </PageHeader>

      <article className="module-section-surface">
        <div className="module-section-header">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[0.5rem] bg-[color:var(--pine)]/10 text-[color:var(--pine)]">
              <FileStack className="h-5 w-5" />
            </span>
            <div className="module-section-heading">
              <h2 className="module-section-title">Report records</h2>
              <p className="module-section-description">Filter by how current the packet is, and by what evidence sits behind it.</p>
            </div>
          </div>
          <div className="module-inline-list">
            {draftCount > 0 ? <span className="module-inline-item"><Sparkles className="h-3 w-3" /> {draftCount} draft{draftCount !== 1 ? "s" : ""}</span> : null}
            {noPacketCount > 0 ? <span className="module-inline-item"><Sparkles className="h-3 w-3" /> {noPacketCount} without packet</span> : null}
          </div>
        </div>

        <div className="mt-5 module-filter-stack">
          <div>
            <p className="module-section-label mb-2">Packet freshness</p>
            <div className="module-filter-rail">
              {freshnessFilters.map((filter) => {
                const active = filter.value === selectedFreshnessFilter;

                return (
                  <Link
                    key={filter.value}
                    href={filter.href}
                    className={["module-filter-link", active ? "is-active" : ""].filter(Boolean).join(" ")}
                  >
                    <span className="module-filter-label">{filter.label}</span>
                    <span className="module-filter-count">{filter.count}</span>
                  </Link>
                );
              })}
            </div>
          </div>
          <div>
            <p className="module-section-label mb-2">Evidence behind the report</p>
            <div className="module-filter-rail">
              {postureFilters.map((filter) => {
                const active = filter.value === selectedPostureFilter;
                const warningActive = active && filter.value === "governance-hold";

                return (
                  <Link
                    key={filter.value}
                    href={filter.href}
                    className={[
                      "module-filter-link",
                      active ? "is-active" : "",
                      warningActive ? "is-warning-active" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    <span className="module-filter-label">{filter.label}</span>
                    <span className="module-filter-count">{filter.count}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          Showing {filteredReports.length} of {reports.length} report{reports.length === 1 ? "" : "s"}
          {selectedFreshnessFilter === "all" && selectedPostureFilter === "all"
            ? "."
            : ` for ${[
                selectedFreshnessFilter === "all"
                  ? null
                  : freshnessFilters.find((filter) => filter.value === selectedFreshnessFilter)?.label.toLowerCase(),
                selectedPostureFilter === "all"
                  ? null
                  : postureFilters.find((filter) => filter.value === selectedPostureFilter)?.label.toLowerCase(),
              ]
                .filter(Boolean)
                .join(" + ")} filters.`}
        </p>

        <div className="mt-5">
          <ReportPacketCommandQueue
            title="Report packet queue"
            description="The reports that need something first, before the full list below."
            items={reportQueueItems}
            emptyLabel="No queued report packet work right now."
          />
        </div>

        {reports.length === 0 ? (
          <div className="mt-5">
            {/* "No reports yet" invites a planner to create work the workspace
                may already hold. A failed read cannot make that invitation. */}
            <EmptyState
              title={reportsReadFailed ? "Reports could not be loaded" : "No reports yet"}
              description={reportsReadFailed
                ? "The report registry could not be read, so nothing is listed. This does not mean the workspace has no reports — do not regenerate on the strength of this screen."
                : "Reports turns work from across OpenPlan into a shareable document, with every number traceable back to its source. Create your first report to assemble findings for a board, a funder, or the public."}
              action={reportsReadFailed ? undefined : (
                <a href="#create-report" className="inline-flex items-center rounded border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted/40">Create a report</a>
              )}
            />
          </div>
        ) : filteredReports.length === 0 ? (
          <div className="mt-5">
            <EmptyState
              title="No reports match this filter"
              description="Try a different packet freshness filter or open all packets to resume catalog review."
            />
          </div>
        ) : (
          <div className="mt-5 module-record-list">
            {filteredReports.map((report) => {
              const packetWorkStatus = getReportPacketWorkStatus(report.packetFreshness.label);
              const releaseReviewSummary = report.rtpReleaseReviewSummary;
              const actionLabel = releaseReviewSummary
                ? releaseReviewSummary.state === "ready"
                  ? "Open release review"
                  : releaseReviewSummary.nextActionLabel
                : getReportPacketActionLabel(report.packetFreshness.label);

              return (
              <CartographicSelectionLink
                key={report.id}
                href={withPlanningContext(
                  getReportNavigationHref(report.id, report.packetFreshness.label),
                  planningContext.status === "active" ? planningContext.project.id : null
                )}
                className="module-record-row is-interactive group block"
                selection={{
                  kind: "report",
                  title: report.title,
                  kicker: `${formatReportStatusLabel(report.status)} · ${report.packetFreshness.label}`,
                  avatarChar: report.title[0],
                  meta: [
                    ...(report.project?.name ? [{ label: "project", value: report.project.name }] : []),
                    ...(report.engagementCampaign
                      ? [{ label: "campaign", value: report.engagementCampaign.title }]
                      : []),
                    { label: "next", value: actionLabel },
                  ],
                }}
              >
                <div className="module-record-head">
                  <div className="module-record-main">
                    <div className="module-record-kicker">
                      <StatusBadge tone={reportStatusTone(report.status)}>
                        {formatReportStatusLabel(report.status)}
                      </StatusBadge>
                      <StatusBadge tone={report.packetFreshness.tone}>{report.packetFreshness.label}</StatusBadge>
                    </div>
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <h3 className="module-record-title transition group-hover:text-primary">{report.title}</h3>
                        <p className="module-record-stamp shrink-0">Updated {formatDateTime(report.updated_at)}</p>
                      </div>
                      <p className="module-record-summary line-clamp-2">
                        {report.summary || "No summary provided."}
                      </p>
                      <p className="text-label text-muted-foreground">
                        {report.targetLabel}
                        {` · ${formatReportTypeLabel(report.report_type)}`}
                        {report.latest_artifact_kind ? ` · ${report.latest_artifact_kind.toUpperCase()}` : ""}
                        {(report.latestArtifact?.generated_at ?? report.generated_at) ? ` · Generated ${formatDateTime(report.latestArtifact?.generated_at ?? report.generated_at)}` : ""}
                        {(report.comparisonSnapshotAggregate?.comparisonSnapshotCount ?? 0) > 0 ? ` · ${report.comparisonSnapshotAggregate!.comparisonSnapshotCount} comparison${report.comparisonSnapshotAggregate!.comparisonSnapshotCount === 1 ? "" : "s"}` : ""}
                      </p>
                    </div>
                  </div>
                  <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition group-hover:text-primary" />
                </div>

                <div className="module-record-meta">
                  <span className="module-record-chip">
                    {report.targetLabel}
                  </span>
                  <span className="module-record-chip">Next step {releaseReviewSummary?.label ?? packetWorkStatus.label}</span>
                  <span className="module-record-chip">Action {actionLabel}</span>
                  {report.evidenceChainSummary && report.evidenceChainSummary.scenarioSetLinkCount > 0 ? (
                    <span className="module-record-chip">
                      {report.evidenceChainSummary.scenarioSetLinkCount} scenario set{report.evidenceChainSummary.scenarioSetLinkCount === 1 ? "" : "s"}
                    </span>
                  ) : null}
                  {report.scenarioSpineSummary ? (
                    report.scenarioSpineSummary.pendingCount > 0 ? (
                      <span className="module-record-chip">Scenario spine pending</span>
                    ) : (
                      <>
                        {(report.scenarioSpineSummary.assumptionSetCount > 0 || report.evidenceChainSummary?.scenarioSetLinkCount) ? (
                          <span className="module-record-chip">
                            {report.scenarioSpineSummary.assumptionSetCount} assumptions
                          </span>
                        ) : null}
                        {(report.scenarioSpineSummary.dataPackageCount > 0 || report.evidenceChainSummary?.scenarioSetLinkCount) ? (
                          <span className="module-record-chip">
                            {report.scenarioSpineSummary.dataPackageCount} packages
                          </span>
                        ) : null}
                        {(report.scenarioSpineSummary.indicatorSnapshotCount > 0 || report.evidenceChainSummary?.scenarioSetLinkCount) ? (
                          <span className="module-record-chip">
                            {report.scenarioSpineSummary.indicatorSnapshotCount} indicators
                          </span>
                        ) : null}
                      </>
                    )
                  ) : null}
                  {report.comparisonSnapshotAggregate &&
                  report.comparisonSnapshotAggregate.comparisonSnapshotCount > 0 ? (
                    <>
                      <span className="module-record-chip">
                        {report.comparisonSnapshotAggregate.comparisonSnapshotCount} saved comparison{report.comparisonSnapshotAggregate.comparisonSnapshotCount === 1 ? "" : "s"}
                      </span>
                      <span className="module-record-chip">
                        {report.comparisonSnapshotAggregate.indicatorDeltaCount} comparison delta{report.comparisonSnapshotAggregate.indicatorDeltaCount === 1 ? "" : "s"}
                      </span>
                      {report.grantModelingReadiness ? (
                        <span className="module-record-chip">{report.grantModelingReadiness.label}</span>
                      ) : null}
                      {report.grantModelingEvidence ? (
                        <span className="module-record-chip">
                          Suggested {titleize(report.grantModelingSupport.recommendedDecisionState)}
                        </span>
                      ) : null}
                    </>
                  ) : null}
                  {report.fundingSnapshot ? (
                    <>
                      <span className="module-record-chip">
                        {report.fundingSnapshot.label}
                      </span>
                      {report.fundingSnapshot.unfundedAfterLikelyAmount > 0 ? (
                        <span className="module-record-chip">
                          Uncovered {formatMoney(report.fundingSnapshot.unfundedAfterLikelyAmount, { precision: "whole" })}
                        </span>
                      ) : null}
                    </>
                  ) : null}
                  {report.latestArtifact?.generated_at ?? report.generated_at ? (
                    <span className="module-record-chip">
                      Generated {formatDateTime(report.latestArtifact?.generated_at ?? report.generated_at)}
                    </span>
                  ) : null}
                </div>

                {/* Two lines instead of four boxes (October 10, 2026). The
                    whole card is a link, so the packet, evidence and funding
                    detail lives on the report page it opens. */}
                <div className="mt-3 grid gap-1.5 text-sm">
                  {/* Why a packet is or is not current stays on the row: the
                      changed sources and a failed evidence read are the facts
                      that decide whether to rebuild. */}
                  <p className="flex flex-wrap items-center gap-2">
                    <StatusBadge tone={report.sourceReviewPosture.state === "ready" ? "success" : "warning"}>
                      {report.sourceReviewPosture.label}
                    </StatusBadge>
                    <span className="text-foreground/90">{report.sourceReviewPosture.headline}</span>
                    {report.sourceReviewPosture.changedSourceText ? (
                      <span className="text-muted-foreground">
                        Changed sources: {report.sourceReviewPosture.changedSourceText}.
                      </span>
                    ) : null}
                  </p>
                  {report.sourceReviewPosture.state === "ready" ? null : (
                    <p className="text-muted-foreground">{report.sourceReviewPosture.detail}</p>
                  )}
                  <p className="text-muted-foreground">{packetWorkStatus.label}</p>
                  {report.comparisonSnapshotAggregate?.comparisonSnapshotCount ? (
                    <p className="text-muted-foreground">
                      Grant release review: {report.grantModelingEvidence ? report.grantModelingReadiness?.label ?? "No visible support" : "Saved comparisons attached"}.
                      {" "}Planning support only, not proof of award likelihood or a replacement for funding-source review.
                    </p>
                  ) : null}
                  <p className="text-muted-foreground">
                    {report.fundingDigest ? report.fundingDigest.headline : "No funding snapshot on the latest packet."}
                    {report.grantsFollowThrough ? ` ${report.grantsFollowThrough.actionLabel} in Grants.` : ""}
                  </p>
                </div>
              </CartographicSelectionLink>
              );
            })}
          </div>
        )}
      </article>

    </section>
  );
}
