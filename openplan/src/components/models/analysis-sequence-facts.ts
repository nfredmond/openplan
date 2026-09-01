import type { SupabaseClient } from "@supabase/supabase-js";

import {
  HOME_GEOGRAPHY_COLUMNS,
  parseWorkspaceHomeGeography,
  placeOfRecordFromHomeGeography,
} from "@/lib/workspaces/home-geography";
import {
  PROJECT_PLACE_COLUMNS,
  placeOfRecordFromProject,
  type ProjectPlaceRow,
} from "@/lib/projects/project-place";
import {
  GUIDED_PROJECT_COMPARISON_MODELS,
  hasGuidedProjectComparisonIntent,
  isGuidedProjectComparisonModel,
  usesGuidedWorkerNetwork,
} from "@/lib/models/project-comparison";
import {
  collectGuidedRunEvidence,
  guidedEvidenceSharesExactNetwork,
  snapshotHasExactGuidedEvidence,
  type GuidedRunJob,
  type GuidedRunRow,
  type ModelRunArtifactRow,
  type ModelRunStageRow,
  type ScenarioComparisonModelRunLinkRow,
} from "@/lib/models/guided-model-evidence";
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
  const scenarioSetsQuery = supabase.from("scenario_sets").select("id, baseline_entry_id").eq("workspace_id", workspaceId);
  const modelsQuery = supabase.from("models").select("id, scenario_set_id, model_family, config_json").eq("workspace_id", workspaceId);
  const geographyQuery = projectId
    ? supabase.from("projects").select(PROJECT_PLACE_COLUMNS).eq("id", projectId).eq("workspace_id", workspaceId).maybeSingle()
    : supabase.from("workspaces").select(HOME_GEOGRAPHY_COLUMNS).eq("id", workspaceId).maybeSingle();
  const [geographyResult, packagesResult, scenarioSetsResult, modelsResult] =
    await Promise.all([
      geographyQuery,
      supabase.from("network_packages").select("id").eq("workspace_id", workspaceId),
      projectId ? scenarioSetsQuery.eq("project_id", projectId) : scenarioSetsQuery,
      projectId ? modelsQuery.eq("project_id", projectId) : modelsQuery,
    ]);

  const unreadable: AnalysisStepId[] = [];

  const home = failed(geographyResult)
    ? null
    : projectId
      ? placeOfRecordFromProject(geographyResult.data as unknown as Partial<ProjectPlaceRow>)
      : placeOfRecordFromHomeGeography(parseWorkspaceHomeGeography(geographyResult.data));
  if (failed(geographyResult)) unreadable.push("area");

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
    scenario_set_id: string | null;
    model_family: string;
    config_json?: unknown;
  }>;
  const modelIds = modelRows.map((row) => row.id);
  const scenarioSetRows = (scenarioSetsResult.data ?? []) as Array<{ id: string; baseline_entry_id: string | null }>;
  const scenarioSetIds = scenarioSetRows.map((row) => row.id);

  // Networks are counted by VERSION, not by package: a package with no version
  // in it is a name, and nothing can be run against a name. The count therefore
  // matches what step two actually asks for.
  const versionsResult = packageIds.length
    ? await supabase.from("network_package_versions").select("id").in("package_id", packageIds)
    : { data: [] as Array<{ id: string }>, error: null };
  if (failed(versionsResult)) unreadable.push("network");

  const runsResult = modelIds.length
    ? await supabase.from("model_runs").select("id, model_id, scenario_entry_id, engine_key, status, assumption_snapshot_json, created_at").in("model_id", modelIds).order("created_at", { ascending: false }).order("id", { ascending: false })
    : { data: [] as Array<{ id: string; model_id: string; scenario_entry_id: string | null; status: string }>, error: null };
  const entriesResult = scenarioSetIds.length
    ? await supabase.from("scenario_entries").select("id, scenario_set_id, entry_type, assumptions_json").in("scenario_set_id", scenarioSetIds)
    : { data: [], error: null };
  const comparisonPacketsResult = scenarioSetIds.length
    ? await supabase
        .from("scenario_comparison_snapshots")
        .select("id, scenario_set_id, status")
        .in("scenario_set_id", scenarioSetIds)
    : { data: [] as Array<{ id: string; status: string }>, error: null };
  // With no models there is nothing to have run, and the empty array is the
  // right answer rather than an unread one — so only a real failure is recorded.
  if (failed(runsResult)) unreadable.push("run", "activitysim_run");
  if (failed(entriesResult)) unreadable.push("comparison");
  if (failed(comparisonPacketsResult)) unreadable.push("packet");

  const modelFamilyById = new Map(modelRows.map((row) => [row.id, row.model_family]));
  const aequilibraeModelCount = modelRows.filter((row) => row.model_family === "travel_demand").length;
  const activitySimModelCount = modelRows.filter((row) => row.model_family === "activity_based_model").length;
  const guidedIntent = modelRows.some((row) => hasGuidedProjectComparisonIntent(row.config_json));
  const managedNetworkBasisCount = scenarioSetRows.filter((scenarioSet) =>
    GUIDED_PROJECT_COMPARISON_MODELS.every((definition) =>
      modelRows.some(
        (row) => row.scenario_set_id === scenarioSet.id &&
          isGuidedProjectComparisonModel(row.config_json, definition.method) &&
          usesGuidedWorkerNetwork(row.config_json),
      ),
    ),
  ).length;
  const runRows = (runsResult.data ?? []) as GuidedRunRow[];
  const guidedProjectComparison = guidedIntent;
  const entries = (entriesResult.data ?? []) as Array<{
    id: string;
    scenario_set_id: string;
    entry_type: string;
    assumptions_json?: unknown;
  }>;
  const guidedJobs: GuidedRunJob[] = [];
  for (const scenarioSet of scenarioSetRows) {
    const baselineEntry = entries.find(
      (entry) => entry.id === scenarioSet.baseline_entry_id,
    ) ?? entries.find(
      (entry) => entry.scenario_set_id === scenarioSet.id && entry.entry_type === "baseline",
    );
    const buildEntry = entries.find(
      (entry) => entry.scenario_set_id === scenarioSet.id && entry.entry_type !== "baseline",
    );
    const aeq = modelRows.find((model) =>
      model.scenario_set_id === scenarioSet.id && isGuidedProjectComparisonModel(model.config_json, "aequilibrae"),
    );
    const asim = modelRows.find((model) =>
      model.scenario_set_id === scenarioSet.id && isGuidedProjectComparisonModel(model.config_json, "activitysim"),
    );
    if (!baselineEntry || !buildEntry || !aeq || !asim) continue;
    guidedJobs.push(
      { method: "aequilibrae", scenario: "baseline", modelId: aeq.id, scenarioEntryId: baselineEntry.id, assumptionsJson: (baselineEntry.assumptions_json as Record<string, unknown> | null) ?? {} },
      { method: "aequilibrae", scenario: "build", modelId: aeq.id, scenarioEntryId: buildEntry.id, assumptionsJson: (buildEntry.assumptions_json as Record<string, unknown> | null) ?? {} },
      { method: "activitysim", scenario: "baseline", modelId: asim.id, scenarioEntryId: baselineEntry.id, assumptionsJson: (baselineEntry.assumptions_json as Record<string, unknown> | null) ?? {} },
      { method: "activitysim", scenario: "build", modelId: asim.id, scenarioEntryId: buildEntry.id, assumptionsJson: (buildEntry.assumptions_json as Record<string, unknown> | null) ?? {} },
    );
  }
  const runIds = runRows.map((run) => run.id);
  const artifactsResult = runIds.length
    ? await supabase.from("model_run_artifacts")
        .select("id, run_id, stage_id, artifact_type, file_url, file_size_bytes, content_hash, metadata_json, created_at")
        .in("run_id", runIds)
        .in("artifact_type", ["link_volumes", "activitysim_link_volumes"])
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
    : { data: [], error: null };
  if (failed(artifactsResult)) unreadable.push("run", "activitysim_run");
  const stagesResult = runIds.length
    ? await supabase.from("model_run_stages")
        .select("id, run_id, stage_name, status")
        .in("run_id", runIds)
        .in("stage_name", ["Artifact Extraction", "ActivitySim Network Assignment"])
    : { data: [], error: null };
  if (failed(stagesResult)) unreadable.push("run", "activitysim_run");
  const guidedEvidence = collectGuidedRunEvidence(
    guidedJobs,
    runRows,
    (artifactsResult.data ?? []) as ModelRunArtifactRow[],
    (stagesResult.data ?? []) as ModelRunStageRow[],
  );
  const aequilibraeRunCount = guidedProjectComparison
    ? guidedEvidence.filter((item) => item.method === "aequilibrae").length
    : runRows.filter((row) => modelFamilyById.get(row.model_id) === "travel_demand").length;
  const activitySimRunCount = guidedProjectComparison
    ? guidedEvidence.filter((item) => item.method === "activitysim").length
    : runRows.filter((row) => modelFamilyById.get(row.model_id) === "activity_based_model").length;

  const evidenceRunIds = guidedEvidence.map((item) => item.runId);
  const claimDecisionsResult = evidenceRunIds.length
    ? await supabase.from("modeling_claim_decisions")
        .select("model_run_id, track, claim_status")
        .in("model_run_id", evidenceRunIds)
    : { data: [], error: null };
  if (failed(claimDecisionsResult)) unreadable.push("check");
  const expectedTrackByRun = new Map(
    guidedEvidence.map((item) => [item.runId, item.method === "aequilibrae" ? "assignment" : "behavioral_demand"]),
  );
  const exactTrackDecisions = ((claimDecisionsResult.data ?? []) as Array<{
    model_run_id: string;
    track: string;
    claim_status: string;
  }>).filter(
    (decision) =>
      expectedTrackByRun.get(decision.model_run_id) === decision.track,
  );
  const checkedRunCount = new Set(exactTrackDecisions.map((decision) => decision.model_run_id)).size;
  const nonPrototypeCheckedRunCount = new Set(exactTrackDecisions
    .filter((decision) => decision.claim_status !== "prototype_only")
    .map((decision) => decision.model_run_id)).size;
  const guidedComparisonCheckedCount = scenarioSetRows.filter((scenarioSet) => {
    const setModelIds = new Set(modelRows.filter((model) => model.scenario_set_id === scenarioSet.id).map((model) => model.id));
    const setEvidence = guidedEvidence.filter((item) => setModelIds.has(item.modelId));
    if (!guidedEvidenceSharesExactNetwork(setEvidence)) return false;
    return setEvidence.every((item) => exactTrackDecisions.some((decision) => decision.model_run_id === item.runId));
  }).length;

  const readySnapshots = ((comparisonPacketsResult.data ?? []) as Array<{
    id: string;
    scenario_set_id: string;
    status: string;
  }>).filter((snapshot) => snapshot.status === "ready");
  const snapshotLinksResult = readySnapshots.length
    ? await supabase.from("scenario_comparison_model_run_links")
        .select("comparison_snapshot_id, model_run_id, model_run_artifact_id, method, scenario_role, artifact_type, artifact_sha256, assignment_profile_sha256, network_settings_sha256, network_state_sha256, scenario_assumptions_json")
        .in("comparison_snapshot_id", readySnapshots.map((snapshot) => snapshot.id))
    : { data: [], error: null };
  if (failed(snapshotLinksResult)) unreadable.push("packet");
  const snapshotLinks = (snapshotLinksResult.data ?? []) as ScenarioComparisonModelRunLinkRow[];
  const comparisonPacketCount = guidedProjectComparison
    ? readySnapshots.filter((snapshot) => {
        const setJobs = guidedJobs.filter((job) => {
          const model = modelRows.find((row) => row.id === job.modelId);
          return model?.scenario_set_id === snapshot.scenario_set_id;
        });
        const setEvidence = collectGuidedRunEvidence(
          setJobs,
          runRows,
          (artifactsResult.data ?? []) as ModelRunArtifactRow[],
          (stagesResult.data ?? []) as ModelRunStageRow[],
        );
        return snapshotHasExactGuidedEvidence(snapshot.id, snapshotLinks, setEvidence);
      }).length
    : readySnapshots.length;
  const savedComparisonPacketCount = readySnapshots.length;

  return {
    areaLabel,
    networkCount: ((versionsResult.data ?? []) as Array<{ id: string }>).length,
    managedNetworkBasisCount,
    guidedProjectComparison,
    scenarioSetCount: scenarioSetRows.length,
    modelCount: modelIds.length,
    aequilibraeModelCount,
    activitySimModelCount,
    runCount: runRows.length,
    aequilibraeRunCount,
    activitySimRunCount,
    checkedRunCount,
    nonPrototypeCheckedRunCount,
    guidedComparisonCheckedCount,
    comparisonPacketCount,
    savedComparisonPacketCount,
    unreadable: Array.from(new Set(unreadable)),
  };
}
