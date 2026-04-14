import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, FolderKanban, Layers3, Sparkles } from "lucide-react";
import { ProjectWorkspaceCreator } from "@/components/projects/project-workspace-creator";
import { ReportPacketCommandQueue } from "@/components/reports/report-packet-command-queue";
import {
  describeComparisonSnapshotAggregate,
  describeEvidenceChainSummary,
  getReportNavigationHref,
  getReportPacketActionLabel,
  getReportPacketFreshness,
  getReportPacketPriority,
  parseStoredComparisonSnapshotAggregate,
  parseStoredEvidenceChainSummary,
} from "@/lib/reports/catalog";
import { createClient } from "@/lib/supabase/server";

type ProjectRow = {
  id: string;
  workspace_id: string;
  name: string;
  summary: string | null;
  status: string;
  plan_type: string;
  delivery_phase: string;
  created_at: string;
  updated_at: string;
  workspaces:
    | {
        name: string | null;
        plan: string | null;
        created_at: string | null;
      }
    | Array<{
        name: string | null;
        plan: string | null;
        created_at: string | null;
      }>
    | null;
};

type ProjectReportRow = {
  id: string;
  project_id: string;
  title: string;
  status: string;
  updated_at: string;
  generated_at: string | null;
  latest_artifact_kind: string | null;
};

type ReportArtifactRow = {
  report_id: string;
  generated_at: string;
  metadata_json: Record<string, unknown> | null;
};

type ProjectRtpLinkRow = {
  id: string;
  project_id: string;
  portfolio_role: string;
};

function titleize(value: string | null | undefined): string {
  if (!value) return "Unknown";
  return value
    .replace(/[_-]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function fmtDate(value: string | null | undefined): string {
  if (!value) return "Unknown";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString();
}

function getProjectPacketCommandPriority(project: {
  reportSummary: {
    attentionCount: number;
    governanceHoldCount: number;
    comparisonBackedCount: number;
  };
}) {
  if (project.reportSummary.attentionCount > 0) return 0;
  if (project.reportSummary.governanceHoldCount > 0) return 1;
  if (project.reportSummary.comparisonBackedCount > 0) return 2;
  return 3;
}

function describeProjectPacketCommand(project: {
  reportSummary: {
    attentionCount: number;
    refreshRecommendedCount: number;
    noPacketCount: number;
    comparisonBackedCount: number;
    governanceHoldCount: number;
    recommendedReport: {
      title: string;
      packetFreshness: { label: string; detail: string };
    } | null;
  };
}) {
  const report = project.reportSummary.recommendedReport;

  if (project.reportSummary.refreshRecommendedCount > 0 && report) {
    return {
      label: `First action: refresh ${report.title}`,
      detail: report.packetFreshness.detail,
    };
  }

  if (project.reportSummary.noPacketCount > 0 && report) {
    return {
      label: `First action: generate ${report.title}`,
      detail: report.packetFreshness.detail,
    };
  }

  if (project.reportSummary.governanceHoldCount > 0 && report) {
    return {
      label: `First action: review governance hold in ${report.title}`,
      detail: "Evidence-backed packet exists, but at least one report still surfaces a governance blocker.",
    };
  }

  if (project.reportSummary.comparisonBackedCount > 0 && report) {
    return {
      label: `First action: review comparison-backed packet ${report.title}`,
      detail: `${project.reportSummary.comparisonBackedCount} report${project.reportSummary.comparisonBackedCount === 1 ? " carries" : "s carry"} saved comparison context that can support grant planning language or prioritization framing for this project. Treat it as planning support, not proof of award likelihood or a replacement for funding-source review.`,
    };
  }

  if (report) {
    return {
      label: `First action: review ${report.title}`,
      detail: report.packetFreshness.detail,
    };
  }

  return {
    label: "First action: create the first report packet",
    detail: "No report records linked yet. Open the project to start the packet trail.",
  };
}

export default async function ProjectsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/sign-in");
  }

  const { data: projectsData } = await supabase
    .from("projects")
    .select(
      "id, workspace_id, name, summary, status, plan_type, delivery_phase, created_at, updated_at, workspaces(name, plan, created_at)"
    )
    .order("updated_at", { ascending: false });

  const projectIds = ((projectsData ?? []) as ProjectRow[]).map((project) => project.id);
  const { data: projectReportsData } = projectIds.length
    ? await supabase
        .from("reports")
        .select(
          "id, project_id, title, status, updated_at, generated_at, latest_artifact_kind"
        )
        .in("project_id", projectIds)
        .order("updated_at", { ascending: false })
    : { data: [] };

  const { data: projectRtpLinksData } = projectIds.length
    ? await supabase
        .from("project_rtp_cycle_links")
        .select("id, project_id, portfolio_role")
        .in("project_id", projectIds)
    : { data: [] };

  const reportIds = ((projectReportsData ?? []) as ProjectReportRow[]).map(
    (report) => report.id
  );
  const { data: reportArtifactsData } = reportIds.length
    ? await supabase
        .from("report_artifacts")
        .select("report_id, generated_at, metadata_json")
        .in("report_id", reportIds)
        .order("generated_at", { ascending: false })
    : { data: [] };

  const latestArtifactByReportId = new Map<string, ReportArtifactRow>();
  for (const artifact of (reportArtifactsData ?? []) as ReportArtifactRow[]) {
    if (!latestArtifactByReportId.has(artifact.report_id)) {
      latestArtifactByReportId.set(artifact.report_id, artifact);
    }
  }

  const reportsByProjectId = new Map<
    string,
    Array<
      ProjectReportRow & {
        packetFreshness: ReturnType<typeof getReportPacketFreshness>;
        evidenceChainDigest: ReturnType<typeof describeEvidenceChainSummary>;
        comparisonDigest: ReturnType<typeof describeComparisonSnapshotAggregate>;
      }
    >
  >();
  const rtpLinksByProjectId = new Map<string, ProjectRtpLinkRow[]>();
  for (const link of (projectRtpLinksData ?? []) as ProjectRtpLinkRow[]) {
    const current = rtpLinksByProjectId.get(link.project_id) ?? [];
    current.push(link);
    rtpLinksByProjectId.set(link.project_id, current);
  }

  for (const report of (projectReportsData ?? []) as ProjectReportRow[]) {
    const current = reportsByProjectId.get(report.project_id) ?? [];
    const latestArtifact = latestArtifactByReportId.get(report.id) ?? null;
    current.push({
      ...report,
      packetFreshness: getReportPacketFreshness({
        latestArtifactKind: report.latest_artifact_kind,
        generatedAt: latestArtifact?.generated_at ?? report.generated_at,
        updatedAt: report.updated_at,
      }),
      comparisonDigest: describeComparisonSnapshotAggregate(
        parseStoredComparisonSnapshotAggregate(
          latestArtifact?.metadata_json ?? null
        )
      ),
      evidenceChainDigest: describeEvidenceChainSummary(
        parseStoredEvidenceChainSummary(
          latestArtifact?.metadata_json ?? null
        )
      ),
    });
    reportsByProjectId.set(report.project_id, current);
  }

  const projects = ((projectsData ?? []) as ProjectRow[]).map((project) => {
    const rtpLinks = rtpLinksByProjectId.get(project.id) ?? [];
    const reports = (reportsByProjectId.get(project.id) ?? []).sort((left, right) => {
      const freshnessPriority =
        getReportPacketPriority(left.packetFreshness.label) -
        getReportPacketPriority(right.packetFreshness.label);
      if (freshnessPriority !== 0) {
        return freshnessPriority;
      }

      return (
        new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime()
      );
    });
    const refreshRecommendedCount = reports.filter(
      (report) => report.packetFreshness.label === "Refresh recommended"
    ).length;
    const noPacketCount = reports.filter(
      (report) => report.packetFreshness.label === "No packet"
    ).length;
    const evidenceBackedCount = reports.filter((report) =>
      Boolean(report.evidenceChainDigest)
    ).length;
    const governanceHoldCount = reports.filter((report) =>
      Boolean(report.evidenceChainDigest?.blockedGateDetail)
    ).length;
    const comparisonBackedCount = reports.filter((report) =>
      Boolean(report.comparisonDigest)
    ).length;

    const projectRecord = {
      ...project,
      workspace: Array.isArray(project.workspaces)
        ? project.workspaces[0] ?? null
        : project.workspaces ?? null,
      reportSummary: {
        totalCount: reports.length,
        attentionCount: refreshRecommendedCount + noPacketCount,
        refreshRecommendedCount,
        noPacketCount,
        evidenceBackedCount,
        comparisonBackedCount,
        governanceHoldCount,
        recommendedReport: reports[0] ?? null,
      },
      rtpSummary: {
        totalCount: rtpLinks.length,
        constrainedCount: rtpLinks.filter((link) => link.portfolio_role === "constrained").length,
        illustrativeCount: rtpLinks.filter((link) => link.portfolio_role === "illustrative").length,
        candidateCount: rtpLinks.filter((link) => link.portfolio_role === "candidate").length,
      },
    };

    return {
      ...projectRecord,
      packetCommand: describeProjectPacketCommand(projectRecord),
    };
  }).sort((left, right) => {
    const commandPriority = getProjectPacketCommandPriority(left) - getProjectPacketCommandPriority(right);
    if (commandPriority !== 0) {
      return commandPriority;
    }

    return new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime();
  });

  const activeCount = projects.filter((project) => project.status === "active").length;
  const planningTypes = new Set(projects.map((project) => project.plan_type)).size;
  const scopingCount = projects.filter((project) => project.delivery_phase === "scoping").length;
  const projectsWithReportAttentionCount = projects.filter(
    (project) => project.reportSummary.attentionCount > 0
  ).length;
  const projectsWithEvidenceBackedReportsCount = projects.filter(
    (project) => project.reportSummary.evidenceBackedCount > 0
  ).length;
  const projectsWithComparisonBackedReportsCount = projects.filter(
    (project) => project.reportSummary.comparisonBackedCount > 0
  ).length;
  const projectsLinkedToRtpCount = projects.filter((project) => project.rtpSummary.totalCount > 0).length;
  const governanceHoldReportCount = projects.reduce(
    (sum, project) => sum + project.reportSummary.governanceHoldCount,
    0
  );
  const packetQueueProjects = projects.filter(
    (project) =>
      project.reportSummary.attentionCount > 0 ||
      project.reportSummary.governanceHoldCount > 0 ||
      project.reportSummary.comparisonBackedCount > 0
  );

  return (
    <section className="module-page">
      <header className="module-header-grid">
        <article className="module-intro-card">
          <div className="module-intro-kicker">
            <Sparkles className="h-3.5 w-3.5" />
            Project workspace
          </div>
          <div className="module-intro-body">
            <h1 className="module-intro-title">Projects</h1>
            <p className="module-intro-description">
              Keep project context, recent activity, and delivery records together in one place so teams can quickly see
              what is active and what needs attention.
            </p>
          </div>

          <div className="module-summary-grid cols-3">
            <div className="module-summary-card">
              <p className="module-summary-label">Projects</p>
              <p className="module-summary-value">{projects.length}</p>
              <p className="module-summary-detail">Project records connected to the rest of the workspace.</p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Active</p>
              <p className="module-summary-value">{activeCount}</p>
              <p className="module-summary-detail">Currently in motion across the workspace portfolio.</p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Plan types</p>
              <p className="module-summary-value">{planningTypes}</p>
              <p className="module-summary-detail">Including {scopingCount} projects still in scoping posture.</p>
            </div>
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            <div className="module-record-chip">
              <span>Report attention</span>
              <strong>{projectsWithReportAttentionCount}</strong>
            </div>
            <div className="module-record-chip">
              <span>Evidence-backed</span>
              <strong>{projectsWithEvidenceBackedReportsCount}</strong>
            </div>
            <div className="module-record-chip">
              <span>Comparison-backed</span>
              <strong>{projectsWithComparisonBackedReportsCount}</strong>
            </div>
            <div className="module-record-chip">
              <span>Governance hold</span>
              <strong>{governanceHoldReportCount}</strong>
            </div>
            <div className="module-record-chip">
              <span>RTP-linked</span>
              <strong>{projectsLinkedToRtpCount}</strong>
            </div>
          </div>
        </article>

        <article className="module-operator-card">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.05]">
              <Layers3 className="h-5 w-5 text-emerald-200" />
            </span>
            <div>
              <p className="module-operator-eyebrow">Portfolio</p>
              <h2 className="module-operator-title">Projects</h2>
            </div>
          </div>
          <p className="module-operator-copy">
            Create projects, review active work, and move into project details from one place.
          </p>
          <div className="module-operator-list">
            <div className="module-operator-item">Track project records, status, and linked work.</div>
            <div className="module-operator-item">Keep plans, reports, and related decisions connected.</div>
            <div className="module-operator-item">Open any project to continue the workflow.</div>
          </div>
        </article>
      </header>

      <div className="grid gap-6 xl:grid-cols-[0.94fr_1.06fr]">
        <ProjectWorkspaceCreator />

        <article className="module-section-surface">
          <div className="module-section-header">
            <div className="module-section-heading">
              <p className="module-section-label">Portfolio</p>
              <h2 className="module-section-title">Project records</h2>
              <p className="module-section-description">All saved projects in the current workspace.</p>
            </div>
            <span className="module-record-chip">
              <FolderKanban className="h-3.5 w-3.5" />
              <span>Total</span>
              <strong>{projects.length}</strong>
            </span>
          </div>

          {projects.length === 0 ? (
            <div className="module-empty-state mt-5 text-sm">
              No project records yet. Create your first project to start tracking work here.
            </div>
          ) : (
            <>
              <div className="mt-5">
                <ReportPacketCommandQueue
                  title="Portfolio packet queue"
                  description="The highest-priority packet actions across the workspace, ordered before the full project registry."
                  items={packetQueueProjects.slice(0, 5).map((project) => {
                    const report = project.reportSummary.recommendedReport;
                    const badges: Array<{ label: string; value?: string | number | null }> = [];
                    if (project.reportSummary.attentionCount > 0) {
                      badges.push({ label: "Attention", value: project.reportSummary.attentionCount });
                    }
                    if (project.reportSummary.comparisonBackedCount > 0) {
                      badges.push({ label: "Comparison-backed", value: project.reportSummary.comparisonBackedCount });
                    }
                    if (project.reportSummary.governanceHoldCount > 0) {
                      badges.push({ label: "Governance hold", value: project.reportSummary.governanceHoldCount });
                    }
                    return {
                      key: `queue-${project.id}`,
                      href: report
                        ? getReportNavigationHref(report.id, report.packetFreshness.label)
                        : `/projects/${project.id}`,
                      title: project.name,
                      subtitle: project.packetCommand.label,
                      detail: project.packetCommand.detail,
                      badges,
                    };
                  })}
                  emptyLabel="No queued packet work across the portfolio."
                />
              </div>

              <div className="mt-5 module-record-list">
                {projects.map((project) => (
                <Link key={project.id} href={`/projects/${project.id}`} className="module-record-row is-interactive group block">
                  <div className="module-record-head">
                    <div className="module-record-main">
                      <div className="module-record-kicker">
                        <span className="module-record-chip"><span>Status</span><strong>{titleize(project.status)}</strong></span>
                        <span className="module-record-chip"><span>Plan</span><strong>{titleize(project.plan_type)}</strong></span>
                        <span className="module-record-chip"><span>Phase</span><strong>{titleize(project.delivery_phase)}</strong></span>
                      </div>

                      <div className="space-y-1.5">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <h3 className="module-record-title text-[1.05rem] transition group-hover:text-primary">
                            {project.name}
                          </h3>
                          <p className="module-record-stamp">Updated {fmtDate(project.updated_at)}</p>
                        </div>
                        <p className="module-record-summary line-clamp-2">
                          {project.summary ||
                            "No summary yet — this project workspace is ready for planning, reporting, and analysis activity."}
                        </p>
                      </div>
                    </div>

                    <ArrowRight className="mt-0.5 h-4.5 w-4.5 text-muted-foreground transition group-hover:text-primary" />
                  </div>

                  <div className="module-record-meta">
                    <span className="module-record-chip"><span>Workspace</span><strong>{project.workspace?.name ?? "Unknown"}</strong></span>
                    <span className="module-record-chip"><span>Tier</span><strong>{titleize(project.workspace?.plan ?? "pilot")}</strong></span>
                    <span className="module-record-chip"><span>Created</span><strong>{fmtDate(project.created_at)}</strong></span>
                    {project.rtpSummary.totalCount > 0 ? (
                      <span className="module-record-chip"><span>RTP cycles</span><strong>{project.rtpSummary.totalCount}</strong></span>
                    ) : null}
                    {project.rtpSummary.constrainedCount > 0 ? (
                      <span className="module-record-chip"><span>Constrained</span><strong>{project.rtpSummary.constrainedCount}</strong></span>
                    ) : null}
                    <span className="module-record-chip"><span>Reports</span><strong>{project.reportSummary.totalCount}</strong></span>
                    {project.reportSummary.attentionCount > 0 ? (
                      <span className="module-record-chip"><span>Need attention</span><strong>{project.reportSummary.attentionCount}</strong></span>
                    ) : null}
                    {project.reportSummary.evidenceBackedCount > 0 ? (
                      <span className="module-record-chip"><span>Evidence-backed</span><strong>{project.reportSummary.evidenceBackedCount}</strong></span>
                    ) : null}
                    {project.reportSummary.comparisonBackedCount > 0 ? (
                      <span className="module-record-chip"><span>Comparison-backed</span><strong>{project.reportSummary.comparisonBackedCount}</strong></span>
                    ) : null}
                    {project.reportSummary.governanceHoldCount > 0 ? (
                      <span className="module-record-chip"><span>Governance hold</span><strong>{project.reportSummary.governanceHoldCount}</strong></span>
                    ) : null}
                  </div>

                  <div className="mt-3 border-t border-border/70 pt-3">
                    <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      Portfolio packet command
                    </p>
                    <p className="mt-1 text-sm font-semibold text-foreground">
                      {project.packetCommand.label}
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      {project.packetCommand.detail}
                    </p>
                    {project.reportSummary.recommendedReport ? (
                      <>
                        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                          {getReportPacketActionLabel(
                            project.reportSummary.recommendedReport.packetFreshness.label
                          )}
                        </p>
                        {project.reportSummary.recommendedReport.evidenceChainDigest ? (
                          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                            {project.reportSummary.recommendedReport.evidenceChainDigest.headline}
                            {project.reportSummary.recommendedReport.evidenceChainDigest.blockedGateDetail
                              ? ` · ${project.reportSummary.recommendedReport.evidenceChainDigest.blockedGateDetail}`
                              : ""}
                          </p>
                        ) : null}
                        {project.reportSummary.recommendedReport.comparisonDigest ? (
                          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                            {project.reportSummary.recommendedReport.comparisonDigest.headline}
                            {` · ${project.reportSummary.recommendedReport.comparisonDigest.detail}`}
                          </p>
                        ) : null}
                      </>
                    ) : (
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                        No report records linked yet. Open the project to create the first packet trail.
                      </p>
                    )}
                  </div>
                </Link>
                ))}
              </div>
            </>
          )}
        </article>
      </div>
    </section>
  );
}
