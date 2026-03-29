import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AlertTriangle, ArrowRight, FileStack, GitCompareArrows, ShieldCheck } from "lucide-react";
import { ScenarioEntryComposer } from "@/components/scenarios/scenario-entry-composer";
import { ScenarioEntryRegistry } from "@/components/scenarios/scenario-entry-registry";
import { ScenarioSetControls } from "@/components/scenarios/scenario-set-controls";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  formatReportStatusLabel,
  formatReportTypeLabel,
  getReportPacketActionLabel,
  getReportPacketFreshness,
  getReportPacketPriority,
  reportStatusTone,
} from "@/lib/reports/catalog";
import { buildScenarioComparisonBoard } from "@/lib/scenarios/comparison-board";
import { createClient } from "@/lib/supabase/server";
import {
  buildScenarioComparisonSummary,
  buildScenarioLinkedReports,
  buildScenarioStudioHref,
  scenarioStatusTone,
  titleizeScenarioValue,
} from "@/lib/scenarios/catalog";

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

  const [{ data: project }, { data: entriesData }, { data: runsData }, { data: modelsData }] = await Promise.all([
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
    supabase
      .from("models")
      .select("id, title, status, last_run_recorded_at")
      .eq("workspace_id", scenarioSet.workspace_id)
      .eq("scenario_set_id", scenarioSet.id)
      .order("updated_at", { ascending: false }),
  ]);

  const runIds = (entriesData ?? [])
    .map((entry) => entry.attached_run_id)
    .filter((value): value is string => Boolean(value));
  const attachedRunsResult = runIds.length
    ? await supabase.from("runs").select("id, title, summary_text, metrics, created_at").in("id", runIds)
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
  const { data: reportsData } = await supabase
    .from("reports")
    .select("id, title, status, report_type, generated_at, updated_at, latest_artifact_kind")
    .eq("project_id", scenarioSet.project_id)
    .order("updated_at", { ascending: false });
  const reportIds = (reportsData ?? []).map((report) => report.id);
  const { data: reportRunsData } = reportIds.length
    ? await supabase.from("report_runs").select("report_id, run_id").in("report_id", reportIds)
    : { data: [] };
  const comparisonBoard = buildScenarioComparisonBoard({
    scenarioSetId: scenarioSet.id,
    baselineEntry,
    alternativeEntries,
  });
  const reportLinkage = buildScenarioLinkedReports({
    reports: (reportsData ?? []) as Array<{
      id: string;
      title: string | null;
      status: string | null;
      report_type: string | null;
      generated_at: string | null;
      updated_at: string | null;
      latest_artifact_kind?: string | null;
    }>,
    reportRuns: ((reportRunsData ?? []) as Array<{ report_id: string; run_id: string }>).filter((link) =>
      (reportsData ?? []).some((report) => report.id === link.report_id)
    ),
    entries: entries.map((entry) => ({
      id: entry.id,
      label: entry.label,
      attached_run_id: entry.attached_run_id,
    })),
    baselineEntryId: baselineEntry?.id ?? null,
  });
  const linkedReportsWithFreshness = reportLinkage.linkedReports
    .map((report) => ({
      ...report,
      packetFreshness: getReportPacketFreshness({
        latestArtifactKind: report.latest_artifact_kind,
        generatedAt: report.generated_at,
        updatedAt: report.updated_at,
      }),
    }))
    .sort((left, right) => {
      const freshnessPriority =
        getReportPacketPriority(left.packetFreshness.label) -
        getReportPacketPriority(right.packetFreshness.label);
      if (freshnessPriority !== 0) {
        return freshnessPriority;
      }

      const leftStamp = left.generated_at ?? left.updated_at ?? "";
      const rightStamp = right.generated_at ?? right.updated_at ?? "";
      return rightStamp.localeCompare(leftStamp);
    });
  const comparisonReadyReportCount = linkedReportsWithFreshness.filter((report) => report.comparisonReady).length;
  const runLinkedOnlyReportCount = linkedReportsWithFreshness.length - comparisonReadyReportCount;
  const refreshRecommendedReportCount = linkedReportsWithFreshness.filter(
    (report) => report.packetFreshness.label === "Refresh recommended"
  ).length;
  const noPacketReportCount = linkedReportsWithFreshness.filter(
    (report) => report.packetFreshness.label === "No packet"
  ).length;
  const linkedReportAttentionCount = refreshRecommendedReportCount + noPacketReportCount;
  const recommendedLinkedReport = linkedReportsWithFreshness[0] ?? null;

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
              <p className="module-section-label">Workflow</p>
              <h2 className="module-section-title">Comparison and reporting runway</h2>
              <p className="module-section-description">
                Move from registered entries into Analysis Studio review or report assembly without losing the explicit evidence trail.
              </p>
            </div>

            <div className="mt-5 grid gap-4 lg:grid-cols-2">
              <div className="rounded-[22px] border border-border/70 bg-background/80 p-5">
                <p className="text-sm font-semibold tracking-tight">Analysis Studio handoff</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  Ready alternatives open with the attached run as current and the baseline pinned for direct review in Analysis Studio.
                </p>
                <div className="mt-4 space-y-2">
                  {alternativeEntries.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No alternatives registered yet.</p>
                  ) : (
                    alternativeEntries.slice(0, 3).map((entry) => (
                      <Link
                        key={entry.id}
                        href={buildScenarioStudioHref({
                          runId: entry.attached_run_id,
                          baselineRunId: baselineEntry?.attached_run_id ?? null,
                          scenarioSetId: scenarioSet.id,
                          entryId: entry.id,
                        })}
                        className="module-record-chip transition hover:border-primary/40 hover:text-primary"
                      >
                        Review {entry.label}
                      </Link>
                    ))
                  )}
                </div>
              </div>

              <div className="rounded-[22px] border border-border/70 bg-background/80 p-5">
                <p className="text-sm font-semibold tracking-tight">Report linkage</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  Reports are surfaced when they already use this scenario set&apos;s attached runs. New comparison packets can be drafted from ready evidence.
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <StatusBadge tone={linkedReportsWithFreshness.length > 0 ? "success" : "neutral"}>
                    {linkedReportsWithFreshness.length} linked reports
                  </StatusBadge>
                  <StatusBadge tone={comparisonReadyReportCount > 0 ? "success" : "info"}>
                    {comparisonReadyReportCount} comparison-ready
                  </StatusBadge>
                  <StatusBadge tone={runLinkedOnlyReportCount > 0 ? "warning" : "neutral"}>
                    {runLinkedOnlyReportCount} run-linked only
                  </StatusBadge>
                  <StatusBadge tone={linkedReportAttentionCount > 0 ? "warning" : "success"}>
                    {linkedReportAttentionCount} packet issue{linkedReportAttentionCount === 1 ? "" : "s"}
                  </StatusBadge>
                </div>
              </div>
            </div>
          </article>

          <article className="module-section-surface">
            <div className="module-section-heading">
              <p className="module-section-label">Decision surface</p>
              <h2 className="module-section-title">Alternative vs baseline comparison board</h2>
              <p className="module-section-description">
                Attached runs now roll up into a decision-useful comparison surface so planners can see where each alternative actually moves the scorecard before opening Studio.
              </p>
            </div>

            {comparisonBoard.length === 0 ? (
              <div className="module-empty-state mt-5 text-sm">
                No comparison cards yet. Attach distinct runs to the baseline and at least one alternative to light up the board.
              </div>
            ) : (
              <div className="mt-5 module-record-list">
                {comparisonBoard.map((card) => (
                  <div key={card.entryId} className="module-record-row">
                    <div className="module-record-head">
                      <div className="module-record-main">
                        <div className="module-record-kicker">
                          <StatusBadge tone="success">Ready to compare</StatusBadge>
                          <StatusBadge tone="info">{card.changedMetricCount} metrics moved</StatusBadge>
                        </div>
                        <div className="space-y-1.5">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <h3 className="module-record-title text-[1.05rem]">{card.candidateLabel} vs {card.baselineLabel}</h3>
                            <Link href={card.analysisHref} className="module-record-chip transition hover:border-primary/40 hover:text-primary">
                              Open in Studio
                            </Link>
                          </div>
                          <p className="module-record-summary line-clamp-2">
                            Alternative run: {card.candidateRunTitle} · Baseline run: {card.baselineRunTitle}
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                      {card.headlineMetrics.map((metric) => (
                        <div key={`${card.entryId}-${metric.key}`} className="rounded-[20px] border border-border/70 bg-background/75 p-4">
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">{metric.label}</p>
                            <StatusBadge tone={metric.tone}>{metric.deltaLabel}</StatusBadge>
                          </div>
                          <div className="mt-3 space-y-1">
                            <p className="text-2xl font-semibold tracking-tight text-foreground">{metric.current ?? "N/A"}</p>
                            <p className="text-sm text-muted-foreground">Baseline {metric.baseline ?? "N/A"}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </article>

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
            scenarioSetTitle={scenarioSet.title}
            planningQuestion={scenarioSet.planning_question}
            projectId={scenarioSet.project_id}
            entries={entries}
            runs={runsData ?? []}
            models={((modelsData ?? []) as Array<{ id: string; title: string | null; status: string | null; last_run_recorded_at: string | null }>).map((model) => ({
              id: model.id,
              title: model.title ?? "Untitled model",
              status: model.status ?? "draft",
              lastRunRecordedAt: model.last_run_recorded_at,
            }))}
            baselineEntryId={baselineEntry?.id ?? null}
            linkedReports={reportLinkage.linkedReports}
          />
        </div>
      </div>

      <article className="module-section-surface mt-6">
        <div className="module-section-header">
          <div className="module-section-heading">
            <p className="module-section-label">Reports</p>
            <h2 className="module-section-title">Scenario-linked report records</h2>
            <p className="module-section-description">
              Lightweight linkage only: reports are shown when they already reference this scenario set&apos;s attached runs.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-background/80 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              <FileStack className="h-3.5 w-3.5" />
              {linkedReportsWithFreshness.length} linked
            </span>
            {linkedReportAttentionCount > 0 ? (
              <span className="inline-flex items-center gap-2 rounded-full border border-amber-400/40 bg-amber-50/80 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-amber-900 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-200">
                <AlertTriangle className="h-3.5 w-3.5" />
                {linkedReportAttentionCount} need{linkedReportAttentionCount === 1 ? "s" : ""} packet attention
              </span>
            ) : null}
          </div>
        </div>

        {linkedReportsWithFreshness.length === 0 ? (
          <div className="module-empty-state mt-5 text-sm">
            No linked reports yet. When comparison-ready evidence exists, create an analysis summary report from an alternative card.
          </div>
        ) : (
          <>
            <div
              className={`mt-5 rounded-[22px] border p-5 ${
                linkedReportAttentionCount > 0
                  ? "border-amber-400/40 bg-amber-50/80 dark:border-amber-900 dark:bg-amber-950/20"
                  : "border-emerald-400/35 bg-emerald-50/70 dark:border-emerald-900 dark:bg-emerald-950/20"
              }`}
            >
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Scenario reporting posture
              </p>
              <h3 className="mt-2 text-sm font-semibold text-foreground">
                {linkedReportAttentionCount > 0 && recommendedLinkedReport
                  ? `${recommendedLinkedReport.title ?? "Linked report"} needs packet attention`
                  : "Linked packets look current"}
              </h3>
              <p className="mt-2 text-sm text-muted-foreground">
                {recommendedLinkedReport
                  ? getReportPacketActionLabel(recommendedLinkedReport.packetFreshness.label)
                  : "Open reports to create the first packet tied to this scenario evidence."}
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                {recommendedLinkedReport?.packetFreshness.detail ??
                  "No linked reports use this scenario set's runs yet."}
              </p>
            </div>

            <div className="mt-5 module-record-list">
              {linkedReportsWithFreshness.map((report) => (
                <Link key={report.id} href={`/reports/${report.id}`} className="module-record-row is-interactive group block">
                  <div className="module-record-head">
                    <div className="module-record-main">
                      <div className="module-record-kicker">
                        <StatusBadge tone={reportStatusTone(report.status ?? "draft")}>
                          {formatReportStatusLabel(report.status)}
                        </StatusBadge>
                        <StatusBadge tone="info">{formatReportTypeLabel(report.report_type)}</StatusBadge>
                        <StatusBadge tone={report.comparisonReady ? "success" : "warning"}>
                          {report.comparisonReady ? "Comparison-ready" : "Run-linked only"}
                        </StatusBadge>
                        <StatusBadge tone={report.packetFreshness.tone}>
                          {report.packetFreshness.label}
                        </StatusBadge>
                      </div>
                      <div className="space-y-1.5">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <h3 className="module-record-title text-[1.05rem] transition group-hover:text-primary">{report.title ?? "Untitled report"}</h3>
                          <p className="module-record-stamp">Updated {report.updated_at ?? report.generated_at ?? "Unknown"}</p>
                        </div>
                        <p className="module-record-summary line-clamp-2">
                          {report.comparisonReady
                            ? `Grounded by baseline + alternative runs from this set: ${report.matchedEntryLabels.join(" · ")}`
                            : report.matchedBaselineRun
                              ? `Includes the baseline run from this set, but no comparison-ready alternative yet: ${report.matchedEntryLabels.join(" · ")}`
                              : `Shares alternative runs with this set, but not enough evidence for a comparison-ready packet: ${report.matchedEntryLabels.join(" · ")}`}
                        </p>
                        <p className="text-sm text-muted-foreground">{report.packetFreshness.detail}</p>
                        <p className="text-sm font-medium text-foreground/80">
                          {getReportPacketActionLabel(report.packetFreshness.label)}
                        </p>
                      </div>
                    </div>
                    <ArrowRight className="mt-0.5 h-4.5 w-4.5 text-muted-foreground transition group-hover:text-primary" />
                  </div>
                  <div className="module-record-meta">
                    <span className="module-record-chip">{report.matchedRunIds.length} matching runs</span>
                    <span className="module-record-chip">
                      {report.generated_at ? `Generated ${report.generated_at}` : "Draft packet"}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          </>
        )}
      </article>
    </section>
  );
}
