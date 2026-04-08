import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, FolderKanban, Layers3, Sparkles } from "lucide-react";
import { ProjectWorkspaceCreator } from "@/components/projects/project-workspace-creator";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  describeEvidenceChainSummary,
  getReportPacketActionLabel,
  getReportPacketFreshness,
  getReportPacketPriority,
} from "@/lib/reports/catalog";
import { createClient } from "@/lib/supabase/server";
import { type EvidenceChainSummary } from "@/lib/reports/evidence-chain";

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

function titleize(value: string | null | undefined): string {
  if (!value) return "Unknown";
  return value
    .replace(/[_-]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function toneForStatus(status: string): "info" | "success" | "warning" | "danger" | "neutral" {
  if (status === "active") return "success";
  if (status === "draft") return "neutral";
  if (status === "on_hold") return "warning";
  if (status === "complete") return "info";
  return "neutral";
}

function fmtDate(value: string | null | undefined): string {
  if (!value) return "Unknown";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asEvidenceChainSummary(
  metadata: Record<string, unknown> | null | undefined
): EvidenceChainSummary | null {
  const sourceContext = asRecord(metadata?.sourceContext);
  const summary = asRecord(sourceContext?.evidenceChainSummary);
  if (!summary) {
    return null;
  }

  return {
    linkedRunCount: asNullableNumber(summary.linkedRunCount) ?? 0,
    scenarioSetLinkCount: asNullableNumber(summary.scenarioSetLinkCount) ?? 0,
    projectRecordGroupCount: asNullableNumber(summary.projectRecordGroupCount) ?? 0,
    totalProjectRecordCount: asNullableNumber(summary.totalProjectRecordCount) ?? 0,
    engagementLabel: asNullableString(summary.engagementLabel) ?? "Unknown",
    engagementItemCount: asNullableNumber(summary.engagementItemCount) ?? 0,
    engagementReadyForHandoffCount:
      asNullableNumber(summary.engagementReadyForHandoffCount) ?? 0,
    stageGateLabel: asNullableString(summary.stageGateLabel) ?? "Unknown",
    stageGatePassCount: asNullableNumber(summary.stageGatePassCount) ?? 0,
    stageGateHoldCount: asNullableNumber(summary.stageGateHoldCount) ?? 0,
    stageGateBlockedGateLabel: asNullableString(summary.stageGateBlockedGateLabel),
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
      }
    >
  >();
  for (const report of (projectReportsData ?? []) as ProjectReportRow[]) {
    const current = reportsByProjectId.get(report.project_id) ?? [];
    current.push({
      ...report,
      packetFreshness: getReportPacketFreshness({
        latestArtifactKind: report.latest_artifact_kind,
        generatedAt: report.generated_at,
        updatedAt: report.updated_at,
      }),
      evidenceChainDigest: describeEvidenceChainSummary(
        asEvidenceChainSummary(
          latestArtifactByReportId.get(report.id)?.metadata_json ?? null
        )
      ),
    });
    reportsByProjectId.set(report.project_id, current);
  }

  const projects = ((projectsData ?? []) as ProjectRow[]).map((project) => {
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

    return {
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
        governanceHoldCount,
        recommendedReport: reports[0] ?? null,
      },
    };
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
  const governanceHoldReportCount = projects.reduce(
    (sum, project) => sum + project.reportSummary.governanceHoldCount,
    0
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

          <div className="mt-4 flex flex-wrap gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/25 bg-amber-500/10 px-3 py-1 text-[0.72rem] font-semibold uppercase tracking-[0.12em] text-amber-800 dark:text-amber-200">
              {projectsWithReportAttentionCount} project{projectsWithReportAttentionCount === 1 ? "" : "s"} with report attention
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-500/25 bg-sky-500/10 px-3 py-1 text-[0.72rem] font-semibold uppercase tracking-[0.12em] text-sky-700 dark:text-sky-300">
              {projectsWithEvidenceBackedReportsCount} project{projectsWithEvidenceBackedReportsCount === 1 ? "" : "s"} with evidence-backed packets
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-rose-500/25 bg-rose-500/10 px-3 py-1 text-[0.72rem] font-semibold uppercase tracking-[0.12em] text-rose-700 dark:text-rose-300">
              {governanceHoldReportCount} governance hold{governanceHoldReportCount === 1 ? "" : "s"} surfaced
            </span>
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
            <span className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-background/80 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              <FolderKanban className="h-3.5 w-3.5" />
              {projects.length} total
            </span>
          </div>

          {projects.length === 0 ? (
            <div className="module-empty-state mt-5 text-sm">
              No project records yet. Create your first project to start tracking work here.
            </div>
          ) : (
            <div className="mt-5 module-record-list">
              {projects.map((project) => (
                <Link key={project.id} href={`/projects/${project.id}`} className="module-record-row is-interactive group block">
                  <div className="module-record-head">
                    <div className="module-record-main">
                      <div className="module-record-kicker">
                        <StatusBadge tone={toneForStatus(project.status)}>{titleize(project.status)}</StatusBadge>
                        <StatusBadge tone="info">{titleize(project.plan_type)}</StatusBadge>
                        <StatusBadge tone="neutral">{titleize(project.delivery_phase)}</StatusBadge>
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
                    <span className="module-record-chip">Workspace {project.workspace?.name ?? "Unknown"}</span>
                    <span className="module-record-chip">Tier {titleize(project.workspace?.plan ?? "pilot")}</span>
                    <span className="module-record-chip">Created {fmtDate(project.created_at)}</span>
                    <span className="module-record-chip">{project.reportSummary.totalCount} report{project.reportSummary.totalCount === 1 ? "" : "s"}</span>
                    {project.reportSummary.attentionCount > 0 ? (
                      <span className="module-record-chip">{project.reportSummary.attentionCount} need attention</span>
                    ) : null}
                    {project.reportSummary.evidenceBackedCount > 0 ? (
                      <span className="module-record-chip">{project.reportSummary.evidenceBackedCount} evidence-backed</span>
                    ) : null}
                    {project.reportSummary.governanceHoldCount > 0 ? (
                      <span className="module-record-chip">{project.reportSummary.governanceHoldCount} governance hold{project.reportSummary.governanceHoldCount === 1 ? "" : "s"}</span>
                    ) : null}
                  </div>

                  <div className="mt-3 rounded-2xl border border-border/70 bg-background/70 px-4 py-3">
                    <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      Report packet posture
                    </p>
                    {project.reportSummary.recommendedReport ? (
                      <>
                        <p className="mt-1 text-sm font-semibold text-foreground">
                          {project.reportSummary.recommendedReport.title}
                        </p>
                        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                          {getReportPacketActionLabel(
                            project.reportSummary.recommendedReport.packetFreshness.label
                          )}
                        </p>
                        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                          {project.reportSummary.recommendedReport.packetFreshness.detail}
                        </p>
                        {project.reportSummary.recommendedReport.evidenceChainDigest ? (
                          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                            {project.reportSummary.recommendedReport.evidenceChainDigest.headline}
                            {project.reportSummary.recommendedReport.evidenceChainDigest.blockedGateDetail
                              ? ` · ${project.reportSummary.recommendedReport.evidenceChainDigest.blockedGateDetail}`
                              : ""}
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
          )}
        </article>
      </div>
    </section>
  );
}
