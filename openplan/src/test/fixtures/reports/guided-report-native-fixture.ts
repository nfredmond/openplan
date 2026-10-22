// SOURCE PREPARATION ONLY. UNINSTALLED AND UNRUN. Root must admit source,
// configured types and an identified disposable437 target before any execution.
import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { appendFileSync, chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { expect } from "vitest";
import { z } from "zod";
import { guidedManagedReportFixture, hashBytes, type EvidenceRow } from "../guided-report-evidence";
import { getLocalSupabaseEnv, liveClient } from "../../local-supabase-env";
import { resolveLocalDbContainer } from "../../helpers/live-catalog";
import { requireContractVerificationStack } from "../../helpers/contract-verification-stack";

const COMMIT = "a2a174b3725abfce5b8e671d7abf260520afb286";
const READINESS = "b2b9e1f11984a9820ee04d1d9a4094f20e2b45afcfe922c39e2cf79f31a18557";
const rowSchema = z.record(z.string(), z.unknown());
const uuid = z.string().uuid();
const lifetimeSchema = z.object({
  purpose: z.literal("synthetic-reports-route-r82"), disposable: z.literal(true), retainForRoot: z.literal(true),
  frozenProductionSourceCommit: z.literal(COMMIT), readinessSourceSha256: z.literal(READINESS),
  // Root binds the eventually accepted fixture-only checkpoint independently
  // of the unchanged frozen production bodies. No current checkpoint is admitted.
  fixtureCheckpoint: z.object({ commit: z.string().regex(/^[a-f0-9]{40}$/), appTree: z.string().regex(/^[a-f0-9]{40}$/) }),
  targetAdmission: z.enum(["new-owned-disposable", "root-readmitted-r70-owned437"]),
  // This reference must identify root's subsequently accepted full native baseline.
  // R70 assembly failures and R77's timezone failure are not admission receipts.
  acceptedReadinessNativeReport: z.string().startsWith("/"),
  acceptedReadinessNativeReportSha256: z.string().regex(/^[a-f0-9]{64}$/),
  ownershipHandbackReceipt: z.string().startsWith("/"),
  ownershipHandbackReceiptSha256: z.string().regex(/^[a-f0-9]{64}$/),
  project: z.string().regex(/^openplan-restore-target-[1-9][0-9]*$/),
  workdir: z.string().startsWith("/"), apiUrl: z.string().url(), dbPort: z.number().int(),
  container: z.string(), containerId: z.string().regex(/^[a-f0-9]{64}$/),
  networkId: z.string().regex(/^[a-f0-9]{64}$/),
  workerRoot: z.string().startsWith("/"), receiptFile: z.string().startsWith("/"),
  migrationVersions: z.array(z.string().regex(/^[0-9]{14}$/)).length(437),
});
export type Variant = "current" | "missing" | "revoked-only" | "wrong-producer" | "ambiguous-current";
export type Method = "aequilibrae" | "activitysim";
export type Kpi = { id: string; run_id: string; attempt_id: string; kpi_name: string; value: number; unit: string } & EvidenceRow;
const kpiSchema = z.object({ id: uuid, run_id: uuid, attempt_id: uuid, kpi_name: z.string(), value: z.number().finite(), unit: z.string() }).passthrough();
const projectionSchema = z.object({ run_id: uuid, run_status: z.string(), outputs: z.array(z.object({
  kind: z.enum(["artifact", "kpi"]), ownership_state: z.string(), record: rowSchema,
})) });
const artifactSchema = z.object({ id: uuid, run_id: uuid, stage_id: uuid, attempt_id: uuid,
  artifact_type: z.string(), content_hash: z.string(), file_size_bytes: z.union([z.number(), z.string()]), file_url: z.string(),
}).passthrough();
type Artifact = z.infer<typeof artifactSchema>;
type Projection = z.infer<typeof projectionSchema>;
export type Fixture = {
  variant: Variant; workspaceId: string; projectId: string; setId: string; snapshotId: string;
  runIds: string[]; oldKpis: Kpi[]; currentKpis: Kpi[]; invalidKpis: Kpi[];
  producers: Map<string, { stageId: string; stageName: string; attemptId: string }>;
  outputIds: string[]; instrumentIds: string[]; artifactIds: string[];
  oldAttemptIds: string[]; oldArtifacts: Artifact[]; oldInstruments: EvidenceRow[]; currentArtifacts: Artifact[];
};
const roles = [
  ["input_bundle", "validation_input_bundle_v2", "openplan.validation-input-bundle.v2"],
  ["comparison_basis", "model_comparison_basis_v2", "openplan.model-comparison-basis.v2"],
  ["assessment", "model_validation_assessment_v2", "openplan.model-validation-assessment.v2"],
  ["match_audit", "pre_volume_match_audit_v2", "openplan.pre-volume-observation-match-audit.v2"],
  ["diagnosis", "model_validation_structural_diagnosis_v2", "openplan.model-validation-structural-diagnosis.v2"],
] as const;
const populationNames: Record<string, string> = {
  common_population: "common_population.json", common_population_households: "households.csv",
  common_population_persons: "persons.csv", common_population_selected_zones: "selected_zones.json",
  common_population_diagnostics: "diagnostics.json", common_population_source_manifest: "source_manifest.json",
  common_population_source_zone_attributes: "source_zone_attributes.csv",
};
function text(row: EvidenceRow, key: string): string { return z.string().parse(row[key]); }
function object(value: unknown): EvidenceRow { return rowSchema.parse(value); }
function exactlyOne<T>(rows: T[], label: string): T {
  if (rows.length !== 1) throw new Error(`${label}: expected one row, got ${rows.length}`);
  return rows[0];
}

/** One bounded fixture factory, reusing maintained clients, bytes and commands.
 * It does not allocate a stack, install SQL, reset history or delete fixtures. */
export class GuidedNativeFixture {
  readonly member: SupabaseClient;
  readonly service: SupabaseClient;
  readonly workerRoot: string;
  readonly actorId: string;
  private constructor(
    readonly lifetime: z.infer<typeof lifetimeSchema>, member: SupabaseClient,
    service: SupabaseClient, actorId: string, workerRoot: string,
  ) { this.member = member; this.service = service; this.actorId = actorId; this.workerRoot = workerRoot; }

  private record(event: string, data: unknown) {
    appendFileSync(this.lifetime.receiptFile, JSON.stringify({ event, synthetic: true, retainForRoot: true,
      containerId: this.lifetime.containerId, data }) + "\n", { mode: 0o600 });
  }
  recordReport(id: string) { uuid.parse(id); this.record("owned_report", { id }); }

  static async open(): Promise<GuidedNativeFixture> {
    const filename = process.env.OPENPLAN_GUIDED_NATIVE_LIFETIME;
    if (!filename) throw new Error("Root must admit this target-bound disposable437 fixture lifetime first");
    const lifetime = lifetimeSchema.parse(JSON.parse(readFileSync(filename, "utf8")));
    // Root decides acceptance. These byte pins bind its reviewed private
    // readiness and ownership receipts; their existence does not grant a run.
    expect(hashBytes(readFileSync(lifetime.acceptedReadinessNativeReport))).toBe(lifetime.acceptedReadinessNativeReportSha256);
    expect(hashBytes(readFileSync(lifetime.ownershipHandbackReceipt))).toBe(lifetime.ownershipHandbackReceiptSha256);
    if (["DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_TLS_VERIFY", "DOCKER_CERT_PATH", "DOCKER_API_VERSION"].some(key => process.env[key])) {
      throw new Error("Root must supply a sanitized local Docker environment");
    }
    if (process.env.OPENPLAN_SUPABASE_WORKDIR !== lifetime.workdir) throw new Error("Wrong native workdir");
    const api = new URL(lifetime.apiUrl);
    if (!["127.0.0.1", "localhost"].includes(api.hostname) ||
      [54321, 58321, 59421, 59521, 59621, 59721, 59821, 59921, 61421].includes(Number(api.port))) {
      throw new Error("An explicitly admitted owned native target is required; excluded/shared targets are refused");
    }
    if (lifetime.targetAdmission === "root-readmitted-r70-owned437") {
      expect(Number(api.port)).toBe(61521); expect(lifetime.dbPort).toBe(61522);
    } else if (Number(api.port) === 61521 || lifetime.dbPort === 61522) {
      throw new Error("Reusing R70 requires root's separate corrected-readiness admission and handoff");
    }
    const env = getLocalSupabaseEnv();
    expect(env.API_URL).toBe(lifetime.apiUrl);
    expect(Number(new URL(env.DB_URL).port)).toBe(lifetime.dbPort);
    expect(resolveLocalDbContainer()).toBe(lifetime.container);
    requireContractVerificationStack(lifetime.container, "false");
    GuidedNativeFixture.inspect(lifetime);
    const history = JSON.parse(execFileSync("docker", ["exec", "-i", lifetime.containerId,
      "psql", "-X", "-U", "postgres", "-d", "postgres", "-qAt", "-v", "ON_ERROR_STOP=1"], {
      input: "BEGIN READ ONLY; SELECT jsonb_agg(version ORDER BY version) FROM supabase_migrations.schema_migrations; COMMIT;",
      encoding: "utf8", timeout: 15_000,
    }));
    expect(history).toEqual(lifetime.migrationVersions);
    expect(new Set(history).size).toBe(437);
    expect(history).toContain("20261022050000"); expect(history).toContain("20261022070000");
    // Root supplies and retains this owned directory. Refuse redirection before writes.
    expect(lstatSync(lifetime.workerRoot).isSymbolicLink()).toBe(false);
    expect(realpathSync(lifetime.workerRoot)).toBe(path.resolve(lifetime.workerRoot));
    if (path.dirname(lifetime.receiptFile) !== lifetime.workerRoot || path.resolve(lifetime.receiptFile) !== lifetime.receiptFile) {
      throw new Error("Receipt must be a new direct child of the admitted owned worker root");
    }
    // Exclusive creation preserves every earlier cohort and refuses symlinks.
    writeFileSync(lifetime.receiptFile, "", { flag: "wx", mode: 0o600 });
    const workerRoot = mkdtempSync(path.join(lifetime.workerRoot, "reports-r82-"));
    const member = liveClient(env.API_URL, env.ANON_KEY, "reports-r82-ordinary");
    const service = liveClient(env.API_URL, env.SERVICE_ROLE_KEY, "reports-r82-service");
    const signup = await member.auth.signUp({ email: `reports-r82-${randomUUID()}@example.test`, password: randomBytes(32).toString("base64url") });
    if (signup.error || !signup.data.user || !signup.data.session) throw new Error(`Owned ordinary signup: ${signup.error?.message ?? "no session"}`);
    const actor = await member.auth.getUser();
    expect(actor.error).toBeNull(); expect(actor.data.user?.id).toBe(signup.data.user.id);
    const result = new GuidedNativeFixture(lifetime, member, service, signup.data.user.id, workerRoot);
    result.record("ordinary_signup", { actorId: result.actorId, workerRoot });
    const memberships = await member.from("workspace_members").select("workspace_id,user_id,role").eq("user_id", result.actorId);
    expect(memberships.error).toBeNull(); result.record("signup_workspaces", memberships.data);
    return result;
  }

  private static inspect(lifetime: z.infer<typeof lifetimeSchema>) {
    const identity = execFileSync("docker", ["inspect", "--format",
      '{{.Id}}|{{index .Config.Labels "com.supabase.cli.project"}}|{{index .Config.Labels "com.supabase.cli.workdir"}}|{{json .NetworkSettings.Networks}}',
      lifetime.container], { encoding: "utf8" }).trim().split("|");
    expect(identity.slice(0, 3)).toEqual([lifetime.containerId, lifetime.project, lifetime.workdir]);
    const networks = Object.values(z.record(z.string(), z.object({ NetworkID: z.string() }).passthrough()).parse(JSON.parse(identity[3])));
    expect(networks).toHaveLength(1); expect(networks[0].NetworkID).toBe(lifetime.networkId);
  }

  private async rpc(name: string, args: EvidenceRow): Promise<EvidenceRow> {
    this.record("native_command_intent", { name, args });
    const result = await this.service.rpc(name, args);
    if (result.error) {
      this.record("native_command_failure", { name, code: result.error.code, message: result.error.message });
      throw new Error(`${name}: ${result.error.code}: ${result.error.message}`);
    }
    const row = object(result.data); this.record(name, row); return row;
  }
  private async claim(stageId: string): Promise<string> {
    const claimed = await this.rpc("claim_model_stage_attempt", { p_request_id: randomUUID(), p_stage_id: stageId, p_worker_id: "synthetic-reports-r82-no-model-execution" });
    expect(claimed.outcome).toBe("claimed"); return uuid.parse(claimed.attempt_id);
  }
  private async finish(attemptId: string, failed = false) {
    await this.rpc("write_model_stage_attempt", { p_request_id: randomUUID(), p_attempt_id: attemptId,
      p_status: failed ? "failed" : "succeeded", p_log_tail: "Synthetic fixture only; no worker/model/scientific execution",
      p_error: failed ? "Synthetic first-attempt failure for retained KPI authority" : null });
  }
  private async writeKpi(attemptId: string, expected: EvidenceRow, value: number): Promise<Kpi> {
    const actual = kpiSchema.parse(await this.rpc("write_model_attempt_kpi", { p_request_id: randomUUID(), p_attempt_id: attemptId,
      p_payload: { kpi_name: expected.kpi_name, kpi_label: expected.kpi_label, kpi_category: expected.kpi_category,
        value, unit: expected.unit, geometry_ref: null, breakdown_json: { synthetic: true, scientificStatus: "inconclusive" } } }));
    expect(actual).toMatchObject({ attempt_id: attemptId, kpi_name: expected.kpi_name, value, unit: expected.unit });
    return actual;
  }
  private async writeArtifact(runId: string, attemptId: string, kind: string, bytes: Uint8Array, metadata: EvidenceRow, filename = `${randomUUID()}.json`): Promise<Artifact> {
    uuid.parse(runId); uuid.parse(attemptId);
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(filename) || bytes.byteLength === 0) throw new Error("Nonempty confined bytes and a canonical basename are required");
    const directory = path.join(this.workerRoot, "runs", runId, "attempts", attemptId);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    expect(realpathSync(directory)).toBe(directory);
    const file = path.join(directory, filename); writeFileSync(file, bytes, { flag: "wx", mode: 0o600 });
    const payload = { id: randomUUID(), artifact_type: kind, file_url: `local://${file}`,
      file_size_bytes: bytes.byteLength, content_hash: hashBytes(bytes), metadata_json: metadata };
    this.record("owned_artifact_file", payload);
    const artifact = artifactSchema.parse(await this.rpc("write_model_attempt_artifact", { p_request_id: randomUUID(), p_attempt_id: attemptId, p_payload: payload }));
    expect(artifact).toMatchObject({ ...payload, run_id: runId, attempt_id: attemptId });
    expect(artifact.content_hash).toBe(hashBytes(readFileSync(file)));
    expect(Number(artifact.file_size_bytes)).toBe(bytes.byteLength);
    return artifact;
  }

  /** Byte contents come from the maintained managed fixture unchanged. Native IDs
   * never enter these v2 documents, so no frozen UUID text substitution occurs. */
  private async outputInstrument(f: ReturnType<typeof guidedManagedReportFixture>, index: number, runId: string, attemptId: string): Promise<{ output: Artifact; instrument: EvidenceRow; artifacts: Artifact[] }> {
    const method: Method = index < 2 ? "aequilibrae" : "activitysim";
    const sourceOutput = f.outputs[index];
    const outputBytes = f.bytes.get(text(sourceOutput, "file_url"));
    if (!outputBytes) throw new Error("Maintained output bytes missing");
    const output = await this.writeArtifact(runId, attemptId, text(sourceOutput, "artifact_type"), outputBytes,
      { ...object(sourceOutput.metadata_json), demand_method: method });
    const payload: EvidenceRow = { demand_method: method, scientific_outcome: "inconclusive", model_output_artifact_id: output.id, model_output_sha256: output.content_hash };
    const artifacts: Artifact[] = [output];
    for (const [prefix, kind, schema] of roles) {
      const row = exactlyOne(f.tables.model_run_artifacts.filter(item => item.run_id === f.runs[index] && item.artifact_type === kind), `maintained ${kind}`);
      const bytes = f.bytes.get(text(row, "file_url")); if (!bytes) throw new Error(`Maintained ${kind} bytes missing`);
      // Existing record_model_attempt_instrument + attached v2 validator own the
      // type/schema contract. This is payload authoring, not another validator.
      const artifact = await this.writeArtifact(runId, attemptId, kind, bytes, { schema, demand_method: method });
      artifacts.push(artifact); payload[`${prefix}_artifact_id`] = artifact.id; payload[`${prefix}_sha256`] = artifact.content_hash;
    }
    const instrument = await this.rpc("record_model_attempt_instrument", { p_request_id: randomUUID(), p_attempt_id: attemptId, p_payload: payload });
    expect(instrument.scientific_outcome).toBe("inconclusive");
    expect(instrument.model_output_artifact_id).toBe(output.id); expect(instrument.attempt_id).toBe(attemptId);
    return { output, instrument, artifacts };
  }

  /** Fixed scoped SELECTs only, using the maintained psql transport on the
   * already bound owned target. State is retained; this never performs cleanup. */
  persisted(f: Fixture): { models: unknown; reports: unknown; artifacts: unknown; storage: unknown } {
    GuidedNativeFixture.inspect(this.lifetime); uuid.parse(f.workspaceId);
    const workspace = f.workspaceId;
    const sql = `BEGIN READ ONLY;
      WITH runs AS (SELECT id FROM public.model_runs WHERE workspace_id='${workspace}')
      SELECT jsonb_build_object(
        'models',jsonb_build_object(
          'runs',(SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM public.model_runs t WHERE t.id IN(SELECT id FROM runs)),
          'stages',(SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM public.model_run_stages t WHERE t.run_id IN(SELECT id FROM runs)),
          'attempts',(SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM public.model_stage_attempts t WHERE t.run_id IN(SELECT id FROM runs)),
          'kpis',(SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM public.model_run_kpis t WHERE t.run_id IN(SELECT id FROM runs)),
          'outputs',(SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM public.model_run_artifacts t WHERE t.run_id IN(SELECT id FROM runs)),
          'instruments',(SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM public.model_attempt_instrument_custody t WHERE t.model_run_id IN(SELECT id FROM runs))),
        'reports',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id),'[]') FROM public.reports t WHERE t.workspace_id='${workspace}'),
        'artifacts',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id),'[]') FROM public.report_artifacts t JOIN public.reports r ON r.id=t.report_id WHERE r.workspace_id='${workspace}'),
        'storage',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id),'[]') FROM storage.objects t WHERE t.bucket_id='report-artifacts' AND t.name LIKE '${workspace}/%'));
      COMMIT;`;
    return z.object({ models: z.unknown(), reports: z.unknown(), artifacts: z.unknown(), storage: z.unknown() }).parse(JSON.parse(execFileSync("docker", ["exec", "-i", this.lifetime.containerId,
      "psql", "-X", "-U", "postgres", "-d", "postgres", "-qAt", "-v", "ON_ERROR_STOP=1"], { input: sql, encoding: "utf8", timeout: 15_000, maxBuffer: 8 * 1024 * 1024 })));
  }

  async projection(runId: string, workspaceId: string): Promise<Projection> {
    return projectionSchema.parse(await this.rpc("read_model_attempt_outputs", { p_run_id: runId, p_workspace_id: workspaceId }));
  }

  async prepare(variant: Variant): Promise<Fixture> {
    const f = guidedManagedReportFixture();
    const fixture: Fixture = { variant, workspaceId: randomUUID(), projectId: randomUUID(), setId: randomUUID(), snapshotId: randomUUID(),
      runIds: [], oldKpis: [], currentKpis: [], invalidKpis: [], producers: new Map(), outputIds: [], instrumentIds: [], artifactIds: [],
      oldAttemptIds: [], oldArtifacts: [], oldInstruments: [], currentArtifacts: [] };
    this.record("fixture_scope", { ...fixture, producers: [] });
    const insert = async (table: string, rows: EvidenceRow | EvidenceRow[]) => {
      this.record("fixture_insert_intent", { table, rows });
      const result = await this.service.from(table).insert(rows); if (result.error) throw new Error(`${table} fixture insert: ${result.error.message}`);
    };
    await insert("workspaces", { id: fixture.workspaceId, name: `SYNTHETIC Reports ${variant}`, slug: `reports-r82-${fixture.workspaceId}` });
    await insert("workspace_members", { workspace_id: fixture.workspaceId, user_id: this.actorId, role: "owner" });
    await insert("projects", { id: fixture.projectId, workspace_id: fixture.workspaceId, name: `SYNTHETIC Reports ${variant}`, place_geometry_geojson: f.tables.projects[0].place_geometry_geojson });
    await insert("scenario_sets", { id: fixture.setId, workspace_id: fixture.workspaceId, project_id: fixture.projectId, title: "SYNTHETIC current versus retained comparison", created_by: this.actorId });
    const entryIds = [randomUUID(), randomUUID()];
    await insert("scenario_entries", f.tables.scenario_entries.map((entry, index) => ({ id: entryIds[index], scenario_set_id: fixture.setId,
      entry_type: entry.entry_type, label: entry.label, slug: `synthetic-${entryIds[index]}`, assumptions_json: entry.assumptions_json, created_by: this.actorId })));
    expect((await this.service.from("scenario_sets").update({ baseline_entry_id: entryIds[0] }).eq("id", fixture.setId)).error).toBeNull();
    const modelIds = [randomUUID(), randomUUID()];
    await insert("models", f.tables.models.map((model, index) => ({ id: modelIds[index], workspace_id: fixture.workspaceId, project_id: fixture.projectId,
      scenario_set_id: fixture.setId, title: `SYNTHETIC ${index ? "ActivitySim" : "AequilibraE"}`, model_family: index ? "activity_based_model" : "travel_demand", config_json: model.config_json, created_by: this.actorId })));
    let source: EvidenceRow | null = null;
    const links: EvidenceRow[] = [];
    for (let index = 0; index < 4; index++) {
      const runId = randomUUID(); fixture.runIds.push(runId);
      const setupId = index === 0 ? randomUUID() : null;
      const bundleId = index >= 2 ? randomUUID() : null;
      const producerId = randomUUID();
      const expected = f.tables.model_run_kpis.filter(kpi => kpi.run_id === f.runs[index]);
      expect(expected).toHaveLength(2);
      const sourceRequest = index === 0 ? f.population.generate : { ...f.population.reuse, source };
      if (index !== 0 && !source) throw new Error("Actual current source reference is missing");
      await insert("model_runs", { id: runId, workspace_id: fixture.workspaceId, project_id: fixture.projectId, model_id: modelIds[index < 2 ? 0 : 1],
        scenario_set_id: fixture.setId, scenario_entry_id: entryIds[index % 2], engine_key: index < 2 ? "aequilibrae" : "behavioral_demand", status: "queued",
        run_title: "SYNTHETIC retry/current Reports input", corridor_geojson: f.tables.projects[0].place_geometry_geojson,
        assumption_snapshot_json: f.tables.scenario_entries[index % 2].assumptions_json,
        input_snapshot_json: { zoneGeography: "tract", commonPopulation: sourceRequest }, created_by: this.actorId });
      const producerName = index < 2 ? "Artifact Extraction" : "ActivitySim Network Assignment";
      await insert("model_run_stages", [
        ...(setupId ? [{ id: setupId, run_id: runId, stage_name: "AequilibraE Setup", status: "queued", sort_order: 0 }] : []),
        ...(bundleId ? [{ id: bundleId, run_id: runId, stage_name: "ActivitySim Bundle & Preflight", status: "queued", sort_order: 0 }] : []),
        { id: producerId, run_id: runId, stage_name: producerName, status: "queued", sort_order: 1 },
      ]);
      // Supported first attempt. No population source is published before retry.
      if (setupId) {
        const oldSetup = await this.claim(setupId); fixture.oldAttemptIds.push(oldSetup); await this.finish(oldSetup);
      }
      if (bundleId) {
        const oldBundle = await this.claim(bundleId); fixture.oldAttemptIds.push(oldBundle);
        fixture.oldKpis.push(await this.writeKpi(oldBundle, expected[0], 999999)); await this.finish(oldBundle);
      }
      const oldProducer = await this.claim(producerId); fixture.oldAttemptIds.push(oldProducer);
      for (const kpi of expected.filter(item => !bundleId || item.kpi_name !== "activitysim_trips")) {
        if (variant === "missing" && index === 0 && kpi.kpi_name === "total_trips") continue;
        fixture.oldKpis.push(await this.writeKpi(oldProducer, kpi, 999999));
      }
      const retained = await this.outputInstrument(f, index, runId, oldProducer);
      fixture.oldArtifacts.push(...retained.artifacts); fixture.oldInstruments.push(retained.instrument);
      await this.finish(oldProducer, true);
      const reviewed = await this.rpc("inspect_model_run_recovery", { p_workspace_id: fixture.workspaceId, p_run_id: runId, p_actor_id: this.actorId });
      expect(object(reviewed.expected_state).status).toBe("failed");
      const retried = await this.rpc("relaunch_model_run_attempts", { p_request_id: randomUUID(), p_workspace_id: fixture.workspaceId,
        p_run_id: runId, p_actor_id: this.actorId, p_expected_state: reviewed.expected_state, p_reason: "Synthetic fresh attempt; preserve original bytes and values" });
      expect(retried.outcome).toBe("fresh_attempt_queued"); expect(retried.outputs_preserved).toBe(true);
      if (setupId) {
        const setupAttempt = await this.claim(setupId);
        if (variant === "wrong-producer") fixture.invalidKpis.push(await this.writeKpi(setupAttempt, expected[1], Number(expected[1].value)));
        for (const artifact of f.tables.model_run_artifacts.filter(item => item.run_id === f.runs[0] && String(item.artifact_type).startsWith("common_population"))) {
          const kind = text(artifact, "artifact_type"), bytes = f.bytes.get(text(artifact, "file_url"));
          if (!bytes) throw new Error("Maintained population companion bytes missing");
          const current = await this.writeArtifact(runId, setupAttempt, kind, bytes, f.population.sourceMetadata, populationNames[kind]);
          fixture.artifactIds.push(current.id); fixture.currentArtifacts.push(current);
          if (kind === "common_population") source = { modelRunId: runId, artifactId: current.id, stageId: setupId, attemptId: setupAttempt, sha256: current.content_hash, sizeBytes: Number(current.file_size_bytes) };
        }
        await this.finish(setupAttempt);
      }
      if (bundleId) {
        const bundleAttempt = await this.claim(bundleId);
        const current = await this.writeKpi(bundleAttempt, expected[0], Number(expected[0].value)); fixture.currentKpis.push(current);
        fixture.producers.set(current.id, { stageId: bundleId, stageName: "ActivitySim Bundle & Preflight", attemptId: bundleAttempt });
        await this.finish(bundleAttempt);
      }
      const currentProducer = await this.claim(producerId); expect(currentProducer).not.toBe(oldProducer);
      for (const kpi of expected.filter(item => !bundleId || item.kpi_name !== "activitysim_trips")) {
        if (index === 0 && ((["missing", "revoked-only"].includes(variant) && kpi.kpi_name === "total_trips") ||
          (variant === "wrong-producer" && kpi.kpi_name === "daily_vmt"))) continue;
        const written = await this.writeKpi(currentProducer, kpi, Number(kpi.value)); fixture.currentKpis.push(written);
        fixture.producers.set(written.id, { stageId: producerId, stageName: producerName, attemptId: currentProducer });
        if (variant === "ambiguous-current" && index === 0 && kpi.kpi_name === "total_trips") {
          const duplicate = await this.writeKpi(currentProducer, kpi, Number(kpi.value) + 1); fixture.currentKpis.push(duplicate);
          fixture.producers.set(duplicate.id, { stageId: producerId, stageName: producerName, attemptId: currentProducer });
        }
      }
      const current = await this.outputInstrument(f, index, runId, currentProducer);
      fixture.outputIds.push(current.output.id); fixture.instrumentIds.push(uuid.parse(current.instrument.id));
      fixture.artifactIds.push(...current.artifacts.map(item => item.id)); fixture.currentArtifacts.push(...current.artifacts);
      await this.finish(currentProducer);
      const metadata = object(f.outputs[index].metadata_json);
      links.push({ workspace_id: fixture.workspaceId, comparison_snapshot_id: fixture.snapshotId, model_run_id: runId, model_run_artifact_id: current.output.id,
        method: index < 2 ? "aequilibrae" : "activitysim", scenario_role: index % 2 ? "build" : "baseline", artifact_type: current.output.artifact_type,
        artifact_sha256: current.output.content_hash, assignment_profile_sha256: metadata.assignment_profile_digest,
        network_settings_sha256: metadata.network_settings_digest, network_state_sha256: metadata.network_state_digest,
        scenario_assumptions_json: f.tables.scenario_entries[index % 2].assumptions_json, created_by: this.actorId });
    }
    await insert("scenario_comparison_snapshots", { id: fixture.snapshotId, scenario_set_id: fixture.setId, baseline_entry_id: entryIds[0], candidate_entry_id: entryIds[1],
      label: `SYNTHETIC ${variant} current versus retained`, summary: "Synthetic software fixture; no scientific acceptance", caveats_json: [],
      metadata_json: { commonPopulation: { ...f.population.snapshot, sourceRunId: fixture.runIds[0], source } }, status: "draft", created_by: this.actorId });
    // Use the real ordinary owner for links and the real native readiness trigger.
    expect((await this.member.from("scenario_comparison_model_run_links").insert(links)).error).toBeNull();
    const ready = await this.member.from("scenario_comparison_snapshots").update({ status: "ready" }).eq("id", fixture.snapshotId).select("id,status").single();
    expect(ready.error).toBeNull(); expect(ready.data).toEqual({ id: fixture.snapshotId, status: "ready" });
    this.record("prepared_fixture", { ...fixture, producers: [...fixture.producers] });
    await this.assertAuthority(fixture);
    return fixture;
  }

  async assertAuthority(f: Fixture) {
    const currentCount = f.variant === "ambiguous-current" ? 9 : f.variant === "current" ? 8 : 7;
    expect(f.currentKpis).toHaveLength(currentCount);
    expect(f.oldKpis).toHaveLength(f.variant === "missing" ? 7 : 8);
    expect(f.outputIds).toHaveLength(4); expect(f.instrumentIds).toHaveLength(4);
    expect(f.oldArtifacts).toHaveLength(24); expect(f.oldInstruments).toHaveLength(4);
    expect(f.currentArtifacts).toHaveLength(31); expect(f.oldAttemptIds).toHaveLength(7);
    const state = z.object({ attempts: z.array(rowSchema), instruments: z.array(rowSchema) }).passthrough().parse(this.persisted(f).models);
    for (const id of f.oldAttemptIds) {
      const attempt = exactlyOne(state.attempts.filter(item => item.id === id), "retained attempt");
      expect(attempt.revoked_at).toEqual(expect.any(String));
    }
    for (const instrument of f.oldInstruments) expect(state.instruments).toContainEqual(instrument);
    if (f.variant === "current") for (const current of f.currentKpis) {
      const old = exactlyOne(f.oldKpis.filter(item => item.run_id === current.run_id && item.kpi_name === current.kpi_name), "same-name retained KPI");
      expect(old.attempt_id).not.toBe(current.attempt_id); expect(old.id).not.toBe(current.id); expect(old.value).toBe(999999);
      expect(current.value).not.toBe(old.value);
    }
    const all: Projection["outputs"] = [];
    for (const runId of f.runIds) {
      const projection = await this.projection(runId, f.workspaceId); expect(projection.run_status).toBe("succeeded"); all.push(...projection.outputs);
      for (const artifact of f.oldArtifacts.filter(item => item.run_id === runId))
        expect(projection.outputs).toContainEqual({ kind: "artifact", ownership_state: "retained_inactive", record: artifact });
      for (const artifact of f.currentArtifacts.filter(item => item.run_id === runId))
        expect(projection.outputs).toContainEqual({ kind: "artifact", ownership_state: "current_completed", record: artifact });
      for (const kpi of f.oldKpis.filter(item => item.run_id === runId))
        expect(projection.outputs).toContainEqual({ kind: "kpi", ownership_state: "retained_inactive", record: kpi });
      for (const kpi of f.currentKpis.filter(item => item.run_id === runId))
        expect(projection.outputs).toContainEqual({ kind: "kpi", ownership_state: "current_completed", record: kpi });
      for (const kpi of f.invalidKpis.filter(item => item.run_id === runId))
        expect(projection.outputs).toContainEqual({ kind: "kpi", ownership_state: "invalid_binding", record: kpi });
    }
    expect(all.filter(item => item.kind === "kpi" && item.ownership_state === "current_completed")).toHaveLength(currentCount);
    const readable = await this.member.from("model_run_kpis").select("*").in("run_id", f.runIds).order("id");
    expect(readable.error).toBeNull();
    expect(readable.data?.map(item => item.id).sort()).toEqual([...f.oldKpis, ...f.currentKpis, ...f.invalidKpis].map(item => item.id).sort());
    const stages = await this.member.from("model_run_stages").select("id,run_id,stage_name,status,attempt_managed,active_attempt_id").in("run_id", f.runIds);
    expect(stages.error).toBeNull();
    for (const kpi of f.currentKpis) {
      const producer = f.producers.get(kpi.id); expect(producer).toBeDefined();
      expect(stages.data).toContainEqual({ id: producer!.stageId, run_id: kpi.run_id, stage_name: producer!.stageName,
        status: "succeeded", attempt_managed: true, active_attempt_id: kpi.attempt_id });
    }
    const instruments = await this.member.from("model_attempt_instrument_custody").select("id,model_run_id,attempt_id,model_output_artifact_id,scientific_outcome").in("id", f.instrumentIds);
    expect(instruments.error).toBeNull(); expect(instruments.data).toHaveLength(4);
    expect(instruments.data?.every(item => item.scientific_outcome === "inconclusive" && f.outputIds.includes(item.model_output_artifact_id))).toBe(true);
    const target = f.runIds[0];
    const named = all.filter(item => item.kind === "kpi" && item.record.run_id === target && item.record.kpi_name === "total_trips");
    if (f.variant === "missing") expect(named).toEqual([]);
    if (f.variant === "revoked-only") { expect(named).toHaveLength(1); expect(named[0].ownership_state).toBe("retained_inactive"); }
    if (f.variant === "ambiguous-current") expect(named.filter(item => item.ownership_state === "current_completed")).toHaveLength(2);
    if (f.variant === "wrong-producer") { expect(f.invalidKpis).toHaveLength(1); expect(f.invalidKpis[0].kpi_name).toBe("daily_vmt"); }
  }


  /** Temporarily remove one registered output from this factory's owned run.
   * Keep all native rows and restore the exact file before returning or throwing. */
  async withQuarantinedOutput<T>(f: Fixture, operation: (file: {
    artifact: Artifact; originalPath: string; quarantinePath: string;
  }) => Promise<T>): Promise<T> {
    const artifact = exactlyOne(f.currentArtifacts.filter(item => item.id === f.outputIds[0]), "owned current output");
    expect(f.runIds).toContain(artifact.run_id);
    expect(artifact.file_url.startsWith("local://")).toBe(true);
    const registered = await this.member.from("model_run_artifacts").select("*")
      .eq("id", artifact.id).eq("run_id", artifact.run_id).single();
    expect(registered.error).toBeNull(); expect(registered.data).toMatchObject(artifact);
    const originalPath = artifact.file_url.slice("local://".length);
    const directory = path.join(this.workerRoot, "runs", uuid.parse(artifact.run_id), "attempts", uuid.parse(artifact.attempt_id));
    expect(path.dirname(originalPath)).toBe(directory);
    expect(realpathSync(directory)).toBe(directory);
    expect(realpathSync(originalPath)).toBe(originalPath);
    const originalStat = lstatSync(originalPath);
    expect(originalStat.isFile()).toBe(true); expect(originalStat.isSymbolicLink()).toBe(false);
    expect(originalStat.nlink).toBe(1);
    const mode = originalStat.mode & 0o7777;
    expect(mode).toBe(0o600);
    const bytes = readFileSync(originalPath);
    expect(bytes.byteLength).toBe(Number(artifact.file_size_bytes)); expect(hashBytes(bytes)).toBe(artifact.content_hash);
    const quarantineDirectory = mkdtempSync(path.join(directory, "quarantine-r82-"));
    expect(realpathSync(quarantineDirectory)).toBe(quarantineDirectory);
    const quarantinePath = path.join(quarantineDirectory, path.basename(originalPath));
    this.record("quarantine_intent", { artifactId: artifact.id, runId: artifact.run_id, originalPath, quarantinePath,
      sha256: hashBytes(bytes), bytes: bytes.byteLength, mode });
    let moved = false;
    try {
      renameSync(originalPath, quarantinePath); moved = true;
      expect(realpathSync(quarantinePath)).toBe(quarantinePath);
      return await operation({ artifact, originalPath, quarantinePath });
    } finally {
      if (moved) {
        renameSync(quarantinePath, originalPath);
        chmodSync(originalPath, mode);
        expect(realpathSync(originalPath)).toBe(originalPath);
        const restored = lstatSync(originalPath);
        expect(restored.isFile()).toBe(true); expect(restored.isSymbolicLink()).toBe(false);
        expect(restored.mode & 0o7777).toBe(mode); expect(restored.nlink).toBe(originalStat.nlink);
        expect(readFileSync(originalPath)).toEqual(bytes);
        this.record("quarantine_restored", { artifactId: artifact.id, originalPath, quarantinePath,
          sha256: hashBytes(readFileSync(originalPath)), bytes: restored.size, mode });
      }
    }
  }

  async close() { await this.member.auth.signOut(); /* Retain all immutable synthetic rows, files and stack. No DELETE or rm. */ }
}
