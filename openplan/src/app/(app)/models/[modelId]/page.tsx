import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Database, FileStack, FolderKanban, ShieldCheck } from "lucide-react";
import { ModelDetailControls } from "@/components/models/model-detail-controls";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/state-block";
import { createClient } from "@/lib/supabase/server";
import {
  buildModelReadiness,
  buildModelWorkflowSummary,
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

  const [projectsResult, scenarioOptionsResult, primaryProjectResult, primaryScenarioResult, plansResult, reportsResult, datasetsResult, runsResult, linksResult] =
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
      supabase.from("data_datasets").select("id, name, status, vintage_label, geometry_scope, updated_at").eq("workspace_id", model.workspace_id).order("updated_at", { ascending: false }),
      supabase.from("runs").select("id, title, created_at").eq("workspace_id", model.workspace_id).order("created_at", { ascending: false }).limit(60),
      supabase.from("model_links").select("id, model_id, link_type, linked_id, label").eq("model_id", model.id),
    ]);

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

  const linkedScenarioCount = (linkedScenariosResult.data?.length ?? 0) + (model.scenario_set_id ? 1 : 0);
  const linkedDatasetCount = linkedDatasetsResult.data?.length ?? 0;
  const linkedReportCount = linkedReportsResult.data?.length ?? 0;
  const linkedRunCount = linkedRunsResult.data?.length ?? 0;
  const readiness = buildModelReadiness({
    hasProject: Boolean(model.project_id),
    hasScenario: linkedScenarioCount > 0,
    configVersion: model.config_version,
    ownerLabel: model.owner_label,
    assumptionsSummary: model.assumptions_summary,
    inputDatasetCount: linkedDatasetCount,
    inputSummary: model.input_summary,
    outputReportCount: linkedReportCount,
    outputRunCount: linkedRunCount,
    outputSummary: model.output_summary,
    lastValidatedAt: model.last_validated_at,
  });
  const workflow = buildModelWorkflowSummary({
    modelStatus: model.status,
    readiness,
    linkedScenarioCount,
    linkedDatasetCount,
    linkedRunCount,
    linkedReportCount,
    lastRunRecordedAt: model.last_run_recorded_at,
  });

  return (
    <section className="module-page">
      <div className="module-page-backdrop" />

      <div className="space-y-6">
        <Link href="/models" className="inline-flex items-center gap-2 text-sm text-muted-foreground transition hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
          Back to Models
        </Link>

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
                  "No summary yet. Use this record to define config versioning, provenance, and downstream output traceability."}
              </p>
            </div>

            <div className="module-summary-grid cols-4">
              <div className="module-summary-card">
                <p className="module-summary-label">Checks passed</p>
                <p className="module-summary-value">
                  {readiness.readyCheckCount}/{readiness.totalCheckCount}
                </p>
                <p className="module-summary-detail">{readiness.reason}</p>
              </div>
              <div className="module-summary-card">
                <p className="module-summary-label">Datasets</p>
                <p className="module-summary-value">{linkedDatasetCount}</p>
                <p className="module-summary-detail">Linked Data Hub provenance records.</p>
              </div>
              <div className="module-summary-card">
                <p className="module-summary-label">Runs</p>
                <p className="module-summary-value">{linkedRunCount}</p>
                <p className="module-summary-detail">Recorded run references tied to this model.</p>
              </div>
              <div className="module-summary-card">
                <p className="module-summary-label">Reports</p>
                <p className="module-summary-value">{linkedReportCount}</p>
                <p className="module-summary-detail">Linked report outputs carrying this model forward.</p>
              </div>
            </div>
          </article>

          <article className="module-operator-card">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.05]">
                <ShieldCheck className="h-5 w-5 text-emerald-200" />
              </span>
              <div>
                <p className="module-operator-eyebrow">Workflow summary</p>
                <h2 className="module-operator-title">{workflow.label}</h2>
              </div>
            </div>
            <p className="module-operator-copy">{workflow.reason}</p>
            <div className="module-operator-list">
              <div className="module-operator-item">{workflow.packageLabel}: {workflow.packageDetail}</div>
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

              <div className="mt-5 grid gap-4 md:grid-cols-2">
                <div className="rounded-[22px] border border-border/70 bg-background/70 p-4">
                  <p className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Primary project</p>
                  {primaryProjectResult.data ? (
                    <div className="mt-2 space-y-2">
                      <Link href={`/projects/${primaryProjectResult.data.id}`} className="text-base font-semibold text-foreground hover:text-primary">
                        {primaryProjectResult.data.name}
                      </Link>
                      <p className="text-sm text-muted-foreground">
                        {primaryProjectResult.data.status || "Status pending"}
                        {primaryProjectResult.data.delivery_phase ? ` · ${primaryProjectResult.data.delivery_phase}` : ""}
                      </p>
                    </div>
                  ) : (
                    <p className="mt-2 text-sm text-muted-foreground">No primary project attached yet.</p>
                  )}
                </div>

                <div className="rounded-[22px] border border-border/70 bg-background/70 p-4">
                  <p className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Primary scenario set</p>
                  {primaryScenarioResult.data ? (
                    <div className="mt-2 space-y-2">
                      <Link href={`/scenarios/${primaryScenarioResult.data.id}`} className="text-base font-semibold text-foreground hover:text-primary">
                        {primaryScenarioResult.data.title}
                      </Link>
                      <p className="text-sm text-muted-foreground">{primaryScenarioResult.data.planning_question || primaryScenarioResult.data.summary || "No planning question captured yet."}</p>
                    </div>
                  ) : (
                    <p className="mt-2 text-sm text-muted-foreground">No primary scenario set attached yet.</p>
                  )}
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
                  <div key={check.key} className="rounded-[20px] border border-border/70 bg-background/70 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-foreground">{check.label}</p>
                      <StatusBadge tone={check.ready ? "success" : "warning"}>{check.ready ? "Ready" : "Missing"}</StatusBadge>
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">{check.detail}</p>
                  </div>
                ))}
              </div>
            </article>

            <article className="module-section-surface">
              <div className="module-section-header">
                <div className="module-section-heading">
                  <p className="module-section-label">Linked records</p>
                  <h2 className="module-section-title">Explicit provenance and outputs</h2>
                </div>
                <span className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-background/80 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  <FolderKanban className="h-3.5 w-3.5" />
                  {links.length} explicit links
                </span>
              </div>

              <div className="mt-5 space-y-5">
                {[
                  {
                    title: "Scenario links",
                    records: (linkedScenariosResult.data ?? []) as Array<{ id: string; title: string | null; status: string | null; updated_at: string | null }>,
                    hrefBase: "/scenarios",
                  },
                  {
                    title: "Plan links",
                    records: (linkedPlansResult.data ?? []) as Array<{ id: string; title: string | null; status: string | null; updated_at: string | null }>,
                    hrefBase: "/plans",
                  },
                  {
                    title: "Report links",
                    records: (linkedReportsResult.data ?? []) as Array<{ id: string; title: string | null; status: string | null; updated_at: string | null }>,
                    hrefBase: "/reports",
                  },
                  {
                    title: "Dataset links",
                    records: (linkedDatasetsResult.data ?? []) as Array<{ id: string; name: string | null; status: string | null; updated_at: string | null }>,
                    hrefBase: "/data-hub",
                  },
                  {
                    title: "Recorded run links",
                    records: (linkedRunsResult.data ?? []) as Array<{ id: string; title: string | null; created_at: string | null }>,
                    hrefBase: "/runs",
                  },
                  {
                    title: "Related projects",
                    records: (linkedProjectsResult.data ?? []) as Array<{ id: string; name: string | null; status: string | null; updated_at: string | null }>,
                    hrefBase: "/projects",
                  },
                ].map((section) => (
                  <div key={section.title} className="space-y-3">
                    <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground">{section.title}</h3>
                    {section.records.length === 0 ? (
                      <EmptyState title={`No ${section.title.toLowerCase()} yet`} description="Use the controls to attach explicit provenance or downstream records." />
                    ) : (
                      <div className="grid gap-3">
                        {section.records.map((record) => {
                          const href =
                            section.hrefBase === "/data-hub"
                              ? "/data-hub"
                              : section.hrefBase === "/runs"
                                ? null
                                : `${section.hrefBase}/${record.id}`;

                          return (
                            <div key={record.id} className="rounded-[20px] border border-border/70 bg-background/70 p-4">
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  {href ? (
                                    <Link href={href} className="text-sm font-semibold text-foreground hover:text-primary">
                                      {titleForRecord(record)}
                                    </Link>
                                  ) : (
                                    <p className="text-sm font-semibold text-foreground">{titleForRecord(record)}</p>
                                  )}
                                  <p className="mt-1 text-sm text-muted-foreground">
                                    {"status" in record && record.status ? record.status : "Recorded"} ·{" "}
                                    {formatModelDateTime(("updated_at" in record ? record.updated_at : record.created_at) ?? null)}
                                  </p>
                                </div>
                                <StatusBadge tone="info">Linked</StatusBadge>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </article>
          </div>
        </div>
      </div>
    </section>
  );
}
