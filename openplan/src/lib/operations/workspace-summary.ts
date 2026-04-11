import { buildPlanReadiness } from "@/lib/plans/catalog";
import {
  describeComparisonSnapshotAggregate,
  getReportNavigationHref,
  getReportPacketFreshness,
  parseStoredComparisonSnapshotAggregate,
} from "@/lib/reports/catalog";
import type { StatusTone } from "@/lib/ui/status";

export type WorkspaceOperationsProjectRow = {
  id: string;
  name: string;
  status: string | null;
  deliveryPhase: string | null;
  updatedAt: string | null;
};

export type WorkspaceOperationsPlanRow = {
  id: string;
  title: string;
  status: string | null;
  geographyLabel: string | null;
  horizonYear: number | null;
  projectId: string | null;
  updatedAt: string | null;
};

export type WorkspaceOperationsProgramRow = {
  id: string;
  title: string;
  status: string | null;
  nominationDueAt: string | null;
  adoptionTargetAt: string | null;
  updatedAt: string | null;
};

export type WorkspaceOperationsFundingOpportunityRow = {
  id: string;
  title: string;
  opportunityStatus: string | null;
  closesAt: string | null;
  decisionDueAt: string | null;
  programId: string | null;
  updatedAt: string | null;
};

export type WorkspaceOperationsReportRow = {
  id: string;
  title: string | null;
  status: string | null;
  latestArtifactKind: string | null;
  generatedAt: string | null;
  updatedAt: string | null;
  metadataJson: Record<string, unknown> | null;
};

export type WorkspaceCommandQueueItem = {
  key: string;
  title: string;
  detail: string;
  href: string;
  tone: StatusTone;
  priority: number;
  badges: Array<{
    label: string;
    value?: string | number | null;
  }>;
};

export type WorkspaceOperationsSummary = {
  posture: "stable" | "active" | "attention";
  headline: string;
  detail: string;
  counts: {
    projects: number;
    activeProjects: number;
    plans: number;
    plansNeedingSetup: number;
    programs: number;
    activePrograms: number;
    reports: number;
    reportRefreshRecommended: number;
    reportNoPacket: number;
    comparisonBackedReports: number;
    fundingOpportunities: number;
    openFundingOpportunities: number;
    closingSoonFundingOpportunities: number;
    queueDepth: number;
  };
  nextCommand: WorkspaceCommandQueueItem | null;
  commandQueue: WorkspaceCommandQueueItem[];
};

function daysUntil(value: string | null | undefined, now: Date) {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  if (!Number.isFinite(parsed)) return null;
  return Math.round((parsed - now.getTime()) / 86400000);
}

export function buildWorkspaceOperationsSummary({
  projects,
  plans,
  programs,
  reports,
  fundingOpportunities,
  now = new Date(),
}: {
  projects: WorkspaceOperationsProjectRow[];
  plans: WorkspaceOperationsPlanRow[];
  programs: WorkspaceOperationsProgramRow[];
  reports: WorkspaceOperationsReportRow[];
  fundingOpportunities: WorkspaceOperationsFundingOpportunityRow[];
  now?: Date;
}): WorkspaceOperationsSummary {
  const reportRows = reports.map((report) => {
    const freshness = getReportPacketFreshness({
      latestArtifactKind: report.latestArtifactKind,
      generatedAt: report.generatedAt,
      updatedAt: report.updatedAt,
    });
    const comparisonAggregate = parseStoredComparisonSnapshotAggregate(report.metadataJson);
    const comparisonDigest = describeComparisonSnapshotAggregate(comparisonAggregate);

    return {
      ...report,
      freshness,
      comparisonAggregate,
      comparisonDigest,
    };
  });

  const activeProjects = projects.filter((project) => !["complete", "archived", "cancelled"].includes(project.status ?? "")).length;
  const plansNeedingSetup = plans.filter((plan) => {
    const readiness = buildPlanReadiness({
      hasProject: Boolean(plan.projectId),
      scenarioCount: 0,
      engagementCampaignCount: 0,
      reportCount: 0,
      geographyLabel: plan.geographyLabel,
      horizonYear: plan.horizonYear,
    });

    return !readiness.ready;
  }).length;
  const activePrograms = programs.filter((program) => !["adopted", "archived"].includes(program.status ?? "")).length;
  const reportRefreshRecommended = reportRows.filter((report) => report.freshness.label === "Refresh recommended").length;
  const reportNoPacket = reportRows.filter((report) => report.freshness.label === "No packet").length;
  const comparisonBackedReports = reportRows.filter(
    (report) => (report.comparisonAggregate?.comparisonSnapshotCount ?? 0) > 0
  ).length;
  const openFundingOpportunities = fundingOpportunities.filter((item) => ["open", "upcoming"].includes(item.opportunityStatus ?? "")).length;
  const closingSoonFundingOpportunities = fundingOpportunities.filter((item) => {
    if ((item.opportunityStatus ?? "") !== "open") return false;
    const days = daysUntil(item.closesAt ?? item.decisionDueAt, now);
    return days !== null && days <= 14;
  }).length;

  const firstRefreshReport = reportRows.find((report) => report.freshness.label === "Refresh recommended");
  const firstMissingReport = reportRows.find((report) => report.freshness.label === "No packet");
  const firstComparisonBackedReport = reportRows.find(
    (report) => (report.comparisonAggregate?.comparisonSnapshotCount ?? 0) > 0
  );
  const firstClosingOpportunity = fundingOpportunities.find((item) => {
    if ((item.opportunityStatus ?? "") !== "open") return false;
    const days = daysUntil(item.closesAt ?? item.decisionDueAt, now);
    return days !== null && days <= 14;
  });
  const firstPlanNeedingSetup = plans.find((plan) => {
    const readiness = buildPlanReadiness({
      hasProject: Boolean(plan.projectId),
      scenarioCount: 0,
      engagementCampaignCount: 0,
      reportCount: 0,
      geographyLabel: plan.geographyLabel,
      horizonYear: plan.horizonYear,
    });

    return !readiness.ready;
  });
  const firstActiveProgram = programs.find((program) => !["adopted", "archived"].includes(program.status ?? ""));

  const queueCandidates: WorkspaceCommandQueueItem[] = [];

  if (reportRefreshRecommended > 0) {
    queueCandidates.push({
      key: "refresh-report-packets",
      title: "Refresh report packets",
      detail: `${reportRefreshRecommended} report packet${reportRefreshRecommended === 1 ? " needs" : "s need"} regeneration because the underlying record changed after generation.${firstRefreshReport?.title ? ` Start with ${firstRefreshReport.title}.` : ""}`,
      href: firstRefreshReport
        ? getReportNavigationHref(firstRefreshReport.id, firstRefreshReport.freshness.label)
        : "/reports?freshness=refresh",
      tone: "warning",
      priority: 0,
      badges: [
        { label: "Refresh", value: reportRefreshRecommended },
        { label: "Reports", value: reports.length },
      ],
    });
  }

  if (reportNoPacket > 0) {
    queueCandidates.push({
      key: "generate-first-packets",
      title: "Generate first report packets",
      detail: `${reportNoPacket} report record${reportNoPacket === 1 ? " is" : "s are"} still missing a packet artifact.${firstMissingReport?.title ? ` Start with ${firstMissingReport.title}.` : ""}`,
      href: firstMissingReport
        ? getReportNavigationHref(firstMissingReport.id, firstMissingReport.freshness.label)
        : "/reports?freshness=missing",
      tone: "warning",
      priority: 1,
      badges: [
        { label: "Missing", value: reportNoPacket },
        { label: "Reports", value: reports.length },
      ],
    });
  }

  if (closingSoonFundingOpportunities > 0) {
    queueCandidates.push({
      key: "funding-windows-closing",
      title: "Advance near-term funding windows",
      detail: `${closingSoonFundingOpportunities} open funding opportunit${closingSoonFundingOpportunities === 1 ? "y closes" : "ies close"} within 14 days.${firstClosingOpportunity?.title ? ` ${firstClosingOpportunity.title} is the first deadline to reopen.` : ""}`,
      href: "/programs",
      tone: "warning",
      priority: 2,
      badges: [
        { label: "Closing soon", value: closingSoonFundingOpportunities },
        { label: "Open", value: openFundingOpportunities },
      ],
    });
  }

  if (plansNeedingSetup > 0) {
    queueCandidates.push({
      key: "tighten-plan-foundations",
      title: "Tighten plan foundations",
      detail: `${plansNeedingSetup} plan record${plansNeedingSetup === 1 ? " still needs" : "s still need"} core setup around project linkage, geography, or horizon year.${firstPlanNeedingSetup?.title ? ` Reopen ${firstPlanNeedingSetup.title} first.` : ""}`,
      href: "/plans",
      tone: "info",
      priority: 3,
      badges: [
        { label: "Needs setup", value: plansNeedingSetup },
        { label: "Plans", value: plans.length },
      ],
    });
  }

  if (activePrograms > 0) {
    queueCandidates.push({
      key: "advance-program-packages",
      title: "Advance active program packages",
      detail: `${activePrograms} program package${activePrograms === 1 ? " is" : "s are"} still in assembly, submission, or review posture.${firstActiveProgram?.title ? ` ${firstActiveProgram.title} is a good next package anchor.` : ""}`,
      href: "/programs",
      tone: "info",
      priority: 4,
      badges: [
        { label: "Active programs", value: activePrograms },
        { label: "Programs", value: programs.length },
      ],
    });
  }

  if (comparisonBackedReports > 0) {
    queueCandidates.push({
      key: "review-comparison-backed-reports",
      title: "Review comparison-backed packet posture",
      detail: `${comparisonBackedReports} report${comparisonBackedReports === 1 ? " carries" : "s carry"} saved comparison context that can shape refresh and narrative choices.${firstComparisonBackedReport?.comparisonDigest?.detail ? ` ${firstComparisonBackedReport.comparisonDigest.detail}` : ""}`,
      href: "/reports?posture=comparison-backed",
      tone: "info",
      priority: 5,
      badges: [
        { label: "Comparison-backed", value: comparisonBackedReports },
        { label: "Ready comparisons", value: firstComparisonBackedReport?.comparisonAggregate?.readyComparisonSnapshotCount ?? null },
      ],
    });
  }

  const commandQueue = queueCandidates.sort((left, right) => left.priority - right.priority).slice(0, 5);

  const nextCommand = commandQueue[0] ?? null;
  const posture = nextCommand
    ? nextCommand.tone === "warning" || nextCommand.tone === "danger"
      ? "attention"
      : "active"
    : "stable";

  const headline = nextCommand ? nextCommand.title : "Workspace command queue is clear";
  const detail = nextCommand
    ? nextCommand.detail
    : reports.length > 0
      ? `The current workspace has ${reports.length} report record${reports.length === 1 ? "" : "s"}, ${projects.length} project${projects.length === 1 ? "" : "s"}, and no immediate packet or funding-window pressure visible from this snapshot.`
      : "Create the next project, plan, program, or report record so the operations runtime has a real command surface to prioritize.";

  return {
    posture,
    headline,
    detail,
    counts: {
      projects: projects.length,
      activeProjects,
      plans: plans.length,
      plansNeedingSetup,
      programs: programs.length,
      activePrograms,
      reports: reports.length,
      reportRefreshRecommended,
      reportNoPacket,
      comparisonBackedReports,
      fundingOpportunities: fundingOpportunities.length,
      openFundingOpportunities,
      closingSoonFundingOpportunities,
      queueDepth: commandQueue.length,
    },
    nextCommand,
    commandQueue,
  };
}
