import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { sortedCompactJson } from "@/lib/models/demand-agreement-artifact";
import { LIVE_RLS, getLocalSupabaseEnv, liveClient } from "./local-supabase-env";

const liveDescribe = LIVE_RLS ? describe : describe.skip;
const digest = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

liveDescribe("guided model truth live RLS and trigger enforcement", () => {
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

  beforeAll(async () => {
    const env = getLocalSupabaseEnv();
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
        status: "succeeded",
        run_title: `Exact ${job.method} ${job.role}`,
        assumption_snapshot_json: job.assumptions,
        created_by: memberId,
      });
      if (run.error) throw new Error(run.error.message);
      const stage = await service.from("model_run_stages").insert({
        id: stageId,
        run_id: runId,
        stage_name: job.method === "aequilibrae" ? "Artifact Extraction" : "ActivitySim Network Assignment",
        status: "succeeded",
        sort_order: index,
      });
      if (stage.error) throw new Error(stage.error.message);
      const artifact = await service.from("model_run_artifacts").insert({
        id: artifactId,
        run_id: runId,
        stage_id: stageId,
        artifact_type: job.method === "aequilibrae" ? "link_volumes" : "activitysim_link_volumes",
        file_url: `storage://run-artifacts/${runId}.csv`,
        file_size_bytes: 100,
        content_hash: `${index + 1}`.repeat(64),
        metadata_json: metadata,
      });
      if (artifact.error) throw new Error(artifact.error.message);
    }
    const decisions = await service.from("modeling_claim_decisions").insert(jobs.map((job, index) => ({
      workspace_id: workspaceA,
      model_run_id: runIds[index],
      track: job.method === "aequilibrae" ? "assignment" : "behavioral_demand",
      claim_status: index === 3 ? "prototype_only" : "screening_grade",
      status_reason: index === 3 ? "Recorded, but evidence remains prototype-only." : "Live fixture screening decision.",
    })));
    if (decisions.error) throw new Error(decisions.error.message);

    const snapshot = await service.from("scenario_comparison_snapshots").insert({
      id: snapshotId,
      scenario_set_id: scenarioSetId,
      baseline_entry_id: baselineId,
      candidate_entry_id: buildId,
      label: "Exact live comparison",
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
    if (service && workspaceA && workspaceB) {
      const removed = await service.from("workspaces").delete().in("id", [workspaceA, workspaceB]);
      if (removed.error) throw new Error(removed.error.message);
      for (const userId of userIds) {
        const memberships = await service.from("workspace_members").select("workspace_id").eq("user_id", userId);
        for (const row of (memberships.data ?? []) as Array<{ workspace_id: string }>) {
          const personal = await service.from("workspaces").delete().eq("id", row.workspace_id);
          if (personal.error) throw new Error(personal.error.message);
        }
        const deleted = await service.auth.admin.deleteUser(userId);
        if (deleted.error) throw new Error(deleted.error.message);
      }
    }
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

  it("refuses semantic, delta, and bound-artifact mutation after custody is attached", async () => {
    const snapshot = await member.from("scenario_comparison_snapshots").update({ label: "Rewritten meaning" }).eq("id", snapshotId);
    expect(snapshot.error?.message ?? "").toMatch(/semantics are immutable/i);
    const delta = await member.from("scenario_comparison_indicator_deltas").update({ delta_json: { percent: 99 } }).eq("id", deltaId);
    expect(delta.error?.message ?? "").toMatch(/indicator deltas are immutable/i);
    const artifact = await member.from("model_run_artifacts").update({ content_hash: "f".repeat(64) }).eq("id", artifactIds[0]);
    expect(artifact.error?.message ?? "").toMatch(/artifact is immutable/i);
  });
});
