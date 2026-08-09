import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CartographicSurfaceWide } from "@/components/cartographic/cartographic-surface-wide";
import { AlertTriangle, ArrowRight, FileStack, GitCompareArrows, ShieldCheck } from "lucide-react";
import { ScenarioEntryComposer } from "@/components/scenarios/scenario-entry-composer";
import { ScenarioEntryRegistry } from "@/components/scenarios/scenario-entry-registry";
import { ScenarioSetControls } from "@/components/scenarios/scenario-set-controls";
import { ScenarioSpinePanel } from "@/components/scenarios/scenario-spine-panel";
import { TripGenComparisonSaveButton } from "@/components/scenarios/trip-gen-comparison-save";
import { MetaItem, MetaList } from "@/components/ui/meta-item";
import { StateBlock } from "@/components/ui/state-block";
import { StatusBadge } from "@/components/ui/status-badge";
import { ReadFailureLog } from "@/lib/ui/read-failures";
import {
  formatReportStatusLabel,
  formatReportTypeLabel,
  getReportPacketActionLabel,
  getReportPacketFreshness,
  getReportPacketPriority,
  reportStatusTone,
} from "@/lib/reports/catalog";
import { PACKET_FRESHNESS_LABELS } from "@/lib/reports/packet-labels";
import { getManagedRunModeDefinition } from "@/lib/models/run-modes";
import { buildScenarioComparisonBoard } from "@/lib/scenarios/comparison-board";
import { scenarioComparisonSourceContextFromMetadata } from "@/lib/scenarios/comparison-source-context";
import { looksLikePendingScenarioSpineSchema } from "@/lib/scenarios/api";
import { createClient } from "@/lib/supabase/server";
import { looksLikePendingSchema } from "@/lib/supabase/pending-schema";
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
  attached_model_run_id: string | null;
  status: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

type ScenarioAttachedModelRunRow = {
  id: string;
  run_title: string;
  engine_key: string;
  status: string;
  result_summary_json: Record<string, unknown> | null;
};

type ScenarioComparisonSnapshotRow = {
  id: string;
  baseline_entry_id: string;
  candidate_entry_id: string;
  label: string;
  summary: string | null;
  metadata_json: Record<string, unknown> | null;
  status: string;
  updated_at: string;
};

type ScenarioComparisonIndicatorDeltaRow = {
  id: string;
  comparison_snapshot_id: string;
};

type ScenarioTripGenModelRunRow = {
  id: string;
  model_id: string;
  scenario_entry_id: string | null;
  status: string;
  engine_key: string;
};

function formatStamp(value: string | null | undefined): string {
  if (!value) return "Unknown";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

/**
 * Classify one `model_runs` read before collecting it.
 *
 * Every model_runs read on this page shares one failure mode: a deployment that
 * has not applied the model-runs migration. That is a CLASSIFIED condition with
 * a truer sentence than "could not be read" — see the note at the top of
 * `src/lib/ui/read-failures.ts` — so it is reported separately and never
 * collected as a read failure. Whatever is left IS a read failure and is
 * registered by name.
 *
 * It returns the two facts rather than mutating a flag, so the caller does the
 * assigning in the component body where it is visible.
 */
function classifyModelRunsRead(
  reads: ReadFailureLog,
  label: string,
  result: { error?: { message?: string | null } | null }
): { unreadable: boolean; schemaPending: boolean } {
  if (looksLikePendingSchema(result.error?.message)) {
    return { unreadable: false, schemaPending: true };
  }

  return { unreadable: reads.check(label, result), schemaPending: false };
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

  // Every read below is registered here, and whatever failed is named at the top
  // of the page. A scenario comparison is a provenance claim — which runs, which
  // assumptions, which indicators — so a read that quietly returned nothing does
  // not merely thin the page, it weakens the claim the page is making while
  // still looking complete.
  const reads = new ReadFailureLog();

  const scenarioSetResult = await supabase
    .from("scenario_sets")
    .select("id, workspace_id, project_id, title, summary, planning_question, status, baseline_entry_id, created_at, updated_at")
    .eq("id", scenarioSetId)
    .maybeSingle();

  // The one load-bearing read on this page, and the one place "could not read
  // it" and "it is not there" must not merge: `notFound()` tells the planner
  // this scenario set does not exist, and a 400 or a policy failure is not
  // evidence of that. Raise instead, so the route's error boundary says
  // something a retry can act on.
  if (scenarioSetResult.error) {
    throw new Error(`Could not read this scenario set: ${scenarioSetResult.error.message}`);
  }

  const scenarioSetData = scenarioSetResult.data;

  if (!scenarioSetData) {
    notFound();
  }

  const scenarioSet = scenarioSetData as ScenarioSetRow;

  const [projectResult, entriesResult, runsResult, modelsResult] = await Promise.all([
    supabase
      .from("projects")
      .select("id, workspace_id, name, summary, status, plan_type, delivery_phase, updated_at")
      .eq("id", scenarioSet.project_id)
      .maybeSingle(),
    supabase
      .from("scenario_entries")
      .select(
        "id, scenario_set_id, entry_type, label, slug, summary, assumptions_json, attached_run_id, attached_model_run_id, status, sort_order, created_at, updated_at"
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

  const project = projectResult.data;
  const projectUnreadable = reads.check("the parent project", projectResult);
  reads.check("selectable runs", runsResult);
  const modelsUnreadable = reads.check("selectable models", modelsResult);
  const runsData = runsResult.data;
  const modelsData = modelsResult.data;

  // A database without the model-run-attachment migration answers the widened
  // select with a missing-column error; fall back to the legacy select and
  // treat every entry as legacy-run-backed. Classify that case FIRST — it has a
  // truer thing to say than "could not be read" — and register whatever is left.
  let entryRows = (entriesResult.data ?? []) as ScenarioEntryRow[];
  let entriesUnreadable = false;
  if (entriesResult.error && looksLikePendingSchema(entriesResult.error.message)) {
    const legacyEntriesResult = await supabase
      .from("scenario_entries")
      .select(
        "id, scenario_set_id, entry_type, label, slug, summary, assumptions_json, attached_run_id, status, sort_order, created_at, updated_at"
      )
      .eq("scenario_set_id", scenarioSet.id)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    entriesUnreadable = reads.check("this scenario set's entries", legacyEntriesResult);
    entryRows = ((legacyEntriesResult.data ?? []) as Array<Omit<ScenarioEntryRow, "attached_model_run_id">>).map(
      (entry) => ({ ...entry, attached_model_run_id: null })
    );
  } else {
    entriesUnreadable = reads.check("this scenario set's entries", entriesResult);
  }

  const runIds = entryRows
    .map((entry) => entry.attached_run_id)
    .filter((value): value is string => Boolean(value));
  const attachedModelRunIds = entryRows
    .map((entry) => entry.attached_model_run_id)
    .filter((value): value is string => Boolean(value));
  const attachedRunsResult = runIds.length
    ? await supabase.from("runs").select("id, title, summary_text, metrics, created_at").in("id", runIds)
    : { data: [], error: null };
  // The attached runs ARE the evidence a comparison card cites. Losing them
  // silently turns "this alternative moved these metrics" into a blank card that
  // reads as "nothing moved".
  const attachedRunsUnreadable = reads.check("the runs attached to these entries", attachedRunsResult);

  // See `classifyModelRunsRead` above: a missing model-runs migration is
  // classified, everything else is collected.
  let modelRunsSchemaPending = false;

  let attachedModelRuns: ScenarioAttachedModelRunRow[] = [];
  let attachedModelRunsUnreadable = false;
  if (attachedModelRunIds.length) {
    try {
      const attachedModelRunsResult = await supabase
        .from("model_runs")
        .select("id, run_title, engine_key, status, result_summary_json")
        .in("id", attachedModelRunIds);
      const attachedClassification = classifyModelRunsRead(
        reads,
        "the model runs attached to these entries",
        attachedModelRunsResult
      );
      modelRunsSchemaPending = modelRunsSchemaPending || attachedClassification.schemaPending;
      attachedModelRunsUnreadable = attachedClassification.unreadable;
      attachedModelRuns = (attachedModelRunsResult.data ?? []) as ScenarioAttachedModelRunRow[];
    } catch (error) {
      // supabase-js answers with an `error` rather than throwing, so reaching
      // here means the transport itself failed. It is still a read that did not
      // happen, and it may not leave the page silent.
      attachedModelRunsUnreadable = reads.check("the model runs attached to these entries", {
        error: { message: error instanceof Error ? error.message : String(error) },
      });
      attachedModelRuns = [];
    }
  }

  const runMap = new Map((attachedRunsResult.data ?? []).map((run) => [run.id, run]));
  const attachedModelRunMap = new Map(attachedModelRuns.map((run) => [run.id, run]));
  const entries = entryRows.map((entry) => ({
    ...entry,
    attachedRun: entry.attached_run_id ? runMap.get(entry.attached_run_id) ?? null : null,
    attachedModelRun: entry.attached_model_run_id
      ? attachedModelRunMap.get(entry.attached_model_run_id) ?? null
      : null,
  }));

  // Attach-picker model-run options: runs that already point back at one of
  // this set's entries, plus the workspace's recent succeeded model runs.
  // Succeeded only — an entry's evidence should be a completed run. Degrades
  // to an empty list when the model_runs module is not migrated.
  let modelRunOptionRows: Array<{
    id: string;
    run_title: string;
    engine_key: string;
    status: string;
    scenario_entry_id: string | null;
  }> = [];
  let modelRunOptionsUnreadable = false;
  try {
    const [entryPointedRunsResult, workspaceModelRunsResult] = await Promise.all([
      entries.length
        ? supabase
            .from("model_runs")
            .select("id, run_title, engine_key, status, scenario_entry_id")
            .in(
              "scenario_entry_id",
              entries.map((entry) => entry.id)
            )
            .eq("status", "succeeded")
            .order("created_at", { ascending: false })
        : Promise.resolve({ data: [], error: null }),
      supabase
        .from("model_runs")
        .select("id, run_title, engine_key, status, scenario_entry_id")
        .eq("workspace_id", scenarioSet.workspace_id)
        .eq("status", "succeeded")
        .order("created_at", { ascending: false })
        .limit(30),
    ]);
    // An unreadable option list is not an empty option list: the attach picker
    // would offer nothing and read as "this workspace has no completed model
    // runs to attach".
    // Both are classified, deliberately without `||` short-circuiting on the
    // calls themselves: an unchecked second result is an unrecorded failure.
    const entryPointedClassification = classifyModelRunsRead(
      reads,
      "model runs already pointing at these entries",
      entryPointedRunsResult
    );
    const workspaceRunsClassification = classifyModelRunsRead(
      reads,
      "this workspace's completed model runs",
      workspaceModelRunsResult
    );
    modelRunsSchemaPending =
      modelRunsSchemaPending ||
      entryPointedClassification.schemaPending ||
      workspaceRunsClassification.schemaPending;
    modelRunOptionsUnreadable = entryPointedClassification.unreadable || workspaceRunsClassification.unreadable;
    const mergedModelRunOptions = new Map<string, (typeof modelRunOptionRows)[number]>();
    for (const run of [
      ...(entryPointedRunsResult.data ?? []),
      ...(workspaceModelRunsResult.data ?? []),
    ] as typeof modelRunOptionRows) {
      if (!mergedModelRunOptions.has(run.id)) {
        mergedModelRunOptions.set(run.id, run);
      }
    }
    modelRunOptionRows = Array.from(mergedModelRunOptions.values());
  } catch (error) {
    modelRunOptionsUnreadable = reads.check("model runs available to attach", {
      error: { message: error instanceof Error ? error.message : String(error) },
    });
    modelRunOptionRows = [];
  }

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
  // Narrow model_runs lookup for the trip-gen comparison save affordance: the
  // newest succeeded ite_trip_generation run per entry. Degrades to "no
  // affordance" on any lookup failure (e.g. the model_runs module migration is
  // not applied yet) instead of blocking the page.
  let tripGenModelRuns: ScenarioTripGenModelRunRow[] = [];
  let tripGenRunsUnreadable = false;
  if (entries.length >= 2) {
    try {
      const tripGenRunsResult = await supabase
        .from("model_runs")
        .select("id, model_id, scenario_entry_id, status, engine_key")
        .in(
          "scenario_entry_id",
          entries.map((entry) => entry.id)
        )
        .eq("engine_key", "ite_trip_generation")
        .eq("status", "succeeded")
        .order("created_at", { ascending: false });
      const tripGenClassification = classifyModelRunsRead(
        reads,
        "the trip-generation runs behind the save affordance",
        tripGenRunsResult
      );
      modelRunsSchemaPending = modelRunsSchemaPending || tripGenClassification.schemaPending;
      tripGenRunsUnreadable = tripGenClassification.unreadable;
      tripGenModelRuns = (tripGenRunsResult.data ?? []) as ScenarioTripGenModelRunRow[];
    } catch (error) {
      tripGenRunsUnreadable = reads.check("the trip-generation runs behind the save affordance", {
        error: { message: error instanceof Error ? error.message : String(error) },
      });
      tripGenModelRuns = [];
    }
  }
  const latestTripGenRunByEntryId = new Map<string, ScenarioTripGenModelRunRow>();
  for (const run of tripGenModelRuns) {
    if (run.scenario_entry_id && !latestTripGenRunByEntryId.has(run.scenario_entry_id)) {
      latestTripGenRunByEntryId.set(run.scenario_entry_id, run);
    }
  }
  // The spine route only accepts a baseline-typed baselineEntryId and a
  // non-baseline candidateEntryId, so the affordance follows the same pairing:
  // the set's baseline entry vs the first non-baseline entry with a succeeded
  // trip-generation run.
  const tripGenBaselineRun = baselineEntry ? latestTripGenRunByEntryId.get(baselineEntry.id) ?? null : null;
  const tripGenCandidateEntry = tripGenBaselineRun
    ? entries.find(
        (entry) =>
          entry.id !== baselineEntry?.id &&
          entry.entry_type !== "baseline" &&
          latestTripGenRunByEntryId.has(entry.id)
      ) ?? null
    : null;
  const tripGenCandidateRun = tripGenCandidateEntry
    ? latestTripGenRunByEntryId.get(tripGenCandidateEntry.id) ?? null
    : null;
  const comparisonSnapshotsResult = await supabase
    .from("scenario_comparison_snapshots")
    .select("id, baseline_entry_id, candidate_entry_id, label, summary, metadata_json, status, updated_at")
    .eq("scenario_set_id", scenarioSet.id)
    .order("updated_at", { ascending: false });
  const comparisonSnapshotsSchemaPending = looksLikePendingScenarioSpineSchema(
    comparisonSnapshotsResult.error?.message
  );
  // Pending-schema is classified above and says something truer. Anything else
  // is a failure that must not be rendered as "no comparisons have been saved".
  const comparisonSnapshotsUnreadable = comparisonSnapshotsSchemaPending
    ? false
    : reads.check("saved comparison snapshots", comparisonSnapshotsResult);
  const comparisonSnapshots = comparisonSnapshotsSchemaPending
    ? []
    : ((comparisonSnapshotsResult.data ?? []) as ScenarioComparisonSnapshotRow[]);
  const comparisonSnapshotIds = comparisonSnapshots.map((snapshot) => snapshot.id);
  const comparisonIndicatorDeltasResult = comparisonSnapshotIds.length
    ? await supabase
        .from("scenario_comparison_indicator_deltas")
        .select("id, comparison_snapshot_id")
        .in("comparison_snapshot_id", comparisonSnapshotIds)
    : { data: [], error: null };
  const comparisonIndicatorDeltasSchemaPending = looksLikePendingScenarioSpineSchema(
    comparisonIndicatorDeltasResult.error?.message
  );
  const comparisonIndicatorDeltasUnreadable = comparisonIndicatorDeltasSchemaPending
    ? false
    : reads.check("indicator deltas on saved comparisons", comparisonIndicatorDeltasResult);
  const comparisonIndicatorDeltas = comparisonIndicatorDeltasSchemaPending
    ? []
    : ((comparisonIndicatorDeltasResult.data ?? []) as ScenarioComparisonIndicatorDeltaRow[]);
  const reportsResult = await supabase
    .from("reports")
    .select("id, title, status, report_type, generated_at, updated_at, latest_artifact_kind")
    .eq("project_id", scenarioSet.project_id)
    .order("updated_at", { ascending: false });
  const reportsUnreadable = reads.check("this project's reports", reportsResult);
  const reportsData = reportsResult.data;
  const reportIds = (reportsData ?? []).map((report) => report.id);
  const [reportRunsResult, reportArtifactsResult] = reportIds.length
    ? await Promise.all([
        supabase.from("report_runs").select("report_id, run_id").in("report_id", reportIds),
        supabase.from("report_artifacts").select("report_id, generated_at").in("report_id", reportIds),
      ])
    : [
        { data: [], error: null },
        { data: [], error: null },
      ];
  // Report-to-run linkage is what decides whether a report counts as linked to
  // this scenario set at all. Losing it empties the linked-report list without
  // emptying the reports.
  const reportRunsUnreadable = reads.check("report-to-run linkage", reportRunsResult);
  reads.check("report packet artifacts", reportArtifactsResult);
  const reportRunsData = reportRunsResult.data;
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
  const latestArtifactByReportId = new Map<string, { generated_at: string | null }>();
  for (const row of (reportArtifactsResult.data ?? []) as Array<{ report_id: string; generated_at: string | null }>) {
    const current = latestArtifactByReportId.get(row.report_id);
    const rowTime = row.generated_at ? new Date(row.generated_at).getTime() : Number.NEGATIVE_INFINITY;
    const currentTime = current?.generated_at ? new Date(current.generated_at).getTime() : Number.NEGATIVE_INFINITY;
    if (!current || rowTime > currentTime) {
      latestArtifactByReportId.set(row.report_id, { generated_at: row.generated_at });
    }
  }

  const linkedReportsWithFreshness = reportLinkage.linkedReports
    .map((report) => ({
      ...report,
      packetFreshness: getReportPacketFreshness({
        latestArtifactKind: report.latest_artifact_kind,
        generatedAt: latestArtifactByReportId.get(report.id)?.generated_at ?? report.generated_at,
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

      const leftStamp = latestArtifactByReportId.get(left.id)?.generated_at ?? left.generated_at ?? left.updated_at ?? "";
      const rightStamp = latestArtifactByReportId.get(right.id)?.generated_at ?? right.generated_at ?? right.updated_at ?? "";
      return rightStamp.localeCompare(leftStamp);
    });
  const entryById = new Map(entries.map((entry) => [entry.id, entry]));
  const comparisonIndicatorDeltaCountBySnapshotId = new Map<string, number>();
  for (const delta of comparisonIndicatorDeltas) {
    comparisonIndicatorDeltaCountBySnapshotId.set(
      delta.comparison_snapshot_id,
      (comparisonIndicatorDeltaCountBySnapshotId.get(delta.comparison_snapshot_id) ?? 0) + 1
    );
  }
  const recentComparisonSnapshots = comparisonSnapshots.map((snapshot) => ({
    ...snapshot,
    baselineEntry: entryById.get(snapshot.baseline_entry_id) ?? null,
    candidateEntry: entryById.get(snapshot.candidate_entry_id) ?? null,
    indicatorDeltaCount: comparisonIndicatorDeltaCountBySnapshotId.get(snapshot.id) ?? 0,
    sourceContext: scenarioComparisonSourceContextFromMetadata(snapshot.metadata_json),
  }));
  const comparisonSnapshotExportReadyCount = recentComparisonSnapshots.filter(
    (snapshot) => snapshot.sourceContext?.exportReady
  ).length;
  const comparisonSnapshotReviewCount = recentComparisonSnapshots.length - comparisonSnapshotExportReadyCount;
  const comparisonReadyReportCount = linkedReportsWithFreshness.filter((report) => report.comparisonReady).length;
  const runLinkedOnlyReportCount = linkedReportsWithFreshness.length - comparisonReadyReportCount;
  const refreshRecommendedReportCount = linkedReportsWithFreshness.filter(
    (report) => report.packetFreshness.label === PACKET_FRESHNESS_LABELS.REFRESH_RECOMMENDED
  ).length;
  const noPacketReportCount = linkedReportsWithFreshness.filter(
    (report) => report.packetFreshness.label === PACKET_FRESHNESS_LABELS.NO_PACKET
  ).length;
  const linkedReportAttentionCount = refreshRecommendedReportCount + noPacketReportCount;
  const recommendedLinkedReport = linkedReportsWithFreshness[0] ?? null;
  // A report is "linked" only when both halves loaded. Either one failing makes
  // an empty list a statement this render has no evidence for.
  const linkedReportsUnreadable = reportsUnreadable || reportRunsUnreadable;
  // The comparison board is derived from entries plus their attached runs, so
  // either failing empties it — and an empty board otherwise reads as "no
  // alternative is ready to compare", which is a finding about the planner's
  // work rather than about this render.
  const comparisonEvidenceUnreadable =
    entriesUnreadable || attachedRunsUnreadable || attachedModelRunsUnreadable;

  return (
    <section className="module-page">
      <CartographicSurfaceWide />
      <div className="mb-4 flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/scenarios" className="transition hover:text-foreground">
          Scenarios
        </Link>
        <ArrowRight className="h-3.5 w-3.5" />
        <span className="text-foreground">{scenarioSet.title}</span>
      </div>

      {/* Internal page, so the database's own message is shown — an operator
          here can act on it. A public surface would disclose only THAT a read
          failed. */}
      {reads.any ? (
        <StateBlock
          className="mb-4"
          tone="danger"
          title="Part of this scenario set could not be read"
          description={`${reads.describe()} ${reads.messages().join(" · ")}`}
        />
      ) : null}

      {modelRunsSchemaPending ? (
        <StateBlock
          className="mb-4"
          tone="warning"
          title="Model-run evidence is waiting on a migration"
          description="This deployment has not applied the model-runs migration, so runs attached to these entries, the attach picker, and the trip-generation comparison affordance are unavailable. That is a missing migration, not an absence of model runs."
        />
      ) : null}

      <header className="module-header-grid">
        <article className="module-intro-card">
          <div className="module-intro-kicker">
            <GitCompareArrows className="h-3.5 w-3.5" />
            Scenario set detail
          </div>
          <div className="module-record-kicker">
            <StatusBadge tone={scenarioStatusTone(scenarioSet.status)}>{titleizeScenarioValue(scenarioSet.status)}</StatusBadge>
            <span className="module-record-chip">
              <span>Baseline</span>
              {/* "Missing" is a finding. It may only be shown when the entries
                  were actually read. */}
              <strong>{entriesUnreadable ? "Unreadable" : baselineEntry ? "Registered" : "Missing"}</strong>
            </span>
          </div>
          <p className="text-[0.73rem] text-muted-foreground">
            {entriesUnreadable
              ? "Alternative readiness is unavailable — this set's entries could not be read."
              : `${comparisonSummary.readyAlternatives}/${comparisonSummary.totalAlternatives} alternatives ready`}
          </p>
          <div className="module-intro-body">
            <h1 className="module-intro-title">{scenarioSet.title}</h1>
            <p className="module-intro-description">
              {scenarioSet.summary ||
                "This scenario set is ready to attach a baseline, alternatives, and run-linked evidence without drifting into a separate comparison engine."}
            </p>
          </div>

          <div className="module-summary-grid cols-4">
            <div className="module-summary-card">
              <p className="module-summary-label">Project</p>
              <p className="module-summary-value text-lg">
                {projectUnreadable ? "Unreadable" : project?.name ?? "Unknown"}
              </p>
              <p className="module-summary-detail">
                {projectUnreadable
                  ? "The parent project could not be read, so it cannot be named here."
                  : "Project-linked scenario registry with durable reopening."}
              </p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Baseline</p>
              <p className="module-summary-value text-lg">
                {entriesUnreadable ? "Unreadable" : baselineEntry?.label ?? "Not set"}
              </p>
              <p className="module-summary-detail">
                {entriesUnreadable
                  ? "This set's entries could not be read, so whether a baseline is registered is unknown."
                  : "Exactly one baseline is allowed per scenario set."}
              </p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Comparison readiness</p>
              <p className="module-summary-value text-lg">
                {comparisonEvidenceUnreadable
                  ? "Unavailable"
                  : `${comparisonSummary.readyAlternatives} / ${comparisonSummary.totalAlternatives}`}
              </p>
              <p className="module-summary-detail">
                {comparisonEvidenceUnreadable
                  ? "Part of the entry or run evidence could not be read, so readiness cannot be counted."
                  : "Ready alternatives have distinct runs attached on both the baseline and alternative entries."}
              </p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Saved comparisons</p>
              <p className="module-summary-value text-lg">
                {comparisonSnapshotsSchemaPending
                  ? "Pending"
                  : comparisonSnapshotsUnreadable
                    ? "Unreadable"
                    : recentComparisonSnapshots.length}
              </p>
              <p className="module-summary-detail">
                {comparisonSnapshotsSchemaPending
                  ? "Apply the latest scenario spine migration to persist comparison artifacts."
                  : comparisonSnapshotsUnreadable
                    ? "Saved comparison snapshots could not be read, so this is not a count of zero."
                    : "Persistent comparison snapshots can now carry narrative, caveats, and indicator deltas."}
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
              <div className="module-record-row">
                <div className="module-record-head">
                  <div className="module-record-main">
                    <p className="module-record-title text-[1rem]">Analysis Studio handoff</p>
                    <p className="module-record-summary">
                      Ready alternatives open with the attached run as current and the baseline pinned for direct review in Analysis Studio.
                    </p>
                  </div>
                </div>
                {entriesUnreadable ? (
                  <p className="text-sm text-muted-foreground">
                    This set&apos;s entries could not be read, so its alternatives cannot be listed here.
                  </p>
                ) : alternativeEntries.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No alternatives registered yet.</p>
                ) : (
                  <MetaList>
                    {alternativeEntries.slice(0, 3).map((entry) => (
                      <MetaItem key={entry.id}>
                        <Link
                          href={buildScenarioStudioHref({
                            runId: entry.attached_run_id,
                            baselineRunId: baselineEntry?.attached_run_id ?? null,
                            scenarioSetId: scenarioSet.id,
                            entryId: entry.id,
                          })}
                          className="transition hover:text-primary"
                        >
                          Review {entry.label}
                        </Link>
                      </MetaItem>
                    ))}
                  </MetaList>
                )}
              </div>

              <div className="module-record-row">
                <div className="module-record-head">
                  <div className="module-record-main">
                    <p className="module-record-title text-[1rem]">Report linkage</p>
                    <p className="module-record-summary">
                      Reports are surfaced when they already use this scenario set&apos;s attached runs. New comparison packets can be drafted from ready evidence.
                    </p>
                  </div>
                </div>
                {linkedReportsUnreadable ? (
                  <p className="text-sm text-muted-foreground">
                    Report linkage counts are unavailable for this render — the reports or their run links could not be
                    read.
                  </p>
                ) : (
                  <div className="module-record-kicker">
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
                )}
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

            {comparisonEvidenceUnreadable ? (
              <div className="module-empty-state mt-5 text-sm">
                The comparison board cannot be built for this render. Part of the entry or attached-run evidence could
                not be read, so an absent card here does not mean the alternative is unready.
              </div>
            ) : comparisonBoard.length === 0 ? (
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
                          {card.evidenceSource === "model_run" || card.baselineEvidenceSource === "model_run" ? (
                            <StatusBadge tone="warning">Worker model run evidence (screening)</StatusBadge>
                          ) : null}
                        </div>
                        <div className="space-y-1.5">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <h3 className="module-record-title text-[1.05rem]">{card.candidateLabel} vs {card.baselineLabel}</h3>
                            <Link href={card.analysisHref} className="text-sm font-medium text-muted-foreground transition hover:text-primary">
                              Open in Studio
                            </Link>
                          </div>
                          <p className="module-record-summary line-clamp-2">
                            Alternative run: {card.candidateRunTitle}
                            {card.candidateModelRun
                              ? ` (${getManagedRunModeDefinition(card.candidateModelRun.engineKey).engineLabel} · ${titleizeScenarioValue(card.candidateModelRun.status)})`
                              : ""}{" "}
                            · Baseline run: {card.baselineRunTitle}
                            {card.baselineModelRun
                              ? ` (${getManagedRunModeDefinition(card.baselineModelRun.engineKey).engineLabel} · ${titleizeScenarioValue(card.baselineModelRun.status)})`
                              : ""}
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="module-note mt-4 border-sky-400/35 bg-sky-50/70 dark:border-sky-900 dark:bg-sky-950/20">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                        Caveat and source context
                      </p>
                      <h4 className="mt-2 text-sm font-semibold text-foreground">{card.sourceContext.pairingLabel}</h4>
                      <div className="mt-2 space-y-1.5 text-sm text-muted-foreground">
                        <p>{card.sourceContext.sourceSummary}</p>
                        <p>{card.sourceContext.baselineAssumptions}</p>
                        <p>{card.sourceContext.alternativeAssumptions}</p>
                        <p>{card.sourceContext.caveatSummary}</p>
                        <p>{card.sourceContext.exportReadiness}</p>
                      </div>
                    </div>

                    <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                      {card.headlineMetrics.map((metric) => (
                        <div key={`${card.entryId}-${metric.key}`} className="rounded-[0.5rem] border border-border/70 bg-background/75 p-4">
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">{metric.label}</p>
                            <StatusBadge tone={metric.tone}>{metric.deltaLabel}</StatusBadge>
                          </div>
                          <div className="mt-3 space-y-1">
                            <p className="text-2xl font-semibold tracking-tight text-foreground">{metric.current ?? "N/A"}</p>
                            <p className="text-sm text-muted-foreground">Baseline {metric.baseline ?? "N/A"}</p>
                            {/*
                              WHY THE SUBTRACTION WAS REFUSED, ON THE CARD ITSELF.
                              A bare "Not comparable" badge with no explanation
                              anywhere reads as a defect in OpenPlan, and the
                              first thing a planner does with an unexplained
                              refusal is find a way around it. Both values are
                              still shown above; it is the SUBTRACTION that is
                              refused, and this sentence is what makes that
                              legible.
                            */}
                            {metric.incomparableReason ? (
                              <p className="pt-1 text-xs leading-relaxed text-muted-foreground">
                                {metric.incomparableReason}
                              </p>
                            ) : null}
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
            <div className="module-section-header">
              <div className="module-section-heading">
                <p className="module-section-label">Provenance</p>
                <h2 className="module-section-title">Assumptions, data, and measured indicators</h2>
                <p className="module-section-description">
                  What this scenario set assumes, where those numbers came from, and what was measured
                  against them. A comparison that cannot name these is a number without a defence — and
                  until now OpenPlan had the records but offered no way to write or read them.
                </p>
              </div>
            </div>
            <div className="mt-5">
              <ScenarioSpinePanel scenarioSetId={scenarioSet.id} />
            </div>
          </article>

          <article className="module-section-surface">
            <div className="module-section-header">
              <div className="module-section-heading">
                <p className="module-section-label">Persistent comparisons</p>
                <h2 className="module-section-title">Saved comparison snapshots</h2>
                <p className="module-section-description">
                  Comparison artifacts now persist as first-class scenario records, so narrative, caveats, and indicator deltas can be reused downstream instead of reassembled each time.
                </p>
              </div>
              {!comparisonSnapshotsSchemaPending && recentComparisonSnapshots.length > 0 ? (
                <div className="module-record-kicker">
                  <StatusBadge tone="success">
                    <ShieldCheck className="h-3.5 w-3.5" />
                    {comparisonSnapshotExportReadyCount} export-ready
                  </StatusBadge>
                  {comparisonSnapshotReviewCount > 0 ? (
                    <StatusBadge tone="warning">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      {comparisonSnapshotReviewCount} need{comparisonSnapshotReviewCount === 1 ? "s" : ""} source review
                    </StatusBadge>
                  ) : null}
                </div>
              ) : null}
            </div>

            {/* The save affordance appears only when both sides carry a
                succeeded trip-generation run. If that lookup failed, its absence
                says nothing about whether those runs exist. */}
            {tripGenRunsUnreadable ? (
              <div className="module-empty-state mt-5 text-sm">
                Trip-generation runs for these entries could not be read, so the save-comparison affordance is not
                offered. That is a failed lookup, not a finding that the runs are missing.
              </div>
            ) : null}

            {!comparisonSnapshotsSchemaPending &&
            baselineEntry &&
            tripGenBaselineRun &&
            tripGenCandidateEntry &&
            tripGenCandidateRun ? (
              <div className="mt-5 rounded-[0.5rem] border border-border/70 bg-background/75 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <p className="text-sm font-semibold tracking-tight">Trip-generation comparison ready</p>
                    <p className="text-sm text-muted-foreground">
                      {baselineEntry.label} and {tripGenCandidateEntry.label} both have a completed screening
                      trip-generation run. Save the KPI deltas as a persistent comparison snapshot with the screening
                      caveats attached.
                    </p>
                  </div>
                  <TripGenComparisonSaveButton
                    scenarioSetId={scenarioSet.id}
                    baselineEntryId={baselineEntry.id}
                    baselineEntryLabel={baselineEntry.label}
                    candidateEntryId={tripGenCandidateEntry.id}
                    candidateEntryLabel={tripGenCandidateEntry.label}
                    baselineRun={{ modelId: tripGenBaselineRun.model_id, modelRunId: tripGenBaselineRun.id }}
                    candidateRun={{ modelId: tripGenCandidateRun.model_id, modelRunId: tripGenCandidateRun.id }}
                  />
                </div>
              </div>
            ) : null}

            {comparisonSnapshotsSchemaPending ? (
              <div className="module-empty-state mt-5 text-sm">
                Comparison snapshot storage is waiting on the latest scenario spine migration.
              </div>
            ) : comparisonSnapshotsUnreadable ? (
              <div className="module-empty-state mt-5 text-sm">
                Saved comparison snapshots could not be read for this render. Nothing is listed below, and that is not a
                statement that none have been saved.
              </div>
            ) : recentComparisonSnapshots.length === 0 ? (
              <div className="module-empty-state mt-5 text-sm">
                No saved comparison snapshots yet. The next useful step is to persist one ready alternative so reports and operator surfaces can reuse the same comparison artifact.
              </div>
            ) : (
              <div className="mt-5 module-record-list">
                {recentComparisonSnapshots.slice(0, 5).map((snapshot) => (
                  <div key={snapshot.id} className="module-record-row">
                    <div className="module-record-head">
                      <div className="module-record-main">
                        <div className="module-record-kicker">
                          <StatusBadge tone={snapshot.status === "ready" ? "success" : snapshot.status === "archived" ? "warning" : "neutral"}>
                            {titleizeScenarioValue(snapshot.status)}
                          </StatusBadge>
                          <StatusBadge
                            tone={
                              comparisonIndicatorDeltasUnreadable
                                ? "warning"
                                : snapshot.indicatorDeltaCount > 0
                                  ? "info"
                                  : "neutral"
                            }
                          >
                            {comparisonIndicatorDeltasUnreadable
                              ? "Indicator deltas unreadable"
                              : `${snapshot.indicatorDeltaCount} indicator delta${snapshot.indicatorDeltaCount === 1 ? "" : "s"}`}
                          </StatusBadge>
                        </div>
                        <div className="space-y-1.5">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <h3 className="module-record-title text-[1.05rem]">{snapshot.label}</h3>
                            {snapshot.candidateEntry ? (
                              <Link
                                href={buildScenarioStudioHref({
                                  runId: snapshot.candidateEntry.attached_run_id,
                                  baselineRunId: snapshot.baselineEntry?.attached_run_id ?? null,
                                  scenarioSetId: scenarioSet.id,
                                  entryId: snapshot.candidateEntry.id,
                                })}
                                className="text-sm font-medium text-muted-foreground transition hover:text-primary"
                              >
                                Open in Studio
                              </Link>
                            ) : null}
                          </div>
                          <p className="module-record-summary line-clamp-2">
                            {snapshot.summary || "No summary yet. Add a durable narrative so downstream reports can reuse this comparison cleanly."}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            {snapshot.candidateEntry?.label ?? "Unknown alternative"} vs {snapshot.baselineEntry?.label ?? "Unknown baseline"} · Updated {formatStamp(snapshot.updated_at)}
                          </p>
                        </div>
                      </div>
                    </div>

                    {snapshot.sourceContext ? (
                      <div className="module-note mt-4 border-sky-400/35 bg-sky-50/70 dark:border-sky-900 dark:bg-sky-950/20">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                              Saved source context
                            </p>
                            <h4 className="mt-2 text-sm font-semibold text-foreground">
                              {snapshot.sourceContext.pairingLabel}
                            </h4>
                          </div>
                          <StatusBadge tone={snapshot.sourceContext.exportReady ? "success" : "warning"}>
                            {snapshot.sourceContext.exportReady ? "Export-ready" : "Review before export"}
                          </StatusBadge>
                        </div>
                        <div className="mt-2 space-y-1.5 text-sm text-muted-foreground">
                          <p>{snapshot.sourceContext.sourceSummary}</p>
                          <p>{snapshot.sourceContext.caveatSummary}</p>
                          <p>{snapshot.sourceContext.exportReadiness}</p>
                        </div>
                      </div>
                    ) : (
                      <div className="module-note mt-4 border-amber-400/40 bg-amber-50/80 dark:border-amber-900 dark:bg-amber-950/20">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                              Source context review
                            </p>
                            <h4 className="mt-2 text-sm font-semibold text-foreground">
                              Structured source context was not captured
                            </h4>
                          </div>
                          <StatusBadge tone="warning">Review before export</StatusBadge>
                        </div>
                        <div className="mt-2 space-y-1.5 text-sm text-muted-foreground">
                          <p>
                            This saved comparison may predate structured source-context metadata or may have been saved without
                            it. Treat it as a saved comparison record only until an operator verifies the run links, assumptions,
                            caveats, and report packet linkage.
                          </p>
                          <p>
                            No raw behavioral-onramp KPI rows are read or inferred here; regenerate the snapshot through the
                            scenario comparison helper to capture planner-readable source context.
                          </p>
                          <p>
                            Current pairing: {snapshot.candidateEntry?.label ?? "Unknown alternative"} vs {snapshot.baselineEntry?.label ?? "Unknown baseline"}.
                          </p>
                        </div>
                      </div>
                    )}
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

            <div className="mt-5 module-record-row">
              <div className="module-record-head">
                <div className="module-record-main">
                  <h3 className="module-record-title text-[1.05rem]">
                    {projectUnreadable ? "Project could not be read" : project?.name ?? "Unknown project"}
                  </h3>
                  <p className="module-record-summary">
                    {projectUnreadable
                      ? "This scenario set is still tied to a project; that project's record could not be read for this render, so nothing below is a statement about it."
                      : project?.summary ||
                        "No project summary yet. Use the project record to add fuller planning context."}
                  </p>
                </div>
                {project ? (
                  <Link href={`/projects/${project.id}`} className="text-sm font-medium text-muted-foreground transition hover:text-primary">
                    Open project
                  </Link>
                ) : null}
              </div>
            </div>
          </article>
        </div>

        <div className="space-y-6">
          {/* The attach picker below offers whatever loaded. An empty picker
              after a failed read would read as "this workspace has no completed
              model runs to attach", which is a claim this render cannot make. */}
          {modelRunOptionsUnreadable ? (
            <StateBlock
              tone="warning"
              compact
              title="Attachable model runs could not be listed"
              description="The model runs offered by the attach picker below could not be read. An empty picker is not a statement that this workspace has no completed model runs."
            />
          ) : null}
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
            modelRunOptions={modelRunOptionRows.map((run) => ({
              id: run.id,
              title: run.run_title,
              engineKey: run.engine_key,
              status: run.status,
              scenarioEntryId: run.scenario_entry_id,
            }))}
            baselineEntryId={baselineEntry?.id ?? null}
            linkedReports={reportLinkage.linkedReports}
            // The registry renders the SAME entries, reports and models this
            // page reads, so it makes the same sentences — "No baseline
            // registered yet", "No alternatives yet", "No linked reports yet",
            // "No model is anchored". Disclosing only in the left column left
            // the page contradicting itself, with the actionable half wrong.
            unreadable={{
              entries: entriesUnreadable,
              linkedReports: linkedReportsUnreadable,
              models: modelsUnreadable,
            }}
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
          <div className="module-record-kicker">
            <StatusBadge tone={linkedReportsUnreadable ? "warning" : "neutral"}>
              <FileStack className="h-3.5 w-3.5" />
              {linkedReportsUnreadable ? "Linkage unreadable" : `${linkedReportsWithFreshness.length} linked`}
            </StatusBadge>
            {linkedReportAttentionCount > 0 ? (
              <StatusBadge tone="warning">
                <AlertTriangle className="h-3.5 w-3.5" />
                {linkedReportAttentionCount} need{linkedReportAttentionCount === 1 ? "s" : ""} packet attention
              </StatusBadge>
            ) : null}
          </div>
        </div>

        {linkedReportsUnreadable ? (
          <div className="module-empty-state mt-5 text-sm">
            Report linkage could not be resolved for this render — this project&apos;s reports or their run links could
            not be read. Nothing is listed below, and that is not a statement that no report uses this scenario
            set&apos;s runs.
          </div>
        ) : linkedReportsWithFreshness.length === 0 ? (
          <div className="module-empty-state mt-5 text-sm">
            No linked reports yet. When comparison-ready evidence exists, create an analysis summary report from an alternative card.
          </div>
        ) : (
          <>
            <div
              className={`module-note mt-5 ${
                linkedReportAttentionCount > 0
                  ? "border-amber-400/40 bg-amber-50/80 dark:border-amber-900 dark:bg-amber-950/20"
                  : "border-emerald-400/35 bg-emerald-50/70 dark:border-emerald-900 dark:bg-emerald-950/20"
              }`}
            >
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Reports built on this scenario set
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
                        <p className="text-[0.73rem] text-muted-foreground">{formatReportTypeLabel(report.report_type)} · {report.comparisonReady ? "Comparison-ready" : "Run-linked only"} · {report.packetFreshness.detail}</p>
                        <p className="text-sm font-medium text-foreground/80">
                          {getReportPacketActionLabel(report.packetFreshness.label)}
                        </p>
                      </div>
                    </div>
                    <ArrowRight className="mt-0.5 h-4.5 w-4.5 text-muted-foreground transition group-hover:text-primary" />
                  </div>
                  <MetaList>
                    <MetaItem>{report.matchedRunIds.length} matching runs</MetaItem>
                    <MetaItem>
                      {latestArtifactByReportId.get(report.id)?.generated_at ?? report.generated_at
                        ? `Generated ${latestArtifactByReportId.get(report.id)?.generated_at ?? report.generated_at}`
                        : "Draft packet"}
                    </MetaItem>
                  </MetaList>
                </Link>
              ))}
            </div>
          </>
        )}
      </article>
    </section>
  );
}
