import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowRight,
  FileStack,
  FolderKanban,
  ScrollText,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { CartographicSelectionLink } from "@/components/cartographic/cartographic-selection-link";
import { WorkspaceCommandBoard } from "@/components/operations/workspace-command-board";
import { WorkspaceRuntimeCue } from "@/components/operations/workspace-runtime-cue";
import { ReportPacketCommandQueue } from "@/components/reports/report-packet-command-queue";
import { ReportCreator } from "@/components/reports/report-creator";
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
import {
  loadWorkspaceOperationsSummaryForWorkspace,
  parseStoredRtpFundingReview,
  type WorkspaceOperationsSupabaseLike,
} from "@/lib/operations/workspace-summary";
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
  resolveReportPacketSourceUpdatedAt,
  titleize,
  type ReportFreshnessFilter,
  type ReportPostureFilter,
} from "@/lib/reports/catalog";
import {
  PACKET_FRESHNESS_LABELS,
} from "@/lib/reports/packet-labels";
import { resolveRtpFundingFollowThrough } from "@/lib/operations/grants-links";

type ReportsPageSearchParams = Promise<{
  freshness?: string;
  posture?: string;
}>;

type ReportRow = {
  id: string;
  workspace_id: string;
  project_id: string | null;
  rtp_cycle_id: string | null;
  title: string;
  report_type: string;
  status: string;
  summary: string | null;
  generated_at: string | null;
  latest_artifact_kind: string | null;
  created_at: string;
  updated_at: string;
  projects:
    | {
        id: string;
        name: string;
      }
    | Array<{
        id: string;
        name: string;
      }>
    | null;
  rtp_cycles:
    | {
        id: string;
        title: string;
        updated_at?: string | null;
      }
    | Array<{
        id: string;
        title: string;
        updated_at?: string | null;
      }>
    | null;
};

type ReportArtifactRow = {
  report_id: string;
  generated_at: string;
  metadata_json: Record<string, unknown> | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

const REPORT_WRITEBACK_GRACE_MS = 15 * 60 * 1000;

function hasMaterialReportWritebackAfterGeneration(
  generatedAt: string | null | undefined,
  updatedAt: string | null | undefined
) {
  if (!generatedAt || !updatedAt) {
    return false;
  }

  const generatedMs = new Date(generatedAt).getTime();
  const updatedMs = new Date(updatedAt).getTime();
  if (!Number.isFinite(generatedMs) || !Number.isFinite(updatedMs)) {
    return false;
  }

  return updatedMs - generatedMs > REPORT_WRITEBACK_GRACE_MS;
}

function resolveTrackedReportSourceUpdatedAt(input: {
  generatedAt: string | null;
  reportUpdatedAt: string | null;
  cycleUpdatedAt: string | null;
  artifactMetadata: Record<string, unknown> | null;
}) {
  const sourceContext = asRecord(input.artifactMetadata?.sourceContext);
  const projectFundingSnapshot = asRecord(sourceContext?.projectFundingSnapshot);
  const trackedSourceUpdatedAt = resolveReportPacketSourceUpdatedAt([
    input.cycleUpdatedAt,
    typeof sourceContext?.projectUpdatedAt === "string"
      ? sourceContext.projectUpdatedAt
      : null,
    typeof sourceContext?.rtpCycleUpdatedAt === "string"
      ? sourceContext.rtpCycleUpdatedAt
      : null,
    typeof projectFundingSnapshot?.latestSourceUpdatedAt === "string"
      ? projectFundingSnapshot.latestSourceUpdatedAt
      : null,
  ]);

  if (!trackedSourceUpdatedAt) {
    return input.reportUpdatedAt;
  }

  return hasMaterialReportWritebackAfterGeneration(input.generatedAt, input.reportUpdatedAt)
    ? resolveReportPacketSourceUpdatedAt([trackedSourceUpdatedAt, input.reportUpdatedAt])
    : trackedSourceUpdatedAt;
}

function buildReportsFilterHref(filters: {
  freshness: ReportFreshnessFilter;
  posture: ReportPostureFilter;
}) {
  const params = new URLSearchParams();
  if (filters.freshness !== "all") {
    params.set("freshness", filters.freshness);
  }
  if (filters.posture !== "all") {
    params.set("posture", filters.posture);
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
        title="Reports need a provisioned workspace"
        description="Report packets, run attachments, and artifact history only exist inside a provisioned workspace. This account is authenticated, but it is not yet attached to one."
      />
    );
  }

  const [{ data: reportsData }, { data: projectsData }, { data: runsData }, operationsSummary] =
    await Promise.all([
      supabase
        .from("reports")
        .select(
          "id, workspace_id, project_id, rtp_cycle_id, title, report_type, status, summary, generated_at, latest_artifact_kind, created_at, updated_at, projects(id, name), rtp_cycles(id, title, updated_at)"
        )
        .order("updated_at", { ascending: false }),
      supabase
        .from("projects")
        .select("id, workspace_id, name")
        .order("updated_at", { ascending: false }),
      supabase
        .from("runs")
        .select("id, workspace_id, title, created_at")
        .order("created_at", { ascending: false })
        .limit(30),
      loadWorkspaceOperationsSummaryForWorkspace(
        supabase as unknown as WorkspaceOperationsSupabaseLike,
        membership.workspace_id
      ),
    ]);

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

  const reports = ((reportsData ?? []) as ReportRow[])
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
      const packetFreshness = getReportPacketFreshness({
        latestArtifactKind: report.latest_artifact_kind,
        generatedAt: packetGeneratedAt,
        updatedAt: resolveTrackedReportSourceUpdatedAt({
          generatedAt: packetGeneratedAt,
          reportUpdatedAt: report.updated_at,
          cycleUpdatedAt: rtpCycle?.updated_at ?? null,
          artifactMetadata: latestArtifact?.metadata_json ?? null,
        }),
      });
      const grantsFollowThrough = resolveRtpFundingFollowThrough(fundingSnapshot);
      const rtpReleaseReviewSummary = storedRtpPublicReviewSummary
        ? buildRtpReleaseReviewSummary({
            packetFreshnessLabel: packetFreshness.label,
            publicReviewSummary: storedRtpPublicReviewSummary,
          })
        : null;
      const project = Array.isArray(report.projects)
        ? report.projects[0] ?? null
        : report.projects ?? null;
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
        packetFreshness,
        evidenceChainSummary,
        scenarioSpineSummary,
        comparisonSnapshotAggregate,
        comparisonSnapshotDigest,
        fundingSnapshot,
        storedRtpFundingReview,
        storedRtpPublicReviewSummary,
        rtpReleaseReviewSummary,
        evidenceChainDigest: describeEvidenceChainSummary(evidenceChainSummary),
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
  const rtpFundingReviewCount = reports.filter(
    (report) => report.packetFreshness.label === PACKET_FRESHNESS_LABELS.CURRENT && report.storedRtpFundingReview?.needsAttention
  ).length;
  const evidenceBackedCount = reports.filter(
    (report) => Boolean(report.evidenceChainDigest)
  ).length;
  const blockedGovernanceCount = reports.filter(
    (report) => Boolean(report.evidenceChainDigest?.blockedGateDetail)
  ).length;
  const scenarioBasisCount = reports.filter(
    (report) => (report.evidenceChainSummary?.scenarioSetLinkCount ?? 0) > 0
  ).length;
  const scenarioSpinePendingCount = reports.filter(
    (report) => (report.evidenceChainSummary?.scenarioSharedSpinePendingCount ?? 0) > 0
  ).length;
  const scenarioSpineVisibleCount = reports.filter((report) => {
    const summary = report.scenarioSpineSummary;
    if (!summary) {
      return false;
    }

    return (
      summary.assumptionSetCount > 0 ||
      summary.dataPackageCount > 0 ||
      summary.indicatorSnapshotCount > 0 ||
      summary.pendingCount > 0
    );
  }).length;
  const comparisonSnapshotVisibleCount = reports.filter(
    (report) => (report.comparisonSnapshotAggregate?.comparisonSnapshotCount ?? 0) > 0
  ).length;
  const fundingSnapshotVisibleCount = reports.filter(
    (report) => Boolean(report.fundingDigest)
  ).length;
  const fundingGapVisibleCount = reports.filter(
    (report) => (report.fundingSnapshot?.unfundedAfterLikelyAmount ?? 0) > 0
  ).length;
  const readyComparisonSnapshotCount = reports.reduce(
    (sum, report) => sum + (report.comparisonSnapshotAggregate?.readyComparisonSnapshotCount ?? 0),
    0
  );
  const filteredReports = reports.filter(
    (report) =>
      matchesReportFreshnessFilter(
        selectedFreshnessFilter,
        report.packetFreshness.label
      ) &&
      matchesReportPostureFilter(selectedPostureFilter, {
        hasEvidenceChain: Boolean(report.evidenceChainDigest),
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
        (report.rtpReleaseReviewSummary?.label ?? "") === "Review loop still open" ||
        (report.rtpReleaseReviewSummary?.label ?? "") === "Comment basis still forming" ||
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
            ? `First action: ${grantsFollowThroughFirst.actionLabel.toLowerCase()} in Grants OS for ${report.title}`
            : report.storedRtpFundingReview?.needsAttention
              ? `First action: run funding-backed release review on ${report.title}`
              : releaseReviewSummary && releaseReviewSummary.label !== "Release review ready"
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
      }),
    },
    {
      value: "refresh",
      label: "Needs refresh",
      count: refreshRecommendedCount,
      href: buildReportsFilterHref({
        freshness: "refresh",
        posture: selectedPostureFilter,
      }),
    },
    {
      value: "missing",
      label: PACKET_FRESHNESS_LABELS.NO_PACKET,
      count: noPacketCount,
      href: buildReportsFilterHref({
        freshness: "missing",
        posture: selectedPostureFilter,
      }),
    },
    {
      value: "current",
      label: PACKET_FRESHNESS_LABELS.CURRENT,
      count: currentPacketCount,
      href: buildReportsFilterHref({
        freshness: "current",
        posture: selectedPostureFilter,
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
      label: "All posture",
      count: reports.length,
      href: buildReportsFilterHref({
        freshness: selectedFreshnessFilter,
        posture: "all",
      }),
    },
    {
      value: "evidence-backed",
      label: "Evidence-backed",
      count: evidenceBackedCount,
      href: buildReportsFilterHref({
        freshness: selectedFreshnessFilter,
        posture: "evidence-backed",
      }),
    },
    {
      value: "comparison-backed",
      label: "Comparison-backed",
      count: comparisonSnapshotVisibleCount,
      href: buildReportsFilterHref({
        freshness: selectedFreshnessFilter,
        posture: "comparison-backed",
      }),
    },
    {
      value: "governance-hold",
      label: "Governance hold",
      count: blockedGovernanceCount,
      href: buildReportsFilterHref({
        freshness: selectedFreshnessFilter,
        posture: "governance-hold",
      }),
    },
    {
      value: "no-evidence",
      label: "No evidence summary",
      count: reports.length - evidenceBackedCount,
      href: buildReportsFilterHref({
        freshness: selectedFreshnessFilter,
        posture: "no-evidence",
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
      <header className="module-header-grid">
        <article className="module-intro-card">
          <div className="module-intro-kicker">
            <ScrollText className="h-3.5 w-3.5" />
            Reports registry
          </div>
          <div className="module-intro-body">
            <h1 className="module-intro-title">Reports</h1>
            <p className="module-intro-description">
              Keep packet generation, evidence lineage, and project delivery history inside one reviewable publishing surface.
            </p>
          </div>

          <div className="module-summary-grid cols-4">
            <div className="module-summary-card">
              <p className="module-summary-label">Total reports</p>
              <p className="module-summary-value">{reports.length}</p>
              <p className="module-summary-detail">Workspace report records currently tracked.</p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Generated</p>
              <p className="module-summary-value">{generatedCount}</p>
              <p className="module-summary-detail">Packets already assembled from stored report records.</p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Needs refresh</p>
              <p className="module-summary-value">{refreshRecommendedCount}</p>
              <p className="module-summary-detail">Records whose current packet no longer matches the source basis.</p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Projects covered</p>
              <p className="module-summary-value">{distinctProjects}</p>
              <p className="module-summary-detail">Projects with report posture visible in this workspace.</p>
            </div>
          </div>

          <div className="module-inline-list">
            <span className="module-inline-item"><strong>{currentPacketCount}</strong> packet current</span>
            <span className="module-inline-item"><strong>{evidenceBackedCount}</strong> evidence-backed</span>
            <span className="module-inline-item"><strong>{scenarioBasisCount}</strong> scenario-backed</span>
            <span className="module-inline-item"><strong>{scenarioSpineVisibleCount}</strong> scenario spine visible</span>
            <span className="module-inline-item"><strong>{comparisonSnapshotVisibleCount}</strong> comparison-backed</span>
            <span className="module-inline-item"><strong>{fundingSnapshotVisibleCount}</strong> funding-backed</span>
            {rtpFundingReviewCount > 0 ? <span className="module-inline-item"><strong>{rtpFundingReviewCount}</strong> RTP funding review</span> : null}
            <span className="module-inline-item"><strong>{readyComparisonSnapshotCount}</strong> ready saved comparisons</span>
            {fundingGapVisibleCount > 0 ? <span className="module-inline-item"><strong>{fundingGapVisibleCount}</strong> funding gap{fundingGapVisibleCount === 1 ? "" : "s"} surfaced</span> : null}
            <span className="module-inline-item"><strong>{blockedGovernanceCount}</strong> governance hold{blockedGovernanceCount === 1 ? "" : "s"} surfaced</span>
            {scenarioSpinePendingCount > 0 ? <span className="module-inline-item"><strong>{scenarioSpinePendingCount}</strong> spine pending</span> : null}
          </div>
        </article>

        <article className="module-operator-card">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[0.5rem] border border-white/10 bg-white/[0.05]">
              <ShieldCheck className="h-5 w-5 text-amber-200" />
            </span>
            <div>
              <p className="text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-amber-200/65">
                Reports
              </p>
              <h2 className="text-xl font-semibold tracking-tight">
                Report packets and exports
              </h2>
            </div>
          </div>
          <div className="mt-5 grid grid-cols-2 gap-3">
            <div>
              <p className="module-summary-label text-amber-200/70">Packets current</p>
              <p className="module-summary-value text-amber-50">{currentPacketCount}</p>
            </div>
            <div>
              <p className="module-summary-label text-amber-200/70">Evidence-backed</p>
              <p className="module-summary-value text-amber-50">{evidenceBackedCount}</p>
            </div>
            <div>
              <p className="module-summary-label text-amber-200/70">Governance hold</p>
              <p className="module-summary-value text-amber-50">{blockedGovernanceCount}</p>
            </div>
            <div>
              <p className="module-summary-label text-amber-200/70">Funding review</p>
              <p className="module-summary-value text-amber-50">{rtpFundingReviewCount}</p>
            </div>
          </div>
          <div className="mt-5">
            <WorkspaceRuntimeCue summary={operationsSummary} className="border-white/10 bg-white/[0.06] text-amber-50/82" />
          </div>
          <div className="module-operator-list mt-5">
            <div className="module-operator-item">Keep report packets connected to the work that produced them.</div>
            <div className="module-operator-item">Generate HTML packets now and prepare exports for delivery.</div>
            <div className="module-operator-item">Missing source context is surfaced clearly during review.</div>
          </div>
        </article>
      </header>

      <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <div className="space-y-6">
          <ReportCreator
            projects={projectsData ?? []}
            runs={runsData ?? []}
            reportGuidanceByProject={reportGuidanceByProject}
          />
          <WorkspaceCommandBoard
            summary={operationsSummary}
            label="Workspace command board"
            title="What should move around reports"
            description="The reports lane now inherits the shared workspace runtime too, so packet refresh pressure, funding timing, and plan/program setup gaps stay visible while operators manage evidence, exports, and governance review."
          />
        </div>

        <article className="module-section-surface">
          <div className="module-section-header">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[0.5rem] bg-[color:var(--pine)]/10 text-[color:var(--pine)]">
                <FileStack className="h-5 w-5" />
              </span>
              <div className="module-section-heading">
                <p className="module-section-label">Catalog</p>
                <h2 className="module-section-title">Report records</h2>
                <p className="module-section-description">Use the rails below to sort packet freshness and evidence posture without collapsing the registry into chip filters.</p>
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
              <p className="module-section-label mb-2">Evidence posture</p>
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
              description="The top report packet actions across the workspace, ordered before the full registry below."
              items={reportQueueItems}
              emptyLabel="No queued report packet work right now."
            />
          </div>

          {reports.length === 0 ? (
            <div className="mt-5">
              <EmptyState
                title="No reports yet"
                description="Create a report packet to establish project-linked records, section structure, and artifact history."
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
                  ? releaseReviewSummary.label === "Release review ready"
                    ? "Open release review"
                    : releaseReviewSummary.nextActionLabel
                  : getReportPacketActionLabel(report.packetFreshness.label);

                return (
                <CartographicSelectionLink
                  key={report.id}
                  href={getReportNavigationHref(report.id, report.packetFreshness.label)}
                  className="module-record-row is-interactive group block"
                  selection={{
                    kind: "report",
                    title: report.title,
                    kicker: `${formatReportStatusLabel(report.status)} · ${report.packetFreshness.label}`,
                    avatarChar: report.title[0],
                    meta: [
                      ...(report.project?.name ? [{ label: "project", value: report.project.name }] : []),
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
                        <p className="text-[0.73rem] text-muted-foreground">
                          {report.rtpCycle ? `RTP Cycle · ${report.rtpCycle.title}` : (report.project?.name ?? "No project")}
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
                      {report.rtpCycle ? `RTP Cycle ${report.rtpCycle.title}` : `Project ${report.project?.name ?? "Unknown project"}`}
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
                            Uncovered {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(report.fundingSnapshot.unfundedAfterLikelyAmount)}
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

                  <div className="module-record-detail-grid cols-2 mt-4">
                    <div className="module-note text-sm">
                      <p className="font-medium text-foreground">Packet posture</p>
                      <p className="mt-2 font-medium text-foreground/90">{packetWorkStatus.label}</p>
                      <p className="mt-1">{packetWorkStatus.detail}</p>
                      <p className="mt-1">{report.packetFreshness.detail}</p>
                    </div>
                    {report.evidenceChainDigest ? (
                      <div className="module-note text-sm">
                        <p className="font-medium text-foreground">Evidence chain posture</p>
                        <p className="mt-2 font-medium text-foreground/90">{report.evidenceChainDigest.headline}</p>
                        <p className="mt-1">{report.evidenceChainDigest.detail}</p>
                        {report.evidenceChainDigest.blockedGateDetail ? <p className="mt-1">{report.evidenceChainDigest.blockedGateDetail}</p> : null}
                        {report.comparisonSnapshotAggregate?.comparisonSnapshotCount ? (
                          <>
                            <p className="mt-1">
                              Saved comparisons: {report.comparisonSnapshotAggregate.readyComparisonSnapshotCount}/{report.comparisonSnapshotAggregate.comparisonSnapshotCount} ready
                              {report.comparisonSnapshotAggregate.latestComparisonSnapshotUpdatedAt
                                ? ` · Updated ${formatDateTime(report.comparisonSnapshotAggregate.latestComparisonSnapshotUpdatedAt)}`
                                : ""}
                            </p>
                            {report.grantModelingEvidence ? (
                              <>
                                <p className="mt-1 font-medium text-foreground/90">Grant release review</p>
                                <p className="mt-1">
                                  {report.grantModelingReadiness?.label ?? "No visible support"}
                                </p>
                                <p className="mt-1">{report.grantModelingSupport.recommendedNextActionSummary}</p>
                              </>
                            ) : (
                              <p className="mt-1">
                                Saved comparison context can support grant planning language or prioritization framing for this packet. Treat it as planning support, not proof of award likelihood or a replacement for funding-source review.
                              </p>
                            )}
                          </>
                        ) : null}
                      </div>
                    ) : (
                      <div className="module-note text-sm">
                        <p className="font-medium text-foreground">Evidence chain posture</p>
                        <p className="mt-2">No evidence summary attached to the latest artifact yet.</p>
                      </div>
                    )}
                    <div className="module-note text-sm">
                      <p className="font-medium text-foreground">Funding posture</p>
                      {report.fundingDigest ? (
                        <>
                          <p className="mt-2 font-medium text-foreground/90">{report.fundingDigest.headline}</p>
                          <p className="mt-1">{report.fundingDigest.detail}</p>
                          {report.fundingDigest.timingDetail ? <p className="mt-1">{report.fundingDigest.timingDetail}</p> : null}
                          {report.grantsFollowThrough ? (
                            <div className="mt-3 rounded-[0.5rem] border border-amber-400/30 bg-amber-500/[0.08] px-3 py-3">
                              <p className="text-xs font-medium text-foreground">Grants follow-through</p>
                              <p className="mt-1 text-xs text-muted-foreground">{report.grantsFollowThrough.title}</p>
                              <p className="mt-2 inline-flex items-center gap-2 text-xs font-semibold text-[color:var(--pine)]">
                                {report.grantsFollowThrough.actionLabel}
                                <ArrowRight className="h-3.5 w-3.5" />
                                <span className="text-[0.7rem] font-medium text-muted-foreground">in Grants OS</span>
                              </p>
                            </div>
                          ) : null}
                        </>
                      ) : (
                        <p className="mt-2">No funding snapshot is attached to the latest artifact yet.</p>
                      )}
                    </div>
                  </div>
                </CartographicSelectionLink>
                );
              })}
            </div>
          )}
        </article>
      </div>

      <article className="module-section-surface">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[0.5rem] bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
            <FolderKanban className="h-5 w-5" />
          </span>
          <div>
            <p className="module-section-label">Capabilities</p>
            <h2 className="module-section-title">What&apos;s available in report packets</h2>
          </div>
        </div>
        <p className="mt-3 max-w-4xl text-sm leading-relaxed text-muted-foreground">
          Reports include schema-backed records, configured sections, run
          attachments, and HTML artifact generation with audit metadata. PDF
          export and storage-backed delivery will layer onto this record model.
        </p>
      </article>
    </section>
  );
}
