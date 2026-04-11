import { buildPlanReadiness } from "@/lib/plans/catalog";
import {
  describeComparisonSnapshotAggregate,
  getReportNavigationHref,
  getReportPacketFreshness,
  parseStoredComparisonSnapshotAggregate,
} from "@/lib/reports/catalog";
import type { StatusTone } from "@/lib/ui/status";

type WorkspaceOperationsSelectChain = {
  eq: (column: string, value: string) => {
    order: (column: string, options: { ascending: boolean }) => {
      limit: (count: number) => PromiseLike<{ data: unknown[] | null }>;
    };
  };
};

export type WorkspaceOperationsSupabaseLike = {
  from: (table: string) => {
    select: (query: string) => WorkspaceOperationsSelectChain;
  };
};

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

export type WorkspaceOperationsProjectSourceRow = {
  id: string;
  name: string;
  status: string | null;
  delivery_phase: string | null;
  updated_at: string | null;
};

export type WorkspaceOperationsPlanSourceRow = {
  id: string;
  title: string;
  status: string | null;
  geography_label: string | null;
  horizon_year: number | null;
  project_id: string | null;
  updated_at: string | null;
};

export type WorkspaceOperationsProgramSourceRow = {
  id: string;
  title: string;
  status: string | null;
  nomination_due_at: string | null;
  adoption_target_at: string | null;
  updated_at: string | null;
};

export type WorkspaceOperationsFundingOpportunitySourceRow = {
  id: string;
  title: string;
  opportunity_status: string | null;
  closes_at: string | null;
  decision_due_at: string | null;
  program_id: string | null;
  updated_at: string | null;
};

export type WorkspaceOperationsReportSourceRow = {
  id: string;
  title: string | null;
  status: string | null;
  latest_artifact_kind: string | null;
  generated_at: string | null;
  updated_at: string | null;
  metadata_json: Record<string, unknown> | null;
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

function mapWorkspaceOperationsProjectRows(
  rows: WorkspaceOperationsProjectSourceRow[]
): WorkspaceOperationsProjectRow[] {
  return rows.map((project) => ({
    id: project.id,
    name: project.name,
    status: project.status,
    deliveryPhase: project.delivery_phase,
    updatedAt: project.updated_at,
  }));
}

function mapWorkspaceOperationsPlanRows(rows: WorkspaceOperationsPlanSourceRow[]): WorkspaceOperationsPlanRow[] {
  return rows.map((plan) => ({
    id: plan.id,
    title: plan.title,
    status: plan.status,
    geographyLabel: plan.geography_label,
    horizonYear: plan.horizon_year,
    projectId: plan.project_id,
    updatedAt: plan.updated_at,
  }));
}

function mapWorkspaceOperationsProgramRows(
  rows: WorkspaceOperationsProgramSourceRow[]
): WorkspaceOperationsProgramRow[] {
  return rows.map((program) => ({
    id: program.id,
    title: program.title,
    status: program.status,
    nominationDueAt: program.nomination_due_at,
    adoptionTargetAt: program.adoption_target_at,
    updatedAt: program.updated_at,
  }));
}

function mapWorkspaceOperationsReportRows(rows: WorkspaceOperationsReportSourceRow[]): WorkspaceOperationsReportRow[] {
  return rows.map((report) => ({
    id: report.id,
    title: report.title,
    status: report.status,
    latestArtifactKind: report.latest_artifact_kind,
    generatedAt: report.generated_at,
    updatedAt: report.updated_at,
    metadataJson: report.metadata_json,
  }));
}

function mapWorkspaceOperationsFundingOpportunityRows(
  rows: WorkspaceOperationsFundingOpportunitySourceRow[]
): WorkspaceOperationsFundingOpportunityRow[] {
  return rows.map((opportunity) => ({
    id: opportunity.id,
    title: opportunity.title,
    opportunityStatus: opportunity.opportunity_status,
    closesAt: opportunity.closes_at,
    decisionDueAt: opportunity.decision_due_at,
    programId: opportunity.program_id,
    updatedAt: opportunity.updated_at,
  }));
}

export function buildWorkspaceOperationsSummaryFromSourceRows({
  projects,
  plans,
  programs,
  reports,
  fundingOpportunities,
  now,
}: {
  projects: WorkspaceOperationsProjectSourceRow[];
  plans: WorkspaceOperationsPlanSourceRow[];
  programs: WorkspaceOperationsProgramSourceRow[];
  reports: WorkspaceOperationsReportSourceRow[];
  fundingOpportunities: WorkspaceOperationsFundingOpportunitySourceRow[];
  now?: Date;
}) {
  return buildWorkspaceOperationsSummary({
    projects: mapWorkspaceOperationsProjectRows(projects),
    plans: mapWorkspaceOperationsPlanRows(plans),
    programs: mapWorkspaceOperationsProgramRows(programs),
    reports: mapWorkspaceOperationsReportRows(reports),
    fundingOpportunities: mapWorkspaceOperationsFundingOpportunityRows(fundingOpportunities),
    now,
  });
}

export async function loadWorkspaceOperationsSummaryForWorkspace(
  supabase: WorkspaceOperationsSupabaseLike,
  workspaceId: string
): Promise<WorkspaceOperationsSummary> {
  const [projectsResult, plansResult, programsResult, reportsResult, fundingOpportunitiesResult] = await Promise.all([
    supabase
      .from("projects")
      .select("id, name, status, delivery_phase, updated_at")
      .eq("workspace_id", workspaceId)
      .order("updated_at", { ascending: false })
      .limit(200),
    supabase
      .from("plans")
      .select("id, title, status, geography_label, horizon_year, project_id, updated_at")
      .eq("workspace_id", workspaceId)
      .order("updated_at", { ascending: false })
      .limit(200),
    supabase
      .from("programs")
      .select("id, title, status, nomination_due_at, adoption_target_at, updated_at")
      .eq("workspace_id", workspaceId)
      .order("updated_at", { ascending: false })
      .limit(200),
    supabase
      .from("reports")
      .select("id, title, status, latest_artifact_kind, generated_at, updated_at, metadata_json")
      .eq("workspace_id", workspaceId)
      .order("updated_at", { ascending: false })
      .limit(200),
    supabase
      .from("funding_opportunities")
      .select("id, title, opportunity_status, closes_at, decision_due_at, program_id, updated_at")
      .eq("workspace_id", workspaceId)
      .order("updated_at", { ascending: false })
      .limit(200),
  ]);

  return buildWorkspaceOperationsSummaryFromSourceRows({
    projects: (projectsResult.data ?? []) as WorkspaceOperationsProjectSourceRow[],
    plans: (plansResult.data ?? []) as WorkspaceOperationsPlanSourceRow[],
    programs: (programsResult.data ?? []) as WorkspaceOperationsProgramSourceRow[],
    reports: (reportsResult.data ?? []) as WorkspaceOperationsReportSourceRow[],
    fundingOpportunities: (fundingOpportunitiesResult.data ?? []) as WorkspaceOperationsFundingOpportunitySourceRow[],
  });
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
