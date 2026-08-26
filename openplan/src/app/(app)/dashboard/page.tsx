import Link from "next/link";
import { redirect } from "next/navigation";
import { FileText, FolderKanban, Landmark, Radar, ShieldCheck } from "lucide-react";
import { DashboardKpiGrid } from "@/components/dashboard/dashboard-kpi-grid";
import { DashboardOperatorGuidance } from "@/components/dashboard/dashboard-operator-guidance";
import { DashboardQuickActions } from "@/components/dashboard/dashboard-quick-actions";
import { BuildIdentityLine } from "@/components/dashboard/build-identity-line";
import { FirstRunChecklist } from "@/components/onboarding/first-run-checklist";
import { GettingStartedCard } from "@/components/onboarding/getting-started-card";
import { DashboardWorkspaceIntro } from "@/components/dashboard/dashboard-workspace-intro";
import { RecentActionActivity } from "@/components/operations/recent-action-activity";
import { WorkspaceCommandBoard } from "@/components/operations/workspace-command-board";
import { RunHistory } from "@/components/runs/RunHistory";
import { WorkspaceMembershipRequired } from "@/components/workspaces/workspace-membership-required";
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
import { hasAnthropicAccess } from "@/lib/integrations/anthropic-access";
import { withWorkspaceIntegrationContext } from "@/lib/integrations/workspace-keys";
import { createClient } from "@/lib/supabase/server";
import {
  loadCurrentWorkspaceMembership,
} from "@/lib/workspaces/current";
import {
  homeGeographyLabel,
  HOME_GEOGRAPHY_SCOPE_COLUMNS,
  parseWorkspaceHomeGeography,
} from "@/lib/workspaces/home-geography";
import { moduleMetadata } from "@/lib/ui/page-title";
import { ReadFailureLog } from "@/lib/ui/read-failures";

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
          .select(HOME_GEOGRAPHY_SCOPE_COLUMNS)
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
  const reads = new ReadFailureLog();
  const homeGeographyUnreadable = reads.check("where your agency works", homeGeographyResult);
  const homeGeography = homeGeographyUnreadable
    ? null
    : parseWorkspaceHomeGeography(homeGeographyResult.data);
  const homeGeographyIsSet = homeGeography !== null;

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
                ? `Go straight to Grants for the ${rtpFundingReviewCount} RTP report${rtpFundingReviewCount === 1 ? "" : "s"} whose linked projects still need their funding sorted out.`
                : rtpFundingReviewCount > 0
                ? `Go straight to the ${rtpFundingReviewCount} RTP report${rtpFundingReviewCount === 1 ? "" : "s"} still waiting on funding sign-off before release.`
                : "Go straight to the RTP reports waiting to be signed off for release.",
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
                ? "Start a reimbursement claim"
                : "Advance reimbursement invoicing",
            description:
              operationsSummary.nextCommand.key === "start-project-reimbursement-packets"
                ? "Go straight to reimbursement in Grants and start the first claim."
                : "Go straight to reimbursement in Grants and move along the claims already under way.",
            icon: ShieldCheck,
          },
        ]
      : []),
    {
      key: "analysis-studio",
      href: "/explore",
      title: "Open Corridor Analysis",
      description: "Score a corridor against the open data available for it, on a map, and save the result.",
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
      label: "RTP reports",
      value: operationsSummary.counts.rtpFundingReviewPackets,
      detail: "RTP reports waiting on a funding review",
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
      detail: "Reports to generate or refresh",
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
        description="What has happened here recently — reports generated, funding decisions made, projects changed."
        emptyDescription="Nothing has happened here yet. Reports you generate, funding decisions you make, and changes to projects all show up here."
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

  const overviewView = (
    <>
      {reads.any ? (
        <div className="mb-4 rounded-lg border border-destructive/50 bg-destructive/5 p-4 text-sm text-destructive" role="alert">
          <p>{reads.describe()}</p>
          <p className="mt-1 text-xs">{reads.messages().join(" · ")}</p>
        </div>
      ) : null}
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
            homeGeographyUnreadable={homeGeographyUnreadable}
            homeGeographyLabel={homeGeographyLabel(homeGeography)}
            hasRuns={kpis.totalRuns > 0}
            runsUnreadable={runsRead.failed}
            canManageWorkspace={canManageWorkspace}
            intent={intent}
            engagementCampaignCount={
              operationsSummary.moduleObservations?.engagement.campaigns ?? null
            }
          />
          <p className="mt-4 text-xs text-muted-foreground">
            New to OpenPlan? The{" "}
            <Link href="/help" className="font-semibold underline underline-offset-4 hover:text-foreground">
              Help page
            </Link>{" "}
            explains what each module does and lists the full getting-started steps.
          </p>
        </div>
      </GettingStartedCard>

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
