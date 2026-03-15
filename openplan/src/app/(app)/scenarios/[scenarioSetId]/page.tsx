import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowRight, GitCompareArrows, ShieldCheck } from "lucide-react";
import { ScenarioEntryComposer } from "@/components/scenarios/scenario-entry-composer";
import { ScenarioSetControls } from "@/components/scenarios/scenario-set-controls";
import { StatusBadge } from "@/components/ui/status-badge";
import { createClient } from "@/lib/supabase/server";
import { scenarioComparisonStatus, scenarioStatusTone, titleizeScenarioValue } from "@/lib/scenarios/catalog";

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
};

type ScenarioEntryRow = {
  id: string;
  scenario_set_id: string;
  entry_type: string;
  label: string;
  slug: string;
  summary: string | null;
  assumptions_json: Record<string, unknown>;
  attached_run_id: string | null;
  status: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

function fmtDateTime(value: string | null | undefined): string {
  if (!value) return "Unknown";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

export default async function ScenarioSetDetailPage({
  params,
}: {
  params: Promise<{ scenarioSetId: string }>;
}) {
  const { scenarioSetId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/sign-in");
  }

  const { data: scenarioSetData } = await supabase
    .from("scenario_sets")
    .select("id, workspace_id, project_id, title, summary, planning_question, status, baseline_entry_id, created_at, updated_at")
    .eq("id", scenarioSetId)
    .maybeSingle();

  if (!scenarioSetData) {
    notFound();
  }

  const scenarioSet = scenarioSetData as ScenarioSetRow;

  const [{ data: project }, { data: entriesData }, { data: runsData }] = await Promise.all([
    supabase
      .from("projects")
      .select("id, workspace_id, name, summary, status, plan_type, delivery_phase, updated_at")
      .eq("id", scenarioSet.project_id)
      .maybeSingle(),
    supabase
      .from("scenario_entries")
      .select(
        "id, scenario_set_id, entry_type, label, slug, summary, assumptions_json, attached_run_id, status, sort_order, created_at, updated_at"
      )
      .eq("scenario_set_id", scenarioSet.id)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true }),
    supabase
      .from("runs")
      .select("id, title, created_at")
      .eq("workspace_id", scenarioSet.workspace_id)
      .order("created_at", { ascending: false })
      .limit(30),
  ]);

  const runIds = (entriesData ?? [])
    .map((entry) => entry.attached_run_id)
    .filter((value): value is string => Boolean(value));
  const attachedRunsResult = runIds.length
    ? await supabase.from("runs").select("id, title, summary_text, created_at").in("id", runIds)
    : { data: [], error: null };

  const runMap = new Map((attachedRunsResult.data ?? []).map((run) => [run.id, run]));
  const entries = ((entriesData ?? []) as ScenarioEntryRow[]).map((entry) => ({
    ...entry,
    attachedRun: entry.attached_run_id ? runMap.get(entry.attached_run_id) ?? null : null,
  }));

  const baselineEntry =
    entries.find((entry) => entry.id === scenarioSet.baseline_entry_id) ??
    entries.find((entry) => entry.entry_type === "baseline") ??
    null;
  const alternativeEntries = entries.filter((entry) => entry.entry_type === "alternative");

  return (
    <section className="module-page">
      <div className="mb-4 flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/scenarios" className="transition hover:text-foreground">
          Scenarios
        </Link>
        <ArrowRight className="h-3.5 w-3.5" />
        <span className="text-foreground">{scenarioSet.title}</span>
      </div>

      <header className="module-header-grid">
        <article className="module-intro-card">
          <div className="module-intro-kicker">
            <GitCompareArrows className="h-3.5 w-3.5" />
            Scenario set detail
          </div>
          <div className="module-record-kicker">
            <StatusBadge tone={scenarioStatusTone(scenarioSet.status)}>{titleizeScenarioValue(scenarioSet.status)}</StatusBadge>
            <StatusBadge tone={baselineEntry ? "success" : "warning"}>
              {baselineEntry ? "Baseline registered" : "Baseline missing"}
            </StatusBadge>
            <StatusBadge tone="info">{alternativeEntries.length} alternatives</StatusBadge>
          </div>
          <div className="module-intro-body">
            <h1 className="module-intro-title">{scenarioSet.title}</h1>
            <p className="module-intro-description">
              {scenarioSet.summary ||
                "This scenario set is ready to attach a baseline, alternatives, and run-linked evidence without drifting into a separate comparison engine."}
            </p>
          </div>

          <div className="module-summary-grid cols-3">
            <div className="module-summary-card">
              <p className="module-summary-label">Project</p>
              <p className="module-summary-value text-lg">{project?.name ?? "Unknown"}</p>
              <p className="module-summary-detail">Project-linked scenario registry with durable reopening.</p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Baseline</p>
              <p className="module-summary-value text-lg">{baselineEntry?.label ?? "Not set"}</p>
              <p className="module-summary-detail">Exactly one baseline is allowed per scenario set.</p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Updated</p>
              <p className="module-summary-value text-lg">{fmtDateTime(scenarioSet.updated_at)}</p>
              <p className="module-summary-detail">Run IDs and assumptions remain visible in the detail view.</p>
            </div>
          </div>
        </article>

        <article className="module-operator-card">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.05]">
              <ShieldCheck className="h-5 w-5 text-emerald-200" />
            </span>
            <div>
              <p className="module-operator-eyebrow">Evidence posture</p>
              <h2 className="module-operator-title">Run attachment stays explicit</h2>
            </div>
          </div>
          <p className="module-operator-copy">
            Comparison readiness is a lightweight first-pass signal. This page says whether the baseline and candidate
            entries have the run attachments needed for a real comparison.
          </p>
          <div className="module-operator-list">
            <div className="module-operator-item">Missing-run means one side still lacks an attached analysis run.</div>
            <div className="module-operator-item">Assumptions stay attached to each entry, not hidden inside prose.</div>
            <div className="module-operator-item">Project linkage remains visible so this record does not float free from the planning container.</div>
          </div>
        </article>
      </header>

      <div className="grid gap-6 xl:grid-cols-[0.92fr_1.08fr]">
        <div className="space-y-6">
          <ScenarioSetControls
            scenarioSetId={scenarioSet.id}
            title={scenarioSet.title}
            summary={scenarioSet.summary}
            planningQuestion={scenarioSet.planning_question}
            status={scenarioSet.status}
          />

          <article className="module-section-surface">
            <div className="module-section-heading">
              <p className="module-section-label">Project linkage</p>
              <h2 className="module-section-title">Source planning container</h2>
              <p className="module-section-description">
                Scenario sets stay subordinate to projects so the registry does not split from the main OpenPlan record.
              </p>
            </div>

            <div className="mt-5 rounded-[22px] border border-border/70 bg-background/80 p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-2">
                  <h3 className="text-lg font-semibold tracking-tight">{project?.name ?? "Unknown project"}</h3>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {project?.summary || "No project summary yet. Use the project record to add fuller planning context."}
                  </p>
                </div>
                {project ? (
                  <Link href={`/projects/${project.id}`} className="module-record-chip transition hover:border-primary/40 hover:text-primary">
                    Open project
                  </Link>
                ) : null}
              </div>
            </div>
          </article>
        </div>

        <div className="space-y-6">
          <ScenarioEntryComposer scenarioSetId={scenarioSet.id} hasBaseline={Boolean(baselineEntry)} runs={runsData ?? []} />

          <article className="module-section-surface">
            <div className="module-section-header">
              <div className="module-section-heading">
                <p className="module-section-label">Registry</p>
                <h2 className="module-section-title">Baseline and alternatives</h2>
                <p className="module-section-description">
                  Entry cards show the minimum useful first-pass metadata: status, assumptions, run attachment, and
                  comparison readiness.
                </p>
              </div>
            </div>

            {entries.length === 0 ? (
              <div className="module-empty-state mt-5 text-sm">
                No scenario entries yet. Start by registering the baseline, then add alternatives.
              </div>
            ) : (
              <div className="mt-5 module-record-list">
                {entries.map((entry) => {
                  const comparisonState =
                    entry.entry_type === "alternative"
                      ? scenarioComparisonStatus(baselineEntry?.attached_run_id, entry.attached_run_id)
                      : null;

                  return (
                    <div key={entry.id} className="module-record-row">
                      <div className="module-record-head">
                        <div className="module-record-main">
                          <div className="module-record-kicker">
                            <StatusBadge tone={entry.entry_type === "baseline" ? "success" : "info"}>
                              {titleizeScenarioValue(entry.entry_type)}
                            </StatusBadge>
                            <StatusBadge tone={scenarioStatusTone(entry.status)}>
                              {titleizeScenarioValue(entry.status)}
                            </StatusBadge>
                            {comparisonState ? (
                              <StatusBadge tone={comparisonState === "ready" ? "success" : "warning"}>
                                {comparisonState}
                              </StatusBadge>
                            ) : null}
                          </div>

                          <div className="space-y-1.5">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <h3 className="module-record-title text-[1.05rem]">{entry.label}</h3>
                              <p className="module-record-stamp">Updated {fmtDateTime(entry.updated_at)}</p>
                            </div>
                            <p className="module-record-summary line-clamp-3">
                              {entry.summary || "No summary yet. Add one to explain why this entry matters."}
                            </p>
                          </div>
                        </div>
                      </div>

                      <div className="module-record-meta">
                        <span className="module-record-chip">
                          Run {entry.attachedRun ? entry.attachedRun.title : "Not attached"}
                        </span>
                        <span className="module-record-chip">
                          Assumptions {Object.keys(entry.assumptions_json ?? {}).length}
                        </span>
                        <span className="module-record-chip">Sort {entry.sort_order}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </article>

          <article className="module-section-surface">
            <div className="module-section-header">
              <div className="module-section-heading">
                <p className="module-section-label">Comparison summary</p>
                <h2 className="module-section-title">Baseline versus alternatives</h2>
                <p className="module-section-description">
                  This surface only reports readiness and linked evidence in pass 1. Materialized comparison products can
                  follow once the registry foundation proves stable.
                </p>
              </div>
            </div>

            {alternativeEntries.length === 0 ? (
              <div className="module-empty-state mt-5 text-sm">No alternatives yet.</div>
            ) : (
              <div className="mt-5 space-y-3">
                {alternativeEntries.map((entry) => {
                  const state = scenarioComparisonStatus(baselineEntry?.attached_run_id, entry.attached_run_id);
                  return (
                    <div key={entry.id} className="rounded-[20px] border border-border/70 bg-background/80 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold tracking-tight">{entry.label}</p>
                          <p className="mt-1 text-sm text-muted-foreground">
                            Baseline: {baselineEntry?.label ?? "Missing"} · Candidate run:{" "}
                            {entry.attachedRun?.title ?? "Missing"}
                          </p>
                        </div>
                        <StatusBadge tone={state === "ready" ? "success" : "warning"}>{state}</StatusBadge>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </article>
        </div>
      </div>
    </section>
  );
}
