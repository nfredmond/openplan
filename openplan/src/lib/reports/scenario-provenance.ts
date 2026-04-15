import {
  buildScenarioComparisonSummary,
  getScenarioComparisonReadiness,
} from "@/lib/scenarios/catalog";
import { looksLikePendingScenarioSpineSchema } from "@/lib/scenarios/api";

export type ReportScenarioSupabaseLike = {
  from: (table: string) => {
    select: (query: string) => {
      in: (
        column: string,
        values: string[]
      ) => Promise<{
        data: Record<string, unknown>[] | null;
        error: { message: string; code?: string | null } | null;
      }>;
    };
  };
};

type ReportRunLike = {
  id: string;
  title: string;
  created_at: string;
};

function looksLikeOptionalScenarioSpineFallback(message: string | null | undefined) {
  return looksLikePendingScenarioSpineSchema(message ?? undefined) || /Unexpected table:/i.test(message ?? "");
}

async function safeOptionalScenarioQuery(
  run: () => PromiseLike<{
    data: Record<string, unknown>[] | null;
    error: { message: string; code?: string | null } | null;
  }>
) {
  try {
    const result = await run();
    if (result.error && looksLikeOptionalScenarioSpineFallback(result.error.message)) {
      return { data: [], error: { message: "schema cache pending" } };
    }

    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (looksLikeOptionalScenarioSpineFallback(message)) {
      return { data: [], error: { message: "schema cache pending" } };
    }

    throw error;
  }
}

type ScenarioEntryRow = {
  id: string;
  scenario_set_id: string;
  entry_type: string;
  label: string;
  attached_run_id: string | null;
  sort_order?: number | null;
  created_at?: string | null;
  updated_at: string | null;
};

type ScenarioSetRow = {
  id: string;
  title: string | null;
  baseline_entry_id: string | null;
  updated_at: string | null;
};

type RunLookupRow = {
  id: string;
  title: string | null;
  created_at: string | null;
};

type ScenarioSpineRow = {
  scenario_set_id: string;
  updated_at?: string | null;
  snapshot_at?: string | null;
};

type ScenarioComparisonSnapshotRow = {
  id: string;
  scenario_set_id: string;
  baseline_entry_id: string;
  candidate_entry_id: string;
  label: string;
  summary: string | null;
  status: string;
  updated_at: string | null;
};

type ScenarioComparisonIndicatorDeltaRow = {
  comparison_snapshot_id: string;
};

export type ReportScenarioMatchedEntry = {
  entryId: string;
  entryType: string;
  label: string;
  attachedRunId: string | null;
  attachedRunTitle: string | null;
  comparisonStatus: string;
  comparisonLabel: string;
  comparisonReady: boolean;
  entryUpdatedAt: string | null;
  runCreatedAt: string | null;
};

export type ReportScenarioSharedSpineSummary = {
  schemaPending: boolean;
  assumptionSetCount: number;
  dataPackageCount: number;
  indicatorSnapshotCount: number;
  comparisonSnapshotCount: number;
  latestAssumptionSetUpdatedAt: string | null;
  latestDataPackageUpdatedAt: string | null;
  latestIndicatorSnapshotAt: string | null;
  latestComparisonSnapshotUpdatedAt: string | null;
};

export type ReportScenarioComparisonSnapshot = {
  comparisonSnapshotId: string;
  label: string;
  summary: string | null;
  status: string;
  candidateEntryId: string;
  candidateEntryLabel: string | null;
  indicatorDeltaCount: number;
  updatedAt: string | null;
};

export type ReportScenarioSetLink = {
  scenarioSetId: string;
  scenarioSetTitle: string;
  baselineEntryId: string | null;
  baselineLabel: string | null;
  baselineRunId: string | null;
  baselineRunTitle: string | null;
  baselineRunCreatedAt: string | null;
  matchedRunIds: string[];
  matchedEntries: ReportScenarioMatchedEntry[];
  comparisonSummary: {
    totalAlternatives: number;
    readyAlternatives: number;
    blockedAlternatives: number;
    baselineEntryPresent: boolean;
    baselineRunPresent: boolean;
    label: string;
  };
  scenarioSetUpdatedAt: string | null;
  latestMatchedEntryUpdatedAt: string | null;
  latestMatchedRunCreatedAt: string | null;
  sharedSpine?: ReportScenarioSharedSpineSummary;
  comparisonSnapshots?: ReportScenarioComparisonSnapshot[];
};

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function sortScenarioEntries(left: ScenarioEntryRow, right: ScenarioEntryRow): number {
  const leftSort = typeof left.sort_order === "number" ? left.sort_order : Number.MAX_SAFE_INTEGER;
  const rightSort = typeof right.sort_order === "number" ? right.sort_order : Number.MAX_SAFE_INTEGER;
  if (leftSort !== rightSort) {
    return leftSort - rightSort;
  }

  const leftCreated = left.created_at ? new Date(left.created_at).getTime() : 0;
  const rightCreated = right.created_at ? new Date(right.created_at).getTime() : 0;
  if (leftCreated !== rightCreated) {
    return leftCreated - rightCreated;
  }

  return left.label.localeCompare(right.label);
}

function latestTimestamp(values: Array<string | null | undefined>): string | null {
  const timestamps = values
    .map((value) => (typeof value === "string" ? new Date(value).getTime() : Number.NaN))
    .filter((value) => Number.isFinite(value));

  if (timestamps.length === 0) {
    return null;
  }

  return new Date(Math.max(...timestamps)).toISOString();
}

function comparisonSummaryLabel(summary: {
  totalAlternatives: number;
  readyAlternatives: number;
  baselineEntryPresent: boolean;
  baselineRunPresent: boolean;
}): string {
  if (!summary.baselineEntryPresent) {
    return "Missing baseline";
  }

  if (!summary.baselineRunPresent) {
    return "Baseline run missing";
  }

  if (summary.totalAlternatives === 0) {
    return "Baseline only";
  }

  if (summary.readyAlternatives === summary.totalAlternatives) {
    return "Ready to compare";
  }

  if (summary.readyAlternatives === 0) {
    return "Comparison blocked";
  }

  return `${summary.readyAlternatives} of ${summary.totalAlternatives} ready`;
}

export async function loadReportScenarioSetLinks({
  supabase,
  linkedRuns,
}: {
  supabase: ReportScenarioSupabaseLike;
  linkedRuns: ReportRunLike[];
}): Promise<{ data: ReportScenarioSetLink[]; error: { message: string; code?: string | null } | null }> {
  if (linkedRuns.length === 0) {
    return { data: [], error: null };
  }

  const linkedRunIds = linkedRuns.map((run) => run.id);
  const linkedRunMap = new Map(linkedRuns.map((run) => [run.id, run]));

  const matchedEntriesResult = await supabase
    .from("scenario_entries")
    .select(
      "id, scenario_set_id, entry_type, label, attached_run_id, sort_order, created_at, updated_at"
    )
    .in("attached_run_id", linkedRunIds);

  if (matchedEntriesResult.error) {
    return { data: [], error: matchedEntriesResult.error };
  }

  const matchedEntries = (matchedEntriesResult.data ?? []) as ScenarioEntryRow[];
  if (matchedEntries.length === 0) {
    return { data: [], error: null };
  }

  const scenarioSetIds = unique(matchedEntries.map((entry) => entry.scenario_set_id));

  const [scenarioSetsResult, allEntriesResult, assumptionSetsResult, dataPackagesResult, indicatorSnapshotsResult, comparisonSnapshotsResult] = await Promise.all([
    supabase
      .from("scenario_sets")
      .select("id, title, baseline_entry_id, updated_at")
      .in("id", scenarioSetIds),
    supabase
      .from("scenario_entries")
      .select(
        "id, scenario_set_id, entry_type, label, attached_run_id, sort_order, created_at, updated_at"
      )
      .in("scenario_set_id", scenarioSetIds),
    safeOptionalScenarioQuery(() =>
      supabase
        .from("scenario_assumption_sets")
        .select("scenario_set_id, updated_at")
        .in("scenario_set_id", scenarioSetIds)
    ),
    safeOptionalScenarioQuery(() =>
      supabase
        .from("scenario_data_packages")
        .select("scenario_set_id, updated_at")
        .in("scenario_set_id", scenarioSetIds)
    ),
    safeOptionalScenarioQuery(() =>
      supabase
        .from("scenario_indicator_snapshots")
        .select("scenario_set_id, snapshot_at")
        .in("scenario_set_id", scenarioSetIds)
    ),
    safeOptionalScenarioQuery(() =>
      supabase
        .from("scenario_comparison_snapshots")
        .select(
          "id, scenario_set_id, baseline_entry_id, candidate_entry_id, label, summary, status, updated_at"
        )
        .in("scenario_set_id", scenarioSetIds)
    ),
  ]);

  if (scenarioSetsResult.error) {
    return { data: [], error: scenarioSetsResult.error };
  }

  if (allEntriesResult.error) {
    return { data: [], error: allEntriesResult.error };
  }

  const scenarioSpinePending = [
    assumptionSetsResult.error,
    dataPackagesResult.error,
    indicatorSnapshotsResult.error,
    comparisonSnapshotsResult.error,
  ].some((error) => looksLikePendingScenarioSpineSchema(error?.message));

  if (
    !scenarioSpinePending &&
    (
      assumptionSetsResult.error ||
      dataPackagesResult.error ||
      indicatorSnapshotsResult.error ||
      comparisonSnapshotsResult.error
    )
  ) {
    return {
      data: [],
      error:
        assumptionSetsResult.error ??
        dataPackagesResult.error ??
        indicatorSnapshotsResult.error ??
        comparisonSnapshotsResult.error ??
        null,
    };
  }

  const allEntries = ((allEntriesResult.data ?? []) as ScenarioEntryRow[]).sort(sortScenarioEntries);
  const scenarioSets = (scenarioSetsResult.data ?? []) as ScenarioSetRow[];
  const assumptionSets = scenarioSpinePending
    ? []
    : ((assumptionSetsResult.data ?? []) as ScenarioSpineRow[]);
  const dataPackages = scenarioSpinePending
    ? []
    : ((dataPackagesResult.data ?? []) as ScenarioSpineRow[]);
  const indicatorSnapshots = scenarioSpinePending
    ? []
    : ((indicatorSnapshotsResult.data ?? []) as ScenarioSpineRow[]);
  const comparisonSnapshots = scenarioSpinePending
    ? []
    : ((comparisonSnapshotsResult.data ?? []) as ScenarioComparisonSnapshotRow[]);

  const comparisonSnapshotIds = comparisonSnapshots.map((item) => item.id);
  const comparisonIndicatorDeltasResult = comparisonSnapshotIds.length
    ? await safeOptionalScenarioQuery(() =>
        supabase
          .from("scenario_comparison_indicator_deltas")
          .select("comparison_snapshot_id")
          .in("comparison_snapshot_id", comparisonSnapshotIds)
      )
    : { data: [], error: null };

  if (
    !scenarioSpinePending &&
    comparisonIndicatorDeltasResult.error &&
    !looksLikePendingScenarioSpineSchema(comparisonIndicatorDeltasResult.error.message)
  ) {
    return { data: [], error: comparisonIndicatorDeltasResult.error };
  }

  const comparisonIndicatorDeltas =
    scenarioSpinePending || looksLikePendingScenarioSpineSchema(comparisonIndicatorDeltasResult.error?.message)
      ? []
      : ((comparisonIndicatorDeltasResult.data ?? []) as ScenarioComparisonIndicatorDeltaRow[]);

  const comparisonIndicatorDeltaCountBySnapshotId = new Map<string, number>();
  for (const delta of comparisonIndicatorDeltas) {
    comparisonIndicatorDeltaCountBySnapshotId.set(
      delta.comparison_snapshot_id,
      (comparisonIndicatorDeltaCountBySnapshotId.get(delta.comparison_snapshot_id) ?? 0) + 1
    );
  }

  const scenarioRunIds = unique(
    allEntries
      .map((entry) => entry.attached_run_id)
      .filter((value): value is string => Boolean(value))
  );

  const scenarioRunsResult = scenarioRunIds.length
    ? await supabase.from("runs").select("id, title, created_at").in("id", scenarioRunIds)
    : { data: [], error: null };

  if (scenarioRunsResult.error) {
    return { data: [], error: scenarioRunsResult.error };
  }

  const scenarioRunMap = new Map(
    ((scenarioRunsResult.data ?? []) as RunLookupRow[]).map((run) => [run.id, run])
  );

  const rawScenarioSetLinks = scenarioSetIds.map((scenarioSetId) => {
        const scenarioSet = scenarioSets.find((item) => item.id === scenarioSetId);
        if (!scenarioSet) {
          return null;
        }

        const setEntries = allEntries.filter((entry) => entry.scenario_set_id === scenarioSetId);
        const baselineEntry =
          setEntries.find((entry) => entry.id === scenarioSet.baseline_entry_id) ??
          setEntries.find((entry) => entry.entry_type === "baseline") ??
          null;
        const alternativeEntries = setEntries.filter((entry) => entry.entry_type !== "baseline");
        const comparisonSummary = buildScenarioComparisonSummary({
          baselineEntryId: baselineEntry?.id ?? null,
          baselineRunId: baselineEntry?.attached_run_id ?? null,
          candidateRunIds: alternativeEntries.map((entry) => entry.attached_run_id),
        });

        const matchedEntriesForSet = unique(
          matchedEntries
            .filter((entry) => entry.scenario_set_id === scenarioSetId)
            .sort(sortScenarioEntries)
            .map((entry) => entry.id)
        )
          .map((entryId) => setEntries.find((entry) => entry.id === entryId) ?? null)
          .filter((entry): entry is ScenarioEntryRow => Boolean(entry))
          .map((entry) => {
            if (entry.entry_type === "baseline") {
              return {
                entryId: entry.id,
                entryType: entry.entry_type,
                label: entry.label,
                attachedRunId: entry.attached_run_id,
                attachedRunTitle:
                  (entry.attached_run_id
                    ? linkedRunMap.get(entry.attached_run_id)?.title ??
                      scenarioRunMap.get(entry.attached_run_id)?.title
                    : null) ?? null,
                comparisonStatus: "baseline",
                comparisonLabel: "Baseline reference",
                comparisonReady: Boolean(entry.attached_run_id),
                entryUpdatedAt: entry.updated_at,
                runCreatedAt:
                  (entry.attached_run_id
                    ? linkedRunMap.get(entry.attached_run_id)?.created_at ??
                      scenarioRunMap.get(entry.attached_run_id)?.created_at
                    : null) ?? null,
              } satisfies ReportScenarioMatchedEntry;
            }

            const readiness = getScenarioComparisonReadiness({
              baselineEntryId: baselineEntry?.id ?? null,
              baselineRunId: baselineEntry?.attached_run_id ?? null,
              candidateRunId: entry.attached_run_id,
            });

            return {
              entryId: entry.id,
              entryType: entry.entry_type,
              label: entry.label,
              attachedRunId: entry.attached_run_id,
              attachedRunTitle:
                (entry.attached_run_id
                  ? linkedRunMap.get(entry.attached_run_id)?.title ??
                    scenarioRunMap.get(entry.attached_run_id)?.title
                  : null) ?? null,
              comparisonStatus: readiness.status,
              comparisonLabel: readiness.label,
              comparisonReady: readiness.ready,
              entryUpdatedAt: entry.updated_at,
              runCreatedAt:
                (entry.attached_run_id
                  ? linkedRunMap.get(entry.attached_run_id)?.created_at ??
                    scenarioRunMap.get(entry.attached_run_id)?.created_at
                  : null) ?? null,
            } satisfies ReportScenarioMatchedEntry;
          });

        const baselineRun = baselineEntry?.attached_run_id
          ? linkedRunMap.get(baselineEntry.attached_run_id) ??
            scenarioRunMap.get(baselineEntry.attached_run_id) ??
            null
          : null;

        const assumptionRowsForSet = assumptionSets.filter(
          (item) => item.scenario_set_id === scenarioSetId
        );
        const dataPackageRowsForSet = dataPackages.filter(
          (item) => item.scenario_set_id === scenarioSetId
        );
        const indicatorRowsForSet = indicatorSnapshots.filter(
          (item) => item.scenario_set_id === scenarioSetId
        );
        const comparisonRowsForSet = comparisonSnapshots.filter(
          (item) => item.scenario_set_id === scenarioSetId
        );
        const comparisonSnapshotsForSet = comparisonRowsForSet.map((item) => ({
          comparisonSnapshotId: item.id,
          label: item.label,
          summary: item.summary,
          status: item.status,
          candidateEntryId: item.candidate_entry_id,
          candidateEntryLabel:
            setEntries.find((entry) => entry.id === item.candidate_entry_id)?.label ?? null,
          indicatorDeltaCount:
            comparisonIndicatorDeltaCountBySnapshotId.get(item.id) ?? 0,
          updatedAt: item.updated_at,
        }));

        return {
          scenarioSetId,
          scenarioSetTitle: scenarioSet.title ?? "Scenario set",
          baselineEntryId: baselineEntry?.id ?? null,
          baselineLabel: baselineEntry?.label ?? null,
          baselineRunId: baselineEntry?.attached_run_id ?? null,
          baselineRunTitle: baselineRun?.title ?? null,
          baselineRunCreatedAt: baselineRun?.created_at ?? null,
          matchedRunIds: unique(
            matchedEntriesForSet
              .map((entry) => entry.attachedRunId)
              .filter((value): value is string => Boolean(value))
          ),
          matchedEntries: matchedEntriesForSet,
          comparisonSummary: {
            ...comparisonSummary,
            label: comparisonSummaryLabel(comparisonSummary),
          },
          scenarioSetUpdatedAt: scenarioSet.updated_at,
          latestMatchedEntryUpdatedAt: latestTimestamp(
            matchedEntriesForSet.map((entry) => entry.entryUpdatedAt)
          ),
          latestMatchedRunCreatedAt: latestTimestamp(
            matchedEntriesForSet.map((entry) => entry.runCreatedAt)
          ),
          sharedSpine: {
            schemaPending: scenarioSpinePending,
            assumptionSetCount: assumptionRowsForSet.length,
            dataPackageCount: dataPackageRowsForSet.length,
            indicatorSnapshotCount: indicatorRowsForSet.length,
            comparisonSnapshotCount: comparisonRowsForSet.length,
            latestAssumptionSetUpdatedAt: latestTimestamp(
              assumptionRowsForSet.map((item) => item.updated_at)
            ),
            latestDataPackageUpdatedAt: latestTimestamp(
              dataPackageRowsForSet.map((item) => item.updated_at)
            ),
            latestIndicatorSnapshotAt: latestTimestamp(
              indicatorRowsForSet.map((item) => item.snapshot_at)
            ),
            latestComparisonSnapshotUpdatedAt: latestTimestamp(
              comparisonRowsForSet.map((item) => item.updated_at)
            ),
          },
          comparisonSnapshots: comparisonSnapshotsForSet,
        } satisfies ReportScenarioSetLink;
      });

  const scenarioSetLinks: ReportScenarioSetLink[] = rawScenarioSetLinks.filter(
    (item): item is NonNullable<(typeof rawScenarioSetLinks)[number]> => item !== null
  );

  return {
    data: scenarioSetLinks,
    error: null,
  };
}
