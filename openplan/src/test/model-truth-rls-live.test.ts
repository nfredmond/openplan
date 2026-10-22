import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { sortedCompactJson } from "@/lib/models/demand-agreement-artifact";
import { populationFixture } from "./fixtures/common-population-evidence";
import { LIVE_RLS, getLocalSupabaseEnv, liveClient } from "./local-supabase-env";
import { resolveLocalDbContainer } from "./helpers/live-catalog";

const liveDescribe = LIVE_RLS ? describe : describe.skip;
const digest = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

liveDescribe("guided model truth live RLS and trigger enforcement", () => {
  let container = "";
  let service: SupabaseClient;
  let member: SupabaseClient;
  let viewer: SupabaseClient;
  let outsider: SupabaseClient;
  let workspaceA = "";
  let workspaceB = "";
  let projectId = "";
  let snapshotId = "";
  let deltaId = "";
  let memberId = "";
  let viewerId = "";
  let outsiderId = "";
  const userIds: string[] = [];
  const runIds: string[] = [];
  const artifactIds: string[] = [];
  const password = "ModelTruthLive!2026";
  let suffix = "";

  // Read committed rows independently of the client that attempts the write.
  // Full descriptor rows include byte hashes, sizes, paths and metadata. They do
  // not establish that the synthetic local files exist or contain those bytes.
  function persistedWorkspace(workspaceId: string) {
    expect(workspaceId).toMatch(/^[a-f0-9-]{36}$/);
    const bytes = execFileSync("docker", ["exec", "-i", container, "psql", "-X", "-U", "postgres", "-d", "postgres", "-qAt", "-v", "ON_ERROR_STOP=1"], {
      input: `BEGIN READ ONLY; SET LOCAL statement_timeout='10s';
        WITH runs AS (SELECT * FROM public.model_runs WHERE workspace_id='${workspaceId}'),
        snapshots AS (SELECT snapshot.* FROM public.scenario_comparison_snapshots snapshot
          JOIN public.scenario_sets scenario ON scenario.id=snapshot.scenario_set_id WHERE scenario.workspace_id='${workspaceId}')
        SELECT jsonb_build_object(
          'workspaces',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id),'[]') FROM public.workspaces t WHERE t.id='${workspaceId}'),
          'members',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.user_id),'[]') FROM public.workspace_members t WHERE t.workspace_id='${workspaceId}'),
          'models',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id),'[]') FROM public.models t WHERE t.workspace_id='${workspaceId}'),
          'runs',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id),'[]') FROM runs t),
          'enrollment',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.run_id),'[]') FROM public.model_execution_custody_enrollment t WHERE t.run_id IN (SELECT id FROM runs)),
          'stages',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id),'[]') FROM public.model_run_stages t WHERE t.run_id IN (SELECT id FROM runs)),
          'attempts',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id),'[]') FROM public.model_stage_attempts t WHERE t.run_id IN (SELECT id FROM runs)),
          'artifacts',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id),'[]') FROM public.model_run_artifacts t WHERE t.run_id IN (SELECT id FROM runs)),
          'snapshots',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id),'[]') FROM snapshots t),
          'deltas',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id),'[]') FROM public.scenario_comparison_indicator_deltas t WHERE t.comparison_snapshot_id IN (SELECT id FROM snapshots)),
          'links',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id),'[]') FROM public.scenario_comparison_model_run_links t WHERE t.comparison_snapshot_id IN (SELECT id FROM snapshots)));
        COMMIT;`,
      encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 15_000,
    }).trim();
    const rows = JSON.parse(bytes) as Record<"workspaces" | "members" | "models" | "runs" | "enrollment" | "stages" | "attempts" | "artifacts" | "snapshots" | "deltas" | "links", Record<string, unknown>[]>;
    return { bytes, rows };
  }

  function guidedPersistedState() {
    const state = persistedWorkspace(workspaceA);
    expect(state.rows.workspaces.map((row) => row.id)).toEqual([workspaceA]);
    expect(state.rows.runs.map((row) => row.id).sort()).toEqual([...runIds].sort());
    expect(state.rows.runs.every((row) => row.workspace_id === workspaceA && row.attempt_managed === true && row.status === "succeeded")).toBe(true);
    expect(state.rows.enrollment.map((row) => row.run_id).sort()).toEqual([...runIds].sort());
    expect(state.rows.enrollment.every((row) => row.provenance === "new_run")).toBe(true);
    expect(state.rows.artifacts).toHaveLength(11);
    expect(state.rows.artifacts.filter((row) => artifactIds.includes(String(row.id))).map((row) => row.id).sort()).toEqual([...artifactIds].sort());
    expect(state.rows.links).toHaveLength(4);
    expect(state.rows.links.map((row) => row.model_run_id).sort()).toEqual([...runIds].sort());
    expect(state.rows.links.map((row) => row.model_run_artifact_id).sort()).toEqual([...artifactIds].sort());
    expect(state.rows.snapshots).toHaveLength(1);
    expect(state.rows.snapshots[0]).toMatchObject({ id: snapshotId, status: "ready", label: "Exact live comparison" });
    expect(state.rows.deltas).toHaveLength(1);
    expect(state.rows.deltas[0]).toMatchObject({ id: deltaId, delta_json: { percent: -8 } });
    return state;
  }

  beforeAll(async () => {
    const env = getLocalSupabaseEnv();
    container = resolveLocalDbContainer();
    service = liveClient(env.API_URL, env.SERVICE_ROLE_KEY, "model-truth-service");
    member = liveClient(env.API_URL, env.ANON_KEY, "model-truth-member");
    viewer = liveClient(env.API_URL, env.ANON_KEY, "model-truth-viewer");
    outsider = liveClient(env.API_URL, env.ANON_KEY, "model-truth-outsider");
    suffix = randomUUID().replace(/-/g, "").slice(0, 10);
    const users = await Promise.all(["member", "viewer", "outsider"].map((role) =>
      service.auth.admin.createUser({
        email: `model-truth-${role}-${suffix}@example.test`,
        password,
        email_confirm: true,
      }),
    ));
    for (const result of users) {
      if (result.error || !result.data.user) throw new Error(result.error?.message ?? "user creation failed");
      userIds.push(result.data.user.id);
    }
    [memberId, viewerId, outsiderId] = userIds;
    workspaceA = randomUUID();
    workspaceB = randomUUID();
    projectId = randomUUID();
    snapshotId = randomUUID();
    deltaId = randomUUID();

    const workspaces = await service.from("workspaces").insert([
      { id: workspaceA, name: `Model truth A ${suffix}`, slug: `model-truth-a-${suffix}` },
      { id: workspaceB, name: `Model truth B ${suffix}`, slug: `model-truth-b-${suffix}` },
    ]);
    if (workspaces.error) throw new Error(workspaces.error.message);
    const memberships = await service.from("workspace_members").insert([
      { workspace_id: workspaceA, user_id: memberId, role: "member" },
      { workspace_id: workspaceA, user_id: viewerId, role: "viewer" },
      { workspace_id: workspaceB, user_id: outsiderId, role: "owner" },
    ]);
    if (memberships.error) throw new Error(memberships.error.message);
    const project = await service.from("projects").insert({
      id: projectId,
      workspace_id: workspaceA,
      name: "Exact model truth project",
      created_by: memberId,
    });
    if (project.error) throw new Error(project.error.message);
    const scenarioSetId = randomUUID();
    const baselineId = randomUUID();
    const buildId = randomUUID();
    const scenarioSet = await service.from("scenario_sets").insert({
      id: scenarioSetId,
      workspace_id: workspaceA,
      project_id: projectId,
      title: "Exact baseline and build",
      created_by: memberId,
    });
    if (scenarioSet.error) throw new Error(scenarioSet.error.message);
    const buildAssumptions = {
      guidedProjectChange: {
        kind: "assigned_auto_trip_change_pct",
        autoTripChangePct: -8,
        basis: "Live RLS fixture",
      },
    };
    const entries = await service.from("scenario_entries").insert([
      { id: baselineId, scenario_set_id: scenarioSetId, entry_type: "baseline", label: "Baseline", slug: `baseline-${suffix}`, assumptions_json: {}, sort_order: 0, created_by: memberId },
      { id: buildId, scenario_set_id: scenarioSetId, entry_type: "alternative", label: "Build", slug: `build-${suffix}`, assumptions_json: buildAssumptions, sort_order: 1, created_by: memberId },
    ]);
    if (entries.error) throw new Error(entries.error.message);
    const baseline = await service.from("scenario_sets").update({ baseline_entry_id: baselineId }).eq("id", scenarioSetId);
    if (baseline.error) throw new Error(baseline.error.message);

    const networkBasis = {
      kind: "worker_osm_snapshot",
      source: "OpenStreetMap",
      identity: "network_state_digest",
      comparisonRule: "exact_digest_match",
    };
    const aeqModelId = randomUUID();
    const asimModelId = randomUUID();
    const models = await service.from("models").insert([
      { id: aeqModelId, workspace_id: workspaceA, project_id: projectId, scenario_set_id: scenarioSetId, title: "Exact AequilibraE", model_family: "travel_demand", config_json: { guidedProjectComparison: "openplan.project_comparison.v1", method: "aequilibrae", networkBasis }, created_by: memberId },
      { id: asimModelId, workspace_id: workspaceA, project_id: projectId, scenario_set_id: scenarioSetId, title: "Exact ActivitySim", model_family: "activity_based_model", config_json: { guidedProjectComparison: "openplan.project_comparison.v1", method: "activitysim", networkBasis }, created_by: memberId },
    ]);
    if (models.error) throw new Error(models.error.message);

    const jobs = [
      { method: "aequilibrae", role: "baseline", modelId: aeqModelId, entryId: baselineId, engine: "aequilibrae", assumptions: {} },
      { method: "aequilibrae", role: "build", modelId: aeqModelId, entryId: buildId, engine: "aequilibrae", assumptions: buildAssumptions },
      { method: "activitysim", role: "baseline", modelId: asimModelId, entryId: baselineId, engine: "behavioral_demand", assumptions: {} },
      { method: "activitysim", role: "build", modelId: asimModelId, entryId: buildId, engine: "behavioral_demand", assumptions: buildAssumptions },
    ] as const;
    const profilePayload = '{"engine":"aequilibrae"}';
    const settingsPayload = '{"capacity":"shared"}';
    const profileHash = digest(profilePayload);
    const settingsHash = digest(settingsPayload);
    const stateRecord = { network_settings_digest: settingsHash, osm_snapshot: "live-shared" };
    const stateHash = digest(sortedCompactJson(stateRecord));
    const metadata = {
      assignment_profile: JSON.parse(profilePayload),
      assignment_profile_payload_json: profilePayload,
      assignment_profile_digest: profileHash,
      network_settings: JSON.parse(settingsPayload),
      network_settings_payload_json: settingsPayload,
      network_settings_digest: settingsHash,
      network_state_record: stateRecord,
      network_state_digest: stateHash,
    };

    // Match the maintained native population fixture with synthetic descriptors.
    // These rows establish relationships, not file availability or scientific validity.
    const population = populationFixture();
    const sourceStageId = randomUUID();
    const sourceArtifactId = randomUUID();
    let source = { ...population.source, modelRunId: "", artifactId: sourceArtifactId, stageId: sourceStageId, attemptId: "" };
    const geometry = { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] };
    const finishStage = async (attemptId: string) => {
      const result = await service.rpc("write_model_stage_attempt", {
        p_request_id: randomUUID(), p_attempt_id: attemptId, p_status: "succeeded",
        p_log_tail: "Synthetic fixture descriptors only", p_error: null,
      });
      if (result.error) throw new Error(result.error.message);
    };
    const claimStage = async (stageId: string): Promise<string> => {
      const result = await service.rpc("claim_model_stage_attempt", {
        p_request_id: randomUUID(), p_stage_id: stageId, p_worker_id: "model-truth-synthetic-fixture",
      });
      if (result.error) throw new Error(result.error.message);
      if (result.data?.outcome !== "claimed" || !result.data.attempt_id) throw new Error("Synthetic stage was not claimed");
      return result.data.attempt_id;
    };

    for (const [index, job] of jobs.entries()) {
      const runId = randomUUID();
      const stageId = randomUUID();
      const artifactId = randomUUID();
      runIds.push(runId);
      artifactIds.push(artifactId);
      const run = await service.from("model_runs").insert({
        id: runId,
        workspace_id: workspaceA,
        project_id: projectId,
        model_id: job.modelId,
        scenario_set_id: scenarioSetId,
        scenario_entry_id: job.entryId,
        engine_key: job.engine,
        launch_source: "scenario_entry",
        status: "queued",
        corridor_geojson: geometry,
        input_snapshot_json: { zoneGeography: "tract", commonPopulation: index === 0 ? population.generate : { ...population.reuse, source } },
        run_title: `Exact ${job.method} ${job.role}`,
        assumption_snapshot_json: job.assumptions,
        created_by: memberId,
      });
      if (run.error) throw new Error(run.error.message);
      // Supply the existing fixture decisions before the first managed claim,
      // as the maintained native population fixture does. No ingestion is forged.
      const decision = await service.from("modeling_claim_decisions").insert({
        workspace_id: workspaceA, model_run_id: runId,
        track: job.method === "aequilibrae" ? "assignment" : "behavioral_demand",
        claim_status: index === 3 ? "prototype_only" : "screening_grade",
        status_reason: index === 3 ? "Recorded, but evidence remains prototype-only." : "Live fixture screening decision.",
      });
      if (decision.error) throw new Error(decision.error.message);
      const stage = await service.from("model_run_stages").insert([
        ...(index === 0 ? [{ id: sourceStageId, run_id: runId, stage_name: "AequilibraE Setup", status: "queued", sort_order: 0 }] : []),
        { id: stageId, run_id: runId, stage_name: job.method === "aequilibrae" ? "Artifact Extraction" : "ActivitySim Network Assignment", status: "queued", sort_order: 1 },
      ]);
      if (stage.error) throw new Error(stage.error.message);
      if (index === 0) {
        const sourceAttemptId = await claimStage(sourceStageId);
        source = { ...source, modelRunId: runId, attemptId: sourceAttemptId };
        const descriptors = [
          { kind: "common_population", ...population.basis.manifest, id: sourceArtifactId },
          { kind: "common_population_households", path: "households.csv", sha256: "d".repeat(64), bytes: 19 },
          { kind: "common_population_persons", path: "persons.csv", sha256: "e".repeat(64), bytes: 23 },
          { kind: "common_population_selected_zones", ...population.basis.selected_zone_map },
          { kind: "common_population_diagnostics", path: "diagnostics.json", sha256: "f".repeat(64), bytes: 29 },
          { kind: "common_population_source_manifest", ...population.basis.source_manifest },
          { kind: "common_population_source_zone_attributes", path: "source_zone_attributes.csv", sha256: "0".repeat(64), bytes: 31 },
        ];
        for (const descriptor of descriptors) {
          const artifact = await service.rpc("write_model_attempt_artifact", {
            p_request_id: randomUUID(), p_attempt_id: sourceAttemptId,
            p_payload: { id: "id" in descriptor ? descriptor.id : randomUUID(), artifact_type: descriptor.kind,
              file_url: `local://synthetic/${runId}/${descriptor.path}`, file_size_bytes: descriptor.bytes,
              content_hash: descriptor.sha256, metadata_json: population.sourceMetadata },
          });
          if (artifact.error) throw new Error(artifact.error.message);
        }
        await finishStage(sourceAttemptId);
      }
      const attemptId = await claimStage(stageId);
      const artifact = await service.rpc("write_model_attempt_artifact", {
        p_request_id: randomUUID(), p_attempt_id: attemptId,
        p_payload: { id: artifactId,
          artifact_type: job.method === "aequilibrae" ? "link_volumes" : "activitysim_link_volumes",
          file_url: `local://synthetic/${runId}/output.csv`, file_size_bytes: 100,
          content_hash: `${index + 1}`.repeat(64), metadata_json: { ...metadata, ...population.metadata } },
      });
      if (artifact.error) throw new Error(artifact.error.message);
      await finishStage(attemptId);
    }


    const snapshot = await service.from("scenario_comparison_snapshots").insert({
      id: snapshotId,
      scenario_set_id: scenarioSetId,
      baseline_entry_id: baselineId,
      candidate_entry_id: buildId,
      label: "Exact live comparison",
      metadata_json: { commonPopulation: { ...population.snapshot, sourceRunId: source.modelRunId, source } },
      status: "draft",
      created_by: memberId,
    });
    if (snapshot.error) throw new Error(snapshot.error.message);
    const delta = await service.from("scenario_comparison_indicator_deltas").insert({
      id: deltaId,
      comparison_snapshot_id: snapshotId,
      indicator_key: "vmt",
      indicator_label: "Vehicle miles traveled",
      delta_json: { percent: -8 },
    });
    if (delta.error) throw new Error(delta.error.message);

    await member.auth.signInWithPassword({ email: `model-truth-member-${suffix}@example.test`, password });
    await viewer.auth.signInWithPassword({ email: `model-truth-viewer-${suffix}@example.test`, password });
    await outsider.auth.signInWithPassword({ email: `model-truth-outsider-${suffix}@example.test`, password });

    const wrongArtifact = await member.from("scenario_comparison_model_run_links").insert({
      workspace_id: workspaceA,
      comparison_snapshot_id: snapshotId,
      model_run_id: runIds[0],
      model_run_artifact_id: artifactIds[1],
      method: "aequilibrae",
      scenario_role: "baseline",
      artifact_type: "link_volumes",
      artifact_sha256: "1".repeat(64),
      assignment_profile_sha256: profileHash,
      network_settings_sha256: settingsHash,
      network_state_sha256: stateHash,
      scenario_assumptions_json: {},
      created_by: memberId,
    });
    if (!wrongArtifact.error) throw new Error("wrong artifact identity unexpectedly inserted");

    const links = await member.from("scenario_comparison_model_run_links").insert(jobs.map((job, index) => ({
      workspace_id: workspaceA,
      comparison_snapshot_id: snapshotId,
      model_run_id: runIds[index],
      model_run_artifact_id: artifactIds[index],
      method: job.method,
      scenario_role: job.role,
      artifact_type: job.method === "aequilibrae" ? "link_volumes" : "activitysim_link_volumes",
      artifact_sha256: `${index + 1}`.repeat(64),
      assignment_profile_sha256: profileHash,
      network_settings_sha256: settingsHash,
      network_state_sha256: stateHash,
      scenario_assumptions_json: job.assumptions,
      created_by: memberId,
    })));
    if (links.error) throw new Error(links.error.message);
    const ready = await member.from("scenario_comparison_snapshots").update({ status: "ready" }).eq("id", snapshotId);
    if (ready.error) throw new Error(ready.error.message);
  }, 60_000);

  afterAll(async () => {
    await member?.auth.signOut();
    await viewer?.auth.signOut();
    await outsider?.auth.signOut();
    // Enrollment intentionally prevents deleting these synthetic runs or their
    // workspace. Keep the fixture until the isolated test stack is discarded.
    // Do not disable retention triggers or delete custody records for cleanup.
  }, 60_000);

  it("lets the member read the four exact links while the outsider reads none", async () => {
    const own = await member.from("scenario_comparison_model_run_links").select("id").eq("comparison_snapshot_id", snapshotId);
    expect(own.error).toBeNull();
    expect(own.data).toHaveLength(4);
    const hidden = await outsider.from("scenario_comparison_model_run_links").select("id").eq("comparison_snapshot_id", snapshotId);
    expect(hidden.error).toBeNull();
    expect(hidden.data).toEqual([]);
  });

  it("denies viewer and outsider link writes", async () => {
    for (const client of [viewer, outsider]) {
      const attempt = await client.from("scenario_comparison_model_run_links").insert({
        workspace_id: workspaceA,
        comparison_snapshot_id: snapshotId,
        model_run_id: runIds[0],
        model_run_artifact_id: artifactIds[0],
        method: "aequilibrae",
        scenario_role: "baseline",
        artifact_type: "link_volumes",
        artifact_sha256: "1".repeat(64),
        assignment_profile_sha256: "a".repeat(64),
        network_settings_sha256: "b".repeat(64),
        network_state_sha256: "c".repeat(64),
        scenario_assumptions_json: {},
        created_by: client === viewer ? viewerId : outsiderId,
      });
      expect(attempt.error).not.toBeNull();
    }
  });

  it("refuses semantic, delta, and managed artifact mutation after custody is attached", async () => {
    const before = guidedPersistedState();
    const snapshot = await member.from("scenario_comparison_snapshots").update({ label: "Rewritten meaning" }).eq("id", snapshotId);
    expect(snapshot.error).toMatchObject({ code: "P0001", message: "evidence-bound comparison snapshot semantics are immutable" });
    expect(persistedWorkspace(workspaceA).bytes, "snapshot refusal preserves all committed evidence").toBe(before.bytes);
    const delta = await member.from("scenario_comparison_indicator_deltas").update({ delta_json: { percent: 99 } }).eq("id", deltaId);
    expect(delta.error).toMatchObject({ code: "P0001", message: "evidence-bound comparison indicator deltas are immutable" });
    expect(persistedWorkspace(workspaceA).bytes, "delta refusal preserves all committed evidence").toBe(before.bytes);
    const artifact = await member.from("model_run_artifacts").update({ content_hash: "f".repeat(64) }).eq("id", artifactIds[0]);
    expect(artifact.error).toMatchObject({ code: "P0001", message: "Attempt artifact records are immutable" });
    expect(persistedWorkspace(workspaceA).bytes, "managed artifact refusal preserves descriptor bytes and links").toBe(before.bytes);
  });

  it("preserves managed comparison artifacts, links, enrolled runs, and workspace after deletion refusal", async () => {
    const before = guidedPersistedState();
    const removed = await service.from("workspaces").delete().eq("id", workspaceA);
    expect(removed.error).toMatchObject({ code: "P0001", message: "Managed model run deletion requires an explicit retention command" });
    expect(persistedWorkspace(workspaceA).bytes, "managed deletion refusal preserves all committed evidence").toBe(before.bytes);
    const retained = await service.from("model_runs").select("id,workspace_id").in("id", runIds);
    expect(retained.error).toBeNull();
    expect(retained.data?.map((row) => row.id).sort()).toEqual([...runIds].sort());
    expect(retained.data?.every((row) => row.workspace_id === workspaceA)).toBe(true);
    const workspace = await service.from("workspaces").select("id").eq("id", workspaceA).single();
    expect(workspace.error).toBeNull();
    expect(workspace.data?.id).toBe(workspaceA);
  });

  it("preserves an automatically enrolled unclaimed run through the original enrollment FK", async () => {
    const workspaceId = randomUUID();
    const modelId = randomUUID();
    const runId = randomUUID();
    const workspace = await service.from("workspaces").insert({ id: workspaceId, name: `Model truth enrollment FK ${suffix}`, slug: `model-truth-enrollment-fk-${suffix}` });
    expect(workspace.error).toBeNull();
    const membership = await service.from("workspace_members").insert({ workspace_id: workspaceId, user_id: memberId, role: "owner" });
    expect(membership.error).toBeNull();
    const model = await service.from("models").insert({ id: modelId, workspace_id: workspaceId, title: "Unclaimed enrollment FK fixture", model_family: "travel_demand", created_by: memberId });
    expect(model.error).toBeNull();
    // Omit management flags and create no stages, claims, outputs or receipts.
    // The installed AFTER INSERT trigger supplies enrollment without a bypass.
    const run = await service.from("model_runs").insert({ id: runId, workspace_id: workspaceId, model_id: modelId, engine_key: "aequilibrae", run_title: "Unclaimed enrollment FK fixture", created_by: memberId });
    expect(run.error).toBeNull();
    const before = persistedWorkspace(workspaceId);
    expect(before.rows.workspaces.map((row) => row.id)).toEqual([workspaceId]);
    expect(before.rows.models.map((row) => row.id)).toEqual([modelId]);
    expect(before.rows.members).toHaveLength(1);
    expect(before.rows.runs).toHaveLength(1);
    expect(before.rows.runs[0]).toMatchObject({ id: runId, workspace_id: workspaceId, attempt_managed: false, status: "queued" });
    expect(before.rows.enrollment).toHaveLength(1);
    expect(before.rows.enrollment[0]).toMatchObject({ run_id: runId, provenance: "new_run" });
    for (const key of ["stages", "attempts", "artifacts", "snapshots", "deltas", "links"] as const) expect(before.rows[key]).toEqual([]);
    const removed = await service.from("workspaces").delete().eq("id", workspaceId);
    expect(removed.error).toMatchObject({
      code: "23503",
      message: 'update or delete on table "model_runs" violates foreign key constraint "model_execution_custody_enrollment_run_id_fkey" on table "model_execution_custody_enrollment"',
      details: `Key (id)=(${runId}) is still referenced from table "model_execution_custody_enrollment".`,
    });
    expect(persistedWorkspace(workspaceId).bytes, "enrollment FK refusal retains the workspace, model, member, run and enrollment").toBe(before.bytes);
  });
});
