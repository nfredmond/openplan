import {
  buildScenarioComparisonSummary,
  getScenarioComparisonReadiness,
} from "@/lib/scenarios/catalog";

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

  const [scenarioSetsResult, allEntriesResult] = await Promise.all([
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
  ]);

  if (scenarioSetsResult.error) {
    return { data: [], error: scenarioSetsResult.error };
  }

  if (allEntriesResult.error) {
    return { data: [], error: allEntriesResult.error };
  }

  const allEntries = ((allEntriesResult.data ?? []) as ScenarioEntryRow[]).sort(sortScenarioEntries);
  const scenarioSets = (scenarioSetsResult.data ?? []) as ScenarioSetRow[];

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

  return {
    data: scenarioSetIds
      .map((scenarioSetId) => {
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
        } satisfies ReportScenarioSetLink;
      })
      .filter((item): item is ReportScenarioSetLink => Boolean(item)),
    error: null,
  };
}
