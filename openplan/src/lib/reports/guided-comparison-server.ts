import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { readEveryPage } from "@/lib/supabase/paged-read";
import { loadArtifactBytes, resolveRunWorkDir, workerLocalRoot } from "@/lib/models/artifact-source";
import { jsonValuesEqual } from "@/lib/models/demand-agreement-artifact";
import { validStageCustodyAttestation } from "@/lib/models/common-population-launch";
import {
  collectGuidedRunEvidence, guidedPopulationComparison, guidedPopulationRerun,
  snapshotHasExactGuidedEvidence, type GuidedRunJob, type GuidedRunRow,
  type ModelRunArtifactRow, type ModelRunStageRow, type ScenarioComparisonModelRunLinkRow,
} from "@/lib/models/guided-model-evidence";
import { isGuidedProjectComparisonModel, usesGuidedWorkerNetwork, parseGuidedBuildAssumption } from "@/lib/models/project-comparison";
import { isModelingClaimStatus } from "@/lib/models/evidence-backbone";
import { readAttemptInstruments } from "@/lib/models/attempt-instrument-read";
import { buildGuidedComparisonResults, type GuidedComparisonDecision } from "@/lib/models/guided-comparison-results";
import { GUIDED_REPORT_CAVEATS, guidedReportCanonicalJson, objectRecord, type GuidedComparisonOption, type GuidedComparisonReportPayload, type GuidedComparisonSelectionV1 } from "./guided-comparison";

type Client = Awaited<ReturnType<typeof createClient>>;
type Row = Record<string, unknown>;
type Run = GuidedRunRow & Row & { workspace_id: string; project_id: string; scenario_set_id: string; corridor_geojson: Row };
type Entry = { id: string; label: string; entry_type: string; assumptions_json: Row; updated_at: string };
type Kpi = Row & { id: string; run_id: string; attempt_id: string | null; kpi_name: string; value: number | null; unit: string | null; geometry_ref: string | null };
type Decision = GuidedComparisonDecision & Row;
export const GUIDED_REPORT_RUN_COLUMNS = "id, workspace_id, project_id, model_id, scenario_set_id, scenario_entry_id, engine_key, status, attempt_managed, assumption_snapshot_json, input_snapshot_json, corridor_geojson";
export const GUIDED_REPORT_LINK_COLUMNS = "comparison_snapshot_id, model_run_id, model_run_artifact_id, method, scenario_role, artifact_type, artifact_sha256, assignment_profile_sha256, network_settings_sha256, network_state_sha256, scenario_assumptions_json";
export const GUIDED_REPORT_KPI_COLUMNS = "id, run_id, attempt_id, kpi_name, kpi_label, kpi_category, value, unit, geometry_ref, breakdown_json, created_at";
export const GUIDED_REPORT_ARTIFACT_COLUMNS = "id, run_id, stage_id, attempt_id, artifact_type, file_url, file_size_bytes, content_hash, metadata_json, created_at";
const uuid = z.string().uuid();
const requestSchema = z.object({ snapshotId: uuid }).strict();
export const guidedComparisonRequestSchema = requestSchema.nullable().optional();

function requireEvidence(condition: unknown, reason: string): asserts condition {
  if (!condition) throw new Error(`Guided comparison cannot be included: ${reason}`);
}
function exactlyOne<T>(rows: T[], reason: string): T {
  requireEvidence(rows.length === 1, reason);
  return rows[0];
}
export function guidedReportDigest(value: unknown): string {
  return createHash("sha256").update(guidedReportCanonicalJson(value)).digest("hex");
}

/** Page every query that can contain repeated evidence. No latest-run lookup. */
async function allRows<T>(fetch: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const result = await readEveryPage(fetch);
  requireEvidence(result.complete, "an evidence read failed or was incomplete.");
  return result.rows;
}

export async function loadGuidedReportOptions(client: Client, workspaceId: string, projectId: string): Promise<GuidedComparisonOption[]> {
  const sets = await allRows<{ id: string }>((from, to) => client.from("scenario_sets").select("id")
    .eq("workspace_id", workspaceId).eq("project_id", projectId).order("id").range(from, to));
  const options: GuidedComparisonOption[] = [];
  for (const set of sets) {
    const snapshots = await allRows<{ id: string; label: string }>((from, to) => client.from("scenario_comparison_snapshots")
      .select("id, label").eq("scenario_set_id", set.id).eq("status", "ready").order("id").range(from, to));
    for (const snapshot of snapshots) {
      const links = await allRows<ScenarioComparisonModelRunLinkRow>((from, to) => client.from("scenario_comparison_model_run_links")
        .select(GUIDED_REPORT_LINK_COLUMNS).eq("workspace_id", workspaceId).eq("comparison_snapshot_id", snapshot.id)
        .order("model_run_id").range(from, to));
      if (links.length === 4 && new Set(links.map((link) => `${link.method}:${link.scenario_role}`)).size === 4) {
        options.push({ id: snapshot.id, projectId, label: snapshot.label });
      }
    }
  }
  return options;
}

/** Check exact stored bytes with the existing confined artifact reader. */
export async function readExactGuidedReportArtifact(artifact: ModelRunArtifactRow): Promise<Uint8Array> {
  const size = Number(artifact.file_size_bytes);
  requireEvidence(artifact.file_url && Number.isSafeInteger(size) && size > 0 && /^[a-f0-9]{64}$/.test(artifact.content_hash ?? ""), "an artifact has no exact size or hash.");
  const localRoot = workerLocalRoot();
  const bytes = await loadArtifactBytes(artifact.file_url, { bucket: "run-artifacts", objectPathPrefix: `model-runs/${artifact.run_id}/`,
    ...(localRoot ? { localRoot: resolveRunWorkDir(localRoot, artifact.run_id) } : {}) });
  requireEvidence(bytes.byteLength === size && createHash("sha256").update(bytes).digest("hex") === artifact.content_hash,
    "retained artifact bytes differ from the selected size or SHA-256.");
  return bytes;
}

/** Ordinary uncontracted rules-v4 emits the bundle digest as one observation hash.
 * This is a producer-format exception, never an absence-based fallback. */
function exactValidationInput(assessment: Row, bundle: Row, expectedHash: string, legacy: boolean): boolean {
  const exact = objectRecord(assessment.exact_inputs);
  if (!exact) return false;
  if (Object.hasOwn(exact, "validation_input_bundle_sha256")) return exact.validation_input_bundle_sha256 === expectedHash;
  const partition = objectRecord(assessment.partition);
  const metrics = objectRecord(assessment.metrics);
  return legacy && assessment.schema === "openplan.model-validation-assessment.v1" && assessment.rules_version === 4 &&
    bundle.schema === "openplan.validation-input-bundle.v1" && bundle.observation_contract === "not_available_for_legacy_count_rows" &&
    objectRecord(bundle.raw_point_count_diagnostic) !== null && assessment.scientific_outcome === "inconclusive" &&
    assessment.legacy_point_count_diagnostic === false && assessment.comparability_findings === "unknown" &&
    partition?.kind === "unpartitioned" && partition.id === "unknown" &&
    metrics?.decisive === "unknown" && metrics.diagnostic_grade_c === "unknown" &&
    objectRecord(objectRecord(metrics.all_computed)?.legacy_point_count_metrics) !== null &&
    Array.isArray(exact.observation_sha256) && exact.observation_sha256.length === 1 && exact.observation_sha256[0] === expectedHash;
}

/** The caller authorizes its report action and project before any privileged read. */
export async function verifyGuidedComparisonReport(input: {
  client: Client; workspaceId: string; projectId: string; reportType: string; snapshotId: string;
  saved?: GuidedComparisonSelectionV1;
}): Promise<GuidedComparisonSelectionV1> {
  const { client, workspaceId, projectId, snapshotId } = input;
  requireEvidence(input.reportType === "analysis_summary" && uuid.safeParse(snapshotId).success, "select a project analysis summary and one snapshot.");
  const projectResult = await client.from("projects").select("id, workspace_id, place_geometry_geojson")
    .eq("id", projectId).eq("workspace_id", workspaceId).maybeSingle();
  requireEvidence(!projectResult.error && projectResult.data, "the project is unavailable in this workspace.");
  const snapshotResult = await client.from("scenario_comparison_snapshots")
    .select("id, scenario_set_id, baseline_entry_id, candidate_entry_id, label, summary, narrative, caveats_json, metadata_json, status, updated_at")
    .eq("id", snapshotId).maybeSingle();
  requireEvidence(!snapshotResult.error && snapshotResult.data?.status === "ready", "the exact saved snapshot is unavailable or not ready.");
  const snapshot = snapshotResult.data as Row;
  const setResult = await client.from("scenario_sets").select("id, workspace_id, project_id, title, baseline_entry_id, updated_at")
    .eq("id", snapshot.scenario_set_id).eq("workspace_id", workspaceId).eq("project_id", projectId).maybeSingle();
  requireEvidence(!setResult.error && setResult.data && setResult.data.baseline_entry_id === snapshot.baseline_entry_id, "the snapshot belongs to another project or its baseline changed.");
  const set = setResult.data;
  const links = await allRows<ScenarioComparisonModelRunLinkRow>((from, to) => client.from("scenario_comparison_model_run_links")
    .select(GUIDED_REPORT_LINK_COLUMNS).eq("workspace_id", workspaceId).eq("comparison_snapshot_id", snapshotId)
    .order("method").order("scenario_role").order("model_run_id").range(from, to));
  requireEvidence(links.length === 4 && new Set(links.map((link) => link.model_run_id)).size === 4 &&
    new Set(links.map((link) => link.model_run_artifact_id)).size === 4 &&
    ["aequilibrae:baseline", "aequilibrae:build", "activitysim:baseline", "activitysim:build"].every((cell) =>
      links.filter((link) => `${link.method}:${link.scenario_role}` === cell).length === 1), "four unique exact method and role links are required.");
  const runIds = links.map((link) => link.model_run_id);
  const [runs, entries, artifacts, stages, kpis, decisions, assessments] = await Promise.all([
    allRows<Run>((from, to) => client.from("model_runs").select(GUIDED_REPORT_RUN_COLUMNS)
      .eq("workspace_id", workspaceId).eq("project_id", projectId).eq("scenario_set_id", set.id).in("id", runIds).order("id").range(from, to)),
    allRows<Entry>((from, to) => client.from("scenario_entries").select("id, label, entry_type, assumptions_json, updated_at")
      .eq("scenario_set_id", set.id).in("id", [snapshot.baseline_entry_id, snapshot.candidate_entry_id]).order("id").range(from, to)),
    allRows<ModelRunArtifactRow>((from, to) => client.from("model_run_artifacts").select(GUIDED_REPORT_ARTIFACT_COLUMNS).in("run_id", runIds).order("id").range(from, to)),
    allRows<ModelRunStageRow>((from, to) => client.from("model_run_stages").select("id, run_id, stage_name, status, attempt_managed, active_attempt_id")
      .in("run_id", runIds).order("id").range(from, to)),
    allRows<Kpi>((from, to) => client.from("model_run_kpis").select(GUIDED_REPORT_KPI_COLUMNS).in("run_id", runIds)
      .in("kpi_name", ["total_trips", "daily_vmt", "activitysim_trips", "activitysim_daily_vmt"]).order("id").range(from, to)),
    allRows<Decision>((from, to) => client.from("modeling_claim_decisions")
      .select("id, workspace_id, model_run_id, track, claim_status, status_reason, reasons_json, validation_summary_json, decided_at")
      .eq("workspace_id", workspaceId).in("model_run_id", runIds).order("id").range(from, to)),
    allRows<Row>((from, to) => client.from("modeling_validation_assessments")
      .select("id, workspace_id, model_run_id, track, model_output_artifact_id, validation_input_bundle_artifact_id, comparison_basis_artifact_id, model_validation_assessment_artifact_id, comparison_basis_sha256, validation_rules_version, partition_json, planning_use, scientific_outcome, reasons_json, created_at")
      .eq("workspace_id", workspaceId).in("model_run_id", runIds).order("id").range(from, to)),
  ]);
  requireEvidence(runs.length === 4 && entries.length === 2, "an exact run or scenario entry is missing.");
  const build = exactlyOne(entries.filter((entry) => entry.id === snapshot.candidate_entry_id && entry.entry_type === "alternative"), "the build entry is ambiguous.");
  requireEvidence(parseGuidedBuildAssumption(build.assumptions_json), "the fixed-population build assumption is unavailable.");
  const service = createServiceRoleClient();
  const instruments = await readAttemptInstruments(client, runs.filter((run) => run.attempt_managed).map((run) => run.id), workspaceId);
  requireEvidence(!instruments.readFailed, "attempt-bound validation custody could not be read.");
  const managed = new Map<string, Row[]>();
  for (const run of runs.filter((row) => row.attempt_managed === true)) {
    const result = await service.rpc("read_model_attempt_outputs", { p_run_id: run.id, p_workspace_id: workspaceId });
    const data = objectRecord(result.data);
    requireEvidence(!result.error && data?.run_id === run.id && data.run_status === "succeeded" && Array.isArray(data.outputs), "managed output custody is unavailable.");
    managed.set(run.id, data.outputs as Row[]);
  }
  // The native reader returns full rows; compare the selected projection exactly.
  function projectedCurrent(kind: string, runId: string, row: Row): boolean {
    const matches = (managed.get(runId) ?? []).filter((output) => output.kind === kind && objectRecord(output.record)?.id === row.id);
    const record = objectRecord(matches[0]?.record);
    return matches.length === 1 && matches[0].ownership_state === "current_completed" && record !== null &&
      Object.entries(row).every(([key, value]) => jsonValuesEqual(value, record[key]));
  }
  const eligible = new Set<string>();
  const exactArtifacts: ModelRunArtifactRow[] = [];
  for (const link of links) {
    exactArtifacts.push(exactlyOne(artifacts.filter((artifact) => artifact.id === link.model_run_artifact_id && artifact.run_id === link.model_run_id), "a selected artifact is missing or belongs to another run."));
  }
  const jobs: GuidedRunJob[] = [];
  for (const link of links) {
    const run = exactlyOne(runs.filter((row) => row.id === link.model_run_id), "a selected run is missing.");
    const entryId = link.scenario_role === "baseline" ? snapshot.baseline_entry_id : snapshot.candidate_entry_id;
    const entry = exactlyOne(entries.filter((row) => row.id === entryId), "a scenario role is missing.");
    const modelResult = await client.from("models").select("id, workspace_id, project_id, scenario_set_id, config_json")
      .eq("id", run.model_id).eq("workspace_id", workspaceId).eq("project_id", projectId).eq("scenario_set_id", set.id).maybeSingle();
    const method = link.method as "aequilibrae" | "activitysim";
    requireEvidence(!modelResult.error && modelResult.data && isGuidedProjectComparisonModel(modelResult.data.config_json, method) && usesGuidedWorkerNetwork(modelResult.data.config_json), "a guided method contract changed.");
    requireEvidence(run.status === "succeeded" && typeof run.attempt_managed === "boolean" && run.scenario_entry_id === entryId &&
      run.engine_key === (method === "aequilibrae" ? "aequilibrae" : "behavioral_demand") &&
      jsonValuesEqual(run.corridor_geojson, projectResult.data.place_geometry_geojson) &&
      jsonValuesEqual(run.assumption_snapshot_json, entry.assumptions_json ?? {}) &&
      jsonValuesEqual(link.scenario_assumptions_json, entry.assumptions_json ?? {}), "run geography, role, or assumptions changed.");
    jobs.push({ method, scenario: link.scenario_role as "baseline" | "build", modelId: run.model_id, scenarioEntryId: entry.id, assumptionsJson: entry.assumptions_json ?? {} });
  }
  const sourceMetadata = objectRecord(snapshot.metadata_json)?.commonPopulation;
  const source = objectRecord(objectRecord(sourceMetadata)?.source);
  requireEvidence(source && typeof source.artifactId === "string", "the common population source is not bound.");
  const populationSource = exactlyOne(artifacts.filter((artifact) => artifact.id === source.artifactId && artifact.run_id === source.modelRunId), "the exact population source is unavailable.");
  const populationArtifacts = artifacts.filter((artifact) => artifact.run_id === populationSource.run_id && artifact.stage_id === populationSource.stage_id && artifact.artifact_type.startsWith("common_population"));
  const bytesById = new Map<string, Uint8Array>();
  for (const artifact of [...exactArtifacts, ...populationArtifacts]) {
    const run = exactlyOne(runs.filter((row) => row.id === artifact.run_id), "population scope changed.");
    if (run.attempt_managed) requireEvidence(projectedCurrent("artifact", run.id, artifact as ModelRunArtifactRow & Row), "a managed attempt is revoked, stale, or incomplete.");
    else {
      const result = await service.rpc("read_common_population_stage_custody", { p_workspace: workspaceId, p_run: run.id, p_stage: artifact.stage_id, p_artifact: artifact.id });
      requireEvidence(!result.error && validStageCustodyAttestation(result.data, workspaceId, run.id, artifact.stage_id ?? "", artifact.id), "legacy artifact custody is unavailable.");
      eligible.add(artifact.id);
    }
    bytesById.set(artifact.id, await readExactGuidedReportArtifact(artifact));
  }
  const evidence = collectGuidedRunEvidence(jobs, runs, exactArtifacts, stages, eligible);
  requireEvidence(snapshotHasExactGuidedEvidence(snapshotId, links, evidence, objectRecord(snapshot.metadata_json)), "the four output fingerprints or population identity changed.");
  const population = guidedPopulationComparison(jobs, evidence);
  requireEvidence(population.state === "ready", "the common population is incomplete or mismatched.");
  const populationCheck = guidedPopulationRerun(jobs, evidence, [populationSource], stages, eligible);
  requireEvidence(!populationCheck.nextRun && !populationCheck.repairState, "the retained population origin or replacement lineage changed.");
  // The manifest names the complete seven-file source package; each companion is exact.
  const manifest = objectRecord(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytesById.get(populationSource.id))));
  const files = objectRecord(manifest?.files);
  requireEvidence(files, "the population manifest has no companion descriptors.");
  requireEvidence(["source_profile", "universe", "exclusions", "selected_zone_map", "realized_zone_counts"].every((key) =>
    jsonValuesEqual(manifest?.[key], population.basis[key as keyof typeof population.basis])), "population manifest identity differs from consumed metadata.");
  for (const [role, descriptor] of Object.entries(files)) {
    const file = objectRecord(descriptor);
    const artifact = exactlyOne(populationArtifacts.filter((row) => row.artifact_type === `common_population_${role}`), "a population companion is missing or ambiguous.");
    requireEvidence(file?.sha256 === artifact.content_hash && file.bytes === Number(artifact.file_size_bytes), "a population companion differs from its manifest.");
  }
  requireEvidence(populationArtifacts.length === Object.keys(files).length + 1 && Object.keys(files).length === 6, "the population package is incomplete.");
  const sources: GuidedComparisonReportPayload["sources"] = [];
  const selectedKpis: Kpi[] = [];
  const selectedDecisions: Decision[] = [];
  for (const link of links) {
    const run = runs.find((row) => row.id === link.model_run_id)!;
    const track = link.method === "aequilibrae" ? "assignment" : "behavioral_demand";
    const output = exactArtifacts.find((row) => row.id === link.model_run_artifact_id)!;
    const names = link.method === "aequilibrae" ? ["total_trips", "daily_vmt"] : ["activitysim_trips", "activitysim_daily_vmt"];
    const chosen: Kpi[] = [];
    for (const name of names) {
      const kpi = exactlyOne(kpis.filter((row) => row.run_id === run.id && row.kpi_name === name), "headline KPI is missing or ambiguous.");
      const unit = name.endsWith("daily_vmt") ? "vehicle-miles/day" : name === "activitysim_trips" ? "trips" : "trips/day";
      requireEvidence(kpi.geometry_ref === null && typeof kpi.value === "number" && Number.isFinite(kpi.value) && kpi.value >= 0 && kpi.unit === unit, "headline KPI has a null value, unknown unit, or nonaggregate scope.");
      if (run.attempt_managed) {
        const expectedStage = link.method === "aequilibrae" ? "Artifact Extraction" : name === "activitysim_trips" ? "ActivitySim Bundle & Preflight" : "ActivitySim Network Assignment";
        requireEvidence(projectedCurrent("kpi", run.id, kpi) && stages.filter((stage) => stage.run_id === run.id && stage.stage_name === expectedStage &&
          stage.attempt_managed === true && stage.active_attempt_id === kpi.attempt_id && stage.status === "succeeded").length === 1, "a KPI attempt is revoked, stale, incomplete, or belongs to the wrong producer stage.");
      }
      else {
        const result = await service.rpc("read_guided_comparison_report_kpi_custody", { p_workspace: workspaceId, p_project: projectId, p_snapshot: snapshotId, p_run: run.id, p_kpi: kpi.id });
        const attestation = objectRecord(result.data);
        requireEvidence(!result.error && attestation?.schema === "openplan.guided-report-kpi-custody.v1" && attestation.eligible === true &&
          attestation.workspace_id === workspaceId && attestation.project_id === projectId && attestation.snapshot_id === snapshotId &&
          attestation.run_id === run.id && attestation.kpi_id === kpi.id && attestation.custody === "legacy_stage_snapshot", "the exact legacy KPI receipt is missing or changed.");
        const attestedKpi = objectRecord(attestation.kpi);
        requireEvidence(attestedKpi && ["id", "run_id", "attempt_id", "kpi_name", "kpi_label", "kpi_category", "value", "unit", "geometry_ref", "breakdown_json"].every((key) =>
          Object.hasOwn(attestedKpi, key) && jsonValuesEqual(attestedKpi[key], kpi[key])), "the receipt attests a different KPI value, unit, definition, or scope.");
        const expectedStage = link.method === "aequilibrae" ? "Artifact Extraction" : name === "activitysim_trips" ? "ActivitySim Bundle & Preflight" : "ActivitySim Network Assignment";
        requireEvidence(stages.filter((stage) => stage.id === attestation.stage_id && stage.run_id === run.id && stage.stage_name === expectedStage &&
          stage.status === "succeeded" && stage.attempt_managed === false && stage.active_attempt_id === null).length === 1, "legacy KPI producer stage differs from its receipt.");
        kpi.custody = attestation;
      }
      chosen.push(kpi);
    }
    const instrument = run.attempt_managed ? exactlyOne(instruments.records.filter((row) => row.model_run_id === run.id &&
      row.demand_method === link.method && row.model_output_artifact_id === output.id && row.model_output_sha256 === output.content_hash), "exact attempt-bound validation is missing or ambiguous.") : null;
    // Managed scientific projections are refused by the existing schema. Its
    // attempt instrument supports only inconclusive, prototype disclosure.
    const decision: Decision = instrument ? { id: instrument.id, workspace_id: workspaceId, model_run_id: run.id, track,
      claim_status: "prototype_only", status_reason: "The exact attempt-bound validation instrument is inconclusive; no stronger scientific projection is authorized.",
      source: "model_attempt_instrument_custody" } : exactlyOne(decisions.filter((row) => row.model_run_id === run.id && row.track === track), "a track-matched decision is missing or ambiguous.");
    requireEvidence(isModelingClaimStatus(decision.claim_status), "the claim status is unsupported.");
    const validation: Row = instrument ? { ...instrument, track } : exactlyOne(assessments.filter((row) => row.model_run_id === run.id && row.track === track && row.model_output_artifact_id === output.id), "exact output validation custody is missing or ambiguous.");
    requireEvidence(["pass", "fail", "inconclusive"].includes(String(validation.scientific_outcome)), "validation outcome is unknown.");
    requireEvidence(validation.scientific_outcome === "pass" || decision.claim_status === "prototype_only", "a stronger claim contradicts nonpassing scientific evidence.");
    const validationFields = instrument ? ["input_bundle_artifact_id", "comparison_basis_artifact_id", "assessment_artifact_id", "match_audit_artifact_id", "diagnosis_artifact_id"]
      : ["validation_input_bundle_artifact_id", "comparison_basis_artifact_id", "model_validation_assessment_artifact_id"];
    const validationArtifacts = validationFields.map((field) =>
      exactlyOne(artifacts.filter((artifact) => artifact.id === validation[field] && artifact.run_id === run.id), "a validation artifact is unavailable."));
    const documents: Row[] = [];
    const artifactTypes = instrument ? ["validation_input_bundle_v2", "model_comparison_basis_v2", "model_validation_assessment_v2", "pre_volume_match_audit_v2", "model_validation_structural_diagnosis_v2"]
      : ["validation_input_bundle", "model_comparison_basis", "model_validation_assessment"];
    for (const [index, artifact] of validationArtifacts.entries()) {
      requireEvidence(artifact.artifact_type === artifactTypes[index], "a validation artifact has the wrong type.");
      if (run.attempt_managed) requireEvidence(projectedCurrent("artifact", run.id, artifact as ModelRunArtifactRow & Row), "validation attempt custody is stale.");
      const document = objectRecord(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await readExactGuidedReportArtifact(artifact))));
      requireEvidence(document, "a validation artifact is malformed.");
      documents.push(document);
    }
    const basis = documents[1];
    const assessment = documents[2];
    requireEvidence((instrument !== null || objectRecord(basis.model_output_artifact)?.artifact_id === output.id) && objectRecord(basis.model_output_artifact)?.sha256 === output.content_hash &&
      validationArtifacts[1].content_hash === validation.comparison_basis_sha256 &&
      objectRecord(assessment.exact_inputs)?.model_output_sha256 === output.content_hash &&
      exactValidationInput(assessment, documents[0], validationArtifacts[0].content_hash!, instrument === null) &&
      assessment.scientific_outcome === validation.scientific_outcome && (instrument
        ? assessment.method === link.method && basis.method === link.method && instrument.scientific_outcome === "inconclusive" &&
          validationArtifacts.every((artifact, index) => artifact.content_hash === instrument[validationFields[index].replace("_artifact_id", "_sha256") as keyof typeof instrument])
        : objectRecord(assessment.exact_inputs)?.model_output_artifact_id === output.id &&
          objectRecord(assessment.exact_inputs)?.comparison_basis_sha256 === validationArtifacts[1].content_hash &&
          assessment.rules_version === validation.validation_rules_version && jsonValuesEqual(assessment.reasons, validation.reasons_json)), "validation does not bind this exact output and outcome.");
    selectedKpis.push(...chosen); selectedDecisions.push(decision);
    sources.push({ method: link.method as "aequilibrae" | "activitysim", role: link.scenario_role as "baseline" | "build", runId: run.id,
      link: { ...link }, inputSnapshot: run.input_snapshot_json ?? {}, output: { ...output }, kpis: chosen, decision,
      validation: { ...validation, assessment, basis }, validationArtifacts: validationArtifacts.map((row) => ({ ...row })) });
  }
  const results = buildGuidedComparisonResults({ snapshotId, links, kpis: selectedKpis, decisions: selectedDecisions });
  requireEvidence(results.length === 2 && results.every((result) => result.metrics.length === 2), "the separate result tables are incomplete.");
  for (const result of results) for (const metric of result.metrics) if (metric.key === "total_trips") metric.label = result.method === "activitysim" ? "ActivitySim person-trip table rows" : "AequilibraE demand trips per day";
  const payload: GuidedComparisonReportPayload = { schema: "openplan.guided-comparison-report.v1", workspaceId, projectId, snapshotId, snapshot,
    scenarioSet: { id: set.id, title: set.title, updated_at: set.updated_at }, entries, geography: runs[0].corridor_geojson,
    population: { ...objectRecord(sourceMetadata) }, sources, populationArtifacts: populationArtifacts.map((row) => ({ ...row })), results,
    caveats: [...GUIDED_REPORT_CAVEATS, ...(Array.isArray(snapshot.caveats_json) ? snapshot.caveats_json.filter((row): row is string => typeof row === "string") : [])] };
  const selection: GuidedComparisonSelectionV1 = { version: 1, snapshotId, payload, bindingSha256: guidedReportDigest(payload) };
  if (input.saved) requireEvidence(input.saved.snapshotId === snapshotId && guidedReportDigest(input.saved.payload) === input.saved.bindingSha256 &&
    selection.bindingSha256 === input.saved.bindingSha256, "saved evidence changed. Review and save the explicit snapshot again before generation.");
  return selection;
}
