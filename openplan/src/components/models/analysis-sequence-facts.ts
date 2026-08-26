import type { SupabaseClient } from "@supabase/supabase-js";

import {
  HOME_GEOGRAPHY_COLUMNS,
  parseWorkspaceHomeGeography,
  placeOfRecordFromHomeGeography,
} from "@/lib/workspaces/home-geography";
import { isPassingCountyRunGateStatus } from "@/lib/models/county-onramp";
import {
  GUIDED_PROJECT_COMPARISON_MODELS,
  isGuidedProjectComparisonModel,
  usesGuidedWorkerNetwork,
} from "@/lib/models/project-comparison";
import type { AnalysisSequenceFacts, AnalysisStepId } from "@/components/models/analysis-sequence";

/**
 * The six reads behind the analysis sequence, done once for every page in the
 * group.
 *
 * WHY ONE FUNCTION AND NOT SIX PAGES DOING THEIR OWN. The gate on step six is
 * the same verdict `/models/[id]` already computes to decide whether its numbers
 * may leave the agency, and `isPassingCountyRunGateStatus` is the one place that
 * verdict is defined. A second, near-identical copy on four more pages is the
 * "shared capability reimplemented wrongly by the second caller" failure this
 * repository keeps hitting — so the caller list grows and the rule does not.
 *
 * A FAILED READ IS NOT A ZERO. Each read that fails names its step in
 * `unreadable`, and the sequence then reports that step as unknown rather than
 * missing. "You have not picked an area yet" is a statement about the agency;
 * a query that failed cannot make it.
 *
 * SCHEMA THIS DEPLOYMENT HAS NOT REACHED YET is treated the same way — unknown,
 * not absent — because a table that does not exist yet says nothing about
 * whether the planner has done the work.
 *
 * NO `import "server-only"` HERE, deliberately. It would make this module
 * unimportable from vitest, and the one thing in it that most needs a test is
 * the screening gate below — the check that decides whether a planner is told
 * their numbers have been measured against the real world.
 */

/** Anything supabase-js hands back from a `.select()`. */
type ReadResult = { error: { message?: string } | null };

function failed(result: ReadResult): boolean {
  return Boolean(result.error);
}

export async function loadAnalysisSequenceFacts(
  supabase: SupabaseClient,
  workspaceId: string,
  projectId?: string | null
): Promise<AnalysisSequenceFacts> {
  const scenarioSetsQuery = supabase.from("scenario_sets").select("id").eq("workspace_id", workspaceId);
  const modelsQuery = supabase.from("models").select("id, model_family, config_json").eq("workspace_id", workspaceId);
  const [workspaceResult, packagesResult, scenarioSetsResult, modelsResult, countyRunsResult] =
    await Promise.all([
      supabase.from("workspaces").select(HOME_GEOGRAPHY_COLUMNS).eq("id", workspaceId).maybeSingle(),
      supabase.from("network_packages").select("id").eq("workspace_id", workspaceId),
      projectId ? scenarioSetsQuery.eq("project_id", projectId) : scenarioSetsQuery,
      projectId ? modelsQuery.eq("project_id", projectId) : modelsQuery,
      supabase.from("county_runs").select("stage, status_label, run_summary_json").eq("workspace_id", workspaceId),
    ]);

  const unreadable: AnalysisStepId[] = [];

  const home = failed(workspaceResult)
    ? null
    : placeOfRecordFromHomeGeography(parseWorkspaceHomeGeography(workspaceResult.data));
  if (failed(workspaceResult)) unreadable.push("area");

  // A boundary that was drawn or uploaded may carry no name. It is still an
  // area, and reporting "nothing chosen yet" over the top of a drawn boundary
  // would send a planner to redo work they have already done — so the presence
  // test is the boundary, and the name is only what it gets CALLED.
  const areaLabel = home
    ? home.label?.trim() || (home.geometry ? "the boundary on file" : null)
    : null;
  if (failed(packagesResult)) unreadable.push("network");
  if (failed(scenarioSetsResult)) unreadable.push("comparison");
  if (failed(modelsResult)) unreadable.push("model");

  const packageIds = ((packagesResult.data ?? []) as Array<{ id: string }>).map((row) => row.id);
  const modelRows = (modelsResult.data ?? []) as Array<{
    id: string;
    model_family: string;
    config_json?: unknown;
  }>;
  const modelIds = modelRows.map((row) => row.id);
  const scenarioSetIds = ((scenarioSetsResult.data ?? []) as Array<{ id: string }>).map((row) => row.id);

  // Networks are counted by VERSION, not by package: a package with no version
  // in it is a name, and nothing can be run against a name. The count therefore
  // matches what step two actually asks for.
  const versionsResult = packageIds.length
    ? await supabase.from("network_package_versions").select("id").in("package_id", packageIds)
    : { data: [] as Array<{ id: string }>, error: null };
  if (failed(versionsResult)) unreadable.push("network");

  const runsResult = modelIds.length
    ? await supabase.from("model_runs").select("id, model_id, scenario_entry_id, status").in("model_id", modelIds)
    : { data: [] as Array<{ id: string; model_id: string; scenario_entry_id: string | null; status: string }>, error: null };
  const comparisonPacketsResult = scenarioSetIds.length
    ? await supabase
        .from("scenario_comparison_snapshots")
        .select("id, status")
        .in("scenario_set_id", scenarioSetIds)
    : { data: [] as Array<{ id: string; status: string }>, error: null };
  // With no models there is nothing to have run, and the empty array is the
  // right answer rather than an unread one — so only a real failure is recorded.
  if (failed(runsResult)) unreadable.push("run", "activitysim_run");
  if (failed(countyRunsResult)) unreadable.push("check");
  if (failed(comparisonPacketsResult)) unreadable.push("packet");

  const modelFamilyById = new Map(modelRows.map((row) => [row.id, row.model_family]));
  const aequilibraeModelCount = modelRows.filter((row) => row.model_family === "travel_demand").length;
  const activitySimModelCount = modelRows.filter((row) => row.model_family === "activity_based_model").length;
  const managedNetworkBasisCount = GUIDED_PROJECT_COMPARISON_MODELS.every((definition) =>
    modelRows.some(
      (row) =>
        isGuidedProjectComparisonModel(row.config_json, definition.method) &&
        usesGuidedWorkerNetwork(row.config_json),
    ),
  )
    ? 1
    : 0;
  const runRows = (runsResult.data ?? []) as Array<{
    id: string;
    model_id: string;
    scenario_entry_id: string | null;
    status: string;
  }>;
  const guidedProjectComparison = managedNetworkBasisCount > 0;
  const successfulScenarioCount = (family: string) => new Set(
    runRows
      .filter((row) =>
        modelFamilyById.get(row.model_id) === family &&
        row.status === "succeeded" &&
        row.scenario_entry_id
      )
      .map((row) => row.scenario_entry_id as string)
  ).size;
  const aequilibraeRunCount = guidedProjectComparison
    ? successfulScenarioCount("travel_demand")
    : runRows.filter((row) => modelFamilyById.get(row.model_id) === "travel_demand").length;
  const activitySimRunCount = guidedProjectComparison
    ? successfulScenarioCount("activity_based_model")
    : runRows.filter((row) => modelFamilyById.get(row.model_id) === "activity_based_model").length;

  const countyRows = (countyRunsResult.data ?? []) as Array<{
    stage: string | null;
    status_label: string | null;
    run_summary_json: { intrazonal_trip_share?: unknown } | null;
  }>;

  // The SAME test `/models/[id]` applies before it will let a number out:
  // reaching the validated-screening stage says the checking ran, not that it
  // passed, and a run whose zones are too coarse for a road-by-road comparison
  // did not establish anything whatever its recorded gate says.
  const checkedRunCount = countyRows.filter((row) => {
    const share = row.run_summary_json?.intrazonal_trip_share;
    return (
      row.stage === "validated-screening" &&
      isPassingCountyRunGateStatus(row.status_label, typeof share === "number" ? share : null)
    );
  }).length;

  return {
    areaLabel,
    networkCount: ((versionsResult.data ?? []) as Array<{ id: string }>).length,
    managedNetworkBasisCount,
    guidedProjectComparison,
    scenarioSetCount: ((scenarioSetsResult.data ?? []) as Array<{ id: string }>).length,
    modelCount: modelIds.length,
    aequilibraeModelCount,
    activitySimModelCount,
    runCount: runRows.length,
    aequilibraeRunCount,
    activitySimRunCount,
    checkedRunCount,
    comparisonPacketCount: ((comparisonPacketsResult.data ?? []) as Array<{ id: string }>).length,
    unreadable: Array.from(new Set(unreadable)),
  };
}
