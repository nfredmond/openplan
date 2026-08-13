import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, FolderKanban, GitCompareArrows, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { CartographicSelectionLink } from "@/components/cartographic/cartographic-selection-link";
import { ScenarioSetCreator } from "@/components/scenarios/scenario-set-creator";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/state-block";
import { WorkspaceMembershipRequired } from "@/components/workspaces/workspace-membership-required";
import { createClient } from "@/lib/supabase/server";
import { ReadFailureLog } from "@/lib/ui/read-failures";
import { loadCurrentWorkspaceMembership } from "@/lib/workspaces/current";
import { scenarioStatusTone, titleizeScenarioValue } from "@/lib/scenarios/catalog";
import { moduleMetadata } from "@/lib/ui/page-title";
import { ReadFailureNotice } from "@/components/ui/read-failure-notice";

export const metadata = moduleMetadata("Scenarios");

/**
 * `?projectId=` is how this catalog is TOLD which project it was opened for.
 *
 * THE DEFECT IT ARRIVED WITH. The project spine board's scenario lane counts the
 * scenario sets tied to one project and links here with the id attached. This
 * page applied the filter and then said nothing about it: the heading still read
 * "Scenario sets in this workspace", the summary tiles still read as workspace
 * totals, and a filtered zero rendered "No scenario sets yet — create the first
 * one", which is a claim about a workspace this render never queried. A filtered
 * list has to name its filter, or its emptiness gets read as the world's.
 */
type ScenariosPageSearchParams = Promise<{
  projectId?: string;
  status?: string;
}>;

const SCENARIO_STATUS_FILTER_OPTIONS = [
  { value: "draft", label: "Draft" },
  { value: "active", label: "Active" },
  { value: "archived", label: "Archived" },
] as const;

/**
 * A status-tab href that carries the filters already in effect.
 *
 * Each tab used to rebuild its href from scratch (`/scenarios?status=active`),
 * so a planner who arrived from a project board on `/scenarios?projectId=…` and
 * then picked a status silently widened from one project back to the whole
 * workspace, with nothing on screen saying the scope had changed. Choosing a
 * status is a request to narrow; it must never widen behind the reader's back.
 * Widening stays deliberate — that is what "Clear filters" is for.
 */
function scenariosTabHref(projectId: string | null, status: string | null): string {
  const params = new URLSearchParams();
  if (projectId) params.set("projectId", projectId);
  if (status) params.set("status", status);
  const query = params.toString();
  return query ? `/scenarios?${query}` : "/scenarios";
}

type ScenarioSetRow = {
  id: string;
  workspace_id: string;
  project_id: string;
  title: string;
  summary: string | null;
  planning_question: string | null;
  status: string;
  baseline_entry_id: string | null;
  created_at: string;
  updated_at: string;
  projects:
    | {
        id: string;
        name: string;
      }
    | Array<{
        id: string;
        name: string;
      }>
    | null;
};

function fmtDateTime(value: string | null | undefined): string {
  if (!value) return "Unknown";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

export default async function ScenariosPage({
  searchParams,
}: {
  searchParams: ScenariosPageSearchParams;
}) {
  const filters = await searchParams;
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
        moduleLabel="Scenarios"
        title="Scenarios need a workspace"
        description="Scenario sets belong to the workspace that owns the projects they compare. You are signed in, but this account is not in a workspace yet — that, and not a missing scenario, is why nothing is listed here."
      />
    );
  }

  // Scoped to the active workspace — RLS grants ALL memberships, so without
  // the filter a multi-workspace member saw every workspace's scenario sets
  // merged (2026-08-03 review, unscoped-list-page class). Entries carry only
  // scenario_set_id, so they scope through this workspace's set ids.
  // A catalog that cannot read its own rows renders the same as a workspace with
  // no scenario sets, and its empty state says so out loud. Register every read
  // and disclose whatever failed.
  const reads = new ReadFailureLog();

  const [scenarioSetsResult, projectsResult] = await Promise.all([
    supabase
      .from("scenario_sets")
      .select(
        "id, workspace_id, project_id, title, summary, planning_question, status, baseline_entry_id, created_at, updated_at, projects(id, name)"
      )
      .eq("workspace_id", membership.workspace_id)
      .order("updated_at", { ascending: false }),
    supabase.from("projects").select("id, workspace_id, name").eq("workspace_id", membership.workspace_id).order("updated_at", { ascending: false }),
  ]);
  const scenarioSetsUnreadable = reads.check("this workspace's scenario sets", scenarioSetsResult);
  const projectsUnreadable = reads.check("this workspace's projects", projectsResult);
  const scenarioSetsData = scenarioSetsResult.data;
  const projectsData = projectsResult.data;
  const projectsError = projectsResult.error;

  const scopedSetIds = ((scenarioSetsData ?? []) as { id: string }[]).map((set) => set.id);
  const entriesResult = scopedSetIds.length
    ? await supabase.from("scenario_entries").select("scenario_set_id, entry_type").in("scenario_set_id", scopedSetIds)
    : { data: [], error: null };
  // The per-set baseline/alternative counts come from here. A failed read makes
  // every row on the page say "Baseline missing" — a finding about the planner's
  // work, invented by a broken query.
  const entriesUnreadable = reads.check("scenario entries", entriesResult);
  const entriesData = entriesResult.data;

  const counts = new Map<string, { baselineCount: number; alternativeCount: number }>();
  for (const entry of entriesData ?? []) {
    const current = counts.get(entry.scenario_set_id) ?? { baselineCount: 0, alternativeCount: 0 };
    if (entry.entry_type === "baseline") {
      current.baselineCount += 1;
    } else {
      current.alternativeCount += 1;
    }
    counts.set(entry.scenario_set_id, current);
  }

  const projectFilterId = filters.projectId?.trim() || null;
  const statusFilter = filters.status?.trim() || null;
  const hasActiveFilters = Boolean(projectFilterId || statusFilter);

  // The project is named from the list this page already reads for the creator
  // panel rather than a second query. A name is a courtesy the list may not be
  // able to supply — the id is the filter, and is disclosed instead when the
  // name is missing, so the reader can still tell WHICH project is in scope.
  const projectFilterName = projectFilterId
    ? ((projectsData ?? []) as Array<{ id: string; name: string | null }>)
        .find((project) => project.id === projectFilterId)
        ?.name?.trim() || null
    : null;

  // The status tabs count within the project scope but BEFORE the status filter.
  // Counting the fully filtered list made every unselected tab read "(0)" the
  // moment a status was chosen — a count of records the page had already thrown
  // away, presented as a count of records that do not exist.
  const scenarioSetsInScope = ((scenarioSetsData ?? []) as ScenarioSetRow[])
    .map((scenarioSet) => ({
      ...scenarioSet,
      project: Array.isArray(scenarioSet.projects) ? scenarioSet.projects[0] ?? null : scenarioSet.projects ?? null,
      counts: counts.get(scenarioSet.id) ?? { baselineCount: 0, alternativeCount: 0 },
    }))
    .filter((scenarioSet) => (projectFilterId ? scenarioSet.project_id === projectFilterId : true));

  const scenarioSets = scenarioSetsInScope.filter((scenarioSet) =>
    statusFilter ? scenarioSet.status === statusFilter : true
  );

  // Named in the reader's terms so the empty state can say what it is filtered
  // to, not merely that it is filtered.
  const activeFilterLabels = [
    projectFilterId ? `project ${projectFilterName ?? projectFilterId}` : null,
    statusFilter ? `status ${titleizeScenarioValue(statusFilter)}` : null,
  ].filter((label): label is string => Boolean(label));

  const activeCount = scenarioSets.filter((scenarioSet) => scenarioSet.status === "active").length;
  const withBaselineCount = scenarioSets.filter((scenarioSet) => scenarioSet.counts.baselineCount > 0).length;
  const totalAlternatives = scenarioSets.reduce((sum, scenarioSet) => sum + scenarioSet.counts.alternativeCount, 0);

  return (
    <section className="module-page">
      {/* Internal page, so the database's own message stays on it — inside the
          notice's operator disclosure, where the person who can act on it will
          look and a planner is not made to read it. */}
      <ReadFailureNotice
        className="mb-4"
        reads={reads}
        title="Part of this catalog could not be read"
      />

      <header className="module-header-grid">
        <article className="module-intro-card">
          <div className="module-intro-kicker">
            <GitCompareArrows className="h-3.5 w-3.5" />
            Scenario planning
          </div>
          <div className="module-intro-body">
            <h1 className="module-intro-title">Scenarios</h1>
            <p className="module-intro-description">
              Compare alternatives, keep a clear baseline, and revisit earlier scenario work when a project changes.
            </p>
            {projectFilterId ? (
              // Every tile and every row below belongs to one project, so the
              // scope has to be stated where the reader cannot miss it and be
              // reversible in one click. Without this the totals read as the
              // workspace's.
              <p className="module-intro-description">
                Showing only scenario sets for {projectFilterName ?? `the project with id ${projectFilterId}`}.{" "}
                <Link href="/scenarios" className="underline underline-offset-2 hover:text-foreground">
                  Show every scenario set in this workspace
                </Link>
                .
              </p>
            ) : null}
            {projectFilterId && !projectFilterName ? (
              // Why the project could not be named. A failed read and a project
              // this workspace does not have produce the same empty catalog, and
              // only one of them is a statement about the project.
              <p className="module-intro-description">
                {projectsError
                  ? "This workspace's project list could not be read, so the filter above is named by id. An empty catalog below would not mean that project has no scenario sets."
                  : "No project with that id appears in this workspace's project list, so this filter may match nothing."}
              </p>
            ) : null}
          </div>

          <div className="module-summary-grid cols-3">
            <div className="module-summary-card">
              <p className="module-summary-label">Scenario sets</p>
              <p className="module-summary-value">{scenarioSetsUnreadable ? "—" : scenarioSets.length}</p>
              <p className="module-summary-detail">
                {scenarioSetsUnreadable
                  ? "The scenario-set list could not be read, so this is not a count of zero."
                  : hasActiveFilters
                    ? "Matching the current filters."
                    : "Saved comparisons linked to projects and plans."}
              </p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Active</p>
              <p className="module-summary-value">{scenarioSetsUnreadable ? "—" : activeCount}</p>
              <p className="module-summary-detail">
                {scenarioSetsUnreadable
                  ? "Unavailable for this render."
                  : "Scenario sets currently being reviewed or compared."}
              </p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Alternatives</p>
              <p className="module-summary-value">
                {scenarioSetsUnreadable || entriesUnreadable ? "—" : totalAlternatives}
              </p>
              <p className="module-summary-detail">
                {scenarioSetsUnreadable || entriesUnreadable
                  ? "Entry counts could not be read, so baselines and alternatives cannot be tallied."
                  : `${withBaselineCount} sets already have a registered baseline.`}
              </p>
            </div>
          </div>
        </article>

        <article className="module-operator-card">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-[0.5rem] border border-white/10 bg-white/[0.05]">
              <ShieldCheck className="h-5 w-5 text-emerald-200" />
            </span>
            <div>
              <p className="module-operator-eyebrow">Scenarios</p>
              <h2 className="module-operator-title">Every alternative keeps the run it came from</h2>
            </div>
          </div>
          <p className="module-operator-copy">
            Each entry records what it is, which analysis run backs it, the assumptions behind it, and whether it is ready to
            compare. Scenario sets organise the comparison; the analysis itself still happens in the Analysis Studio.
          </p>
          <div className="module-operator-list">
            <div className="module-operator-item">A scenario set can only have one baseline — the database will not allow a second.</div>
            <div className="module-operator-item">Attaching a saved run to an alternative keeps the trail back to the project.</div>
            <div className="module-operator-item">A comparison is only ready when both sides have a run. If one is missing, it says so.</div>
          </div>
        </article>
      </header>

      <div className="grid gap-6 xl:grid-cols-[0.92fr_1.08fr]">
        {/* The creator's project picker is fed by the same read the filter name
            uses. An empty picker after a failed read would tell the planner this
            workspace has no projects. */}
        <div id="create-scenario-set">
          <ScenarioSetCreator projects={projectsData ?? []} projectsUnreadable={projectsUnreadable} />
        </div>

        <article className="module-section-surface">
          <div className="module-section-header">
            <div className="module-section-heading">
              <p className="module-section-label">Catalog</p>
              <h2 className="module-section-title">
                {/* The heading may not claim workspace scope over a project-scoped list. */}
                {projectFilterId ? "Scenario sets for this project" : "Scenario sets in this workspace"}
              </h2>
              <p className="module-section-description">
                {projectFilterId
                  ? "Filter by status to narrow this project's scenario sets further."
                  : "Filter by status to narrow the catalog to the records that need attention."}
              </p>
            </div>
            <span className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-background/80 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              <FolderKanban className="h-3.5 w-3.5" />
              {/* "0 total" beside "this catalog could not be read" is the same
                  lie the empty state was fixed for, wearing a number. */}
              {scenarioSetsUnreadable ? "Total unreadable" : `${scenarioSets.length} total`}
            </span>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-1.5 border-b border-border/60 pb-3 text-[0.78rem]">
            <Link href={scenariosTabHref(projectFilterId, null)} className={cn("rounded px-2 py-0.5 transition-colors", !statusFilter ? "bg-emerald-500/10 font-semibold text-emerald-700 dark:text-emerald-300" : "text-muted-foreground hover:text-foreground")}>
              {/* Every tab count is derived from the list read. When it failed
                  they would all read "(0)" — four separate statements that no
                  scenario set has that status. */}
              All {scenarioSetsUnreadable ? "" : `(${scenarioSetsInScope.length})`}
            </Link>
            {SCENARIO_STATUS_FILTER_OPTIONS.map((opt) => (
              <Link key={opt.value} href={scenariosTabHref(projectFilterId, opt.value)} className={cn("rounded px-2 py-0.5 transition-colors", statusFilter === opt.value ? "bg-emerald-500/10 font-semibold text-emerald-700 dark:text-emerald-300" : "text-muted-foreground hover:text-foreground")}>
                {opt.label}{" "}
                {scenarioSetsUnreadable ? "" : `(${scenarioSetsInScope.filter((s) => s.status === opt.value).length})`}
              </Link>
            ))}
            {hasActiveFilters ? (
              // The one deliberate way to widen. Every tab above narrows within
              // the scope the page was opened for; only this leaves it.
              <Link href="/scenarios" className="ml-auto rounded px-2 py-0.5 text-muted-foreground/70 hover:text-foreground">
                Clear filters ×
              </Link>
            ) : null}
          </div>

          {scenarioSetsUnreadable ? (
            // "No scenario sets yet" is a claim about this workspace. A read
            // that failed cannot make it.
            <div className="mt-5">
              <EmptyState
                title="This catalog could not be read"
                description="The scenario-set list for this workspace could not be loaded, so nothing is shown below. That is a failed read, not an empty workspace — do not read it as a statement that no scenario sets exist."
              />
            </div>
          ) : scenarioSets.length === 0 ? (
            <div className="mt-5">
              <EmptyState
                title={hasActiveFilters ? "No scenario sets match these filters" : "No scenario sets yet"}
                description={
                  hasActiveFilters
                    ? `This catalog is filtered to ${activeFilterLabels.join(", ")}. Clear the filters to see every scenario set in this workspace — an empty filtered list is not a statement that none exist.`
                    : "Scenarios lets you compare a baseline against alternatives — with the project, without it, or with a different design — before you recommend one. Create your first scenario set for a project you are studying."
                }
                action={
                  hasActiveFilters ? undefined : (
                    <a href="#create-scenario-set" className="inline-flex items-center rounded border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted/40">
                      Create a scenario set
                    </a>
                  )
                }
              />
            </div>
          ) : (
            <div className="mt-5 module-record-list">
              {scenarioSets.map((scenarioSet) => (
                <CartographicSelectionLink
                  key={scenarioSet.id}
                  href={`/scenarios/${scenarioSet.id}`}
                  className="module-record-row is-interactive group block"
                  selection={{
                    kind: "run",
                    title: scenarioSet.title,
                    kicker: entriesUnreadable
                      ? `${titleizeScenarioValue(scenarioSet.status)} · alternatives unreadable`
                      : `${titleizeScenarioValue(scenarioSet.status)} · ${scenarioSet.counts.alternativeCount} alternatives`,
                    avatarChar: scenarioSet.title[0],
                    meta: [
                      ...(scenarioSet.project?.name ? [{ label: "project", value: scenarioSet.project.name }] : []),
                      entriesUnreadable
                        ? { label: "baseline", value: "unreadable", tone: "warn" as const }
                        : scenarioSet.counts.baselineCount > 0
                          ? { label: "baseline", value: "set", tone: "ok" as const }
                          : { label: "baseline", value: "missing", tone: "warn" as const },
                    ],
                  }}
                >
                  <div className="module-record-head">
                    <div className="module-record-main">
                      <div className="module-record-kicker">
                        <StatusBadge tone={scenarioStatusTone(scenarioSet.status)}>
                          {titleizeScenarioValue(scenarioSet.status)}
                        </StatusBadge>
                        {/* "Baseline missing" is a finding. Only a successful
                            entries read can support it. */}
                        <StatusBadge
                          tone={
                            entriesUnreadable ? "warning" : scenarioSet.counts.baselineCount > 0 ? "success" : "warning"
                          }
                        >
                          {entriesUnreadable
                            ? "Baseline unreadable"
                            : scenarioSet.counts.baselineCount > 0
                              ? "Baseline set"
                              : "Baseline missing"}
                        </StatusBadge>
                      </div>

                      <div className="space-y-1.5">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <h3 className="module-record-title text-[1.05rem] transition group-hover:text-primary">
                            {scenarioSet.title}
                          </h3>
                          <p className="module-record-stamp">Updated {fmtDateTime(scenarioSet.updated_at)}</p>
                        </div>
                        <p className="module-record-summary line-clamp-2">
                          {scenarioSet.summary ||
                            "No summary yet. Open the scenario set to define the planning question, baseline, and alternatives."}
                        </p>
                      </div>
                    </div>

                    <ArrowRight className="mt-0.5 h-4.5 w-4.5 text-muted-foreground transition group-hover:text-primary" />
                  </div>

                  <p className="mt-1.5 text-[0.73rem] text-muted-foreground">
                    {scenarioSet.project?.name ?? "No project"} ·{" "}
                    {entriesUnreadable ? "alternatives unreadable" : `${scenarioSet.counts.alternativeCount} alternatives`} · {scenarioSet.planning_question ? "Planning question captured" : "Planning question pending"} · Updated {fmtDateTime(scenarioSet.updated_at)}
                  </p>
                </CartographicSelectionLink>
              ))}
            </div>
          )}
        </article>
      </div>
    </section>
  );
}
