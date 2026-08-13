import Link from "next/link";
import { redirect } from "next/navigation";
import { FileText, FolderKanban, Landmark, Radar, ShieldCheck } from "lucide-react";
import { DashboardKpiGrid } from "@/components/dashboard/dashboard-kpi-grid";
import { DashboardOperatorGuidance } from "@/components/dashboard/dashboard-operator-guidance";
import { DashboardQuickActions } from "@/components/dashboard/dashboard-quick-actions";
import { BuildIdentityLine } from "@/components/dashboard/build-identity-line";
import { DeploymentHealthPanel } from "@/components/dashboard/deployment-health-panel";
import { FirstRunChecklist } from "@/components/onboarding/first-run-checklist";
import { GettingStartedCard } from "@/components/onboarding/getting-started-card";
import { DashboardWorkspaceIntro } from "@/components/dashboard/dashboard-workspace-intro";
import { RecentActionActivity } from "@/components/operations/recent-action-activity";
import { WorkspaceCommandBoard } from "@/components/operations/workspace-command-board";
import { RunHistory } from "@/components/runs/RunHistory";
import { WorkspaceGeographyPanel } from "@/components/workspaces/workspace-geography-panel";
import { WorkspaceIntegrationKeysPanel } from "@/components/workspaces/workspace-integration-keys-panel";
import { WorkspaceMembershipRequired } from "@/components/workspaces/workspace-membership-required";
import { WorkspaceStageGatePanel } from "@/components/workspaces/workspace-stage-gate-panel";
import { WorkspaceTeamPanel } from "@/components/workspaces/workspace-team-panel";
import {
  buildStageGateRebindChoices,
  STAGE_GATE_BINDING_WORKSPACE_COLUMNS,
} from "@/lib/stage-gates/rebind";
import { isGrantsCommand, resolveSharedGrantsQueueHref } from "@/lib/operations/grants-links";
import { buildWorkspaceKpis, formatTimeToFirstResult } from "@/lib/metrics/workspace-kpis";
import {
  runInsightTiles,
  runKpiCards,
  runsAreKnownEmpty,
} from "@/lib/dashboard/run-figures";
import { DashboardInsights } from "@/components/dashboard/dashboard-insights";
import { DashboardViewSwitch } from "@/components/dashboard/dashboard-view-switch";
import { lanePressure, recentOverallScores, runsPerMonth } from "@/lib/dashboard/insights";
import { awardDrawdown, commentsReceivedOverTime, COMMENT_WINDOW_WEEKS } from "@/lib/dashboard/chart-series";
import {
  loadDashboardChartRows,
  noDashboardChartRows,
  type DashboardChartSupabaseLike,
} from "@/lib/dashboard/chart-reads";
import {
  buildWorkspaceOperationsSummaryFromSourceRows,
  loadWorkspaceOperationsSummaryForWorkspace,
  type WorkspaceOperationsSupabaseLike,
} from "@/lib/operations/workspace-summary";
import {
  loadRecentActionExecutionsForWorkspace,
  type RecentActionActivitySupabaseLike,
} from "@/lib/operations/action-activity";
import { evaluateDeploymentHealth } from "@/lib/config/deployment-health";
import { hasAnthropicAccess } from "@/lib/integrations/anthropic-access";
import { INTEGRATION_PROVIDERS } from "@/lib/integrations/providers";
import { withWorkspaceIntegrationContext } from "@/lib/integrations/workspace-keys";
import {
  loadModelingWorkerFacts,
  readDeploymentEnvFacts,
} from "@/lib/config/deployment-health-facts";
import { createClient } from "@/lib/supabase/server";
import {
  loadCurrentWorkspaceMembership,
} from "@/lib/workspaces/current";
import {
  homeGeographyLabel,
  parseWorkspaceHomeGeography,
} from "@/lib/workspaces/home-geography";
import { moduleMetadata } from "@/lib/ui/page-title";

export const metadata = moduleMetadata("Overview");

// The percentage and date formatters that used to live here moved into
// `lib/dashboard/run-figures.ts` with the tiles they format, so the honest and
// the unreadable spellings of a tile sit in one tested file.

export default async function DashboardPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  // What the person said they came for, carried from the public landing page
  // through sign-up as a query parameter. It steers one step in the
  // getting-started checklist and is never stored — an unrecognized or absent
  // value simply means the checklist shows its default steps.
  const resolvedSearchParams = (await searchParams) ?? {};
  const intentParam = resolvedSearchParams.intent;
  const intent =
    intentParam === "modeling" || intentParam === "engagement" ? intentParam : null;

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

  // One clock for the whole render. The comment figure's read window and the
  // series that buckets it must not disagree about where "twelve weeks ago"
  // starts, or the first bucket lands half-empty and reads as a quiet week.
  const now = new Date();
  const commentWindowStart = new Date(now);
  commentWindowStart.setUTCDate(commentWindowStart.getUTCDate() - COMMENT_WINDOW_WEEKS * 7);

  const [operationsSummary, homeGeographyResult, actionActivity, chartRows] = workspaceId
    ? await Promise.all([
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
        //
        // The projection is WIDER than the scope set because the SAME row
        // answers the second question this page asks of it: which stage-gate
        // template the workspace delivers under. That needs the stored
        // binding and the workspace's SUBDIVISION, neither of which is in the
        // scope set — see STAGE_GATE_BINDING_WORKSPACE_COLUMNS for what each
        // one changes. It is a superset, so the geography parse below is
        // unaffected.
        supabase
          .from("workspaces")
          .select(STAGE_GATE_BINDING_WORKSPACE_COLUMNS)
          .eq("id", workspaceId)
          .maybeSingle(),
        // The recent-actions audit feed, absorbed from the retired Command
        // Center page — the one thing it had that the dashboard did not.
        loadRecentActionExecutionsForWorkspace(
          supabase as unknown as RecentActionActivitySupabaseLike,
          workspaceId
        ),
        // Every figure's rows, in ONE batch: public comments, funding awards,
        // invoice records — and, since 2026-08-13, this workspace's analysis
        // RUNS, which used to be read inline above with only `.data` taken. A
        // chart the person may have switched off must not cost a serial round
        // trip, and every one of these hands back a read OUTCOME, so a failed
        // query cannot render as a zero on a tile or as a flat line on a chart.
        loadDashboardChartRows(
          supabase as unknown as DashboardChartSupabaseLike,
          workspaceId,
          commentWindowStart
        ),
      ])
    : [
        buildWorkspaceOperationsSummaryFromSourceRows({
          projects: [],
          plans: [],
          programs: [],
          reports: [],
          fundingOpportunities: [],
        }),
        { data: null },
        { executions: [], error: null },
        // No workspace id means no read happened at all. Empty-and-successful is
        // the honest description of that: there is nothing to disbelieve.
        noDashboardChartRows(),
      ];

  // Whether this workspace's AI assistant can run at all: an Anthropic key the
  // workspace stored itself, or the deployment's own environment key. Resolved
  // with the SAME helper every AI route uses, so this boolean cannot disagree
  // with what a request would actually experience. Only the boolean goes to
  // the client — never the key.
  const aiKeyConfigured = await withWorkspaceIntegrationContext(workspaceId, async () =>
    hasAnthropicAccess()
  );

  // The runs read's OUTCOME, not its rows. Everything runs-derived on this page
  // goes through it, and `run-figures.ts` is what decides whether a number may
  // be stated at all.
  const runsRead = chartRows.runs;
  const runsData = runsRead.rows;
  const homeGeography = parseWorkspaceHomeGeography(homeGeographyResult.data);
  const homeGeographyIsSet = homeGeography !== null;

  // Which stage-gate template this workspace delivers under, and what changing
  // it would mean — resolved from the row on the server so the panel renders the
  // same reconciliation the project boards and the decisions route perform,
  // rather than a second answer computed in the browser.
  //
  // THE READ ERROR IS HANDED IN, and that is the whole point. A failed read
  // leaves `data` null, and a null row resolves to the interim default with the
  // reason `no_workspace_jurisdiction`, whose disclosure states "This workspace
  // has not stated where it works" and tells the planner to set a home geography
  // they may already have set. That is a claim about the agency, and a query
  // that failed cannot make it. With the error in hand the panel says the
  // binding could not be read instead — a different fact, stated as itself.
  const stageGateReadError =
    "error" in homeGeographyResult ? homeGeographyResult.error : null;
  const stageGateChoices = buildStageGateRebindChoices(homeGeographyResult.data, {
    readError: stageGateReadError,
  });

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

  // Computed unconditionally and rendered CONDITIONALLY: on an unreadable read
  // these are all zeros, and `runKpiCards`/`runInsightTiles` refuse to state
  // them. Nothing below reads `kpis` without going through one of those.
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
                ? `Jump straight into Grants for the ${rtpFundingReviewCount} current RTP packet${rtpFundingReviewCount === 1 ? "" : "s"} that still need linked-project funding follow-through.`
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
      title: "Open Corridor Analysis",
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

  const kpiCards = runKpiCards(runsRead, kpis);

  /*
    THE INSIGHTS VIEW reads the SAME rows this page already loaded — `runsData`
    and `operationsSummary`. It issues no query of its own, so switching views
    cannot show a different workspace from the one the overview describes, and
    costs nothing.
  */
  const insightsTiles = runInsightTiles(runsRead, kpis, operationsSummary.counts.queueDepth);

  const insightLanes = [
    {
      label: "RTP packets",
      value: operationsSummary.counts.rtpFundingReviewPackets,
      detail: "RTP packets awaiting funding review",
    },
    {
      label: "Grants",
      value: operationsSummary.counts.openFundingOpportunities,
      detail: "Open funding opportunities",
    },
    {
      label: "Funding gaps",
      value: operationsSummary.counts.projectFundingGapProjects,
      detail: "Projects carrying a funding gap",
    },
    {
      label: "Reports",
      value: operationsSummary.counts.reportRefreshRecommended + operationsSummary.counts.reportNoPacket,
      detail: "Report packets to generate or refresh",
    },
    {
      label: "Aerial",
      value: operationsSummary.counts.aerialActiveMissions,
      detail: "Active aerial missions",
    },
  ];

  const insightsView = (
    <>
      <DashboardInsights
        userId={user.id}
        workspaceId={workspaceId}
        tiles={insightsTiles}
        series={{
          "runs-per-month": runsPerMonth(runsRead),
          "comments-received": commentsReceivedOverTime(chartRows.comments, now),
          "composite-scores": recentOverallScores(runsRead),
          "award-drawdown": awardDrawdown(chartRows.awards, chartRows.invoices),
          "open-work": lanePressure(insightLanes),
        }}
      />
      {/* The recent-actions audit feed, absorbed from the retired Command
          Center page. It reads the same workspace audit record the Planner
          Agent Activity page reads in full. */}
      <RecentActionActivity
        className="mt-6"
        executions={actionActivity.executions}
        error={actionActivity.error}
        description="What has happened recently in this workspace — reports generated, funding decisions made, project records changed."
        emptyDescription="Nothing has been recorded in this workspace yet. Report generation, funding decisions, and changes to project records show up here once they run."
      />
    </>
  );

  // A workspace with no activity in any core lane. This gates the quick
  // actions — an empty workspace has no lead action to derive — and ONLY them.
  // It used to gate the getting-started checklist too, which meant creating a
  // single project removed the checklist forever, even with the home geography
  // still unset. Activity is not the same as being set up: the checklist now
  // stays until the home geography is set AND the user dismisses it
  // (GettingStartedCard holds that rule), with a permanent low-key re-entry
  // link in its place once dismissed.
  //
  // AN UNREADABLE RUNS READ IS NOT AN EMPTY WORKSPACE. `runsAreKnownEmpty` is
  // false when the read failed, so a broken query can no longer print "Your
  // workspace is ready and empty" or hide the quick actions of a workspace that
  // is full of work.
  const workspaceIsEmpty =
    runsAreKnownEmpty(runsRead) &&
    operationsSummary.counts.projects === 0 &&
    operationsSummary.counts.plans === 0 &&
    operationsSummary.counts.programs === 0 &&
    operationsSummary.counts.reports === 0;

  // While the checklist's first step is outstanding, its control moves up next
  // to it — the geography setter is what the step asks for, and it was
  // previously buried mid-page where a first-run user never reached it. It is
  // still mounted EXACTLY ONCE either way: the panel self-fetches, so a second
  // mount would mean a second request and a second answer. The checklist
  // renders whenever the geography is unset, so the hoist no longer depends on
  // the workspace being empty.
  const hoistGeographyPanel = !homeGeographyIsSet;
  const geographyPanel = (
    <WorkspaceGeographyPanel workspaceId={workspaceId} canManage={canManageWorkspace} />
  );

  // Same hoisting rule for the AI key: while no Anthropic key resolves, the
  // integration-keys panel's Anthropic row moves up into the checklist's first
  // step, and the main panel below renders the remaining providers. Each
  // provider row is mounted exactly once either way. Members cannot manage
  // keys (the panel renders nothing for them), so nothing is hoisted for them.
  const hoistAiKeyRow = !aiKeyConfigured && canManageWorkspace;
  const nonAiProviderIds = INTEGRATION_PROVIDERS.map((provider) => provider.id).filter(
    (id) => id !== "anthropic"
  );

  const overviewView = (
    <>
      {/* The getting-started checklist. GettingStartedCard decides whether it
          is on screen: always while the home geography is unset, otherwise
          until this user dismisses it — and once dismissed, a permanent
          low-key "Getting started" link stands in its place to reopen it. */}
      <GettingStartedCard
        userId={user.id}
        workspaceId={workspaceId}
        dismissible={homeGeographyIsSet}
      >
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-6 dark:bg-primary/10">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Get started</p>
          <h2 className="mt-1 text-lg font-semibold text-foreground">
            {/* `workspaceName` carries a generic fallback for the intro card;
                reading "Set up Your workspace" would be worse than reading
                "Set up your workspace", so the unnamed case is worded here. */}
            {workspace?.name?.trim() ? `Set up ${workspace.name.trim()}` : "Set up your workspace"}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {workspaceIsEmpty
              ? "Your workspace is ready and empty. These are the things that are actually configured — or not — and what each one turns on."
              : "The setup state of this workspace: what is actually configured — or not — and what each setting turns on."}
          </p>
          <FirstRunChecklist
            aiKeyConfigured={aiKeyConfigured}
            homeGeographyIsSet={homeGeographyIsSet}
            homeGeographyLabel={homeGeographyLabel(homeGeography)}
            hasRuns={kpis.totalRuns > 0}
            runsUnreadable={runsRead.failed}
            canManageWorkspace={canManageWorkspace}
            intent={intent}
            engagementCampaignCount={
              operationsSummary.moduleObservations?.engagement.campaigns ?? null
            }
            aiKeyControl={
              hoistAiKeyRow ? (
                <WorkspaceIntegrationKeysPanel
                  workspaceId={workspaceId}
                  canManage={canManageWorkspace}
                  providerIds={["anthropic"]}
                />
              ) : null
            }
          >
            {hoistGeographyPanel ? geographyPanel : null}
          </FirstRunChecklist>
          <p className="mt-4 text-xs text-muted-foreground">
            New to OpenPlan? The{" "}
            <Link href="/help" className="font-semibold underline underline-offset-4 hover:text-foreground">
              Help page
            </Link>{" "}
            explains what each module does and lists the full getting-started steps.
          </p>
        </div>
      </GettingStartedCard>

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

      {/* Which delivery process this workspace's gate boards follow. It sits
          directly under the geography because it is downstream of it: the
          registry binds a template from the workspace's own jurisdiction when
          one is registered, and until a geography is set every workspace holds
          an explicitly-labeled interim default nobody chose. Unlike the team and
          key panels this renders for every member — an assumed template changes
          the gate names and evidence ids they read on every project board, and a
          member who cannot change it still has to know not to file them as their
          agency's own requirements. */}
      <WorkspaceStageGatePanel
        workspaceId={workspaceId}
        canManage={canManageWorkspace}
        choices={stageGateChoices}
      />

      {/* Integration keys take their own full-width row rather than a third
          slot in the pair above: three items in a two-column grid leave a lone
          half-width card, and this panel's per-provider rows want the width.
          Like the team panel, it renders nothing for a member — key management
          is operator/owner work — so the row collapses cleanly for them.
          While the Anthropic row is hoisted into the checklist's AI step, this
          panel renders the remaining providers only. */}
      <WorkspaceIntegrationKeysPanel
        workspaceId={workspaceId}
        canManage={canManageWorkspace}
        providerIds={hoistAiKeyRow ? nonAiProviderIds : undefined}
      />

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
      <div className={workspaceIsEmpty ? undefined : "grid gap-6 xl:grid-cols-[1.04fr_0.96fr]"}>
        {workspaceIsEmpty ? null : <DashboardQuickActions actions={actions} />}

        <WorkspaceCommandBoard summary={operationsSummary} />
      </div>

      <RunHistory workspaceId={workspaceId} />
    </>
  );

  return (
    <section className="module-page">
      {/* Two readings of one workspace. Overview stays the default; see
          `DashboardViewSwitch` for why the choice is per-browser and not in the
          URL. Both are rendered here and one is hidden — the data is already
          loaded, so a switch should not cost a request. */}
      <DashboardViewSwitch overview={overviewView} insights={insightsView} />

      {/* Last, and always. A self-hosted instance that cannot name its own
          version makes every bug report unanswerable — see `app-version.ts`. */}
      <BuildIdentityLine />
    </section>
  );
}
