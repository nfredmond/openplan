import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

import { LIVE_RLS, getLocalSupabaseEnv, liveClient } from "./local-supabase-env";

const liveDescribe = LIVE_RLS ? describe : describe.skip;

liveDescribe("distributed work loading custody live RLS", () => {
  let service: SupabaseClient;
  let member: SupabaseClient;
  let outsider: SupabaseClient;
  let workspaceA = "";
  let workspaceB = "";
  let runA = "";
  let runB = "";
  let custodyId = "";
  let inputArtifactId = "";
  const inputHash = "a".repeat(64);
  const auditHash = "b".repeat(64);
  const comparisonHash = "c".repeat(64);
  const sourceHash = "d".repeat(64);
  const networkHash = "e".repeat(64);
  const password = "DistributedWorkLive!2026";
  const sourceStates = Object.fromEntries([
    "covered", "explicit_zero", "suppressed", "unavailable_source", "unmapped", "unroutable", "inconclusive_missing_pair",
  ].map((state) => [state, { records: 0, source_weight: 0, modeled_work_demand: 0 }]));
  const loadingInputMetadata = {
    schema: "openplan.distributed-work-loading-input.v1", method: "aequilibrae", method_aggregation: "separate",
    non_work_treatment: "unchanged_not_supported_by_lodes", arbitrary_point_cap: null, arbitrary_gateway_cap: null,
    source_states: sourceStates, retained_work_demand: [{ demand: 3 }],
    demand_accounting: { original_total: 20, candidate_total: 20, original_work_total: 8, work_loaded_at_access_points: 5, work_retained_at_original_centroids: 3 },
  };
  const auditMetadata = {
    schema: "openplan.pre-output-audit.v1", method: "aequilibrae", frozen_before_assignment_output: true,
    assignment_output_bytes_read: false, holdout_accessed: false, methods_averaged: false, defaults_changed: false,
    candidate_promoted: false, bindings: { source_od: { sha256: sourceHash }, candidate_network: { sha256: networkHash } },
  };
  const comparisonMetadata = {
    schema: "openplan.development-comparison.v1", method: "aequilibrae", scientific_outcome: "inconclusive",
    method_aggregation: "separate", defaults_changed: false, holdout_accessed: false,
    bindings: { pre_output_audit_sha256: auditHash }, county_stratum: { geography_id: "fixture", worsened: false },
    development_gate: { advanced: false, demand_conserved: true, observed_link_reach_improved: false, no_county_stratum_worsened: true, no_road_class_worsened: true, same_source_network_custody: true },
  };

  function rpcArguments(modelRunId: string, audit: Record<string, unknown> = auditMetadata) {
    return {
      p_workspace_id: workspaceA, p_model_run_id: modelRunId, p_stage_id: null,
      p_loading_input_file_url: `storage://run-artifacts/model-runs/${modelRunId}/loading-input.json`, p_loading_input_size: 100, p_loading_input_sha256: inputHash,
      p_loading_input_metadata: loadingInputMetadata,
      p_pre_output_audit_file_url: `storage://run-artifacts/model-runs/${modelRunId}/pre-output-audit.json`, p_pre_output_audit_size: 100, p_pre_output_audit_sha256: auditHash,
      p_pre_output_audit_metadata: audit,
      p_development_comparison_file_url: `storage://run-artifacts/model-runs/${modelRunId}/development-comparison.json`, p_development_comparison_size: 100, p_development_comparison_sha256: comparisonHash,
      p_development_comparison_metadata: comparisonMetadata,
      p_source_custody_sha256: sourceHash, p_network_custody_sha256: networkHash,
      p_method: "aequilibrae", p_scientific_outcome: "inconclusive", p_defaults_changed: false, p_holdout_accessed: false,
    };
  }

  beforeAll(async () => {
    const env = getLocalSupabaseEnv();
    service = liveClient(env.API_URL, env.SERVICE_ROLE_KEY, "distributed-work-service");
    member = liveClient(env.API_URL, env.ANON_KEY, "distributed-work-member");
    outsider = liveClient(env.API_URL, env.ANON_KEY, "distributed-work-outsider");
    const suffix = randomUUID().replace(/-/g, "").slice(0, 10);
    const memberUser = await service.auth.admin.createUser({ email: `distributed-work-member-${suffix}@example.test`, password, email_confirm: true });
    const outsiderUser = await service.auth.admin.createUser({ email: `distributed-work-outsider-${suffix}@example.test`, password, email_confirm: true });
    if (!memberUser.data.user || !outsiderUser.data.user) throw new Error("live fixture users were not created");
    workspaceA = randomUUID(); workspaceB = randomUUID();
    const workspaces = await service.from("workspaces").insert([
      { id: workspaceA, name: `Distributed A ${suffix}`, slug: `distributed-a-${suffix}` },
      { id: workspaceB, name: `Distributed B ${suffix}`, slug: `distributed-b-${suffix}` },
    ]);
    if (workspaces.error) throw new Error(workspaces.error.message);
    const memberships = await service.from("workspace_members").insert([
      { workspace_id: workspaceA, user_id: memberUser.data.user.id, role: "member" },
      { workspace_id: workspaceB, user_id: outsiderUser.data.user.id, role: "owner" },
    ]);
    if (memberships.error) throw new Error(memberships.error.message);
    const modelA = randomUUID(); const modelB = randomUUID();
    const models = await service.from("models").insert([
      { id: modelA, workspace_id: workspaceA, title: "Distributed A", model_family: "travel_demand", created_by: memberUser.data.user.id },
      { id: modelB, workspace_id: workspaceB, title: "Distributed B", model_family: "travel_demand", created_by: outsiderUser.data.user.id },
    ]);
    if (models.error) throw new Error(models.error.message);
    runA = randomUUID(); runB = randomUUID();
    const runs = await service.from("model_runs").insert([
      { id: runA, workspace_id: workspaceA, model_id: modelA, engine_key: "aequilibrae", status: "succeeded", run_title: "Distributed A", created_by: memberUser.data.user.id },
      { id: runB, workspace_id: workspaceA, model_id: modelA, engine_key: "aequilibrae", status: "succeeded", run_title: "Distributed guard mutation", created_by: memberUser.data.user.id },
    ]);
    if (runs.error) throw new Error(runs.error.message);
    const custody = await service.rpc("record_modeling_distributed_work_loading", rpcArguments(runA));
    if (custody.error) throw new Error(custody.error.message);
    custodyId = String((custody.data as Record<string, unknown>).id);
    inputArtifactId = String((custody.data as Record<string, unknown>).loading_input_artifact_id);
    await member.auth.signInWithPassword({ email: `distributed-work-member-${suffix}@example.test`, password });
    await outsider.auth.signInWithPassword({ email: `distributed-work-outsider-${suffix}@example.test`, password });
  });

  it("isolates reads and refuses member writes", async () => {
    const visible = await member.from("modeling_distributed_work_loading_custody").select("method,scientific_outcome").eq("id", custodyId).single();
    expect(visible.error).toBeNull();
    expect(visible.data).toEqual({ method: "aequilibrae", scientific_outcome: "inconclusive" });
    const hidden = await outsider.from("modeling_distributed_work_loading_custody").select("id").eq("id", custodyId);
    expect(hidden.error).toBeNull(); expect(hidden.data).toEqual([]);
    const memberWrite = await member.from("modeling_distributed_work_loading_custody").update({ method: "activitysim" }).eq("id", custodyId);
    expect(memberWrite.error).not.toBeNull();
  });

  it("refuses altered custody, updates, deletes, and bound-artifact mutation", async () => {
    const rowResult = await service.from("modeling_distributed_work_loading_custody").select("*").eq("id", custodyId).single();
    const row = rowResult.data as Record<string, unknown>;
    const changed = await service.from("modeling_distributed_work_loading_custody").insert({ ...row, id: randomUUID(), development_comparison_sha256: "f".repeat(64) });
    expect(changed.error?.message).toContain("type, run, or hash");
    const crossWorkspace = await service.from("modeling_distributed_work_loading_custody").insert({ ...row, id: randomUUID(), workspace_id: workspaceB });
    expect(crossWorkspace.error?.message).toContain("does not belong to workspace");
    const update = await service.from("modeling_distributed_work_loading_custody").update({ defaults_changed: true }).eq("id", custodyId);
    expect(update.error?.message).toContain("append-only");
    const deletion = await service.from("modeling_distributed_work_loading_custody").delete().eq("id", custodyId);
    expect(deletion.error?.message).toContain("append-only");
    const artifactUpdate = await service.from("model_run_artifacts").update({ content_hash: "0".repeat(64) }).eq("id", inputArtifactId);
    expect(artifactUpdate.error?.message).toContain("immutable distributed work loading custody");
  });

  it("rolls back all three artifacts when a pre-output guard is weakened", async () => {
    const weakened = await service.rpc("record_modeling_distributed_work_loading", rpcArguments(runB, {
      ...auditMetadata, assignment_output_bytes_read: true,
    }));
    expect(weakened.error?.message).toContain("metadata does not match exact custody");
    const artifacts = await service.from("model_run_artifacts").select("id").eq("run_id", runB);
    expect(artifacts.error).toBeNull();
    expect(artifacts.data).toEqual([]);
  });
});
