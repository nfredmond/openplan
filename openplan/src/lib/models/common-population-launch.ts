import { z } from "zod";
import { resolveZoneAttributeSource, type ZoneAttributeSourceDescriptor } from "@/lib/geographies/zone-attribute-source";
import { jsonValuesEqual } from "@/lib/models/demand-agreement-artifact";
import {
  GUIDED_AUTO_TRIP_CHANGE_KIND,
  hasGuidedProjectComparisonIntent,
  isGuidedProjectComparisonModel,
  parseGuidedBuildAssumption,
} from "@/lib/models/project-comparison";
import type { ZoneAttributeStamp } from "@/lib/models/zone-attribute-payload";

const SCHEMA = "openplan.common-population-request.v1";
const POLICY = "fixed_population_auto_trip_change";
const uuid = z.string().uuid();
const record = z.record(z.string(), z.unknown());

export type CommonPopulationCustody = "legacy_stage_snapshot" | "managed_attempt";
type PopulationSource = { modelRunId: string; artifactId: string; stageId: string; sha256: string; sizeBytes: number };
export type CommonPopulationRequest =
  | { schema: typeof SCHEMA; mode: "generate"; custody: CommonPopulationCustody; comparisonPolicy: typeof POLICY; sourceProfile: Record<string, unknown> }
  | ({ schema: typeof SCHEMA; mode: "reuse"; comparisonPolicy: typeof POLICY } & (
      | { custody: "legacy_stage_snapshot"; source: PopulationSource & { attemptId: null } }
      | { custody: "managed_attempt"; source: PopulationSource & { attemptId: string } }
    ));

type ReadResult = { data: unknown; error: { message: string } | null };
type Query = PromiseLike<ReadResult> & {
  eq(column: string, value: string): Query;
  order(column: string, options: { ascending: boolean }): Query;
  limit(count: number): Query;
};
export type CommonPopulationLaunchClient = {
  from(table: string): { select(columns: string): Query };
};
type Model = {
  id: string; workspace_id: string; project_id: string | null; scenario_set_id: string | null;
  config_json?: Record<string, unknown> | null;
};
type Entry = { id: string; scenario_set_id: string; entry_type: string; assumptions_json: Record<string, unknown> | null };

export type CommonPopulationLaunchResult =
  | { state: "not_applicable" }
  | { state: "ready"; request: CommonPopulationRequest }
  | { state: "repair"; repairState: string; error: string; status: 409 | 503 };

function repair(repairState: string, error: string, status: 409 | 503 = 409): CommonPopulationLaunchResult {
  return { state: "repair", repairState, error, status };
}

const setSchema = z.object({ id: uuid, workspace_id: uuid, project_id: uuid, baseline_entry_id: uuid });
const entrySchema = z.object({ id: uuid, scenario_set_id: uuid, entry_type: z.string(), assumptions_json: record.nullable() });
const modelSchema = z.object({ id: uuid, workspace_id: uuid, project_id: uuid, scenario_set_id: uuid, config_json: record.nullable() });
const runSchema = z.object({
  id: uuid, workspace_id: uuid, project_id: uuid, model_id: uuid, scenario_set_id: uuid, scenario_entry_id: uuid,
  engine_key: z.literal("aequilibrae"), status: z.literal("succeeded"), attempt_managed: z.boolean(),
  corridor_geojson: record, input_snapshot_json: record,
});
const positiveBytes = z.union([z.number(), z.string().regex(/^[1-9][0-9]*$/).transform(Number)])
  .refine((value) => Number.isSafeInteger(value) && value > 0);
const artifactSchema = z.object({
  id: uuid, run_id: uuid, stage_id: uuid, attempt_id: uuid.nullable(), artifact_type: z.literal("common_population"),
  file_url: z.string().trim().min(1), file_size_bytes: positiveBytes, content_hash: z.string().regex(/^[a-f0-9]{64}$/),
});
const stageSchema = z.object({
  id: uuid, run_id: uuid, stage_name: z.literal("AequilibraE Setup"), status: z.literal("succeeded"),
  attempt_managed: z.boolean(), active_attempt_id: uuid.nullable(),
});
const generateSchema = z.object({
  schema: z.literal(SCHEMA), custody: z.enum(["legacy_stage_snapshot", "managed_attempt"]), mode: z.literal("generate"), comparisonPolicy: z.literal(POLICY), sourceProfile: record,
}).strict();

export type ReadStageCustody = (workspaceId: string, runId: string, stageId: string, artifactId: string) => PromiseLike<ReadResult>;

/** Check only the exact scoped attestation, never infer eligibility from null attempts. */
export function validStageCustodyAttestation(data: unknown, workspaceId: string, runId: string, stageId: string, artifactId: string): boolean {
  const result = z.object({ schema: z.literal("openplan.common-population-stage-custody.v1"),
    custody: z.literal("legacy_stage_snapshot"), workspace_id: uuid, run_id: uuid, stage_id: uuid,
    artifact_id: uuid, eligible: z.literal(true) }).strict().safeParse(data);
  return result.success && result.data.workspace_id === workspaceId && result.data.run_id === runId &&
    result.data.stage_id === stageId && result.data.artifact_id === artifactId;
}

function single<T>(schema: z.ZodType<T>, data: unknown): T | null {
  const rows = z.array(schema).length(1).safeParse(data);
  return rows.success ? rows.data[0] : null;
}

/** Source-specific population profiles stay behind adapter identity and tested vintage. */
function populationSourceProfile(descriptor: ZoneAttributeSourceDescriptor): Record<string, unknown> | null {
  if (descriptor.id !== "us_census_acs5" || descriptor.vintage !== "2023" ||
      descriptor.retrievalUrl !== `https://api.census.gov/data/${descriptor.vintage}/acs/acs5`) return null;
  const year = Number(descriptor.vintage);
  return {
    adapter: "us_census_acs5_pums",
    acs_summary_endpoint: descriptor.retrievalUrl,
    pums_endpoint: `${descriptor.retrievalUrl}/pums`,
    sample_years: [year - 4, year],
    income_dollar_year: year,
    puma_fields: { "2020": "PUMA" },
  };
}

function hasCurrentChange(value: unknown): boolean {
  const candidate = record.safeParse(value);
  if (!candidate.success) return false;
  const change = record.safeParse(candidate.data.guidedProjectChange);
  return change.success && change.data.kind === GUIDED_AUTO_TRIP_CHANGE_KIND;
}

type CommonPopulationLaunchArgs = {
  client: CommonPopulationLaunchClient;
  readStageCustody: ReadStageCustody;
  custody?: CommonPopulationCustody;
  readOutputs: (runId: string, workspaceId: string) => PromiseLike<ReadResult>;
  model: Model;
  scenarioEntry: Entry | null;
  engineKey: string;
  corridorGeojson: unknown;
  zoneGeography: string;
  zoneAttributes: ZoneAttributeStamp | null;
  sourceDescriptor?: ZoneAttributeSourceDescriptor;
};

/** Resolve a fixed-population guided launch from scoped server rows, never caller paths or references. */
export async function prepareCommonPopulationLaunch(args: CommonPopulationLaunchArgs): Promise<CommonPopulationLaunchResult> {
  try {
    return await resolveCommonPopulationLaunch(args);
  } catch {
    return repair("common_population_source_read_failed", "The comparison population basis could not be verified. Restore access before launching.", 503);
  }
}

async function resolveCommonPopulationLaunch(args: CommonPopulationLaunchArgs): Promise<CommonPopulationLaunchResult> {
  const { client, model, scenarioEntry: entry } = args;
  const custody = args.custody ?? "legacy_stage_snapshot";
  if (!["legacy_stage_snapshot", "managed_attempt"].includes(custody)) return repair("common_population_custody_invalid", "The requested population custody is unsupported.");
  if (!entry || !hasGuidedProjectComparisonIntent(model.config_json) ||
      !["aequilibrae", "behavioral_demand"].includes(args.engineKey)) return { state: "not_applicable" };
  const method = args.engineKey === "aequilibrae" ? "aequilibrae" : "activitysim";
  if (!isGuidedProjectComparisonModel(model.config_json, method) || !model.project_id || !model.scenario_set_id ||
      entry.scenario_set_id !== model.scenario_set_id) {
    return repair("common_population_comparison_scope_invalid", "Repair this model's guided project and scenario-set links before launching.");
  }

  const setRead = await client.from("scenario_sets").select("id, workspace_id, project_id, baseline_entry_id")
    .eq("id", model.scenario_set_id).eq("workspace_id", model.workspace_id).eq("project_id", model.project_id).limit(2);
  if (setRead.error) return repair("common_population_source_read_failed", "The comparison population scope could not be read. Retry after restoring access.", 503);
  const set = single(setSchema, setRead.data);
  if (!set || set.id !== model.scenario_set_id || set.workspace_id !== model.workspace_id || set.project_id !== model.project_id) {
    return repair("common_population_comparison_scope_invalid", "Designate the baseline in this project's own scenario set before launching.");
  }
  const buildRead = await client.from("scenario_entries").select("id, scenario_set_id, entry_type, assumptions_json")
    .eq("scenario_set_id", set.id);
  if (buildRead.error) return repair("common_population_source_read_failed", "The guided build assumptions could not be read.", 503);
  const entries = z.array(entrySchema).safeParse(buildRead.data);
  if (!entries.success) return repair("common_population_comparison_scope_invalid", "The guided scenario records are incomplete.");
  const builds = entries.data.filter((candidate) => candidate.entry_type === "alternative");
  if (!builds.some((build) => hasCurrentChange(build.assumptions_json)) && !hasCurrentChange(entry.assumptions_json)) return { state: "not_applicable" };
  const baselines = entries.data.filter((candidate) => candidate.id === set.baseline_entry_id);
  const sourceBaseline = baselines[0];
  const build = builds[0];
  if (baselines.length !== 1 || !sourceBaseline || sourceBaseline.entry_type !== "baseline" || sourceBaseline.scenario_set_id !== set.id ||
      builds.length !== 1 || !build || build.scenario_set_id !== set.id || build.entry_type !== "alternative" ||
      !parseGuidedBuildAssumption(build.assumptions_json) ||
      (entry.id !== set.baseline_entry_id && entry.id !== build.id) ||
      (entry.id === set.baseline_entry_id ? entry.entry_type !== "baseline" :
        entry.entry_type !== "alternative" || !jsonValuesEqual(entry.assumptions_json, build.assumptions_json))) {
    return repair("common_population_comparison_scope_invalid", "Repair the designated baseline and the single fixed-population build assumption before launching.");
  }

  const descriptor = args.sourceDescriptor ?? resolveZoneAttributeSource().descriptor;
  const sourceProfile = populationSourceProfile(descriptor);
  if (!sourceProfile) return repair("common_population_source_unsupported", "This zone-attribute adapter or vintage has no supported retained-population profile.");
  const stamp = args.zoneAttributes;
  if (!stamp || stamp.status !== "supplied" || stamp.demographics.status !== "supplied" ||
      stamp.demographics.geographies <= 0 || !stamp.storageRef || stamp.geographyIndexTruncated) {
    return repair("common_population_source_unavailable", "Supply complete study-area demographics before launching this fixed-population comparison.");
  }
  if (stamp.sourceId !== descriptor.id || stamp.vintage !== descriptor.vintage) {
    return repair("common_population_source_mismatch", "The supplied demographics do not match the registered population source. Rebuild the launch inputs.");
  }
  if (method === "aequilibrae" && entry.id === set.baseline_entry_id) {
    return { state: "ready", request: { schema: SCHEMA, custody, mode: "generate", comparisonPolicy: POLICY, sourceProfile } };
  }

  const modelsRead = await client.from("models").select("id, workspace_id, project_id, scenario_set_id, config_json")
    .eq("workspace_id", model.workspace_id).eq("project_id", model.project_id).eq("scenario_set_id", set.id);
  if (modelsRead.error) return repair("common_population_source_read_failed", "The comparison's baseline method record could not be read.", 503);
  const models = z.array(modelSchema).safeParse(modelsRead.data);
  const sources = models.success ? models.data.filter((candidate) => isGuidedProjectComparisonModel(candidate.config_json, "aequilibrae")) : [];
  const sourceModel = sources[0];
  if (sources.length !== 1 || !sourceModel || sourceModel.workspace_id !== model.workspace_id ||
      sourceModel.project_id !== model.project_id || sourceModel.scenario_set_id !== set.id ||
      (method === "aequilibrae" && sourceModel.id !== model.id)) {
    return repair("common_population_baseline_model_invalid", "Repair the single AequilibraE baseline method in this project's comparison.");
  }
  const runRead = await client.from("model_runs")
    .select("id, workspace_id, project_id, model_id, scenario_set_id, scenario_entry_id, engine_key, status, attempt_managed, corridor_geojson, input_snapshot_json")
    .eq("workspace_id", model.workspace_id).eq("project_id", model.project_id).eq("model_id", sourceModel.id)
    .eq("scenario_set_id", set.id).eq("scenario_entry_id", set.baseline_entry_id).eq("engine_key", "aequilibrae")
    .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(1);
  if (runRead.error) return repair("common_population_source_read_failed", "The baseline population run could not be read.", 503);
  const run = single(runSchema, runRead.data);
  if (!run || run.workspace_id !== model.workspace_id || run.project_id !== model.project_id || run.model_id !== sourceModel.id ||
      run.scenario_set_id !== set.id || run.scenario_entry_id !== set.baseline_entry_id ||
      run.attempt_managed !== (custody === "managed_attempt")) {
    return repair("common_population_baseline_required", "Run a new AequilibraE baseline successfully before reusing its population. Existing runs remain historical.");
  }
  const generated = generateSchema.safeParse(run.input_snapshot_json.commonPopulation);
  const sourceStamp = z.object({ status: z.literal("supplied"), sourceId: z.literal(descriptor.id), vintage: z.literal(descriptor.vintage),
    demographics: z.object({ status: z.literal("supplied"), geographies: z.number().int().positive() }),
    geographyIndexTruncated: z.literal(false),
  }).safeParse(run.input_snapshot_json.zoneAttributes);
  if (!generated.success || generated.data.custody !== custody || !sourceStamp.success || !jsonValuesEqual(generated.data.sourceProfile, sourceProfile) ||
      run.input_snapshot_json.zoneGeography !== args.zoneGeography || !jsonValuesEqual(run.corridor_geojson, args.corridorGeojson)) {
    return repair("common_population_baseline_mismatch", "The baseline population uses different inputs or lacks a retained basis. Launch a new baseline for these inputs.");
  }

  const artifactRead = await client.from("model_run_artifacts")
    .select("id, run_id, stage_id, attempt_id, artifact_type, file_url, file_size_bytes, content_hash")
    .eq("run_id", run.id).eq("artifact_type", "common_population").limit(2);
  if (artifactRead.error) return repair("common_population_source_read_failed", "The baseline's retained population artifact could not be read.", 503);
  const artifact = single(artifactSchema, artifactRead.data);
  if (!artifact || artifact.run_id !== run.id) return repair("common_population_artifact_invalid", "The baseline needs one retained population artifact with valid bytes and explicit custody. Run a new baseline.");
  const stageRead = await client.from("model_run_stages")
    .select("id, run_id, stage_name, status, attempt_managed, active_attempt_id")
    .eq("id", artifact.stage_id).eq("run_id", run.id).limit(2);
  if (stageRead.error) return repair("common_population_source_read_failed", "The population artifact's producing setup stage could not be read.", 503);
  const stage = single(stageSchema, stageRead.data);
  if (!stage || stage.id !== artifact.stage_id || stage.run_id !== run.id ||
      stage.attempt_managed !== (custody === "managed_attempt") ||
      (custody === "managed_attempt" ? !artifact.attempt_id || stage.active_attempt_id !== artifact.attempt_id
        : artifact.attempt_id !== null || stage.active_attempt_id !== null)) {
    return repair("common_population_attempt_invalid", "The population artifact is inconsistent with the baseline's explicit setup custody. Run a new baseline.");
  }
  if (custody === "legacy_stage_snapshot") {
    const attestation = await args.readStageCustody(model.workspace_id, run.id, stage.id, artifact.id);
    if (attestation.error) return repair("common_population_source_read_failed", "The baseline's fresh stage custody could not be verified.", 503);
    if (!validStageCustodyAttestation(attestation.data, model.workspace_id, run.id, stage.id, artifact.id)) {
      return repair("common_population_custody_invalid", "The baseline lacks fresh receipt-backed stage custody. Run a new baseline.");
    }
  } else {
    // Attempt rows have no direct client/service SELECT grant. This existing service
    // reader checks revocation and exact attempt/run/stage binding after our scope checks.
    const outputsRead = await args.readOutputs(run.id, model.workspace_id);
    if (outputsRead.error) return repair("common_population_source_read_failed", "The retained population's attempt ownership could not be verified.", 503);
    const outputs = z.object({ run_id: uuid, run_status: z.literal("succeeded"), outputs: z.array(z.object({
      kind: z.string(), ownership_state: z.string(), record,
    })) }).safeParse(outputsRead.data);
    const matching = outputs.success ? outputs.data.outputs.filter((output) => output.kind === "artifact" && output.record.id === artifact.id) : [];
    const output = matching[0];
    const confirmed = artifactSchema.safeParse(output?.record);
    if (!outputs.success || outputs.data.run_id !== run.id || matching.length !== 1 || output?.ownership_state !== "current_completed" ||
        !confirmed.success || !jsonValuesEqual(confirmed.data, artifact)) {
      return repair("common_population_attempt_invalid", "The retained population attempt is revoked, inactive or inconsistent. Run a new baseline; do not refit this launch.");
    }
  }
  const source = { modelRunId: run.id, artifactId: artifact.id, stageId: artifact.stage_id,
    sha256: artifact.content_hash, sizeBytes: artifact.file_size_bytes };
  return custody === "legacy_stage_snapshot"
    ? { state: "ready", request: { schema: SCHEMA, custody, mode: "reuse", comparisonPolicy: POLICY, source: { ...source, attemptId: null } } }
    : { state: "ready", request: { schema: SCHEMA, custody, mode: "reuse", comparisonPolicy: POLICY, source: { ...source, attemptId: artifact.attempt_id! } } };
}
