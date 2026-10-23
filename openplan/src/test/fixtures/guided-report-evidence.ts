/** Synthetic custody fixture. Values reproduce the supplied VMT example only. */
import { createHash } from "node:crypto";
import { populationFixture } from "@/test/fixtures/common-population-evidence";
import { sortedCompactJson } from "@/lib/models/demand-agreement-artifact";
import { buildGuidedComparisonResults, type GuidedComparisonDecision, type GuidedComparisonKpi, type GuidedComparisonLink } from "@/lib/models/guided-comparison-results";
import { GUIDED_REPORT_CAVEATS, guidedReportCanonicalJson, type GuidedComparisonSelectionV1 } from "@/lib/reports/guided-comparison";
export type EvidenceRow = Record<string, unknown>;
export const reportId = (n: number) => `${String(n).padStart(8, "0")}-1111-4111-8111-111111111111`;
export const REPORT_WORKSPACE = reportId(1), REPORT_PROJECT = reportId(2), REPORT_SNAPSHOT = reportId(3), REPORT_SET = reportId(4);
export const hashBytes = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
export const encodeRecord = (value: unknown) => new TextEncoder().encode(guidedReportCanonicalJson(value));
const roles = ["households", "persons", "selected_zones", "diagnostics", "source_manifest", "source_zone_attributes"];

export function guidedReportFixture() {
  const tables: Record<string, EvidenceRow[]> = {};
  const bytes = new Map<string, Uint8Array>();
  let nextId = 100;
  const geometry = { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] };
  const change = { guidedProjectChange: { kind: "assigned_auto_trip_change_pct", autoTripChangePct: -5, basis: "Synthetic sensitivity assumption <script>unsafe</script>" } };
  const runs = [10, 11, 12, 13].map(reportId);
  const population = populationFixture(runs[0], "legacy_stage_snapshot");
  const companionFiles = Object.fromEntries(roles.map((role) => {
    const data = encodeRecord({ role, content: "synthetic input" });
    const path = role === "households" || role === "persons" || role === "source_zone_attributes" ? `${role}.csv` : `${role}.json`;
    return [role, { path, sha256: hashBytes(data), bytes: data.byteLength }] as const;
  }));
  const manifest = { source_profile: population.basis.source_profile, universe: population.basis.universe, exclusions: population.basis.exclusions,
    selected_zone_map: companionFiles.selected_zones, realized_zone_counts: population.basis.realized_zone_counts, files: companionFiles };
  const manifestBytes = encodeRecord(manifest);
  population.basis.manifest = { path: "common_population.json", sha256: hashBytes(manifestBytes), bytes: manifestBytes.byteLength };
  population.basis.selected_zone_map = companionFiles.selected_zones;
  population.basis.source_manifest = companionFiles.source_manifest;
  const identityJson = sortedCompactJson(population.basis);
  const identityDigest = hashBytes(new TextEncoder().encode(identityJson));
  Object.assign(population.source, { sha256: hashBytes(manifestBytes), sizeBytes: manifestBytes.byteLength });
  for (const metadata of [population.metadata, population.sourceMetadata]) Object.assign(metadata, {
    population_basis: population.basis, population_basis_payload_json: identityJson, population_basis_digest: identityDigest });
  Object.assign(population.snapshot, { populationBasisDigest: identityDigest, manifest: population.basis.manifest });
  const profileJson = '{"solver":"synthetic"}', settingsJson = '{"capacity":"shared"}';
  const digestText = (text: string) => hashBytes(new TextEncoder().encode(text));
  const networkState = { network_settings_digest: digestText(settingsJson), source: "synthetic exact network" };
  const network = { assignment_profile: JSON.parse(profileJson), assignment_profile_payload_json: profileJson, assignment_profile_digest: digestText(profileJson),
    network_settings: JSON.parse(settingsJson), network_settings_payload_json: settingsJson, network_settings_digest: digestText(settingsJson),
    network_state_record: networkState, network_state_digest: digestText(sortedCompactJson(networkState)) };
  tables.projects = [{ id: REPORT_PROJECT, workspace_id: REPORT_WORKSPACE, place_geometry_geojson: geometry }];
  tables.scenario_sets = [{ id: REPORT_SET, project_id: REPORT_PROJECT, workspace_id: REPORT_WORKSPACE, baseline_entry_id: reportId(5), title: "Synthetic comparison", updated_at: "2026-10-19" }];
  tables.scenario_comparison_snapshots = [{ id: REPORT_SNAPSHOT, scenario_set_id: REPORT_SET, baseline_entry_id: reportId(5), candidate_entry_id: reportId(6), label: "Exact saved packet", summary: "Supplied example", narrative: null, caveats_json: ["Out-of-area counts remain inconclusive."], metadata_json: { commonPopulation: population.snapshot }, status: "ready", updated_at: "2026-10-19" }];
  tables.scenario_entries = [{ id: reportId(5), scenario_set_id: REPORT_SET, label: "Baseline", entry_type: "baseline", assumptions_json: {}, updated_at: "2026-10-19" },
    { id: reportId(6), scenario_set_id: REPORT_SET, label: "Build", entry_type: "alternative", assumptions_json: change, updated_at: "2026-10-19" }];
  tables.models = ["aequilibrae", "activitysim"].map((method, index) => ({ id: reportId(7 + index), workspace_id: REPORT_WORKSPACE, project_id: REPORT_PROJECT, scenario_set_id: REPORT_SET,
    config_json: { method, guidedProjectComparison: "openplan.project_comparison.v1", networkBasis: { kind: "worker_osm_snapshot", source: "OpenStreetMap", identity: "network_state_digest", comparisonRule: "exact_digest_match" } } }));
  tables.model_runs = runs.map((id, index) => ({ id, workspace_id: REPORT_WORKSPACE, project_id: REPORT_PROJECT, model_id: reportId(index < 2 ? 7 : 8), scenario_set_id: REPORT_SET,
    scenario_entry_id: reportId(index % 2 ? 6 : 5), engine_key: index < 2 ? "aequilibrae" : "behavioral_demand", status: "succeeded", attempt_managed: false,
    assumption_snapshot_json: index % 2 ? change : {}, input_snapshot_json: { commonPopulation: index === 0 ? population.generate : population.reuse }, corridor_geojson: geometry }));
  tables.model_run_stages = runs.flatMap((run_id, index) => [{ id: reportId(20 + index), run_id, stage_name: index < 2 ? "Artifact Extraction" : "ActivitySim Network Assignment", status: "succeeded", attempt_managed: false, active_attempt_id: null },
    ...(index >= 2 ? [{ id: reportId(30 + index), run_id, stage_name: "ActivitySim Bundle & Preflight", status: "succeeded", attempt_managed: false, active_attempt_id: null }] : [])]);
  tables.model_run_stages.push({ id: population.source.stageId, run_id: runs[0], stage_name: "AequilibraE Setup", status: "succeeded", attempt_managed: false, active_attempt_id: null });
  tables.model_run_artifacts = [];
  function artifact(run_id: string, stage_id: string, artifact_type: string, data: Uint8Array, metadata_json: EvidenceRow = {}, identity?: string) {
    const id = identity ?? reportId(nextId++);
    const file_url = `storage://run-artifacts/model-runs/${run_id}/${id}.json`;
    bytes.set(file_url, data);
    const record = { id, run_id, stage_id, attempt_id: null as string | null, artifact_type, file_url, file_size_bytes: data.byteLength, content_hash: hashBytes(data), metadata_json, created_at: "2026-10-19" };
    tables.model_run_artifacts.push(record);
    return record;
  }
  const outputs = runs.map((run, index) => artifact(run, reportId(20 + index), index < 2 ? "link_volumes" : "activitysim_link_volumes", new TextEncoder().encode(`synthetic volume ${index}`), { ...network, ...population.metadata }));
  artifact(runs[0], population.source.stageId, "common_population", manifestBytes, population.sourceMetadata, population.source.artifactId);
  roles.forEach((role) => artifact(runs[0], population.source.stageId, `common_population_${role}`, encodeRecord({ role, content: "synthetic input" })));
  tables.scenario_comparison_model_run_links = outputs.map((output, index) => ({ workspace_id: REPORT_WORKSPACE, comparison_snapshot_id: REPORT_SNAPSHOT,
    model_run_id: runs[index], model_run_artifact_id: output.id, method: index < 2 ? "aequilibrae" : "activitysim", scenario_role: index % 2 ? "build" : "baseline",
    artifact_type: output.artifact_type, artifact_sha256: output.content_hash, assignment_profile_sha256: network.assignment_profile_digest,
    network_settings_sha256: network.network_settings_digest, network_state_sha256: network.network_state_digest, scenario_assumptions_json: index % 2 ? change : {} }));
  const vmt = [450909.6, 443317.9, 401455.9, 398090.6];
  tables.model_run_kpis = runs.flatMap((run_id, index) => [
    { id: reportId(nextId++), run_id, attempt_id: null, kpi_name: index < 2 ? "total_trips" : "activitysim_trips", kpi_label: "Synthetic trips", kpi_category: "general", value: index < 2 ? 160012 : 74775, unit: index < 2 ? "trips/day" : "trips", geometry_ref: null, breakdown_json: { calibration: "uncalibrated", provenance: "Synthetic exact KPI" }, created_at: "2026-10-19" },
    { id: reportId(nextId++), run_id, attempt_id: null, kpi_name: index < 2 ? "daily_vmt" : "activitysim_daily_vmt", kpi_label: "VMT", kpi_category: "general", value: vmt[index], unit: "vehicle-miles/day", geometry_ref: null, breakdown_json: { provenance: "Retained assignment VMT" }, created_at: "2026-10-19" },
  ]);
  tables.modeling_claim_decisions = runs.map((model_run_id, index) => ({ id: reportId(nextId++), workspace_id: REPORT_WORKSPACE, model_run_id, track: index < 2 ? "assignment" : "behavioral_demand", claim_status: "prototype_only", status_reason: "Uncalibrated prototype; local observation basis inconclusive.", reasons_json: ["Unknown observation basis"], validation_summary_json: {}, decided_at: "2026-10-19" }));
  tables.modeling_validation_assessments = runs.map((run, index) => {
    const input = artifact(run, reportId(20 + index), "validation_input_bundle", encodeRecord({ schema: "openplan.validation-input-bundle.v1", model_run_id: run, observation_contract: "not_available_for_legacy_count_rows", raw_point_count_diagnostic: { results: [], coverage: { status: "out_of_area" } } }));
    const basis = artifact(run, reportId(20 + index), "model_comparison_basis", encodeRecord({ schema: "openplan.model-comparison-basis.v1", model_run_id: run, model_output_artifact: { artifact_id: outputs[index].id, sha256: outputs[index].content_hash } }));
    const assessment = artifact(run, reportId(20 + index), "model_validation_assessment", encodeRecord({ schema: "openplan.model-validation-assessment.v1",
      assessment_id: reportId(900 + index), created_at: "2026-10-19T07:00:00Z", planning_use: "unknown", observation_results: [],
      coverage: { status: "out_of_area" }, validation_evidence_write: "pending",
      rules_version: 4, scientific_outcome: "inconclusive", reasons: ["Unknown observation basis"],
      partition: { kind: "unpartitioned", id: "unknown" }, comparability_findings: "unknown", legacy_point_count_diagnostic: false,
      metrics: { decisive: "unknown", diagnostic_grade_c: "unknown", all_computed: { legacy_point_count_metrics: { results: [] } } },
      exact_inputs: { model_output_artifact_id: outputs[index].id, model_output_sha256: outputs[index].content_hash,
        comparison_basis_sha256: basis.content_hash, observation_sha256: [input.content_hash] } }));
    return { id: reportId(nextId++), workspace_id: REPORT_WORKSPACE, model_run_id: run, track: index < 2 ? "assignment" : "behavioral_demand", model_output_artifact_id: outputs[index].id,
      validation_input_bundle_artifact_id: input.id, comparison_basis_artifact_id: basis.id, model_validation_assessment_artifact_id: assessment.id,
      comparison_basis_sha256: basis.content_hash, validation_rules_version: 4, partition_json: {}, planning_use: "unknown", scientific_outcome: "inconclusive", reasons_json: ["Unknown observation basis"], created_at: "2026-10-19" };
  });
  tables.model_attempt_instrument_custody = [];
  return { tables, bytes, runs, outputs, population, artifact };
}

/** Rendering fixture only. The server tests construct their seal through the verifier. */
export function guidedReportSelectionFixture(): GuidedComparisonSelectionV1 {
  const f = guidedReportFixture();
  const results = buildGuidedComparisonResults({ snapshotId: REPORT_SNAPSHOT,
    links: f.tables.scenario_comparison_model_run_links as unknown as GuidedComparisonLink[],
    kpis: f.tables.model_run_kpis as unknown as GuidedComparisonKpi[], decisions: f.tables.modeling_claim_decisions as unknown as GuidedComparisonDecision[] });
  results[0].metrics[0].label = "AequilibraE demand trips per day";
  results[1].metrics[0].label = "ActivitySim person-trip table rows";
  const payload: GuidedComparisonSelectionV1["payload"] = { schema: "openplan.guided-comparison-report.v1", workspaceId: REPORT_WORKSPACE, projectId: REPORT_PROJECT,
    snapshotId: REPORT_SNAPSHOT, snapshot: f.tables.scenario_comparison_snapshots[0],
    scenarioSet: { id: REPORT_SET, title: "Synthetic comparison", updated_at: "2026-10-19" },
    entries: f.tables.scenario_entries as unknown as GuidedComparisonSelectionV1["payload"]["entries"],
    geography: f.tables.projects[0].place_geometry_geojson as EvidenceRow, population: f.population.snapshot,
    populationArtifacts: f.tables.model_run_artifacts.filter((row) => String(row.artifact_type).startsWith("common_population")), results, caveats: [...GUIDED_REPORT_CAVEATS],
    sources: f.runs.map((runId, index) => ({ runId, method: index < 2 ? "aequilibrae" : "activitysim", role: index % 2 ? "build" : "baseline",
      link: f.tables.scenario_comparison_model_run_links[index], inputSnapshot: f.tables.model_runs[index].input_snapshot_json as EvidenceRow,
      output: f.outputs[index], kpis: f.tables.model_run_kpis.filter((row) => row.run_id === runId), decision: f.tables.modeling_claim_decisions[index],
      validation: f.tables.modeling_validation_assessments[index], validationArtifacts: f.tables.model_run_artifacts.filter((row) => row.run_id === runId && String(row.artifact_type).includes("validation")) })),
  };
  return { version: 1, snapshotId: REPORT_SNAPSHOT, payload, bindingSha256: hashBytes(encodeRecord(payload)) };
}

export function guidedManagedReportFixture() {
  const f = guidedReportFixture();
  f.tables.model_runs.forEach((row) => { row.attempt_managed = true; });
  f.tables.model_run_stages.forEach((stage, index) => { stage.attempt_managed = true; stage.active_attempt_id = reportId(1000 + index); });
  f.tables.model_run_artifacts.forEach((artifact) => {
    artifact.attempt_id = f.tables.model_run_stages.find((stage) => stage.id === artifact.stage_id)!.active_attempt_id;
  });
  const sourceStage = f.tables.model_run_stages.find((stage) => stage.id === f.population.source.stageId)!;
  f.population.source.attemptId = sourceStage.active_attempt_id as string;
  f.population.generate.custody = "managed_attempt";
  f.population.reuse.custody = "managed_attempt";
  f.population.snapshot.custody = "managed_attempt";
  f.population.sourceMetadata.custody = "managed_attempt";
  f.outputs.forEach((output) => { output.metadata_json.population_custody = "managed_attempt"; });
  f.tables.model_run_kpis.forEach((kpi) => {
    const name = String(kpi.kpi_name);
    const stageName = name === "activitysim_trips" ? "ActivitySim Bundle & Preflight" : name.startsWith("activitysim") ? "ActivitySim Network Assignment" : "Artifact Extraction";
    kpi.attempt_id = f.tables.model_run_stages.find((stage) => stage.run_id === kpi.run_id && stage.stage_name === stageName)!.active_attempt_id;
  });
  f.tables.modeling_claim_decisions = [];
  f.tables.modeling_validation_assessments = [];
  f.tables.model_attempt_instrument_custody = f.outputs.map((output, index) => {
    const method = index < 2 ? "aequilibrae" : "activitysim";
    const input = f.artifact(output.run_id, output.stage_id, "validation_input_bundle_v2", encodeRecord({ schema: "openplan.validation-input-bundle.v2" }));
    const basis = f.artifact(output.run_id, output.stage_id, "model_comparison_basis_v2", encodeRecord({ method, model_output_artifact: { sha256: output.content_hash } }));
    const assessment = f.artifact(output.run_id, output.stage_id, "model_validation_assessment_v2", encodeRecord({ method, rules_version: 5, scientific_outcome: "inconclusive", reasons: ["No accepted observation basis"],
      exact_inputs: { model_output_sha256: output.content_hash, validation_input_bundle_sha256: input.content_hash } }));
    const audit = f.artifact(output.run_id, output.stage_id, "pre_volume_match_audit_v2", encodeRecord({ schema: "openplan.pre-volume-observation-match-audit.v2" }));
    const diagnosis = f.artifact(output.run_id, output.stage_id, "model_validation_structural_diagnosis_v2", encodeRecord({ schema: "openplan.model-validation-structural-diagnosis.v2" }));
    const attempt = f.tables.model_run_stages.find((stage) => stage.id === output.stage_id)!.active_attempt_id;
    for (const artifact of [input, basis, assessment, audit, diagnosis]) artifact.attempt_id = attempt as string;
    return { id: reportId(1100 + index), workspace_id: REPORT_WORKSPACE, model_run_id: output.run_id, stage_id: output.stage_id, attempt_id: attempt,
      demand_method: method, scientific_outcome: "inconclusive", created_at: "2026-10-19", model_output_artifact_id: output.id, model_output_sha256: output.content_hash,
      input_bundle_artifact_id: input.id, input_bundle_sha256: input.content_hash, match_audit_artifact_id: audit.id, match_audit_sha256: audit.content_hash,
      comparison_basis_artifact_id: basis.id, comparison_basis_sha256: basis.content_hash, assessment_artifact_id: assessment.id, assessment_sha256: assessment.content_hash,
      diagnosis_artifact_id: diagnosis.id, diagnosis_sha256: diagnosis.content_hash };
  });
  return f;
}
