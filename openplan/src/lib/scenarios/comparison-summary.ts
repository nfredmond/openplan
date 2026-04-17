import type { SupabaseClient } from "@supabase/supabase-js";

export type ScenarioComparisonSummaryRow = {
  scenario_set_id: string;
  indicator_key: string;
  indicator_label: string | null;
  unit_label: string | null;
  latest_delta_json: Record<string, unknown> | null;
  latest_summary_text: string | null;
  latest_ready_updated_at: string | null;
  ready_snapshot_count: number;
  total_snapshot_count: number;
};

export type ScenarioComparisonSummarySupabaseLike = Pick<SupabaseClient, "from">;

export type LoadScenarioComparisonSummaryInput = {
  supabase: ScenarioComparisonSummarySupabaseLike;
  scenarioSetIds: string[];
  indicatorKeys?: string[];
};

export type ScenarioComparisonSummaryResult = {
  rows: ScenarioComparisonSummaryRow[];
  error: { message: string; code?: string | null } | null;
};

export async function loadScenarioComparisonSummary({
  supabase,
  scenarioSetIds,
  indicatorKeys,
}: LoadScenarioComparisonSummaryInput): Promise<ScenarioComparisonSummaryResult> {
  const uniqueSetIds = Array.from(new Set(scenarioSetIds.filter(Boolean)));
  if (uniqueSetIds.length === 0) {
    return { rows: [], error: null };
  }

  let query = supabase
    .from("scenario_comparison_summary")
    .select(
      "scenario_set_id, indicator_key, indicator_label, unit_label, latest_delta_json, latest_summary_text, latest_ready_updated_at, ready_snapshot_count, total_snapshot_count"
    )
    .in("scenario_set_id", uniqueSetIds);

  if (indicatorKeys && indicatorKeys.length > 0) {
    const uniqueKeys = Array.from(new Set(indicatorKeys.filter(Boolean)));
    if (uniqueKeys.length > 0) {
      query = query.in("indicator_key", uniqueKeys);
    }
  }

  const { data, error } = await query;

  if (error) {
    return {
      rows: [],
      error: { message: error.message, code: error.code ?? null },
    };
  }

  return {
    rows: (data ?? []) as ScenarioComparisonSummaryRow[],
    error: null,
  };
}

export function groupScenarioComparisonSummaryByIndicator(
  rows: ScenarioComparisonSummaryRow[]
): Map<string, ScenarioComparisonSummaryRow[]> {
  const grouped = new Map<string, ScenarioComparisonSummaryRow[]>();
  for (const row of rows) {
    const bucket = grouped.get(row.indicator_key);
    if (bucket) {
      bucket.push(row);
    } else {
      grouped.set(row.indicator_key, [row]);
    }
  }
  return grouped;
}

export function totalReadySnapshotCount(rows: ScenarioComparisonSummaryRow[]): number {
  return rows.reduce((total, row) => total + (row.ready_snapshot_count ?? 0), 0);
}

export type LoadScenarioComparisonSummaryForProjectsInput = {
  supabase: ScenarioComparisonSummarySupabaseLike;
  projectIds: string[];
  indicatorKeys?: string[];
};

export type ScenarioComparisonSummaryForProjectsResult = {
  rows: ScenarioComparisonSummaryRow[];
  scenarioSetProjectMap: Map<string, string>;
  error: { message: string; code?: string | null } | null;
};

export async function loadScenarioComparisonSummaryForProjects({
  supabase,
  projectIds,
  indicatorKeys,
}: LoadScenarioComparisonSummaryForProjectsInput): Promise<ScenarioComparisonSummaryForProjectsResult> {
  const uniqueProjectIds = Array.from(new Set(projectIds.filter(Boolean)));
  if (uniqueProjectIds.length === 0) {
    return { rows: [], scenarioSetProjectMap: new Map(), error: null };
  }

  const scenarioSetsResult = await supabase
    .from("scenario_sets")
    .select("id, project_id")
    .in("project_id", uniqueProjectIds);

  if (scenarioSetsResult.error) {
    return {
      rows: [],
      scenarioSetProjectMap: new Map(),
      error: {
        message: scenarioSetsResult.error.message,
        code: scenarioSetsResult.error.code ?? null,
      },
    };
  }

  const setRows = (scenarioSetsResult.data ?? []) as Array<{ id: string; project_id: string }>;
  if (setRows.length === 0) {
    return { rows: [], scenarioSetProjectMap: new Map(), error: null };
  }

  const scenarioSetProjectMap = new Map<string, string>();
  for (const row of setRows) {
    scenarioSetProjectMap.set(row.id, row.project_id);
  }

  const summary = await loadScenarioComparisonSummary({
    supabase,
    scenarioSetIds: setRows.map((row) => row.id),
    indicatorKeys,
  });

  return {
    rows: summary.rows,
    scenarioSetProjectMap,
    error: summary.error,
  };
}
