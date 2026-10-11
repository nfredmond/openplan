import Link from "next/link";
import { redirect } from "next/navigation";
import { BuildIdentityLine } from "@/components/dashboard/build-identity-line";
import { ComingUpRail } from "@/components/dashboard/coming-up-rail";
import { DashboardFigures, type DashboardFigure } from "@/components/dashboard/dashboard-figures";
import { DashboardInsights } from "@/components/dashboard/dashboard-insights";
import { DashboardProjects, type DashboardProjectRow } from "@/components/dashboard/dashboard-projects";
import {
  DashboardScopeSwitch,
  normalizeDashboardScope,
} from "@/components/dashboard/dashboard-scope-switch";
import { NeedsYouList } from "@/components/dashboard/needs-you-list";
import { FirstRunChecklist } from "@/components/onboarding/first-run-checklist";
import { GettingStartedCard } from "@/components/onboarding/getting-started-card";
import { WorkspaceMembershipRequired } from "@/components/workspaces/workspace-membership-required";
import { buildWorkspaceKpis } from "@/lib/metrics/workspace-kpis";
import { recentOverallScores, runsPerMonth } from "@/lib/dashboard/insights";
import {
  awardDrawdown,
  awardDrawdownTotals,
  commentsReceivedOverTime,
  COMMENT_WINDOW_WEEKS,
} from "@/lib/dashboard/chart-series";
import { loadDashboardChartRows, type DashboardChartSupabaseLike } from "@/lib/dashboard/chart-reads";
import {
  addDays,
  cappedSourcesSentence,
  comingUpFromMyWork,
  deadlinesByMonth,
  needsYouFromMyWork,
  sortComingUp,
  withCommandActions,
  withinWindow,
  type ComingUpItem,
} from "@/lib/dashboard/coming-up";
import { deadlinesByMonthSeries } from "@/lib/dashboard/deadline-series";
import { loadWorkspaceDates, type WorkspaceDatesSupabaseLike } from "@/lib/dashboard/workspace-dates";
import {
  loadWorkspaceOperationsSummaryForWorkspace,
  type WorkspaceOperationsSupabaseLike,
} from "@/lib/operations/workspace-summary";
import { hasAnthropicAccess } from "@/lib/integrations/anthropic-access";
import { withWorkspaceIntegrationContext } from "@/lib/integrations/workspace-keys";
import { formatMoney } from "@/lib/money/format";
import { loadMyWork, MY_WORK_SOURCES_BY_ID } from "@/lib/my-work/query";
import type { MyWorkResult } from "@/lib/my-work/types";
import { createClient } from "@/lib/supabase/server";
import { loadCurrentWorkspaceMembership } from "@/lib/workspaces/current";
import {
  homeGeographyLabel,
  HOME_GEOGRAPHY_SCOPE_COLUMNS,
  parseWorkspaceHomeGeography,
} from "@/lib/workspaces/home-geography";
import { moduleMetadata } from "@/lib/ui/page-title";
import { ReadFailureLog } from "@/lib/ui/read-failures";

export const metadata = moduleMetadata("Dashboard");

/** How far ahead Coming up looks, and how far the deadline chart counts. */
const COMING_UP_DAYS = 60;
const DEADLINE_CHART_MONTHS = 3;
const NEEDS_YOU_LIMIT = 6;
const UPCOMING_CAP_PER_SOURCE = 10;
const BACKLOG_CAP_PER_SOURCE = 20;

/** Sources that returned their full cap: more rows may exist than were read. */
function cappedLabels(result: MyWorkResult, cap: number, blocks: readonly string[]): string[] {
  return Object.entries(result.rowsRead).flatMap(([sourceId, rows]) => {
    const source = MY_WORK_SOURCES_BY_ID[sourceId as keyof typeof MY_WORK_SOURCES_BY_ID];
    if (!source || rows === undefined || !blocks.includes(source.block)) return [];
    return rows >= cap ? [source.label.toLowerCase()] : [];
  });
}

function failedSentence(labels: readonly string[]): string | null {
  if (labels.length === 0) return null;
  return `Could not check ${labels.join(", ")}. Anything due there is not shown.`;
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  // What the person said they came for on the public page, carried through
  // sign-up. It steers one checklist step and is never stored.
  const resolvedSearchParams = (await searchParams) ?? {};
  const intentParam = resolvedSearchParams.intent;
  const intent = intentParam === "modeling" || intentParam === "engagement" ? intentParam : null;
  const scope = normalizeDashboardScope(resolvedSearchParams.scope);

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
        moduleLabel="Dashboard"
        title="The dashboard needs a workspace"
        description="Create a project workspace, or ask an owner or admin to add you to one."
        primaryHref="/projects"
        primaryLabel="Create or open project workspace"
      />
    );
  }

  const workspaceId = membership.workspace_id ?? "";
  const workspaceRole = membership.role ?? "member";
  const canManageWorkspace = workspaceRole === "owner" || workspaceRole === "admin";

  // One clock for the whole render, so every window agrees where it starts.
  const now = new Date();
  const commentWindowStart = new Date(now);
  commentWindowStart.setUTCDate(commentWindowStart.getUTCDate() - COMMENT_WINDOW_WEEKS * 7);
  // A day of margin either side of the server's date. The browser places
  // "today" in the reader's own time zone; these bounds only decide which
  // read an item arrives in, and no item falls between them.
  const boundary = addDays(now.toISOString().slice(0, 10), -1);
  const windowEnd = addDays(boundary, COMING_UP_DAYS + 1);
  const chartEnd = addDays(boundary, DEADLINE_CHART_MONTHS * 31 + 1);
  const myWorkScope = scope === "mine" ? "assigned" : "all_projects";
  // The roster only matters to the unassigned scope, which the dashboard does not offer.
  const roster = { ok: true as const, members: [] };

  const [
    operationsSummary,
    homeGeographyResult,
    chartRows,
    backlog,
    upcoming,
    workspaceDates,
    projectsResult,
  ] = await Promise.all([
    loadWorkspaceOperationsSummaryForWorkspace(
      supabase as unknown as WorkspaceOperationsSupabaseLike,
      workspaceId
    ),
    // Identity columns only: the boundary polygon can be megabytes.
    supabase.from("workspaces").select(HOME_GEOGRAPHY_SCOPE_COLUMNS).eq("id", workspaceId).maybeSingle(),
    loadDashboardChartRows(supabase as unknown as DashboardChartSupabaseLike, workspaceId, commentWindowStart),
    // Undated work and the overdue backlog, oldest first.
    loadMyWork(supabase, {
      workspaceId,
      userId: user.id,
      scope: myWorkScope,
      roster,
      limitPerSource: BACKLOG_CAP_PER_SOURCE,
      dueBefore: boundary,
      now,
    }),
    // Dated work from the boundary forward, soonest first. Read separately so
    // a long overdue backlog cannot push every upcoming item past the cap.
    loadMyWork(supabase, {
      workspaceId,
      userId: user.id,
      scope: myWorkScope,
      roster,
      limitPerSource: UPCOMING_CAP_PER_SOURCE,
      dueOnOrAfter: boundary,
      dueOnOrBefore: chartEnd,
      datedOnly: true,
      now,
    }),
    loadWorkspaceDates(supabase as unknown as WorkspaceDatesSupabaseLike, workspaceId, boundary, chartEnd),
    supabase
      .from("projects")
      .select("id, name, status, delivery_phase")
      .eq("workspace_id", workspaceId)
      .in("status", ["active", "on_hold", "draft"])
      .order("updated_at", { ascending: false })
      .limit(8),
  ]);

  const aiKeyConfigured = await withWorkspaceIntegrationContext(workspaceId, async () => hasAnthropicAccess());

  const reads = new ReadFailureLog();
  const homeGeographyUnreadable = reads.check("where your agency works", homeGeographyResult);
  const homeGeography = homeGeographyUnreadable ? null : parseWorkspaceHomeGeography(homeGeographyResult.data);
  const homeGeographyIsSet = homeGeography !== null;
  const projectsUnreadable = Boolean(projectsResult.error);
  const projects = (projectsUnreadable ? [] : projectsResult.data ?? []) as DashboardProjectRow[];

  const runsRead = chartRows.runs;
  const kpis = buildWorkspaceKpis({
    workspaceCreatedAt: workspace.created_at ?? null,
    runs: runsRead.rows as Parameters<typeof buildWorkspaceKpis>[0]["runs"],
  });

  // ── Needs you ──
  const needsYou = withCommandActions(needsYouFromMyWork(backlog.items), operationsSummary.commandQueue);
  const needsYouFailed = failedSentence(backlog.reads.all.map((failure) => failure.label));
  const needsYouCapped = cappedSourcesSentence(
    cappedLabels(backlog, BACKLOG_CAP_PER_SOURCE, ["blocked_projects", "needs_review", "undated"]).map((label) => ({
      label,
      shown: BACKLOG_CAP_PER_SOURCE,
    }))
  );

  // ── Coming up ──
  const overdue = sortComingUp(comingUpFromMyWork(backlog.items));
  const allUpcoming = sortComingUp([...comingUpFromMyWork(upcoming.items), ...workspaceDates.items]);
  const nextDays = withinWindow(allUpcoming, windowEnd);
  const comingUpCapped = cappedSourcesSentence(
    [
      ...cappedLabels(upcoming, UPCOMING_CAP_PER_SOURCE, ["deadlines", "workspace_deadlines"]),
      ...cappedLabels(backlog, BACKLOG_CAP_PER_SOURCE, ["deadlines", "workspace_deadlines"]),
      ...workspaceDates.capped,
    ].map((label) => ({ label, shown: UPCOMING_CAP_PER_SOURCE }))
  );
  const comingUpFailed = failedSentence([
    ...upcoming.reads.all.map((failure) => failure.label),
    ...workspaceDates.failed,
  ]);

  const nextDateByProject = new Map<string, ComingUpItem>();
  for (const entry of comingUpFromMyWork(upcoming.items)) {
    const projectId = upcoming.items.find((row) => `${row.sourceId}:${row.id}` === entry.key)?.projectId;
    if (projectId && !nextDateByProject.has(projectId)) nextDateByProject.set(projectId, entry);
  }

  // ── Figures ──
  const drawdown = awardDrawdownTotals(chartRows.awards, chartRows.invoices);
  const moderation = operationsSummary.moduleObservations?.engagement.moderationActionableItems ?? null;
  const thisYear = String(now.getUTCFullYear());
  const runsThisYear = runsRead.failed || runsRead.pending
    ? null
    : runsRead.rows.filter((row) => String(row.created_at ?? "").startsWith(thisYear)).length;
  const figures: DashboardFigure[] = [
    {
      key: "awarded",
      label: "Awarded",
      value: drawdown ? formatMoney(drawdown.authorised, { precision: "whole" }) : null,
      qualifier: drawdown
        ? [`${drawdown.percent}% drawn`, drawdown.disclosure].filter(Boolean).join(". ")
        : null,
      href: "/grants",
    },
    {
      key: "comments",
      label: "Comments to review",
      value: moderation === null ? null : moderation.toLocaleString("en-US"),
      qualifier: moderation === 0 ? "None waiting" : "Pending or flagged",
      href: "/engagement",
    },
    {
      key: "runs",
      label: `Corridor runs in ${thisYear}`,
      value: runsThisYear === null ? null : `${runsThisYear}${runsRead.truncated ? "+" : ""}`,
      qualifier: runsRead.truncated ? "At least this many" : null,
      href: "/explore",
    },
  ];

  const deadlineCounts = deadlinesByMonth(allUpcoming, boundary, DEADLINE_CHART_MONTHS);

  // ── Setup ──
  const setupSteps = [aiKeyConfigured, homeGeographyIsSet, kpis.totalRuns > 0];
  const setupDone = setupSteps.filter(Boolean).length;
  const checklist = (
    <FirstRunChecklist
      aiKeyConfigured={aiKeyConfigured}
      homeGeographyIsSet={homeGeographyIsSet}
      homeGeographyUnreadable={homeGeographyUnreadable}
      homeGeographyLabel={homeGeographyLabel(homeGeography)}
      hasRuns={kpis.totalRuns > 0}
      runsUnreadable={runsRead.failed}
      canManageWorkspace={canManageWorkspace}
      intent={intent}
      engagementCampaignCount={operationsSummary.moduleObservations?.engagement.campaigns ?? null}
    />
  );

  return (
    <section className="module-page dashboard">
      <header className="dashboard-head">
        <div>
          <h1 className="dashboard-title">Dashboard</h1>
          {homeGeography ? <p className="dashboard-place">{homeGeographyLabel(homeGeography)}</p> : null}
        </div>
        <DashboardScopeSwitch scope={scope} />
      </header>

      {reads.any ? (
        <p className="dashboard-read-failed" role="alert">
          {reads.describe()}
        </p>
      ) : null}

      {homeGeographyIsSet ? (
        <GettingStartedCard userId={user.id} workspaceId={workspaceId} dismissible inline>
          <details className="dashboard-setup" open={setupDone < setupSteps.length}>
            <summary>
              <strong>Setup checklist</strong>
              <span>
                {setupDone} of {setupSteps.length} done
              </span>
            </summary>
            {checklist}
          </details>
        </GettingStartedCard>
      ) : (
        <section aria-labelledby="dashboard-setup-title" className="dashboard-panel">
          <header className="dashboard-panel-header">
            <h2 id="dashboard-setup-title" className="dashboard-panel-title">
              Set up this workspace
            </h2>
            <Link href="/help" className="dashboard-panel-aside dashboard-link">
              Help
            </Link>
          </header>
          {checklist}
        </section>
      )}

      <div className="dashboard-lead">
        <NeedsYouList
          items={needsYou}
          limit={NEEDS_YOU_LIMIT}
          failedSentence={needsYouFailed}
          incompleteSentence={needsYouCapped}
          moreHref="/my-work?scope=all_projects"
        />
        <ComingUpRail
          overdue={overdue.slice(0, 3)}
          overdueTotal={overdue.length}
          upcoming={nextDays}
          windowDays={COMING_UP_DAYS}
          incompleteSentence={comingUpCapped}
          failedSentence={comingUpFailed}
          moreHref="/my-work?scope=all_projects"
        />
      </div>

      <DashboardProjects
        projects={projects}
        nextDates={nextDateByProject}
        datesKnown={!upcoming.reads.any}
        unreadable={projectsUnreadable}
      />

      <DashboardFigures figures={figures} />

      <DashboardInsights
        userId={user.id}
        workspaceId={workspaceId}
        series={{
          "award-drawdown": awardDrawdown(chartRows.awards, chartRows.invoices),
          "comments-received": commentsReceivedOverTime(chartRows.comments, now),
          "deadlines-by-month": deadlinesByMonthSeries(deadlineCounts, Boolean(comingUpFailed), Boolean(comingUpCapped)),
          "runs-per-month": runsPerMonth(runsRead),
          "composite-scores": recentOverallScores(runsRead),
        }}
      />

      <footer className="dashboard-foot">
        <Link href="/assistant-activity" className="dashboard-more-link">
          Planner Agent activity
        </Link>
        <BuildIdentityLine />
      </footer>
    </section>
  );
}
