import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, Download, FolderKanban, Layers3, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { CartographicSelectionLink } from "@/components/cartographic/cartographic-selection-link";
import { ProjectWorkspaceCreator } from "@/components/projects/project-workspace-creator";
import {
  ProjectPortfolioImporter,
  type PortfolioImportSummary,
} from "@/components/projects/project-portfolio-importer";
import { WorkspaceMembershipRequired } from "@/components/workspaces/workspace-membership-required";
import { ReportPacketCommandQueue } from "@/components/reports/report-packet-command-queue";
import {
  buildGrantDecisionModelingSupport,
  buildProjectGrantModelingEvidenceByProjectId,
  describeProjectGrantModelingReadiness,
} from "@/lib/grants/modeling-evidence";
import { buildAerialProjectPosture, type AerialProjectPosture } from "@/lib/aerial/public";
import { loadAerialPostureInputsForProjects } from "@/lib/aerial/queries";
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
import { PACKET_FRESHNESS_LABELS } from "@/lib/reports/packet-labels";
import { StateBlock } from "@/components/ui/state-block";
import { ProjectPortfolioTable } from "@/components/projects/project-portfolio-table";
import { WorkPlanTemplateApplier } from "@/components/projects/work-plan-template-applier";
import { buildProjectPortfolioSummary } from "@/lib/projects/portfolio";
import { loadProjectPortfolioInputs } from "@/lib/projects/portfolio-queries";
import { workPlanTemplateRegistry } from "@/lib/work-plans/built-in";
import { createClient } from "@/lib/supabase/server";
import { ReadFailureLog } from "@/lib/ui/read-failures";
import { loadCurrentWorkspaceMembership } from "@/lib/workspaces/current";
import { moduleMetadata } from "@/lib/ui/page-title";

export const metadata = moduleMetadata("Projects");

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
        created_at: string | null;
      }
    | Array<{
        name: string | null;
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

type PortfolioImportBatchRow = {
  id: string;
  source_sha256: string;
  source_format: "csv" | "xls" | "xlsx" | "ods";
  sheet_configurations_json: unknown;
  row_count: number;
  created_count: number;
  skipped_count: number;
  conflicted_count: number;
  invalid_count: number;
  previously_created_count: number;
  imported_at: string;
  source_document:
    | { title: string | null; original_filename: string | null }
    | Array<{ title: string | null; original_filename: string | null }>
    | null;
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

/** What a card says when the reports read failed, in place of a count of zero. */
const REPORTS_UNREADABLE_DETAIL =
  "The reports linked to this project could not be read, so this is unavailable rather than empty — it is not a finding that the project has no reports.";

function describeProjectPacketCommand(
  project: {
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
  },
  reportsReadFailed: boolean
) {
  const report = project.reportSummary.recommendedReport;

  // Checked before every packet rule below, because each of them reads an
  // absence as a finding — "generate the first packet" over a project whose
  // reports the database refused to hand over is a false instruction.
  if (reportsReadFailed && !report) {
    return {
      label: "First action: unavailable — the linked reports could not be read",
      detail: REPORTS_UNREADABLE_DETAIL,
    };
  }

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
      detail: "A report backed by evidence exists, but at least one report is still waiting for sign-off.",
    };
  }

  if (project.reportSummary.comparisonBackedCount > 0 && report) {
    return {
      label: `First action: review ${report.title}, which is backed by a comparison`,
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
    label: "First action: create the first report",
    detail: "No reports linked yet. Open the project to write the first one.",
  };
}

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
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
        moduleLabel="Projects"
        title="Projects need a workspace"
        description="Projects belong to a workspace. You are signed in, but this account is not in a workspace yet — a workspace is normally created for you when you sign up. Reload your workspace, or ask an owner/admin to add you to the correct one."
      />
    );
  }

  const workspaceId = membership.workspace_id;

  // Every read behind this registry is collected rather than discarded. The
  // portfolio read is the one that mattered most: `const { data }` gave `null`
  // for both "this workspace has no projects" and "the query failed", and the
  // page then told an agency "No project records yet. Create your first
  // project" over a portfolio it simply could not see. The other three feed the
  // per-card packet copy, which has its own false-absence sentence.
  const reads = new ReadFailureLog();

  const projectsResult = await supabase
    .from("projects")
    .select(
      "id, workspace_id, name, summary, status, plan_type, delivery_phase, created_at, updated_at, workspaces(name, created_at)"
    )
    .eq("workspace_id", workspaceId)
    .order("updated_at", { ascending: false });
  const projectsReadFailed = reads.check("your projects", projectsResult);
  const projectsData = projectsReadFailed ? [] : projectsResult.data;

  const portfolioImportsResult = await supabase
    .from("project_portfolio_import_batches")
    .select(
      "id, source_sha256, source_format, sheet_configurations_json, row_count, created_count, skipped_count, conflicted_count, invalid_count, previously_created_count, imported_at, source_document:kb_documents!project_portfolio_import_batches_source_document_id_fkey(title, original_filename)"
    )
    .eq("workspace_id", workspaceId)
    .order("imported_at", { ascending: false })
    .limit(6);
  const importHistoryReadFailed = reads.check("recent project-list imports", portfolioImportsResult);
  const recentImports: PortfolioImportSummary[] = importHistoryReadFailed
    ? []
    : ((portfolioImportsResult.data ?? []) as PortfolioImportBatchRow[]).map((row) => {
        const source = Array.isArray(row.source_document)
          ? row.source_document[0] ?? null
          : row.source_document;
        return {
          id: row.id,
          sourceTitle: source?.title ?? null,
          sourceFilename: source?.original_filename ?? null,
          sourceHash: row.source_sha256,
          sourceFormat: row.source_format,
          sheetCount: Array.isArray(row.sheet_configurations_json)
            ? row.sheet_configurations_json.length
            : 0,
          rowCount: row.row_count,
          createdCount: row.created_count,
          skippedCount: row.skipped_count,
          conflictedCount: row.conflicted_count,
          invalidCount: row.invalid_count,
          previouslyCreatedCount: row.previously_created_count,
          importedAt: row.imported_at,
        };
      });

  const projectIds = ((projectsData ?? []) as ProjectRow[]).map((project) => project.id);
  const projectReportsResult = projectIds.length
    ? await supabase
        .from("reports")
        .select(
          "id, project_id, title, status, updated_at, generated_at, latest_artifact_kind"
        )
        .in("project_id", projectIds)
        .order("updated_at", { ascending: false })
    : { data: [], error: null };
  const reportsReadFailed = reads.check("the reports linked to them", projectReportsResult);
  const projectReportsData = reportsReadFailed ? [] : projectReportsResult.data;

  const projectRtpLinksResult = projectIds.length
    ? await supabase
        .from("project_rtp_cycle_links")
        .select("id, project_id, portfolio_role")
        .in("project_id", projectIds)
    : { data: [], error: null };
  const rtpLinksReadFailed = reads.check("RTP cycle links", projectRtpLinksResult);
  const projectRtpLinksData = rtpLinksReadFailed ? [] : projectRtpLinksResult.data;

  const reportIds = ((projectReportsData ?? []) as ProjectReportRow[]).map(
    (report) => report.id
  );
  const reportArtifactsResult = reportIds.length
    ? await supabase
        .from("report_artifacts")
        .select("report_id, generated_at, metadata_json")
        .in("report_id", reportIds)
        .order("generated_at", { ascending: false })
    : { data: [], error: null };
  // An unreadable artifact list makes every packet look ungenerated, which the
  // freshness rules turn into "First action: generate <report>" — an instruction
  // to redo work that may already exist.
  reads.check("the report files already generated", reportArtifactsResult);
  const reportArtifactsData = reportArtifactsResult.error ? [] : reportArtifactsResult.data;

  const latestArtifactByReportId = new Map<string, ReportArtifactRow>();
  for (const artifact of (reportArtifactsData ?? []) as ReportArtifactRow[]) {
    if (!latestArtifactByReportId.has(artifact.report_id)) {
      latestArtifactByReportId.set(artifact.report_id, artifact);
    }
  }

  const { missions: aerialMissions, packages: aerialPackages } =
    await loadAerialPostureInputsForProjects(supabase, projectIds);

  const aerialPostureByProjectId = new Map<string, AerialProjectPosture>();
  for (const projectId of projectIds) {
    const missions = aerialMissions.filter((m) => m.project_id === projectId);
    if (missions.length === 0) continue;
    const packages = aerialPackages.filter((p) => p.project_id === projectId);
    aerialPostureByProjectId.set(projectId, buildAerialProjectPosture(missions, packages));
  }

  const projectGrantModelingEvidenceByProjectId = buildProjectGrantModelingEvidenceByProjectId(
    (projectReportsData ?? []) as Array<{
      id: string;
      project_id: string;
      title: string;
      updated_at: string;
      generated_at: string | null;
      latest_artifact_kind: string | null;
    }>,
    (reportArtifactsData ?? []) as Array<{
      report_id: string;
      generated_at: string;
      metadata_json: Record<string, unknown> | null;
    }>
  );

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
      (report) => report.packetFreshness.label === PACKET_FRESHNESS_LABELS.REFRESH_RECOMMENDED
    ).length;
    const noPacketCount = reports.filter(
      (report) => report.packetFreshness.label === PACKET_FRESHNESS_LABELS.NO_PACKET
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
    const grantModelingEvidence =
      projectGrantModelingEvidenceByProjectId.get(project.id) ?? null;
    const grantModelingReadiness = describeProjectGrantModelingReadiness(
      grantModelingEvidence
    );
    const grantModelingSupport = buildGrantDecisionModelingSupport(
      grantModelingEvidence,
      project.name
    );

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
      grantModelingEvidence,
      grantModelingReadiness,
      grantModelingSupport,
      aerialPosture: aerialPostureByProjectId.get(project.id) ?? null,
      rtpSummary: {
        totalCount: rtpLinks.length,
        constrainedCount: rtpLinks.filter((link) => link.portfolio_role === "constrained").length,
        illustrativeCount: rtpLinks.filter((link) => link.portfolio_role === "illustrative").length,
        candidateCount: rtpLinks.filter((link) => link.portfolio_role === "candidate").length,
      },
    };

    const packetCommand = describeProjectPacketCommand(projectRecord, reportsReadFailed);
    if (
      projectRecord.reportSummary.comparisonBackedCount > 0 &&
      projectRecord.grantModelingEvidence
    ) {
      packetCommand.detail = projectRecord.grantModelingSupport.recommendedNextActionSummary;
    }

    return {
      ...projectRecord,
      packetCommand,
    };
  }).sort((left, right) => {
    const commandPriority = getProjectPacketCommandPriority(left) - getProjectPacketCommandPriority(right);
    if (commandPriority !== 0) {
      return commandPriority;
    }

    return new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime();
  });

  const { status: statusFilter = null } = await searchParams;
  const filteredProjects = statusFilter
    ? projects.filter((project) => project.status === statusFilter)
    : projects;

  const statusCounts = projects.reduce<Record<string, number>>((acc, project) => {
    acc[project.status] = (acc[project.status] ?? 0) + 1;
    return acc;
  }, {});

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

  /**
   * A COUNT IS A CLAIM, AND A FAILED READ CANNOT MAKE ONE.
   *
   * Every tile above is derived from `projects`, which is `[]` when the
   * portfolio read failed — so the header rendered "Projects 0 · Active 0 ·
   * Plan types 0" and a row of zeroed chips over an agency that may have
   * hundreds. Those are the largest numbers on the page and they read as
   * findings. "—" is the honest answer, and it is the same one the project
   * detail page already gives for an unreadable risk or issue count.
   *
   * Each count names the reads it actually depends on: the report chips are
   * unknown if EITHER the portfolio or the reports read failed, because a
   * complete project list with no reports attached produces the same zero.
   */
  const unknownIfUnread = (failed: boolean, value: number): number | string =>
    failed ? "—" : value;
  const portfolioCountsUnknown = projectsReadFailed;
  const reportCountsUnknown = projectsReadFailed || reportsReadFailed;
  const rtpCountsUnknown = projectsReadFailed || rtpLinksReadFailed;
  /**
   * THE PORTFOLIO TABLE'S OWN READS — six batched lanes, one per source, not one
   * set of reads per project. `filteredProjects` rather than `projects`, so the
   * status filter above governs the table and the cards together; the loader
   * caps the list and says so on screen.
   */
  const portfolioInputs = await loadProjectPortfolioInputs(supabase, {
    workspaceId,
    projectIds: filteredProjects.map((project) => project.id),
  });
  // Fold the loader's failures into the page's single banner. They are already
  // classified and labelled by the loader (which is the only module that knows
  // which tables it read); re-checking them here just puts them in one place.
  for (const failure of portfolioInputs.reads.all) {
    reads.check(failure.label, { error: { message: failure.message } });
  }
  const portfolioSummary = buildProjectPortfolioSummary({
    projects: filteredProjects.map((project) => ({
      id: project.id,
      name: project.name,
      status: project.status,
      deliveryPhase: project.delivery_phase,
      updatedAt: project.updated_at,
    })),
    inputs: portfolioInputs,
    now: new Date(),
  });
  const workPlanTemplates = workPlanTemplateRegistry.list();

  const packetQueueProjects = projects.filter(
    (project) =>
      project.reportSummary.attentionCount > 0 ||
      project.reportSummary.governanceHoldCount > 0 ||
      project.reportSummary.comparisonBackedCount > 0
  );

  return (
    <section className="module-page grid-cols-[minmax(0,1fr)]">
      {reads.any ? (
        <StateBlock
          tone="danger"
          title="Part of this page could not be read"
          description={`${reads.describe()} ${reads.messages().join(" · ")}`}
        />
      ) : null}

      <header className="module-header-grid">
        <article className="module-intro-card">
          <div className="module-intro-kicker">
            <Sparkles className="h-3.5 w-3.5" />
            Project workspace
          </div>
          <div className="module-intro-body">
            <h1 className="module-intro-title">Projects</h1>
            <p className="module-intro-description">
              Everything about a project in one place — what it is, what has happened lately, and where it stands —
              so your team can see at a glance what is moving and what needs attention.
            </p>
          </div>

          {/* The module's primary action, in the header rather than wherever the
              section order puts the form. The full creator stays where it is —
              this jumps to it. */}
          <div className="module-intro-actions">
            <a className="module-intro-action" href="#create-project">
              New project
            </a>
            <a
              className="inline-flex min-h-11 items-center rounded-md border border-border bg-background/70 px-4 py-2 text-sm font-semibold text-foreground no-underline transition-colors hover:bg-muted"
              href="#import-project-list"
            >
              Import project list
            </a>
            <a
              className="inline-flex min-h-11 items-center gap-2 rounded-md border border-border bg-background/70 px-4 py-2 text-sm font-semibold text-foreground no-underline transition-colors hover:bg-muted"
              href="/api/projects/export/workbook"
              download
            >
              <Download className="h-4 w-4" />
              Download project workbook
            </a>
          </div>

          <div className="module-summary-grid cols-3">
            <div className="module-summary-card">
              <p className="module-summary-label">Projects</p>
              <p className="module-summary-value">{unknownIfUnread(portfolioCountsUnknown, projects.length)}</p>
              <p className="module-summary-detail">
                {portfolioCountsUnknown
                  ? "Unavailable — your projects could not be read, so this is unknown, not zero."
                  : "Projects connected to the rest of your work here."}
              </p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Active</p>
              <p className="module-summary-value">{unknownIfUnread(portfolioCountsUnknown, activeCount)}</p>
              <p className="module-summary-detail">
                {portfolioCountsUnknown
                  ? "Unavailable — nothing here was counted, because your projects could not be read. That is unknown, not zero."
                  : "Currently in motion across your portfolio."}
              </p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Plan types</p>
              <p className="module-summary-value">{unknownIfUnread(portfolioCountsUnknown, planningTypes)}</p>
              <p className="module-summary-detail">
                {portfolioCountsUnknown
                  ? "Unavailable — the project list could not be read, so this is not a count of zero."
                  : `Including ${scopingCount} still in scoping.`}
              </p>
            </div>
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            <div className="module-record-chip">
              <span>Report attention</span>
              <strong>{unknownIfUnread(reportCountsUnknown, projectsWithReportAttentionCount)}</strong>
            </div>
            <div className="module-record-chip">
              <span>Evidence-backed</span>
              <strong>{unknownIfUnread(reportCountsUnknown, projectsWithEvidenceBackedReportsCount)}</strong>
            </div>
            <div className="module-record-chip">
              <span>Comparison-backed</span>
              <strong>{unknownIfUnread(reportCountsUnknown, projectsWithComparisonBackedReportsCount)}</strong>
            </div>
            <div className="module-record-chip">
              <span>Governance hold</span>
              <strong>{unknownIfUnread(reportCountsUnknown, governanceHoldReportCount)}</strong>
            </div>
            <div className="module-record-chip">
              <span>RTP-linked</span>
              <strong>{unknownIfUnread(rtpCountsUnknown, projectsLinkedToRtpCount)}</strong>
            </div>
            {(() => {
              const aerialCoverageCount = projects.filter((p) => (p.aerialPosture?.missionCount ?? 0) > 0).length;
              return aerialCoverageCount > 0 ? (
                <div className="module-record-chip">
                  <span>Aerial coverage</span>
                  <strong>{aerialCoverageCount}</strong>
                </div>
              ) : null;
            })()}
          </div>
        </article>

        <article className="module-operator-card">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-[0.5rem] border border-white/10 bg-white/[0.05]">
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

      <ProjectPortfolioImporter
        workspaceId={workspaceId}
        recentImports={recentImports}
        historyReadFailed={importHistoryReadFailed}
      />

      {/* ABOVE the cards, deliberately: the comparative view comes first, and
          the cards below keep everything they always said. Both are skipped
          when the portfolio read failed — a table of "—" over a list that
          already says why would be noise. */}
      {projectsReadFailed ? null : (
        <div className="space-y-6">
          <ProjectPortfolioTable summary={portfolioSummary} />
          <WorkPlanTemplateApplier
            projects={filteredProjects.map((project) => ({ id: project.id, name: project.name }))}
            templates={workPlanTemplates}
          />
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[0.94fr_1.06fr]">
        <div id="create-project">
          <ProjectWorkspaceCreator />
        </div>

        <article className="module-section-surface">
          <div className="module-section-header">
            <div className="module-section-heading">
              <p className="module-section-label">Portfolio</p>
              <h2 className="module-section-title">Your projects</h2>
            </div>
            <span className="module-record-chip">
              <FolderKanban className="h-3.5 w-3.5" />
              <span>Total</span>
              <strong>{projects.length}</strong>
            </span>
          </div>

          {/* Status filter bar */}
          <div className="mt-4 flex flex-wrap items-center gap-1.5 border-b border-border/60 pb-3 text-[0.78rem]">
            <Link
              href="/projects"
              className={cn(
                "rounded px-2 py-0.5 transition-colors",
                !statusFilter ? "bg-emerald-500/10 font-semibold text-emerald-700 dark:text-emerald-300" : "text-muted-foreground hover:text-foreground"
              )}
            >
              All ({projects.length})
            </Link>
            {Object.entries(statusCounts)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([status, count]) => (
                <Link
                  key={status}
                  href={`/projects?status=${status}`}
                  className={cn(
                    "rounded px-2 py-0.5 transition-colors",
                    statusFilter === status ? "bg-emerald-500/10 font-semibold text-emerald-700 dark:text-emerald-300" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {titleize(status)} ({count})
                </Link>
              ))}
          </div>

          {projectsReadFailed ? (
            /* Never "No project records yet" on a failed read: that sentence
               tells an agency it has no portfolio, and invites a planner to
               create a duplicate of a project that already exists. */
            <div className="module-empty-state mt-5 text-sm">
              Your projects could not be read, so this list is unavailable rather than empty.
              This is not a finding that you have no projects. Reload the page; the banner above
              carries the database&apos;s own message for whoever installed OpenPlan for your agency.
            </div>
          ) : projects.length === 0 ? (
            <div className="module-empty-state mt-5 text-sm">
              Projects gives each piece of work your agency delivers — a corridor study, an intersection
              fix, a trail segment — one place that plans, funding, models, and reports all connect to.
              Create your first project to start tracking its milestones and money in one place.
              <div className="mt-3">
                <a href="#create-project" className="inline-flex items-center rounded border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted/40">
                  Create a project
                </a>
              </div>
            </div>
          ) : (
            <>
              <div className="mt-5">
                <ReportPacketCommandQueue
                  title="Reports that need something first"
                  description="The report work to do before anything else, ahead of the full project list below."
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
                  emptyLabel={
                    reportsReadFailed
                      ? "This is unavailable — the linked reports could not be read, so it is not a finding that nothing needs doing."
                      : "No report work is waiting anywhere in your portfolio."
                  }
                />
              </div>

              <div className="mt-4 module-record-list">
                {filteredProjects.length === 0 ? (
                  <div className="module-empty-state text-sm">
                    No projects match the current filter.{" "}
                    <Link href="/projects" className="text-emerald-700 underline-offset-2 hover:underline">
                      Clear filter
                    </Link>
                  </div>
                ) : filteredProjects.map((project) => (
                  <CartographicSelectionLink
                    key={project.id}
                    href={`/projects/${project.id}`}
                    className="module-record-row is-interactive group block"
                    selection={{
                      kind: "project",
                      title: project.name,
                      kicker: `${titleize(project.plan_type)} · ${titleize(project.delivery_phase)}`,
                      avatarChar: project.name[0],
                      meta: [
                        { label: "status", value: titleize(project.status) },
                        { label: "reports", value: String(project.reportSummary.totalCount) },
                        ...(project.reportSummary.attentionCount > 0
                          ? [{ label: "need attention", value: String(project.reportSummary.attentionCount), tone: "warn" as const }]
                          : []),
                        ...(project.rtpSummary.totalCount > 0
                          ? [{ label: "RTP cycles", value: String(project.rtpSummary.totalCount) }]
                          : []),
                        ...(project.aerialPosture && project.aerialPosture.missionCount > 0
                          ? [{ label: "missions", value: String(project.aerialPosture.missionCount) }]
                          : []),
                      ],
                    }}
                  >
                    <div className="module-record-head">
                      <div className="module-record-main">
                        <div className="module-record-kicker">
                          <span className="module-record-chip"><span>Status</span><strong>{titleize(project.status)}</strong></span>
                          <span className="module-record-chip"><span>Plan</span><strong>{titleize(project.plan_type)}</strong></span>
                          <span className="module-record-chip"><span>Phase</span><strong>{titleize(project.delivery_phase)}</strong></span>
                        </div>

                        <div className="space-y-1">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <h3 className="module-record-title transition group-hover:text-primary">
                              {project.name}
                            </h3>
                            <p className="module-record-stamp shrink-0">Updated {fmtDate(project.updated_at)}</p>
                          </div>
                          <p className="module-record-summary line-clamp-2">
                            {project.summary || "No summary yet."}
                          </p>
                        </div>
                      </div>

                      <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition group-hover:text-primary" />
                    </div>

                    <div className="module-record-meta">
                      <span className="module-record-chip"><span>Workspace</span><strong>{project.workspace?.name ?? "Unknown"}</strong></span>
                      <span className="module-record-chip"><span>Created</span><strong>{fmtDate(project.created_at)}</strong></span>
                      {project.rtpSummary.totalCount > 0 ? (
                        <span className="module-record-chip"><span>RTP cycles</span><strong>{project.rtpSummary.totalCount}</strong></span>
                      ) : null}
                      {project.rtpSummary.constrainedCount > 0 ? (
                        <span className="module-record-chip"><span>Constrained</span><strong>{project.rtpSummary.constrainedCount}</strong></span>
                      ) : null}
                      {/* "—", not 0: the count is unknown when the read failed. */}
                      <span className="module-record-chip"><span>Reports</span><strong>{reportsReadFailed ? "—" : project.reportSummary.totalCount}</strong></span>
                      {project.reportSummary.attentionCount > 0 ? (
                        <span className="module-record-chip"><span>Need attention</span><strong>{project.reportSummary.attentionCount}</strong></span>
                      ) : null}
                      {project.reportSummary.evidenceBackedCount > 0 ? (
                        <span className="module-record-chip"><span>Evidence-backed</span><strong>{project.reportSummary.evidenceBackedCount}</strong></span>
                      ) : null}
                      {project.reportSummary.comparisonBackedCount > 0 ? (
                        <span className="module-record-chip"><span>Comparison-backed</span><strong>{project.reportSummary.comparisonBackedCount}</strong></span>
                      ) : null}
                      {project.grantModelingReadiness ? (
                        <span className="module-record-chip"><span>Grant review</span><strong>{project.grantModelingReadiness.label}</strong></span>
                      ) : null}
                      {project.reportSummary.governanceHoldCount > 0 ? (
                        <span className="module-record-chip"><span>Governance hold</span><strong>{project.reportSummary.governanceHoldCount}</strong></span>
                      ) : null}
                      {project.aerialPosture && project.aerialPosture.missionCount > 0 ? (
                        <span className="module-record-chip">
                          <span>Aerial</span>
                          <strong>{project.aerialPosture.missionCount} mission{project.aerialPosture.missionCount === 1 ? "" : "s"}</strong>
                        </span>
                      ) : null}
                      {project.aerialPosture?.verificationReadiness === "ready" ? (
                        <span className="module-record-chip"><span>Verification</span><strong>Ready</strong></span>
                      ) : project.aerialPosture?.verificationReadiness === "partial" ? (
                        <span className="module-record-chip"><span>Verification</span><strong>Partial</strong></span>
                      ) : null}
                    </div>

                    <div className="mt-3 border-t border-border/70 pt-3">
                      <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                        What this project needs next
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
                          {project.grantModelingEvidence ? (
                            /* A HAIRLINE, NOT A BOX. This used to be a bordered,
                               tinted panel inside the project card, inside the
                               section, inside the page shell — four frames, one more
                               than the interface has hierarchy to spend. It only
                               renders for a project that HAS grant modeling evidence,
                               so an empty workspace never showed it and the browser
                               audit could not see it. A 1px top rule separates it
                               without boxing it, and no background tint stands in for
                               the border. */
                            <div className="mt-3 border-t border-border/60 pt-2.5">
                              <p className="text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                                Grant release review
                              </p>
                              <div className="mt-2 flex flex-wrap gap-1.5">
                                {project.grantModelingReadiness ? (
                                  <span className="module-record-chip">{project.grantModelingReadiness.label}</span>
                                ) : null}
                                <span className="module-record-chip">
                                  Suggested {titleize(project.grantModelingSupport.recommendedDecisionState)}
                                </span>
                                <span className="module-record-chip">
                                  Lead packet {project.grantModelingEvidence.leadComparisonReport.packetFreshness.label}
                                </span>
                              </div>
                              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                                {project.grantModelingSupport.recommendedNextActionSummary}
                              </p>
                            </div>
                          ) : null}
                        </>
                      ) : (
                        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                          {reportsReadFailed
                            ? REPORTS_UNREADABLE_DETAIL
                            : "No reports linked yet. Open the project to write the first one."}
                        </p>
                      )}
                    </div>
                  </CartographicSelectionLink>
                ))}
              </div>
            </>
          )}
        </article>
      </div>
    </section>
  );
}
