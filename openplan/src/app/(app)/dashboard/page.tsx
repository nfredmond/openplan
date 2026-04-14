import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, FileText, FolderKanban, Landmark, Radar, ShieldCheck } from "lucide-react";
import { WorkspaceCommandBoard } from "@/components/operations/workspace-command-board";
import { RunHistory } from "@/components/runs/RunHistory";
import { WorkspaceMembershipRequired } from "@/components/workspaces/workspace-membership-required";
import { isGrantsCommand, resolveSharedGrantsQueueHref } from "@/lib/operations/grants-links";
import { buildWorkspaceKpis, formatTimeToFirstResult } from "@/lib/metrics/workspace-kpis";
import {
  buildWorkspaceOperationsSummaryFromSourceRows,
  loadWorkspaceOperationsSummaryForWorkspace,
  type WorkspaceOperationsSupabaseLike,
} from "@/lib/operations/workspace-summary";
import { createClient } from "@/lib/supabase/server";
import {
  loadCurrentWorkspaceMembership,
} from "@/lib/workspaces/current";

function fmtPct(value: number | null): string {
  return value === null ? "N/A" : `${value}%`;
}

function fmtDate(value: string | null): string {
  if (!value) {
    return "Not available";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString();
}

export default async function DashboardPage() {
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
        moduleLabel="Overview"
        title="Overview needs a provisioned workspace"
        description="Dashboard metrics, run history, and workspace KPIs are only available after this account is attached to a workspace. Create a project workspace first or ask an owner/admin to add you to the correct workspace."
        primaryHref="/projects"
        primaryLabel="Create or open project workspace"
      />
    );
  }

  const workspaceName = workspace?.name ?? "Your workspace";
  const workspacePlan = workspace?.plan ?? "pilot";
  const workspaceCreatedAt = workspace?.created_at ?? null;
  const workspaceRole = membership?.role ?? "member";
  const workspaceId = membership?.workspace_id ?? "";
  const workspaceIdSnippet = workspaceId ? workspaceId.slice(0, 8) : "unavailable";

  const [runsResult, operationsSummary] = workspaceId
    ? await Promise.all([
        supabase
          .from("runs")
          .select("created_at, metrics, summary_text, report_generated_count")
          .eq("workspace_id", workspaceId)
          .order("created_at", { ascending: true })
          .limit(500),
        loadWorkspaceOperationsSummaryForWorkspace(
          supabase as unknown as WorkspaceOperationsSupabaseLike,
          workspaceId
        ),
      ])
    : [
        { data: [] },
        buildWorkspaceOperationsSummaryFromSourceRows({
          projects: [],
          plans: [],
          programs: [],
          reports: [],
          fundingOpportunities: [],
        }),
      ];

  const runsData = runsResult.data ?? [];

  const kpis = buildWorkspaceKpis({
    workspaceCreatedAt,
    runs: runsData as Array<{
      created_at: string;
      metrics: Record<string, unknown> | null;
      summary_text: string | null;
      report_generated_count: number | null;
    }>,
  });

  const leadGrantsCommand = operationsSummary.fullCommandQueue.find((item) => isGrantsCommand(item)) ?? null;
  const rtpFundingReviewCount = operationsSummary.counts.rtpFundingReviewPackets;
  const comparisonBackedReportCount = operationsSummary.counts.comparisonBackedReports;
  const grantsRoutedRtpFundingReview =
    operationsSummary.nextCommand?.key === "review-current-report-packets" &&
    operationsSummary.nextCommand.moduleKey === "grants" &&
    rtpFundingReviewCount > 0;

  const actions = [
    ...(operationsSummary.nextCommand?.key === "review-current-report-packets"
        ? [
          {
            key: "rtp-grants-follow-through",
            href: operationsSummary.nextCommand.href,
            title: grantsRoutedRtpFundingReview ? "Open RTP grants follow-through" : "Open RTP funding release review",
            description:
              grantsRoutedRtpFundingReview
                ? `Jump straight into Grants OS for the ${rtpFundingReviewCount} current RTP packet${rtpFundingReviewCount === 1 ? "" : "s"} that still need linked-project funding follow-through.`
                : rtpFundingReviewCount > 0
                ? `Jump straight into the ${rtpFundingReviewCount} current RTP packet${rtpFundingReviewCount === 1 ? "" : "s"} still carrying funding-backed release-review follow-up.`
                : "Jump straight into the current RTP packet release-review lane.",
            icon: FileText,
          },
        ]
      : []),
    ...(operationsSummary.nextCommand?.key === "start-project-reimbursement-packets" ||
    operationsSummary.nextCommand?.key === "advance-project-reimbursement-invoicing"
      ? [
          {
            key: "grants-reimbursement-follow-through",
            href: isGrantsCommand(operationsSummary.nextCommand)
              ? resolveSharedGrantsQueueHref(operationsSummary.nextCommand)
              : operationsSummary.nextCommand.href,
            title:
              operationsSummary.nextCommand.key === "start-project-reimbursement-packets"
                ? "Start reimbursement packet"
                : "Advance reimbursement invoicing",
            description:
              operationsSummary.nextCommand.key === "start-project-reimbursement-packets"
                ? "Jump straight into the lead grants reimbursement lane and start the first reimbursement packet."
                : "Jump straight into the lead grants reimbursement lane and advance follow-through already in motion.",
            icon: ShieldCheck,
          },
        ]
      : []),
    {
      key: "analysis-studio",
      href: "/explore",
      title: "Open Analysis Studio",
      description: "Run corridor analysis with map context, metrics, and report-ready outputs intact.",
      icon: Radar,
    },
    {
      key: "projects-module",
      href: "/projects",
      title: "Open Projects Module",
      description: "Move into the project control rooms for deliverables, risks, decisions, issues, and meetings.",
      icon: FolderKanban,
    },
    {
      key: "grants-surface",
      href: leadGrantsCommand ? resolveSharedGrantsQueueHref(leadGrantsCommand) : "/grants",
      title: "Open Grants Surface",
      description: leadGrantsCommand
        ? `Jump straight into the current lead grants action: ${leadGrantsCommand.title.toLowerCase()}.`
        : "Track funding opportunities, pursue decisions, awards, and reimbursement follow-through in one shared operating lane.",
      icon: Landmark,
    },
    {
      key: "reports-surface",
      href: "/reports",
      title: "Open Reports Surface",
      description:
        comparisonBackedReportCount > 0
          ? `${comparisonBackedReportCount} comparison-backed report packet${comparisonBackedReportCount === 1 ? " can" : "s can"} support grant planning language or prioritization framing. Treat that context as planning support, not proof of award likelihood or a replacement for funding-source review.`
          : "Review where evidence packs, board-ready exports, and grant artifacts will converge.",
      icon: FileText,
    },
  ];

  const kpiCards = [
    {
      label: "Total runs",
      value: `${kpis.totalRuns || 0}`,
      detail: `${kpis.completedRuns} completed runs in this workspace`,
    },
    {
      label: "Run completion rate",
      value: fmtPct(kpis.runCompletionRate),
      detail: `${kpis.completedRuns}/${kpis.totalRuns || 0} runs completed`,
    },
    {
      label: "Report generation rate",
      value: fmtPct(kpis.reportGenerationRate),
      detail: `${kpis.runsWithReports}/${kpis.totalRuns || 0} runs exported`,
    },
    {
      label: "Time to first result",
      value: formatTimeToFirstResult(kpis.timeToFirstResultHours),
      detail: `First run at ${fmtDate(kpis.firstRunAt)}`,
    },
  ];

  const baselineItems = [
    "Supabase auth flow is live for sign-up, sign-in, and protected routes.",
    "Analysis API supports validated corridor scoring requests.",
    "Runs persist and reload cleanly at workspace scope.",
    "Report endpoint returns structured HTML / PDF-ready output.",
    "Core layers now use GTFS, crashes, Census, and LODES inputs.",
    "KPI instrumentation tracks completion, reporting, and time-to-first-result.",
  ];

  return (
    <section className="module-page">
      <header className="module-header-grid">
        <article className="module-intro-card">
          <div className="module-intro-kicker">Workspace dashboard</div>
          <div className="module-intro-body">
            <div className="grid gap-2 sm:grid-cols-3">
              <div className="module-record-chip">
                <span>Role</span>
                <strong>{workspaceRole}</strong>
              </div>
              <div className="module-record-chip">
                <span>Plan</span>
                <strong>{workspacePlan}</strong>
              </div>
              <div className="module-record-chip">
                <span>Workspace ID</span>
                <strong className="font-mono normal-case tracking-tight">{workspaceIdSnippet}</strong>
              </div>
            </div>
            <h1 className="module-intro-title">{workspaceName}</h1>
            <p className="module-intro-description">
              Use this overview to see current work, recent activity, and the next planning tasks that need attention.
            </p>
          </div>

          <div className="module-summary-grid cols-4">
            {kpiCards.map((card) => (
              <div key={card.label} className="module-summary-card">
                <p className="module-summary-label">{card.label}</p>
                <p className="module-summary-value">{card.value}</p>
                <p className="module-summary-detail">{card.detail}</p>
              </div>
            ))}
          </div>
        </article>

        <article className="module-operator-card">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.05]">
              <ShieldCheck className="h-5 w-5 text-emerald-200" />
            </span>
            <div>
              <p className="module-operator-eyebrow">Overview</p>
              <h2 className="module-operator-title">Start here, then move into the work</h2>
            </div>
          </div>
          <p className="module-operator-copy">
            Start with a quick scan of your workspace, then open the project, analysis, or report that needs work.
            {rtpFundingReviewCount > 0
              ? grantsRoutedRtpFundingReview
                ? ` ${rtpFundingReviewCount} current RTP packet${rtpFundingReviewCount === 1 ? " still needs" : "s still need"} Grants OS follow-through even though freshness already reads current.`
                : ` ${rtpFundingReviewCount} current RTP packet${rtpFundingReviewCount === 1 ? " still needs" : "s still need"} funding-backed release review even though freshness already reads current.`
              : ""}
          </p>
          <div className="module-operator-list">
            <div className="module-operator-item">
              Review active projects, recent updates, and items that need follow-up.
            </div>
            {rtpFundingReviewCount > 0 ? (
              <div className="module-operator-item">
                {grantsRoutedRtpFundingReview
                  ? `Current RTP packet work is now a Grants OS follow-through lane, ${rtpFundingReviewCount} packet${rtpFundingReviewCount === 1 ? " still needs" : "s still need"} linked-project funding cleanup before packet posture is truly settled.`
                  : `Current RTP packet work is not just freshness, ${rtpFundingReviewCount} packet${rtpFundingReviewCount === 1 ? " still carries" : "s still carry"} linked-project funding follow-up.`}
              </div>
            ) : null}
            {comparisonBackedReportCount > 0 ? (
              <div className="module-operator-item">
                {comparisonBackedReportCount} comparison-backed report packet{comparisonBackedReportCount === 1 ? " can" : "s can"} support grant planning language or prioritization framing, but that evidence still does not prove award likelihood or replace funding-source review.
              </div>
            ) : null}
            <div className="module-operator-item">
              Open Projects to manage a planning effort, or Analysis Studio to work on a corridor study.
            </div>
            <div className="module-operator-item">
              A good overview should help the team get to the right task quickly.
              {" "}
              {formatTimeToFirstResult(kpis.timeToFirstResultHours)}.
            </div>
          </div>
        </article>
      </header>

      <div className="grid gap-6 xl:grid-cols-[1.04fr_0.96fr]">
        <article className="module-section-surface">
          <div className="module-section-header">
            <div className="module-section-heading">
              <p className="module-section-label">Quick actions</p>
              <h2 className="module-section-title">Move into the right module lane</h2>
              <p className="module-section-description">
                Each surface below is intentionally framed as a next action rather than a decorative promo tile.
              </p>
            </div>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {actions.map((action) => {
              const Icon = action.icon;
              return (
                <Link
                  key={action.key}
                  href={action.href}
                  className="module-subpanel group transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/35 hover:shadow-[0_16px_36px_rgba(4,12,20,0.08)]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="flex h-10 w-10 items-center justify-center border border-emerald-500/18 bg-emerald-500/8 text-emerald-700 dark:text-emerald-300">
                      <Icon className="h-4.5 w-4.5" />
                    </span>
                    <ArrowRight className="mt-1 h-4.5 w-4.5 text-muted-foreground transition group-hover:text-primary" />
                  </div>
                  <h3 className="mt-4 text-lg font-semibold tracking-tight text-foreground group-hover:text-primary">
                    {action.title}
                  </h3>
                  <p className="mt-2 text-sm text-muted-foreground">{action.description}</p>
                </Link>
              );
            })}
          </div>
        </article>

        <WorkspaceCommandBoard summary={operationsSummary}>
          {baselineItems.map((item) => (
            <div key={item} className="module-subpanel text-sm text-muted-foreground">
              {item}
            </div>
          ))}
        </WorkspaceCommandBoard>
      </div>

      <RunHistory workspaceId={workspaceId} />
    </section>
  );
}
