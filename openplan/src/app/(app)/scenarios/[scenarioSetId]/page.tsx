import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowRight, GitCompareArrows, ShieldCheck } from "lucide-react";
import { ScenarioEntryComposer } from "@/components/scenarios/scenario-entry-composer";
import { ScenarioEntryRegistry } from "@/components/scenarios/scenario-entry-registry";
import { ScenarioSetControls } from "@/components/scenarios/scenario-set-controls";
import { StatusBadge } from "@/components/ui/status-badge";
import { createClient } from "@/lib/supabase/server";
import { buildScenarioComparisonSummary, scenarioStatusTone, titleizeScenarioValue } from "@/lib/scenarios/catalog";

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
  const comparisonSummary = buildScenarioComparisonSummary({
    baselineEntryId: baselineEntry?.id,
    baselineRunId: baselineEntry?.attached_run_id ?? null,
    candidateRunIds: alternativeEntries.map((entry) => entry.attached_run_id),
  });

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
            <StatusBadge tone={comparisonSummary.readyAlternatives > 0 ? "success" : "info"}>
              {comparisonSummary.readyAlternatives}/{comparisonSummary.totalAlternatives} ready
            </StatusBadge>
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
              <p className="module-summary-label">Comparison readiness</p>
              <p className="module-summary-value text-lg">
                {comparisonSummary.readyAlternatives} / {comparisonSummary.totalAlternatives}
              </p>
              <p className="module-summary-detail">
                Ready alternatives have distinct runs attached on both the baseline and alternative entries.
              </p>
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
            Comparison readiness stays lightweight, but it is now explicit about what is attached, what assumptions are
            recorded, and why a baseline-versus-alternative comparison is or is not ready.
          </p>
          <div className="module-operator-list">
            <div className="module-operator-item">Baseline and alternative entries show distinct run-attachment blockers.</div>
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
          <ScenarioEntryRegistry
            scenarioSetId={scenarioSet.id}
            entries={entries}
            runs={runsData ?? []}
            baselineEntryId={baselineEntry?.id ?? null}
          />
        </div>
      </div>
    </section>
  );
}
