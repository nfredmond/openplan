import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, Database, FolderKanban, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
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
  MODEL_FAMILY_OPTIONS,
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
        title="Models need a provisioned workspace"
        description="Model records, scenario anchors, and downstream traceability are workspace-scoped. Without a provisioned workspace, this surface should explain the gap instead of pretending nothing exists."
      />
    );
  }

  const [{ data: modelsData }, { data: projectsData }, { data: scenarioSetsData }] = await Promise.all([
    supabase
      .from("models")
      .select(
        "id, workspace_id, project_id, scenario_set_id, title, model_family, status, config_version, owner_label, horizon_label, assumptions_summary, input_summary, output_summary, summary, last_validated_at, last_run_recorded_at, created_at, updated_at, projects(id, name), scenario_sets(id, title)"
      )
      .order("updated_at", { ascending: false }),
    supabase.from("projects").select("id, name").order("updated_at", { ascending: false }),
    supabase.from("scenario_sets").select("id, title").order("updated_at", { ascending: false }),
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

  const models = ((modelsData ?? []) as ModelRow[])
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
    .filter((model) => (filters.projectId ? model.project_id === filters.projectId : true))
    .filter((model) => (filters.modelFamily ? model.model_family === filters.modelFamily : true))
    .filter((model) => (filters.status ? model.status === filters.status : true))
    .filter((model) => {
      if (filters.readiness === "ready") return model.readiness.ready;
      if (filters.readiness === "gaps") return !model.readiness.ready;
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

  const reviewReadyCount = models.filter((model) => model.status === "ready_for_review" || model.status === "approved").length;
  const readinessGreenCount = models.filter((model) => model.readiness.ready).length;
  const traceableCount = models.filter((model) => model.linkageCounts.reports > 0 || model.linkageCounts.runs > 0).length;
  const hasActiveFilters = Boolean(filters.projectId || filters.modelFamily || filters.status || filters.readiness || normalizedQuery);

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

          <div className="mt-4 flex flex-wrap items-center gap-1.5 border-b border-slate-100 pb-3 text-[0.78rem]">
            <Link href="/models" className={cn("rounded px-2 py-0.5 transition-colors", !filters.status ? "bg-emerald-50 font-semibold text-emerald-700" : "text-slate-500 hover:text-slate-800")}>
              All ({models.length})
            </Link>
            {MODEL_STATUS_OPTIONS.map((opt) => (
              <Link key={opt.value} href={`/models?status=${opt.value}`} className={cn("rounded px-2 py-0.5 transition-colors", filters.status === opt.value ? "bg-emerald-50 font-semibold text-emerald-700" : "text-slate-500 hover:text-slate-800")}>
                {opt.label} ({models.filter((m) => m.status === opt.value).length})
              </Link>
            ))}
            {hasActiveFilters ? (
              <Link href="/models" className="ml-auto rounded px-2 py-0.5 text-slate-400 hover:text-slate-700">
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
                    ? "Adjust the catalog filters or clear them to bring records back into view."
                    : "Create the first model record to establish config versioning, readiness checks, and traceability across scenarios, datasets, reports, and linked plans."
                }
              />
            </div>
          ) : (
            <div className="mt-5 module-record-list">
              {models.map((model) => (
                <Link key={model.id} href={`/models/${model.id}`} className="module-record-row is-interactive group block">
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
                </Link>
              ))}
            </div>
          )}
        </article>
      </div>
    </section>
  );
}
