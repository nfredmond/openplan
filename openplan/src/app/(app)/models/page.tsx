import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, Database, FolderKanban, ShieldCheck } from "lucide-react";
import { ModelCreator } from "@/components/models/model-creator";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/state-block";
import { WorkspaceMembershipRequired } from "@/components/workspaces/workspace-membership-required";
import { createClient } from "@/lib/supabase/server";
import {
  CURRENT_WORKSPACE_MEMBERSHIP_SELECT,
  type WorkspaceMembershipRow,
  unwrapWorkspaceRecord,
} from "@/lib/workspaces/current";
import {
  buildModelWorkspaceSummary,
  formatModelDateTime,
  formatModelFamilyLabel,
  formatModelStatusLabel,
  MODEL_FAMILY_OPTIONS,
  MODEL_STATUS_OPTIONS,
  modelStatusTone,
} from "@/lib/models/catalog";

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

  const { data: memberships } = await supabase
    .from("workspace_members")
    .select(CURRENT_WORKSPACE_MEMBERSHIP_SELECT)
    .eq("user_id", user.id)
    .limit(1);

  const membership = memberships?.[0] as WorkspaceMembershipRow | undefined;
  const workspace = unwrapWorkspaceRecord(membership?.workspaces);

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
            <h1 className="module-intro-title">Managed model records now have a real Planning OS home</h1>
            <p className="module-intro-description">
              Track versioned model configurations, scenario anchors, input provenance, and output traceability without
              pretending OpenPlan already runs full model orchestration inside the product.
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
              <p className="module-summary-label">Review-ready</p>
              <p className="module-summary-value">{reviewReadyCount}</p>
              <p className="module-summary-detail">Records that reached review or approval posture.</p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Traceable outputs</p>
              <p className="module-summary-value">{traceableCount}</p>
              <p className="module-summary-detail">{readinessGreenCount} currently pass every readiness check.</p>
            </div>
          </div>
        </article>

        <article className="module-operator-card">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.05]">
              <ShieldCheck className="h-5 w-5 text-emerald-200" />
            </span>
            <div>
              <p className="module-operator-eyebrow">Modeling posture</p>
              <h2 className="module-operator-title">Readiness is explicit, not implied</h2>
            </div>
          </div>
          <p className="module-operator-copy">
            Models v1 is deliberately metadata-first. It shows what is configured, what evidence is linked, and what is
            still missing before a run or report can be trusted downstream.
          </p>
          <div className="module-operator-list">
            <div className="module-operator-item">Primary project and scenario anchors keep the modeling record tied to planning context.</div>
            <div className="module-operator-item">Data Hub datasets, plans, reports, and recorded runs can be linked without inventing duplicate concepts.</div>
            <div className="module-operator-item">Filters expose which models are ready, which still have gaps, and which already support downstream planning records.</div>
          </div>
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

          <form className="mt-5 grid gap-3 rounded-[22px] border border-border/70 bg-background/70 p-4 md:grid-cols-2 xl:grid-cols-[1.3fr_repeat(4,minmax(0,1fr))]">
            <input
              type="search"
              name="q"
              defaultValue={filters.q ?? ""}
              placeholder="Search title, owner, version, project, or scenario"
              className="flex h-10 w-full rounded-xl border border-input bg-background px-3 text-sm outline-none md:col-span-2 xl:col-span-1"
            />

            <select
              name="projectId"
              defaultValue={filters.projectId ?? ""}
              className="flex h-10 w-full rounded-xl border border-input bg-background px-3 text-sm outline-none"
            >
              <option value="">All projects</option>
              {(projectsData ?? []).map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>

            <select
              name="modelFamily"
              defaultValue={filters.modelFamily ?? ""}
              className="flex h-10 w-full rounded-xl border border-input bg-background px-3 text-sm outline-none"
            >
              <option value="">All model families</option>
              {MODEL_FAMILY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>

            <select
              name="status"
              defaultValue={filters.status ?? ""}
              className="flex h-10 w-full rounded-xl border border-input bg-background px-3 text-sm outline-none"
            >
              <option value="">All statuses</option>
              {MODEL_STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>

            <div className="flex gap-3">
              <select
                name="readiness"
                defaultValue={filters.readiness ?? ""}
                className="flex h-10 w-full rounded-xl border border-input bg-background px-3 text-sm outline-none"
              >
                <option value="">All readiness states</option>
                <option value="ready">Ready</option>
                <option value="gaps">Has gaps</option>
              </select>
              <button
                type="submit"
                className="inline-flex h-10 shrink-0 items-center justify-center rounded-xl border border-border bg-card px-4 text-sm font-medium"
              >
                Apply
              </button>
            </div>

            {hasActiveFilters ? (
              <div className="md:col-span-2 xl:col-span-5 flex items-center justify-between gap-3 rounded-xl border border-dashed border-border/70 bg-background/80 px-3 py-2 text-sm text-muted-foreground">
                <span>Filters are narrowing the model catalog so you can focus on the records that still need operator attention.</span>
                <Link href="/models" className="font-medium text-foreground transition hover:text-primary">
                  Clear filters
                </Link>
              </div>
            ) : null}
          </form>

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
                        <StatusBadge tone={model.readiness.ready ? "success" : "warning"}>{model.readiness.label}</StatusBadge>
                        <StatusBadge tone={model.workflow.tone}>{model.workflow.label}</StatusBadge>
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

                  <div className="module-record-meta">
                    <span className="module-record-chip">Project {model.project?.name ?? "Pending"}</span>
                    <span className="module-record-chip">Scenario {model.scenarioSet?.title ?? "Pending"}</span>
                    <span className="module-record-chip">{model.config_version ? `Config ${model.config_version}` : "Config version pending"}</span>
                    <span className="module-record-chip">{model.linkageCounts.plans} plans</span>
                    <span className="module-record-chip">{model.linkageCounts.datasets} datasets</span>
                    <span className="module-record-chip">{model.linkageCounts.runs} runs</span>
                    <span className="module-record-chip">{model.linkageCounts.reports} reports</span>
                    <span className="module-record-chip">
                      {model.readiness.missingCheckCount > 0
                        ? `${model.readiness.missingCheckCount} readiness gap${model.readiness.missingCheckCount === 1 ? "" : "s"}`
                        : "No readiness gaps"}
                    </span>
                  </div>

                  {model.readiness.missingCheckLabels.length > 0 ? (
                    <p className="mt-3 text-sm text-muted-foreground">Missing basis: {model.readiness.missingCheckLabels.join(", ")}.</p>
                  ) : (
                    <p className="mt-3 text-sm text-muted-foreground">{model.workflow.reason}</p>
                  )}
                </Link>
              ))}
            </div>
          )}
        </article>
      </div>
    </section>
  );
}
