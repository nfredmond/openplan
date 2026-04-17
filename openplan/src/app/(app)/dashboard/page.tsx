import { redirect } from "next/navigation";
import { FileText, FolderKanban, Landmark, Radar, ShieldCheck } from "lucide-react";
import { DashboardKpiGrid } from "@/components/dashboard/dashboard-kpi-grid";
import { DashboardOperatorGuidance } from "@/components/dashboard/dashboard-operator-guidance";
import { DashboardQuickActions } from "@/components/dashboard/dashboard-quick-actions";
import { DashboardWorkspaceIntro } from "@/components/dashboard/dashboard-workspace-intro";
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
  const grantModelingSummary = operationsSummary.grantModelingSummary ?? null;
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
      description:
        leadGrantsCommand?.key === "advance-project-funding-decisions" && grantModelingSummary?.leadDecisionDetail
          ? grantModelingSummary.leadDecisionDetail
          : leadGrantsCommand
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
        <DashboardWorkspaceIntro
          workspaceName={workspaceName}
          workspaceRole={workspaceRole}
          workspacePlan={workspacePlan}
        >
          <DashboardKpiGrid cards={kpiCards} />
        </DashboardWorkspaceIntro>

        <DashboardOperatorGuidance
          rtpFundingReviewCount={rtpFundingReviewCount}
          grantsRoutedRtpFundingReview={grantsRoutedRtpFundingReview}
          comparisonBackedReportCount={comparisonBackedReportCount}
          grantModelingOperatorDetail={grantModelingSummary?.operatorDetail ?? null}
          firstRunAt={kpis.firstRunAt}
          timeToFirstResultFormatted={formatTimeToFirstResult(kpis.timeToFirstResultHours)}
        />
      </header>

      <div className="grid gap-6 xl:grid-cols-[1.04fr_0.96fr]">
        <DashboardQuickActions actions={actions} />

        <WorkspaceCommandBoard summary={operationsSummary}>
          {baselineItems.map((item) => (
            <p key={item} className="text-[0.8rem] text-muted-foreground">
              {item}
            </p>
          ))}
        </WorkspaceCommandBoard>
      </div>

      <RunHistory workspaceId={workspaceId} />
    </section>
  );
}
