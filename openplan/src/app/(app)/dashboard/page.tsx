import { redirect } from "next/navigation";
import { FileText, FolderKanban, Landmark, Radar, ShieldCheck } from "lucide-react";
import { DashboardKpiGrid } from "@/components/dashboard/dashboard-kpi-grid";
import { DashboardOperatorGuidance } from "@/components/dashboard/dashboard-operator-guidance";
import { DashboardQuickActions } from "@/components/dashboard/dashboard-quick-actions";
import { BuildIdentityLine } from "@/components/dashboard/build-identity-line";
import { DeploymentHealthPanel } from "@/components/dashboard/deployment-health-panel";
import { FirstRunChecklist } from "@/components/onboarding/first-run-checklist";
import { DashboardWorkspaceIntro } from "@/components/dashboard/dashboard-workspace-intro";
import { WorkspaceCommandBoard } from "@/components/operations/workspace-command-board";
import { RunHistory } from "@/components/runs/RunHistory";
import { WorkspaceGeographyPanel } from "@/components/workspaces/workspace-geography-panel";
import { WorkspaceIntegrationKeysPanel } from "@/components/workspaces/workspace-integration-keys-panel";
import { WorkspaceMembershipRequired } from "@/components/workspaces/workspace-membership-required";
import { WorkspaceTeamPanel } from "@/components/workspaces/workspace-team-panel";
import { isGrantsCommand, resolveSharedGrantsQueueHref } from "@/lib/operations/grants-links";
import { buildWorkspaceKpis, formatTimeToFirstResult } from "@/lib/metrics/workspace-kpis";
import {
  buildWorkspaceOperationsSummaryFromSourceRows,
  loadWorkspaceOperationsSummaryForWorkspace,
  type WorkspaceOperationsSupabaseLike,
} from "@/lib/operations/workspace-summary";
import { evaluateDeploymentHealth } from "@/lib/config/deployment-health";
import {
  loadModelingWorkerFacts,
  readDeploymentEnvFacts,
} from "@/lib/config/deployment-health-facts";
import { createClient } from "@/lib/supabase/server";
import {
  loadCurrentWorkspaceMembership,
} from "@/lib/workspaces/current";
import {
  HOME_GEOGRAPHY_SCOPE_COLUMNS,
  homeGeographyLabel,
  parseWorkspaceHomeGeography,
} from "@/lib/workspaces/home-geography";

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
        title="Overview needs a workspace"
        description="Dashboard metrics, run history, and workspace KPIs only appear once this account is in a workspace. Create a project workspace first, or ask an owner/admin to add you to the correct one."
        primaryHref="/projects"
        primaryLabel="Create or open project workspace"
      />
    );
  }

  const workspaceName = workspace?.name ?? "Your workspace";
  const workspaceCreatedAt = workspace?.created_at ?? null;
  const workspaceRole = membership?.role ?? "member";
  const workspaceId = membership?.workspace_id ?? "";
  // Workspace configuration (geography, team) is owner/admin work; every API it
  // calls enforces the same rule server-side.
  const canManageWorkspace = workspaceRole === "owner" || workspaceRole === "admin";

  const [runsResult, operationsSummary, homeGeographyResult] = workspaceId
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
        // Where this workspace works, read here so the first-run checklist can
        // report real configuration instead of offering navigation. Only the
        // identity columns are selected (HOME_GEOGRAPHY_SCOPE_COLUMN_NAMES
        // deliberately omits `home_geometry_geojson`, which holds the full
        // boundary polygon and can be megabytes) — the same read pattern
        // cartographic-shell.tsx uses. An error, including the migration not
        // being applied, leaves `data` null, which parses to null, which reads
        // honestly as "not set".
        supabase
          .from("workspaces")
          .select(HOME_GEOGRAPHY_SCOPE_COLUMNS)
          .eq("id", workspaceId)
          .maybeSingle(),
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
        { data: null },
      ];

  const runsData = runsResult.data ?? [];
  const homeGeography = parseWorkspaceHomeGeography(homeGeographyResult.data);
  const homeGeographyIsSet = homeGeography !== null;

  // What this deployment cannot currently do, and why. Only owners and admins
  // see it — it is operator information, and a member cannot act on it. Silent
  // when everything is configured.
  const deploymentHealth = canManageWorkspace
    ? evaluateDeploymentHealth({
        ...readDeploymentEnvFacts(),
        modelingWorker: await loadModelingWorkerFacts(
          supabase as unknown as Parameters<typeof loadModelingWorkerFacts>[0],
          workspaceId
        ),
      })
    : null;

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
                : "Jump straight into the current RTP packets awaiting release review.",
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
                ? "Jump straight into reimbursement in Grants and start the first reimbursement packet."
                : "Jump straight into reimbursement in Grants and advance follow-through already in motion.",
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
      title: "Open Grants",
      description:
        leadGrantsCommand?.key === "advance-project-funding-decisions" && grantModelingSummary?.leadDecisionDetail
          ? grantModelingSummary.leadDecisionDetail
          : leadGrantsCommand
            ? `Jump straight into the current lead grants action: ${leadGrantsCommand.title.toLowerCase()}.`
            : "Track funding opportunities, pursue decisions, awards, and reimbursement follow-through, all in one place.",
      icon: Landmark,
    },
    {
      key: "reports-surface",
      href: "/reports",
      title: "Open Reports",
      description:
        comparisonBackedReportCount > 0
          ? `${comparisonBackedReportCount} comparison-backed report packet${comparisonBackedReportCount === 1 ? " can" : "s can"} support grant planning language or prioritization framing. Treat that context as planning support, not proof of award likelihood or a replacement for funding-source review.`
          : "Review where evidence packs, board-ready exports, and grant documents come together.",
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

  // A brand-new user lands here on an auto-provisioned but empty workspace (the
  // handle_new_user trigger creates the workspace on sign-up). Guide them with a
  // stateful first-run checklist until they have real activity in any core lane.
  const isFirstRun =
    kpis.totalRuns === 0 &&
    operationsSummary.counts.projects === 0 &&
    operationsSummary.counts.plans === 0 &&
    operationsSummary.counts.programs === 0 &&
    operationsSummary.counts.reports === 0;

  // While the checklist's first step is outstanding, its control moves up next
  // to it — the geography setter is what the step asks for, and it was
  // previously buried mid-page where a first-run user never reached it. It is
  // still mounted EXACTLY ONCE either way: the panel self-fetches, so a second
  // mount would mean a second request and a second answer.
  const hoistGeographyPanel = isFirstRun && !homeGeographyIsSet;
  const geographyPanel = (
    <WorkspaceGeographyPanel workspaceId={workspaceId} canManage={canManageWorkspace} />
  );

  return (
    <section className="module-page">
      {isFirstRun ? (
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-6 dark:bg-primary/10">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Get started</p>
          <h2 className="mt-1 text-lg font-semibold text-foreground">
            {/* `workspaceName` carries a generic fallback for the intro card;
                reading "Set up Your workspace" would be worse than reading
                "Set up your workspace", so the unnamed case is worded here. */}
            {workspace?.name?.trim() ? `Set up ${workspace.name.trim()}` : "Set up your workspace"}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Your workspace is ready and empty. These are the things that are actually configured — or
            not — and what each one turns on.
          </p>
          <FirstRunChecklist
            homeGeographyIsSet={homeGeographyIsSet}
            homeGeographyLabel={homeGeographyLabel(homeGeography)}
            hasRuns={kpis.totalRuns > 0}
            canManageWorkspace={canManageWorkspace}
          >
            {hoistGeographyPanel ? geographyPanel : null}
          </FirstRunChecklist>
        </div>
      ) : null}

      {deploymentHealth ? <DeploymentHealthPanel health={deploymentHealth} /> : null}

      {/* Workspace configuration: where this agency works, and who works here.
          Geography comes first because it is what the rest of the app reads —
          maps, jurisdiction rules, equity data, and study-area defaults are all
          downstream of it; while it is outstanding on a first run it sits in the
          checklist above instead, and this row holds the team alone. The
          two-column layout only applies to owners and admins with both panels
          here: one panel in a two-column grid leaves a lone half-width card. */}
      <div className={canManageWorkspace && !hoistGeographyPanel ? "grid gap-6 xl:grid-cols-2" : undefined}>
        {hoistGeographyPanel ? null : geographyPanel}

        {/* Anchored so the checklist's team step can point at the control
            rather than at another page. */}
        <div id="workspace-team">
          <WorkspaceTeamPanel workspaceId={workspaceId} canManage={canManageWorkspace} />
        </div>
      </div>

      {/* Integration keys take their own full-width row rather than a third
          slot in the pair above: three items in a two-column grid leave a lone
          half-width card, and this panel's per-provider rows want the width.
          Like the team panel, it renders nothing for a member — key management
          is operator/owner work — so the row collapses cleanly for them. */}
      <WorkspaceIntegrationKeysPanel workspaceId={workspaceId} canManage={canManageWorkspace} />

      <header className="module-header-grid">
        <DashboardWorkspaceIntro
          workspaceName={workspaceName}
          workspaceRole={workspaceRole}
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

      {/* One next action, not four. Quick actions are the workspace's real
          entry points — every item is derived from the operations summary, so
          they name THIS workspace's lead grants command rather than reciting a
          fixed tour. The static four-step "workflow spine" that used to sit
          above them was that fixed tour, and its four destinations were the
          same ones listed here; PilotWorkflowHandoff still renders on project
          and report detail pages, where it carries a real project or report id
          and the steps mean something specific.

          On a first run they are suppressed entirely: a workspace with nothing
          in it has no lead action to derive, and the checklist above is the one
          honest path. The command board stays either way — it reports workspace
          state rather than offering a starting point, and on an empty workspace
          it reports zeros and says so. */}
      <div className={isFirstRun ? undefined : "grid gap-6 xl:grid-cols-[1.04fr_0.96fr]"}>
        {isFirstRun ? null : <DashboardQuickActions actions={actions} />}

        <WorkspaceCommandBoard summary={operationsSummary} />
      </div>

      <RunHistory workspaceId={workspaceId} />

      {/* Last, and always. A self-hosted instance that cannot name its own
          version makes every bug report unanswerable — see `app-version.ts`. */}
      <BuildIdentityLine />
    </section>
  );
}
