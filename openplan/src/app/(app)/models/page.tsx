import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, Database, FolderKanban, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { CartographicSelectionLink } from "@/components/cartographic/cartographic-selection-link";
import { NetworkPackagesPanel } from "@/app/(app)/models/_components/network-packages-panel";
import { ModelCreator } from "@/components/models/model-creator";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/state-block";
import { WorkspaceMembershipRequired } from "@/components/workspaces/workspace-membership-required";
import { createClient } from "@/lib/supabase/server";
import { loadCurrentWorkspaceMembership } from "@/lib/workspaces/current";
import {
  buildModelWorkspaceSummary,
  formatModelDateTime,
  formatModelFamilyLabel,
  formatModelStatusLabel,
  MODEL_STATUS_OPTIONS,
  modelStatusTone,
} from "@/lib/models/catalog";
import { looksLikePendingScenarioSpineSchema } from "@/lib/scenarios/api";

type ModelsPageSearchParams = Promise<{
  projectId?: string;
  modelFamily?: string;
  status?: string;
  readiness?: string;
  q?: string;
}>;

type ModelsPageFilters = {
  projectId: string | null;
  modelFamily: string | null;
  status: string | null;
  readiness: string | null;
  q: string | null;
};

/**
 * A status-tab href that carries the filters already in effect.
 *
 * Each tab used to rebuild its href from scratch (`/models?status=approved`), so
 * a planner who arrived from a project board on `/models?projectId=…` and then
 * picked a status silently widened from one project back to the whole workspace
 * — every other filter dropped with it — while the page went on looking like a
 * narrowed view. Choosing a status is a request to narrow; it must never widen
 * behind the reader's back. Widening stays deliberate: that is "Clear filters".
 */
function modelsTabHref(filters: ModelsPageFilters, status: string | null): string {
  const params = new URLSearchParams();
  if (filters.projectId) params.set("projectId", filters.projectId);
  if (filters.modelFamily) params.set("modelFamily", filters.modelFamily);
  if (filters.readiness) params.set("readiness", filters.readiness);
  if (filters.q) params.set("q", filters.q);
  if (status) params.set("status", status);
  const query = params.toString();
  return query ? `/models?${query}` : "/models";
}

type ModelRow = {
  id: string;
  workspace_id: string;
  project_id: string | null;
  scenario_set_id: string | null;
  title: string;
  model_family: string;
  status: string;
  config_version: string | null;
  owner_label: string | null;
  horizon_label: string | null;
  assumptions_summary: string | null;
  input_summary: string | null;
  output_summary: string | null;
  summary: string | null;
  last_validated_at: string | null;
  last_run_recorded_at: string | null;
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
  scenario_sets:
    | {
        id: string;
        title: string;
      }
    | Array<{
        id: string;
        title: string;
      }>
    | null;
};

type ModelLinkRow = {
  model_id: string;
  link_type: string;
  linked_id: string;
};

type ScenarioSpineCountRow = {
  scenario_set_id: string;
};

function incrementCount(map: Map<string, number>, key: string) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

export default async function ModelsPage({
  searchParams,
}: {
  searchParams: ModelsPageSearchParams;
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
        moduleLabel="Models"
        title="Models need a workspace"
        description="Models belong to a workspace, and this account is not in one yet. Join or create a workspace to see them."
      />
    );
  }

  // Scoped to the active workspace — RLS grants ALL memberships, so without
  // the filter a multi-workspace member saw every workspace's models merged
  // under summary tiles claiming "the current workspace" (2026-08-03 review,
  // unscoped-list-page class). The creator pickers scope too, so a model
  // cannot be linked to another workspace's project or scenario set.
  const [{ data: modelsData }, { data: projectsData, error: projectsError }, { data: scenarioSetsData }] = await Promise.all([
    supabase
      .from("models")
      .select(
        "id, workspace_id, project_id, scenario_set_id, title, model_family, status, config_version, owner_label, horizon_label, assumptions_summary, input_summary, output_summary, summary, last_validated_at, last_run_recorded_at, created_at, updated_at, projects(id, name), scenario_sets(id, title)"
      )
      .eq("workspace_id", membership.workspace_id)
      .order("updated_at", { ascending: false }),
    supabase.from("projects").select("id, name").eq("workspace_id", membership.workspace_id).order("updated_at", { ascending: false }),
    supabase.from("scenario_sets").select("id, title").eq("workspace_id", membership.workspace_id).order("updated_at", { ascending: false }),
  ]);

  const modelIds = ((modelsData ?? []) as ModelRow[]).map((model) => model.id);
  const scenarioSetIds = Array.from(
    new Set(
      ((modelsData ?? []) as ModelRow[])
        .map((model) => model.scenario_set_id)
        .filter((value): value is string => Boolean(value))
    )
  );

  const [scenarioAssumptionSetsResult, scenarioDataPackagesResult, scenarioIndicatorSnapshotsResult] =
    scenarioSetIds.length
      ? await Promise.all([
          supabase
            .from("scenario_assumption_sets")
            .select("scenario_set_id")
            .in("scenario_set_id", scenarioSetIds),
          supabase
            .from("scenario_data_packages")
            .select("scenario_set_id")
            .in("scenario_set_id", scenarioSetIds),
          supabase
            .from("scenario_indicator_snapshots")
            .select("scenario_set_id")
            .in("scenario_set_id", scenarioSetIds),
        ])
      : [
          { data: [], error: null },
          { data: [], error: null },
          { data: [], error: null },
        ];

  const scenarioSpineSchemaPending = [
    scenarioAssumptionSetsResult.error,
    scenarioDataPackagesResult.error,
    scenarioIndicatorSnapshotsResult.error,
  ].some((error) => looksLikePendingScenarioSpineSchema(error?.message));

  const scenarioAssumptionCounts = new Map<string, number>();
  const scenarioDataPackageCounts = new Map<string, number>();
  const scenarioIndicatorSnapshotCounts = new Map<string, number>();

  if (!scenarioSpineSchemaPending) {
    for (const row of (scenarioAssumptionSetsResult.data ?? []) as ScenarioSpineCountRow[]) {
      incrementCount(scenarioAssumptionCounts, row.scenario_set_id);
    }
    for (const row of (scenarioDataPackagesResult.data ?? []) as ScenarioSpineCountRow[]) {
      incrementCount(scenarioDataPackageCounts, row.scenario_set_id);
    }
    for (const row of (scenarioIndicatorSnapshotsResult.data ?? []) as ScenarioSpineCountRow[]) {
      incrementCount(scenarioIndicatorSnapshotCounts, row.scenario_set_id);
    }
  }

  let modelLinksData: ModelLinkRow[] = [];
  if (modelIds.length) {
    const { data } = await supabase.from("model_links").select("model_id, link_type, linked_id").in("model_id", modelIds);
    modelLinksData = (data ?? []) as ModelLinkRow[];
  }

  const linksByModel = new Map<string, ModelLinkRow[]>();
  for (const link of modelLinksData) {
    const current = linksByModel.get(link.model_id) ?? [];
    current.push(link);
    linksByModel.set(link.model_id, current);
  }

  const normalizedQuery = filters.q?.trim().toLowerCase() ?? "";

  const activeFilters: ModelsPageFilters = {
    projectId: filters.projectId?.trim() || null,
    modelFamily: filters.modelFamily?.trim() || null,
    status: filters.status?.trim() || null,
    readiness: filters.readiness?.trim() || null,
    q: filters.q?.trim() || null,
  };

  const modelsInScope = ((modelsData ?? []) as ModelRow[])
    .map((model) => {
      const project = Array.isArray(model.projects) ? model.projects[0] ?? null : model.projects ?? null;
      const scenarioSet = Array.isArray(model.scenario_sets) ? model.scenario_sets[0] ?? null : model.scenario_sets ?? null;
      const links = linksByModel.get(model.id) ?? [];
      const workspaceSummary = buildModelWorkspaceSummary({
        modelStatus: model.status,
        projectId: model.project_id,
        scenarioSetId: model.scenario_set_id,
        configVersion: model.config_version,
        ownerLabel: model.owner_label,
        assumptionsSummary: model.assumptions_summary,
        inputSummary: model.input_summary,
        outputSummary: model.output_summary,
        lastValidatedAt: model.last_validated_at,
        lastRunRecordedAt: model.last_run_recorded_at,
        links,
      });

      return {
        ...model,
        project,
        scenarioSet,
        scenarioSpine: model.scenario_set_id
          ? {
              schemaPending: scenarioSpineSchemaPending,
              assumptionSetCount: scenarioAssumptionCounts.get(model.scenario_set_id) ?? 0,
              dataPackageCount: scenarioDataPackageCounts.get(model.scenario_set_id) ?? 0,
              indicatorSnapshotCount: scenarioIndicatorSnapshotCounts.get(model.scenario_set_id) ?? 0,
            }
          : null,
        ...workspaceSummary,
      };
    })
    .filter((model) => (activeFilters.projectId ? model.project_id === activeFilters.projectId : true))
    .filter((model) => (activeFilters.modelFamily ? model.model_family === activeFilters.modelFamily : true))
    .filter((model) => {
      if (activeFilters.readiness === "ready") return model.readiness.ready;
      if (activeFilters.readiness === "gaps") return !model.readiness.ready;
      return true;
    })
    .filter((model) => {
      if (!normalizedQuery) return true;

      const searchableText = [
        model.title,
        model.summary,
        model.owner_label,
        model.config_version,
        model.project?.name,
        model.scenarioSet?.title,
        model.readiness.reason,
        model.workflow.label,
      ]
        .filter((value): value is string => Boolean(value))
        .join(" ")
        .toLowerCase();

      return searchableText.includes(normalizedQuery);
    });

  // The status tabs count within every OTHER active filter but before the status
  // one. Counting the fully filtered list made each unselected tab read "(0)"
  // the moment a status was chosen — a count of records the page had already
  // discarded, presented as a count of records that do not exist.
  const models = modelsInScope.filter((model) =>
    activeFilters.status ? model.status === activeFilters.status : true
  );

  const reviewReadyCount = models.filter((model) => model.status === "ready_for_review" || model.status === "approved").length;
  const readinessGreenCount = models.filter((model) => model.readiness.ready).length;
  const traceableCount = models.filter((model) => model.linkageCounts.reports > 0 || model.linkageCounts.runs > 0).length;
  const hasActiveFilters = Boolean(
    activeFilters.projectId || activeFilters.modelFamily || activeFilters.status || activeFilters.readiness || normalizedQuery
  );

  // The project is named from the list this page already reads for the creator
  // panel rather than a second query. A name is a courtesy that list may not be
  // able to supply; the id is the filter, and is disclosed instead when the name
  // is missing, so the reader can still tell WHICH project is in scope.
  const projectFilterName = activeFilters.projectId
    ? ((projectsData ?? []) as Array<{ id: string; name: string | null }>)
        .find((project) => project.id === activeFilters.projectId)
        ?.name?.trim() || null
    : null;

  // Named in the reader's terms so the empty state can say what it is filtered
  // TO, not merely that it is filtered.
  const activeFilterLabels = [
    activeFilters.projectId ? `project ${projectFilterName ?? activeFilters.projectId}` : null,
    activeFilters.modelFamily ? `family ${formatModelFamilyLabel(activeFilters.modelFamily)}` : null,
    activeFilters.status ? `status ${formatModelStatusLabel(activeFilters.status)}` : null,
    activeFilters.readiness === "ready"
      ? "readiness Ready"
      : activeFilters.readiness === "gaps"
        ? "readiness Has gaps"
        : null,
    activeFilters.q ? `search “${activeFilters.q}”` : null,
  ].filter((label): label is string => Boolean(label));

  // `?readiness=` is the one filter whose value can be present and unrecognized
  // (only "ready" and "gaps" narrow anything), so the label list can be empty
  // while `hasActiveFilters` is true. Naming nothing there would have rendered
  // "This catalog is filtered to ." — so the sentence falls back to saying only
  // what it can stand behind: that a filter is in effect.
  const filteredEmptyDescription =
    activeFilterLabels.length > 0
      ? `This catalog is filtered to ${activeFilterLabels.join(", ")}. Clear the filters to see every model in this workspace — an empty filtered list is not a statement that none exist.`
      : "This catalog is filtered by the query string it was opened with. Clear the filters to see every model in this workspace — an empty filtered list is not a statement that none exist.";

  return (
    <section className="module-page">
      <header className="module-header-grid">
        <article className="module-intro-card">
          <div className="module-intro-kicker">
            <Database className="h-3.5 w-3.5" />
            Models module live
          </div>
          <div className="module-intro-body">
            <h1 className="module-intro-title">Models</h1>
            <p className="module-intro-description">
              Keep methods, assumptions, and results connected to the plans and projects they support.
            </p>
            {activeFilters.projectId ? (
              // Every tile and every row below belongs to one project, so the
              // scope has to be stated where the reader cannot miss it and be
              // reversible in one click. Without this the totals read as the
              // workspace's.
              <p className="module-intro-description">
                Showing only models for {projectFilterName ?? `the project with id ${activeFilters.projectId}`}.{" "}
                <Link href="/models" className="underline underline-offset-2 hover:text-foreground">
                  Show every model in this workspace
                </Link>
                .
              </p>
            ) : null}
            {activeFilters.projectId && !projectFilterName ? (
              // Why the project could not be named. A failed read and a project
              // this workspace does not have produce the same empty catalog, and
              // only one of them is a statement about the project.
              <p className="module-intro-description">
                {projectsError
                  ? "This workspace's project list could not be read, so the filter above is named by id. An empty catalog below would not mean that project has no models."
                  : "No project with that id appears in this workspace's project list, so this filter may match nothing."}
              </p>
            ) : null}
          </div>

          <div className="module-summary-grid cols-3">
            <div className="module-summary-card">
              <p className="module-summary-label">Models</p>
              <p className="module-summary-value">{models.length}</p>
              <p className="module-summary-detail">
                {hasActiveFilters ? "Matching the current filters." : "Managed model records in the current workspace."}
              </p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Ready for review</p>
              <p className="module-summary-value">{reviewReadyCount}</p>
              <p className="module-summary-detail">Records that reached review or approval posture.</p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Linked results</p>
              <p className="module-summary-value">{traceableCount}</p>
              <p className="module-summary-detail">{readinessGreenCount} currently pass every readiness check.</p>
            </div>
          </div>
        </article>

        <article className="module-operator-card">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-[0.5rem] border border-white/10 bg-white/[0.05]">
              <ShieldCheck className="h-5 w-5 text-emerald-200" />
            </span>
            <div>
              <p className="module-operator-eyebrow">Modeling</p>
              <h2 className="module-operator-title">Keep methods and results easy to review</h2>
            </div>
          </div>
          <p className="module-operator-copy">
            Use this page to keep model descriptions, assumptions, related scenarios, and results organized for planning review.
          </p>
          <div className="module-operator-list">
            <div className="module-operator-item">Link each model to the project or scenario it supports.</div>
            <div className="module-operator-item">Keep related datasets, reports, and results connected in one place.</div>
            <div className="module-operator-item">Use filters to see which models are ready to review and which still need work.</div>
          </div>
          <Link
            href="/county-runs"
            className="module-operator-inline-link mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-200 hover:text-emerald-100"
          >
            Stage a county-level onramp run
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </article>
      </header>

      <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <ModelCreator projects={projectsData ?? []} scenarioSets={scenarioSetsData ?? []} />

        <article className="module-section-surface">
          <div className="module-section-header">
            <div className="module-section-heading">
              <p className="module-section-label">Catalog</p>
              <h2 className="module-section-title">Managed model records</h2>
              <p className="module-section-description">
                Filter by readiness, status, project, or model family to isolate the records that actually need attention.
              </p>
            </div>
            <span className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-background/80 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              <FolderKanban className="h-3.5 w-3.5" />
              {models.length} total
            </span>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-1.5 border-b border-border/60 pb-3 text-[0.78rem]">
            <Link href={modelsTabHref(activeFilters, null)} className={cn("rounded px-2 py-0.5 transition-colors", !activeFilters.status ? "bg-emerald-500/10 font-semibold text-emerald-700 dark:text-emerald-300" : "text-muted-foreground hover:text-foreground")}>
              All ({modelsInScope.length})
            </Link>
            {MODEL_STATUS_OPTIONS.map((opt) => (
              <Link key={opt.value} href={modelsTabHref(activeFilters, opt.value)} className={cn("rounded px-2 py-0.5 transition-colors", activeFilters.status === opt.value ? "bg-emerald-500/10 font-semibold text-emerald-700 dark:text-emerald-300" : "text-muted-foreground hover:text-foreground")}>
                {opt.label} ({modelsInScope.filter((m) => m.status === opt.value).length})
              </Link>
            ))}
            {hasActiveFilters ? (
              // The one deliberate way to widen. Every tab above narrows within
              // the scope the page was opened for; only this leaves it.
              <Link href="/models" className="ml-auto rounded px-2 py-0.5 text-muted-foreground/70 hover:text-foreground">
                Clear filters ×
              </Link>
            ) : null}
          </div>

          {models.length === 0 ? (
            <div className="mt-5">
              <EmptyState
                title={hasActiveFilters ? "No models match these filters" : "No models yet"}
                description={
                  hasActiveFilters
                    ? filteredEmptyDescription
                    : "Create the first model record to track versions, readiness, and how each model connects to scenarios, datasets, reports, and linked plans."
                }
              />
            </div>
          ) : (
            <div className="mt-5 module-record-list">
              {models.map((model) => (
                <CartographicSelectionLink
                  key={model.id}
                  href={`/models/${model.id}`}
                  className="module-record-row is-interactive group block"
                  selection={{
                    kind: "run",
                    title: model.title,
                    kicker: `${formatModelFamilyLabel(model.model_family)} · ${formatModelStatusLabel(model.status)}`,
                    avatarChar: model.title[0],
                    meta: model.readiness.missingCheckLabels.length > 0
                      ? [{ label: "gaps", value: String(model.readiness.missingCheckLabels.length), tone: "warn" as const }]
                      : [{ label: "status", value: "ready", tone: "ok" as const }],
                  }}
                >
                  <div className="module-record-head">
                    <div className="module-record-main">
                      <div className="module-record-kicker">
                        <StatusBadge tone={modelStatusTone(model.status)}>{formatModelStatusLabel(model.status)}</StatusBadge>
                        <StatusBadge tone="info">{formatModelFamilyLabel(model.model_family)}</StatusBadge>
                      </div>

                      <div className="space-y-1.5">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <h3 className="module-record-title text-[1.05rem] transition group-hover:text-primary">{model.title}</h3>
                          <p className="module-record-stamp">Updated {formatModelDateTime(model.updated_at)}</p>
                        </div>
                        <p className="module-record-summary line-clamp-2">
                          {model.summary || "No summary yet. Open the record to define assumptions, input basis, and output traceability."}
                        </p>
                      </div>
                    </div>

                    <ArrowRight className="mt-0.5 h-4.5 w-4.5 text-muted-foreground transition group-hover:text-primary" />
                  </div>

                  <p className="mt-1.5 text-[0.73rem] text-muted-foreground">
                    {model.project?.name ?? "No project"} · {model.config_version ? `Config ${model.config_version}` : "Config pending"} · {model.readiness.ready ? "Ready" : `${model.readiness.missingCheckCount} gap${model.readiness.missingCheckCount === 1 ? "" : "s"}`} · {model.linkageCounts.reports} reports · {model.linkageCounts.runs} runs
                  </p>
                  {model.readiness.missingCheckLabels.length > 0 ? (
                    <p className="mt-1 text-[0.72rem] text-amber-700 dark:text-amber-300">Missing: {model.readiness.missingCheckLabels.join(", ")}.</p>
                  ) : null}
                </CartographicSelectionLink>
              ))}
            </div>
          )}
        </article>
      </div>

      <NetworkPackagesPanel workspaceId={membership.workspace_id} />
    </section>
  );
}
