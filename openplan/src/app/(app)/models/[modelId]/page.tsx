import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CartographicSurfaceWide } from "@/components/cartographic/cartographic-surface-wide";
import { ArrowLeft, Database, FileStack, ShieldCheck } from "lucide-react";
import { ModelDetailControls } from "@/components/models/model-detail-controls";
import { ModelLinkedRecordsBoard } from "@/components/models/model-linked-records";
import { ModelRunManager, type ModelRunStage, type ModelRunArtifact } from "@/components/models/model-run-manager";
import { MetaItem, MetaList } from "@/components/ui/meta-item";
import { StateBlock } from "@/components/ui/state-block";
import { StatusBadge } from "@/components/ui/status-badge";
import { NEVADA_COUNTY_SCREENING_GATE } from "@/lib/examples/nevada-county-2026-03-24";
import { extractModelLaunchTemplate, looksLikePendingSchema } from "@/lib/models/run-launch";
import { createClient } from "@/lib/supabase/server";
import { looksLikePendingScenarioSpineSchema } from "@/lib/scenarios/api";
import {
  buildModelWorkspaceSummary,
  formatModelDateTime,
  formatModelFamilyLabel,
  formatModelStatusLabel,
  modelStatusTone,
} from "@/lib/models/catalog";

type RouteParams = Promise<{ modelId: string }>;

type ModelLinkRow = {
  id: string;
  model_id: string;
  link_type: string;
  linked_id: string;
  label: string | null;
};

type LinkedRecordCard = {
  id: string;
  title: string;
  href: string | null;
  statusLabel: string;
  timestampLabel: string;
  meta: string[];
};

type ScenarioSpineRow = {
  updated_at?: string | null;
  snapshot_at?: string | null;
};

function latestTimestamp(values: Array<string | null | undefined>) {
  const timestamps = values
    .map((value) => (typeof value === "string" ? new Date(value).getTime() : Number.NaN))
    .filter((value) => Number.isFinite(value));

  if (timestamps.length === 0) {
    return null;
  }

  return new Date(Math.max(...timestamps)).toISOString();
}

function titleForRecord(record: { title?: string | null; name?: string | null }) {
  return record.title ?? record.name ?? "Untitled";
}

export default async function ModelDetailPage({ params }: { params: RouteParams }) {
  const { modelId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/sign-in");
  }

  const { data: model } = await supabase
    .from("models")
    .select(
      "id, workspace_id, project_id, scenario_set_id, title, model_family, status, config_version, owner_label, horizon_label, assumptions_summary, input_summary, output_summary, summary, config_json, last_validated_at, last_run_recorded_at, created_at, updated_at"
    )
    .eq("id", modelId)
    .maybeSingle();

  if (!model) {
    notFound();
  }

  const [projectsResult, scenarioOptionsResult, primaryProjectResult, primaryScenarioResult, plansResult, reportsResult, datasetsResult, runsResult, linksResult, scenarioEntriesResult, modelRunsResult, scenarioAssumptionSetsResult, scenarioDataPackagesResult, scenarioIndicatorSnapshotsResult] =
    await Promise.all([
      supabase.from("projects").select("id, name").eq("workspace_id", model.workspace_id).order("updated_at", { ascending: false }),
      supabase.from("scenario_sets").select("id, title").eq("workspace_id", model.workspace_id).order("updated_at", { ascending: false }),
      model.project_id
        ? supabase.from("projects").select("id, name, status, delivery_phase, summary, updated_at").eq("id", model.project_id).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      model.scenario_set_id
        ? supabase
            .from("scenario_sets")
            .select("id, title, status, summary, planning_question, updated_at")
            .eq("id", model.scenario_set_id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      supabase.from("plans").select("id, title").eq("workspace_id", model.workspace_id).order("updated_at", { ascending: false }),
      supabase.from("reports").select("id, title").eq("workspace_id", model.workspace_id).order("updated_at", { ascending: false }),
      supabase
        .from("data_datasets")
        .select("id, name, status, vintage_label, geometry_scope, updated_at")
        .eq("workspace_id", model.workspace_id)
        .order("updated_at", { ascending: false }),
      supabase.from("runs").select("id, title, created_at").eq("workspace_id", model.workspace_id).order("created_at", { ascending: false }).limit(60),
      supabase.from("model_links").select("id, model_id, link_type, linked_id, label").eq("model_id", model.id),
      model.scenario_set_id
        ? supabase
            .from("scenario_entries")
            .select("id, label, entry_type, status, assumptions_json, sort_order, created_at")
            .eq("scenario_set_id", model.scenario_set_id)
            .order("sort_order", { ascending: true })
            .order("created_at", { ascending: true })
        : Promise.resolve({ data: [], error: null }),
      supabase
        .from("model_runs")
        .select(
          "id, model_id, scenario_entry_id, source_analysis_run_id, engine_key, status, run_title, result_summary_json, error_message, started_at, completed_at, created_at, stages:model_run_stages(id, stage_name, status, started_at, completed_at, error_message, log_tail), artifacts:model_run_artifacts(id, artifact_type, file_url, file_size_bytes)"
        )
        .eq("model_id", model.id)
        .order("created_at", { ascending: false })
        .limit(12),
      model.scenario_set_id
        ? supabase
            .from("scenario_assumption_sets")
            .select("updated_at")
            .eq("scenario_set_id", model.scenario_set_id)
        : Promise.resolve({ data: [], error: null }),
      model.scenario_set_id
        ? supabase
            .from("scenario_data_packages")
            .select("updated_at")
            .eq("scenario_set_id", model.scenario_set_id)
        : Promise.resolve({ data: [], error: null }),
      model.scenario_set_id
        ? supabase
            .from("scenario_indicator_snapshots")
            .select("snapshot_at")
            .eq("scenario_set_id", model.scenario_set_id)
        : Promise.resolve({ data: [], error: null }),
    ]);

  const { data: workspaceCountyRuns } = await supabase
    .from("county_runs")
    .select("stage, status_label")
    .eq("workspace_id", model.workspace_id);

  const countyRunRows = (workspaceCountyRuns ?? []) as Array<{
    stage: string | null;
    status_label: string | null;
  }>;
  const hasWorkspacePassingCountyRun = countyRunRows.some(
    (row) =>
      row.stage === "validated-screening" &&
      row.status_label !== null &&
      row.status_label.trim() !== "" &&
      row.status_label !== NEVADA_COUNTY_SCREENING_GATE.statusLabel
  );

  const links = (linksResult.data ?? []) as ModelLinkRow[];
  const scenarioLinkIds = links.filter((link) => link.link_type === "scenario_set").map((link) => link.linked_id);
  const planLinkIds = links.filter((link) => link.link_type === "plan").map((link) => link.linked_id);
  const reportLinkIds = links.filter((link) => link.link_type === "report").map((link) => link.linked_id);
  const datasetLinkIds = links.filter((link) => link.link_type === "data_dataset").map((link) => link.linked_id);
  const runLinkIds = links.filter((link) => link.link_type === "run").map((link) => link.linked_id);
  const projectLinkIds = links.filter((link) => link.link_type === "project_record").map((link) => link.linked_id);

  const [linkedScenariosResult, linkedPlansResult, linkedReportsResult, linkedDatasetsResult, linkedRunsResult, linkedProjectsResult] =
    await Promise.all([
      scenarioLinkIds.length
        ? supabase
            .from("scenario_sets")
            .select("id, title, status, summary, planning_question, updated_at")
            .in("id", scenarioLinkIds)
        : Promise.resolve({ data: [], error: null }),
      planLinkIds.length
        ? supabase.from("plans").select("id, title, plan_type, status, updated_at").in("id", planLinkIds)
        : Promise.resolve({ data: [], error: null }),
      reportLinkIds.length
        ? supabase.from("reports").select("id, title, report_type, status, generated_at, updated_at").in("id", reportLinkIds)
        : Promise.resolve({ data: [], error: null }),
      datasetLinkIds.length
        ? supabase
            .from("data_datasets")
            .select("id, name, status, vintage_label, geometry_scope, updated_at")
            .in("id", datasetLinkIds)
        : Promise.resolve({ data: [], error: null }),
      runLinkIds.length ? supabase.from("runs").select("id, title, created_at").in("id", runLinkIds) : Promise.resolve({ data: [], error: null }),
      projectLinkIds.length
        ? supabase.from("projects").select("id, name, status, delivery_phase, updated_at").in("id", projectLinkIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

  const { readiness, workflow, linkageCounts } = buildModelWorkspaceSummary({
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

  const linkedRecordSections: Array<{ title: string; count: number; records: LinkedRecordCard[]; emptyCopy: string }> = [
    {
      title: "Scenario links",
      count: linkedScenariosResult.data?.length ?? 0,
      emptyCopy: "Use the Links tab to attach additional scenario variants or parallel scenario sets.",
      records: ((linkedScenariosResult.data ?? []) as Array<{
        id: string;
        title: string | null;
        status: string | null;
        planning_question: string | null;
        updated_at: string | null;
      }>).map((record) => ({
        id: record.id,
        title: titleForRecord(record),
        href: `/scenarios/${record.id}`,
        statusLabel: record.status || "Scenario record",
        timestampLabel: formatModelDateTime(record.updated_at),
        meta: record.planning_question ? [record.planning_question] : [],
      })),
    },
    {
      title: "Plan links",
      count: linkedPlansResult.data?.length ?? 0,
      emptyCopy: "Attach plans when the model supports a specific planning package or corridor strategy.",
      records: ((linkedPlansResult.data ?? []) as Array<{
        id: string;
        title: string | null;
        status: string | null;
        plan_type: string | null;
        updated_at: string | null;
      }>).map((record) => ({
        id: record.id,
        title: titleForRecord(record),
        href: `/plans/${record.id}`,
        statusLabel: record.status || "Plan record",
        timestampLabel: formatModelDateTime(record.updated_at),
        meta: record.plan_type ? [record.plan_type] : [],
      })),
    },
    {
      title: "Report links",
      count: linkedReportsResult.data?.length ?? 0,
      emptyCopy: "Attach reports when outputs have been cited or published downstream.",
      records: ((linkedReportsResult.data ?? []) as Array<{
        id: string;
        title: string | null;
        status: string | null;
        report_type: string | null;
        generated_at: string | null;
        updated_at: string | null;
      }>).map((record) => ({
        id: record.id,
        title: titleForRecord(record),
        href: `/reports/${record.id}`,
        statusLabel: record.status || "Report record",
        timestampLabel: formatModelDateTime(record.generated_at ?? record.updated_at),
        meta: record.report_type ? [record.report_type] : [],
      })),
    },
    {
      title: "Dataset links",
      count: linkedDatasetsResult.data?.length ?? 0,
      emptyCopy: "Attach datasets to make the model input basis traceable from Data Hub forward.",
      records: ((linkedDatasetsResult.data ?? []) as Array<{
        id: string;
        name: string | null;
        status: string | null;
        vintage_label: string | null;
        geometry_scope: string | null;
        updated_at: string | null;
      }>).map((record) => ({
        id: record.id,
        title: titleForRecord(record),
        href: "/data-hub",
        statusLabel: record.status || "Dataset record",
        timestampLabel: formatModelDateTime(record.updated_at),
        meta: [record.vintage_label, record.geometry_scope].filter((value): value is string => Boolean(value)),
      })),
    },
    {
      title: "Recorded runs",
      count: linkedRunsResult.data?.length ?? 0,
      emptyCopy: "Attach run records when execution evidence exists and should remain auditable.",
      records: ((linkedRunsResult.data ?? []) as Array<{
        id: string;
        title: string | null;
        created_at: string | null;
      }>).map((record) => ({
        id: record.id,
        title: titleForRecord(record),
        href: null,
        statusLabel: "Recorded run",
        timestampLabel: formatModelDateTime(record.created_at),
        meta: [],
      })),
    },
    {
      title: "Related projects",
      count: linkedProjectsResult.data?.length ?? 0,
      emptyCopy: "Attach adjacent projects when the model informs work outside the primary anchor.",
      records: ((linkedProjectsResult.data ?? []) as Array<{
        id: string;
        name: string | null;
        status: string | null;
        delivery_phase: string | null;
        updated_at: string | null;
      }>).map((record) => ({
        id: record.id,
        title: titleForRecord(record),
        href: `/projects/${record.id}`,
        statusLabel: record.status || "Project record",
        timestampLabel: formatModelDateTime(record.updated_at),
        meta: record.delivery_phase ? [record.delivery_phase] : [],
      })),
    },
  ];

  const scenarioSpineSchemaPending = [
    scenarioAssumptionSetsResult.error,
    scenarioDataPackagesResult.error,
    scenarioIndicatorSnapshotsResult.error,
  ].some((error) => looksLikePendingScenarioSpineSchema(error?.message));

  const primaryScenarioSpine = model.scenario_set_id
    ? {
        schemaPending: scenarioSpineSchemaPending,
        assumptionSetCount: scenarioSpineSchemaPending
          ? 0
          : ((scenarioAssumptionSetsResult.data ?? []) as ScenarioSpineRow[]).length,
        dataPackageCount: scenarioSpineSchemaPending
          ? 0
          : ((scenarioDataPackagesResult.data ?? []) as ScenarioSpineRow[]).length,
        indicatorSnapshotCount: scenarioSpineSchemaPending
          ? 0
          : ((scenarioIndicatorSnapshotsResult.data ?? []) as ScenarioSpineRow[]).length,
        latestIndicatorSnapshotAt: scenarioSpineSchemaPending
          ? null
          : latestTimestamp(
              ((scenarioIndicatorSnapshotsResult.data ?? []) as ScenarioSpineRow[]).map(
                (row) => row.snapshot_at ?? null
              )
            ),
      }
    : null;

  const launchTemplate = extractModelLaunchTemplate(model.config_json ?? {});
  const modelRunsSchemaPending = Boolean(modelRunsResult.error && looksLikePendingSchema(modelRunsResult.error.message));
  const modelRuns = modelRunsSchemaPending ? [] : ((modelRunsResult.data ?? []) as unknown as Array<{
    id: string;
    status: string;
    run_title: string;
    engine_key?: string;
    scenario_entry_id: string | null;
    source_analysis_run_id: string | null;
    result_summary_json: Record<string, unknown> | null;
    error_message: string | null;
    started_at: string | null;
    completed_at: string | null;
    created_at: string | null;
    stages: ModelRunStage[];
    artifacts: ModelRunArtifact[];
  }>).map((r) => ({ ...r, engine_key: r.engine_key ?? "deterministic_corridor_v1" }));
  const scenarioEntryOptions = ((scenarioEntriesResult.data ?? []) as Array<{
    id: string;
    label: string;
    entry_type: string;
    status: string;
    assumptions_json: Record<string, unknown> | null;
  }>).map((entry) => ({
    id: entry.id,
    label: entry.label,
    entryType: entry.entry_type,
    status: entry.status,
    assumptionCount: Object.keys(entry.assumptions_json ?? {}).length,
  }));
  const defaultCorridorText = launchTemplate.corridorGeojson
    ? JSON.stringify(launchTemplate.corridorGeojson, null, 2)
    : "";

  return (
    <section className="module-page relative">
      <CartographicSurfaceWide />
      <div className="module-page-backdrop" />

      <div className="space-y-6">
        <Link href="/models" className="inline-flex items-center gap-2 text-sm text-muted-foreground transition hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
          Back to Models
        </Link>

        {!hasWorkspacePassingCountyRun ? (
          <StateBlock
            tone="warning"
            title="No validated screening run on file"
            description="Modeling outputs in this workspace are prototype-only until a county-run clears the screening gate. Any numbers produced here should not be used for outward modeling claims."
            action={
              <Link
                href="/county-runs"
                className="inline-flex items-center rounded border border-border/70 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-foreground transition hover:border-primary/35 hover:text-primary"
              >
                Review county runs
              </Link>
            }
          />
        ) : null}

        <header className="module-header-grid">
          <article className="module-intro-card">
            <div className="module-intro-kicker">
              <Database className="h-3.5 w-3.5" />
              Model detail
            </div>
            <div className="module-intro-body">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge tone={modelStatusTone(model.status)}>{formatModelStatusLabel(model.status)}</StatusBadge>
                <StatusBadge tone="info">{formatModelFamilyLabel(model.model_family)}</StatusBadge>
                <StatusBadge tone={readiness.ready ? "success" : "warning"}>{readiness.label}</StatusBadge>
              </div>
              <h1 className="module-intro-title">{model.title}</h1>
              <p className="module-intro-description">
                {model.summary ||
                  "No summary yet. Use this record to document the model setup, linked inputs, and downstream outputs."}
              </p>
            </div>

            <div className="module-summary-grid cols-5">
              <div className="module-summary-card">
                <p className="module-summary-label">Checks passed</p>
                <p className="module-summary-value">
                  {readiness.readyCheckCount}/{readiness.totalCheckCount}
                </p>
                <p className="module-summary-detail">{readiness.reason}</p>
              </div>
              <div className="module-summary-card">
                <p className="module-summary-label">Linked plans</p>
                <p className="module-summary-value">{linkageCounts.plans}</p>
                <p className="module-summary-detail">Plans that already reference this model.</p>
              </div>
              <div className="module-summary-card">
                <p className="module-summary-label">Datasets</p>
                <p className="module-summary-value">{linkageCounts.datasets}</p>
                <p className="module-summary-detail">Linked Data Hub records.</p>
              </div>
              <div className="module-summary-card">
                <p className="module-summary-label">Runs</p>
                <p className="module-summary-value">{linkageCounts.runs}</p>
                <p className="module-summary-detail">Recorded run references tied to this model.</p>
              </div>
              <div className="module-summary-card">
                <p className="module-summary-label">Reports</p>
                <p className="module-summary-value">{linkageCounts.reports}</p>
                <p className="module-summary-detail">Reports that reference this model.</p>
              </div>
            </div>
          </article>

          <article className="module-operator-card">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-[0.5rem] border border-white/10 bg-white/[0.05]">
                <ShieldCheck className="h-5 w-5 text-emerald-200" />
              </span>
              <div>
                <p className="module-operator-eyebrow">Model summary</p>
                <h2 className="module-operator-title">{workflow.label}</h2>
              </div>
            </div>
            <p className="module-operator-copy">{workflow.reason}</p>
            <div className="module-operator-list">
              <div className="module-operator-item">
                {workflow.packageLabel}: {workflow.packageDetail}
              </div>
              {workflow.actionItems.length > 0 ? <div className="module-operator-item">{workflow.actionItems[0]}</div> : null}
              {workflow.reviewNotes[0] ? <div className="module-operator-item">{workflow.reviewNotes[0]}</div> : null}
            </div>
          </article>
        </header>

        <div className="grid gap-6 xl:grid-cols-[0.96fr_1.04fr]">
          <ModelDetailControls
            model={model}
            projects={(projectsResult.data ?? []) as Array<{ id: string; name: string }>}
            scenarioSets={(scenarioOptionsResult.data ?? []) as Array<{ id: string; title: string }>}
            plans={((plansResult.data ?? []) as Array<{ id: string; title: string | null }>).map((plan) => ({
              id: plan.id,
              title: plan.title ?? "Untitled plan",
            }))}
            reports={((reportsResult.data ?? []) as Array<{ id: string; title: string | null }>).map((report) => ({
              id: report.id,
              title: report.title ?? "Untitled report",
            }))}
            datasets={((datasetsResult.data ?? []) as Array<{ id: string; name: string | null }>).map((dataset) => ({
              id: dataset.id,
              title: dataset.name ?? "Untitled dataset",
            }))}
            runs={((runsResult.data ?? []) as Array<{ id: string; title: string | null }>).map((run) => ({
              id: run.id,
              title: run.title ?? "Untitled run",
            }))}
            selectedLinks={{
              scenarios: scenarioLinkIds,
              plans: planLinkIds,
              reports: reportLinkIds,
              datasets: datasetLinkIds,
              runs: runLinkIds,
              relatedProjects: projectLinkIds,
            }}
          />

          <div className="space-y-6">
            <ModelRunManager
              modelId={model.id}
              modelTitle={model.title}
              defaultQueryText={launchTemplate.queryText ?? ""}
              defaultCorridorText={defaultCorridorText}
              scenarioEntries={scenarioEntryOptions}
              modelRuns={modelRuns}
              schemaPending={modelRunsSchemaPending}
            />

            <article className="module-section-surface">
              <div className="module-section-header">
                <div className="module-section-heading">
                  <p className="module-section-label">Anchors</p>
                  <h2 className="module-section-title">Primary planning context</h2>
                  <p className="module-section-description">
                    These anchors define what decision frame the model record belongs to before any explicit cross-links are added.
                  </p>
                </div>
              </div>

              <div className="mt-5 grid gap-3 md:grid-cols-2">
                <div className="module-record-row">
                  <div className="module-record-head">
                    <div className="module-record-main">
                      <p className="module-section-label">Primary project</p>
                      {primaryProjectResult.data ? (
                        <>
                          <Link href={`/projects/${primaryProjectResult.data.id}`} className="module-record-title hover:text-primary">
                            {primaryProjectResult.data.name}
                          </Link>
                          <p className="module-record-summary">
                            {primaryProjectResult.data.summary || "Project anchor is present for this model record."}
                          </p>
                        </>
                      ) : (
                        <p className="module-record-summary">No primary project attached yet.</p>
                      )}
                    </div>
                  </div>
                  {primaryProjectResult.data ? (
                    <MetaList>
                      <MetaItem>{primaryProjectResult.data.status || "Status pending"}</MetaItem>
                      {primaryProjectResult.data.delivery_phase ? <MetaItem>{primaryProjectResult.data.delivery_phase}</MetaItem> : null}
                      <MetaItem>Updated {formatModelDateTime(primaryProjectResult.data.updated_at)}</MetaItem>
                    </MetaList>
                  ) : null}
                </div>

                <div className="module-record-row">
                  <div className="module-record-head">
                    <div className="module-record-main">
                      <p className="module-section-label">Primary scenario set</p>
                      {primaryScenarioResult.data ? (
                        <>
                          <Link href={`/scenarios/${primaryScenarioResult.data.id}`} className="module-record-title hover:text-primary">
                            {primaryScenarioResult.data.title}
                          </Link>
                          <p className="module-record-summary">
                            {primaryScenarioResult.data.planning_question || primaryScenarioResult.data.summary || "No planning question captured yet."}
                          </p>
                        </>
                      ) : (
                        <p className="module-record-summary">No primary scenario set attached yet.</p>
                      )}
                    </div>
                  </div>
                  {primaryScenarioResult.data ? (
                    <MetaList>
                      <MetaItem>{primaryScenarioResult.data.status || "Scenario record"}</MetaItem>
                      <MetaItem>Updated {formatModelDateTime(primaryScenarioResult.data.updated_at)}</MetaItem>
                      {primaryScenarioSpine ? (
                        primaryScenarioSpine.schemaPending ? (
                          <MetaItem>Scenario spine schema pending</MetaItem>
                        ) : (
                          <>
                            <MetaItem>{primaryScenarioSpine.assumptionSetCount} assumption sets</MetaItem>
                            <MetaItem>{primaryScenarioSpine.dataPackageCount} data packages</MetaItem>
                            <MetaItem>{primaryScenarioSpine.indicatorSnapshotCount} indicator snapshots</MetaItem>
                            {primaryScenarioSpine.latestIndicatorSnapshotAt ? (
                              <MetaItem>
                                Latest indicator {formatModelDateTime(primaryScenarioSpine.latestIndicatorSnapshotAt)}
                              </MetaItem>
                            ) : null}
                          </>
                        )
                      ) : null}
                    </MetaList>
                  ) : null}
                </div>
              </div>
            </article>

            <article className="module-section-surface">
              <div className="module-section-header">
                <div className="module-section-heading">
                  <p className="module-section-label">Readiness</p>
                  <h2 className="module-section-title">Configuration and traceability checks</h2>
                </div>
                <span className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-background/80 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  <FileStack className="h-3.5 w-3.5" />
                  {readiness.missingCheckCount} gaps
                </span>
              </div>

              <div className="mt-5 grid gap-3">
                {readiness.checks.map((check) => (
                  <div key={check.key} className="rounded-[0.5rem] border border-border/70 bg-background/70 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-foreground">{check.label}</p>
                      <StatusBadge tone={check.ready ? "success" : "warning"}>{check.ready ? "Ready" : "Missing"}</StatusBadge>
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">{check.detail}</p>
                  </div>
                ))}
              </div>
            </article>

            <ModelLinkedRecordsBoard sections={linkedRecordSections} totalLinkCount={links.length} />
          </div>
        </div>
      </div>
    </section>
  );
}
