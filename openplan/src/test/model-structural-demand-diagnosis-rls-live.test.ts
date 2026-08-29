import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

import { LIVE_RLS, getLocalSupabaseEnv, liveClient } from "./local-supabase-env";

const liveDescribe = LIVE_RLS ? describe : describe.skip;

liveDescribe("structural demand diagnosis custody live RLS", () => {
  let service: SupabaseClient;
  let member: SupabaseClient;
  let outsider: SupabaseClient;
  let workspaceA = "";
  let workspaceB = "";
  let runA = "";
  let custodyId = "";
  let auditArtifactId = "";
  const auditHash = "a".repeat(64);
  const diagnosisHash = "b".repeat(64);
  const password = "StructuralDemandLive!2026";

  beforeAll(async () => {
    const env = getLocalSupabaseEnv();
    service = liveClient(env.API_URL, env.SERVICE_ROLE_KEY, "structural-demand-service");
    member = liveClient(env.API_URL, env.ANON_KEY, "structural-demand-member");
    outsider = liveClient(env.API_URL, env.ANON_KEY, "structural-demand-outsider");
    const suffix = randomUUID().replace(/-/g, "").slice(0, 10);
    const memberEmail = `structural-demand-member-${suffix}@example.test`;
    const outsiderEmail = `structural-demand-outsider-${suffix}@example.test`;
    const memberUser = await service.auth.admin.createUser({ email: memberEmail, password, email_confirm: true });
    const outsiderUser = await service.auth.admin.createUser({ email: outsiderEmail, password, email_confirm: true });
    if (!memberUser.data.user || !outsiderUser.data.user) throw new Error("live fixture users were not created");
    workspaceA = randomUUID();
    workspaceB = randomUUID();
    const workspaces = await service.from("workspaces").insert([
      { id: workspaceA, name: `Structural A ${suffix}`, slug: `structural-a-${suffix}` },
      { id: workspaceB, name: `Structural B ${suffix}`, slug: `structural-b-${suffix}` },
    ]);
    if (workspaces.error) throw new Error(workspaces.error.message);
    const memberships = await service.from("workspace_members").insert([
      { workspace_id: workspaceA, user_id: memberUser.data.user.id, role: "member" },
      { workspace_id: workspaceB, user_id: outsiderUser.data.user.id, role: "owner" },
    ]);
    if (memberships.error) throw new Error(memberships.error.message);
    const modelA = randomUUID();
    const modelB = randomUUID();
    const models = await service.from("models").insert([
      { id: modelA, workspace_id: workspaceA, title: "Structural A", model_family: "travel_demand", created_by: memberUser.data.user.id },
      { id: modelB, workspace_id: workspaceB, title: "Structural B", model_family: "travel_demand", created_by: outsiderUser.data.user.id },
    ]);
    if (models.error) throw new Error(models.error.message);
    runA = randomUUID();
    const runs = await service.from("model_runs").insert({ id: runA, workspace_id: workspaceA, model_id: modelA, engine_key: "aequilibrae", status: "succeeded", run_title: "Structural A", created_by: memberUser.data.user.id });
    if (runs.error) throw new Error(runs.error.message);
    const custody = await service.rpc("record_modeling_structural_demand_diagnosis", {
      p_workspace_id: workspaceA,
      p_model_run_id: runA,
      p_stage_id: null,
      p_input_audit_file_url: `storage://run-artifacts/model-runs/${runA}/input-audit.json`,
      p_input_audit_size: 100,
      p_input_audit_sha256: auditHash,
      p_input_audit_metadata: { schema: "openplan.model-structural-input-audit.v1", method: "aequilibrae" },
      p_diagnosis_file_url: `storage://run-artifacts/model-runs/${runA}/diagnosis-v3.json`,
      p_diagnosis_size: 100,
      p_diagnosis_sha256: diagnosisHash,
      p_diagnosis_metadata: { schema: "openplan.model-validation-structural-diagnosis.v3", method: "aequilibrae", input_audit_sha256: auditHash, scientific_outcome: "inconclusive" },
      p_method: "aequilibrae",
      p_scientific_outcome: "inconclusive",
    });
    if (custody.error) throw new Error(custody.error.message);
    custodyId = String((custody.data as Record<string, unknown>).id);
    auditArtifactId = String((custody.data as Record<string, unknown>).input_audit_artifact_id);
    await member.auth.signInWithPassword({ email: memberEmail, password });
    await outsider.auth.signInWithPassword({ email: outsiderEmail, password });
  });

  it("isolates reads and refuses member writes", async () => {
    const visible = await member.from("modeling_structural_demand_diagnosis_custody").select("method,scientific_outcome").eq("id", custodyId).single();
    expect(visible.error).toBeNull();
    expect(visible.data).toEqual({ method: "aequilibrae", scientific_outcome: "inconclusive" });
    const hidden = await outsider.from("modeling_structural_demand_diagnosis_custody").select("id").eq("id", custodyId);
    expect(hidden.error).toBeNull();
    expect(hidden.data).toEqual([]);
    const memberWrite = await member.from("modeling_structural_demand_diagnosis_custody").update({ method: "activitysim" }).eq("id", custodyId);
    expect(memberWrite.error).not.toBeNull();
  });

  it("refuses changed hashes, cross-workspace records, updates, and deletes", async () => {
    const rowResult = await service.from("modeling_structural_demand_diagnosis_custody").select("*").eq("id", custodyId).single();
    const row = rowResult.data as Record<string, unknown>;
    const changedHash = await service.from("modeling_structural_demand_diagnosis_custody").insert({ ...row, id: randomUUID(), diagnosis_sha256: "c".repeat(64) });
    expect(changedHash.error?.message).toContain("type, run, or hash");
    const crossWorkspace = await service.from("modeling_structural_demand_diagnosis_custody").insert({ ...row, id: randomUUID(), workspace_id: workspaceB });
    expect(crossWorkspace.error?.message).toContain("does not belong to workspace");
    const update = await service.from("modeling_structural_demand_diagnosis_custody").update({ diagnosis_sha256: "d".repeat(64) }).eq("id", custodyId);
    expect(update.error?.message).toContain("append-only");
    const deletion = await service.from("modeling_structural_demand_diagnosis_custody").delete().eq("id", custodyId);
    expect(deletion.error?.message).toContain("append-only");
    const artifactUpdate = await service.from("model_run_artifacts").update({ content_hash: "e".repeat(64) }).eq("id", auditArtifactId);
    expect(artifactUpdate.error?.message).toContain("immutable structural demand custody");
  });
});
