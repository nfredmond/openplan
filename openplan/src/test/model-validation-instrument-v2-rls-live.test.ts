import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

import { LIVE_RLS, getLocalSupabaseEnv, liveClient } from "./local-supabase-env";

const liveDescribe = LIVE_RLS ? describe : describe.skip;

liveDescribe("comparable observation v2 custody live RLS", () => {
  let service: SupabaseClient;
  let member: SupabaseClient;
  let outsider: SupabaseClient;
  let workspaceA = "";
  let workspaceB = "";
  let runA = "";
  let custodyId = "";
  let boundArtifactId = "";
  const hashes = ["1", "2", "3", "4", "5"].map((seed) => seed.repeat(64));
  const password = "ComparableInstrumentLive!2026";

  beforeAll(async () => {
    const env = getLocalSupabaseEnv();
    service = liveClient(env.API_URL, env.SERVICE_ROLE_KEY, "comparable-v2-service");
    member = liveClient(env.API_URL, env.ANON_KEY, "comparable-v2-member");
    outsider = liveClient(env.API_URL, env.ANON_KEY, "comparable-v2-outsider");
    const suffix = randomUUID().replace(/-/g, "").slice(0, 10);
    const memberUser = await service.auth.admin.createUser({ email: `comparable-member-${suffix}@example.test`, password, email_confirm: true });
    const outsiderUser = await service.auth.admin.createUser({ email: `comparable-outsider-${suffix}@example.test`, password, email_confirm: true });
    if (!memberUser.data.user || !outsiderUser.data.user) throw new Error("live fixture users were not created");

    workspaceA = randomUUID();
    workspaceB = randomUUID();
    const workspaceInsert = await service.from("workspaces").insert([
      { id: workspaceA, name: `Comparable A ${suffix}`, slug: `comparable-a-${suffix}` },
      { id: workspaceB, name: `Comparable B ${suffix}`, slug: `comparable-b-${suffix}` },
    ]);
    if (workspaceInsert.error) throw new Error(workspaceInsert.error.message);
    const membershipInsert = await service.from("workspace_members").insert([
      { workspace_id: workspaceA, user_id: memberUser.data.user.id, role: "member" },
      { workspace_id: workspaceB, user_id: outsiderUser.data.user.id, role: "owner" },
    ]);
    if (membershipInsert.error) throw new Error(membershipInsert.error.message);

    const modelA = randomUUID();
    const modelB = randomUUID();
    const modelInsert = await service.from("models").insert([
      { id: modelA, workspace_id: workspaceA, title: "Comparable A", model_family: "travel_demand", created_by: memberUser.data.user.id },
      { id: modelB, workspace_id: workspaceB, title: "Comparable B", model_family: "travel_demand", created_by: outsiderUser.data.user.id },
    ]);
    if (modelInsert.error) throw new Error(modelInsert.error.message);
    runA = randomUUID();
    const runB = randomUUID();
    const runInsert = await service.from("model_runs").insert([
      { id: runA, workspace_id: workspaceA, model_id: modelA, engine_key: "aequilibrae", status: "succeeded", run_title: "Comparable A", created_by: memberUser.data.user.id },
      { id: runB, workspace_id: workspaceB, model_id: modelB, engine_key: "aequilibrae", status: "succeeded", run_title: "Comparable B", created_by: outsiderUser.data.user.id },
    ]);
    if (runInsert.error) throw new Error(runInsert.error.message);

    const types = [
      ["validation_input_bundle_v2", "openplan.validation-input-bundle.v2"],
      ["pre_volume_match_audit_v2", "openplan.pre-volume-observation-match-audit.v2"],
      ["model_comparison_basis_v2", "openplan.model-comparison-basis.v2"],
      ["model_validation_assessment_v2", "openplan.model-validation-assessment.v2"],
      ["model_validation_structural_diagnosis_v2", "openplan.model-validation-structural-diagnosis.v2"],
    ] as const;
    const artifactIds = types.map(() => randomUUID());
    const artifactInsert = await service.from("model_run_artifacts").insert(types.map(([artifactType, schema], index) => ({
      id: artifactIds[index],
      run_id: runA,
      artifact_type: artifactType,
      file_url: `storage://run-artifacts/model-runs/${runA}/${artifactType}.json`,
      file_size_bytes: 10,
      content_hash: hashes[index],
      metadata_json: { schema },
    })));
    if (artifactInsert.error) throw new Error(artifactInsert.error.message);
    boundArtifactId = artifactIds[0];

    const custody = await service.rpc("record_modeling_validation_instrument_v2", {
      p_workspace_id: workspaceA,
      p_model_run_id: runA,
      p_input_bundle_artifact_id: artifactIds[0], p_input_bundle_sha256: hashes[0],
      p_match_audit_artifact_id: artifactIds[1], p_match_audit_sha256: hashes[1],
      p_comparison_basis_artifact_id: artifactIds[2], p_comparison_basis_sha256: hashes[2],
      p_assessment_artifact_id: artifactIds[3], p_assessment_sha256: hashes[3],
      p_diagnosis_artifact_id: artifactIds[4], p_diagnosis_sha256: hashes[4],
      p_scientific_outcome: "inconclusive",
    });
    if (custody.error) throw new Error(custody.error.message);
    custodyId = String((custody.data as Record<string, unknown>).id);

    await member.auth.signInWithPassword({ email: `comparable-member-${suffix}@example.test`, password });
    await outsider.auth.signInWithPassword({ email: `comparable-outsider-${suffix}@example.test`, password });
  });

  it("isolates reads by workspace", async () => {
    const visible = await member.from("modeling_validation_instrument_v2_custody").select("scientific_outcome, diagnosis_sha256").eq("id", custodyId).single();
    expect(visible.error).toBeNull();
    expect(visible.data?.scientific_outcome).toBe("inconclusive");
    const hidden = await outsider.from("modeling_validation_instrument_v2_custody").select("id").eq("id", custodyId);
    expect(hidden.error).toBeNull();
    expect(hidden.data).toEqual([]);
  });

  it("allows only service-role creation and refuses custody or artifact mutation", async () => {
    const memberInsert = await member.from("modeling_validation_instrument_v2_custody").insert({
      workspace_id: workspaceA, model_run_id: runA,
      input_bundle_artifact_id: randomUUID(), match_audit_artifact_id: randomUUID(),
      comparison_basis_artifact_id: randomUUID(), assessment_artifact_id: randomUUID(), diagnosis_artifact_id: randomUUID(),
      input_bundle_sha256: hashes[0], match_audit_sha256: hashes[1], comparison_basis_sha256: hashes[2], assessment_sha256: hashes[3], diagnosis_sha256: hashes[4], scientific_outcome: "inconclusive",
    });
    expect(memberInsert.error).not.toBeNull();
    const update = await service.from("modeling_validation_instrument_v2_custody").update({ diagnosis_sha256: "a".repeat(64) }).eq("id", custodyId);
    expect(update.error?.message).toContain("append-only");
    const mutateArtifact = await service.from("model_run_artifacts").update({ content_hash: "b".repeat(64) }).eq("id", boundArtifactId);
    expect(mutateArtifact.error?.message).toContain("immutable comparable observation custody");
    const deleteArtifact = await service.from("model_run_artifacts").delete().eq("id", boundArtifactId);
    expect(deleteArtifact.error?.message).toContain("immutable comparable observation custody");
  });

  it("refuses a cross-workspace or wrong-hash service binding", async () => {
    const existing = await service.from("modeling_validation_instrument_v2_custody").select("*").eq("id", custodyId).single();
    const row = existing.data as Record<string, unknown>;
    const cross = await service.from("modeling_validation_instrument_v2_custody").insert({
      ...row, id: randomUUID(), workspace_id: workspaceB, model_run_id: runA,
    });
    expect(cross.error?.message).toContain("does not belong to workspace");
    const wrongHash = await service.from("modeling_validation_instrument_v2_custody").insert({
      ...row, id: randomUUID(), diagnosis_sha256: "f".repeat(64),
    });
    expect(wrongHash.error).not.toBeNull();
  });
});
