import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

import { LIVE_RLS, getLocalSupabaseEnv, liveClient } from "./local-supabase-env";

const liveDescribe = LIVE_RLS ? describe : describe.skip;

liveDescribe("rules-v4 model validation custody live RLS", () => {
  let service: SupabaseClient;
  let member: SupabaseClient;
  let outsider: SupabaseClient;
  let workspaceA = "";
  let workspaceB = "";
  let runA = "";
  let runB = "";
  let stageA = "";
  let outputA = "";
  let outputB = "";
  let custodyId = "";
  let assessmentArtifactId = "";
  const password = "ValidationCustodyLive!2026";

  beforeAll(async () => {
    const env = getLocalSupabaseEnv();
    service = liveClient(env.API_URL, env.SERVICE_ROLE_KEY, "validation-custody-service");
    member = liveClient(env.API_URL, env.ANON_KEY, "validation-custody-member");
    outsider = liveClient(env.API_URL, env.ANON_KEY, "validation-custody-outsider");
    const suffix = randomUUID().replace(/-/g, "").slice(0, 10);
    const memberUser = await service.auth.admin.createUser({
      email: `validation-custody-member-${suffix}@example.test`, password, email_confirm: true,
    });
    const outsiderUser = await service.auth.admin.createUser({
      email: `validation-custody-outsider-${suffix}@example.test`, password, email_confirm: true,
    });
    if (!memberUser.data.user || !outsiderUser.data.user) throw new Error("live fixture users were not created");

    workspaceA = randomUUID();
    workspaceB = randomUUID();
    const workspaces = await service.from("workspaces").insert([
      { id: workspaceA, name: `Validation A ${suffix}`, slug: `validation-a-${suffix}` },
      { id: workspaceB, name: `Validation B ${suffix}`, slug: `validation-b-${suffix}` },
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
      { id: modelA, workspace_id: workspaceA, title: "Validation A", model_family: "travel_demand", created_by: memberUser.data.user.id },
      { id: modelB, workspace_id: workspaceB, title: "Validation B", model_family: "travel_demand", created_by: outsiderUser.data.user.id },
    ]);
    if (models.error) throw new Error(models.error.message);
    runA = randomUUID();
    runB = randomUUID();
    const runs = await service.from("model_runs").insert([
      { id: runA, workspace_id: workspaceA, model_id: modelA, engine_key: "aequilibrae", status: "succeeded", run_title: "Negative assessment retained", created_by: memberUser.data.user.id },
      { id: runB, workspace_id: workspaceB, model_id: modelB, engine_key: "aequilibrae", status: "succeeded", run_title: "Cross-workspace decoy", created_by: outsiderUser.data.user.id },
    ]);
    if (runs.error) throw new Error(runs.error.message);
    stageA = randomUUID();
    const stageB = randomUUID();
    const stages = await service.from("model_run_stages").insert([
      { id: stageA, run_id: runA, stage_name: "Artifact Extraction", status: "succeeded", sort_order: 1 },
      { id: stageB, run_id: runB, stage_name: "Artifact Extraction", status: "succeeded", sort_order: 1 },
    ]);
    if (stages.error) throw new Error(stages.error.message);
    outputA = randomUUID();
    outputB = randomUUID();
    const outputs = await service.from("model_run_artifacts").insert([
      { id: outputA, run_id: runA, stage_id: stageA, artifact_type: "link_volumes", file_url: `storage://run-artifacts/${runA}.csv`, file_size_bytes: 10, content_hash: "1".repeat(64), metadata_json: {} },
      { id: outputB, run_id: runB, stage_id: stageB, artifact_type: "link_volumes", file_url: `storage://run-artifacts/${runB}.csv`, file_size_bytes: 10, content_hash: "2".repeat(64), metadata_json: {} },
    ]);
    if (outputs.error) throw new Error(outputs.error.message);

    const basisHash = "b".repeat(64);
    const record = await service.rpc("record_modeling_validation_assessment", {
      p_workspace_id: workspaceA,
      p_model_run_id: runA,
      p_stage_id: stageA,
      p_track: "assignment",
      p_model_output_artifact_id: outputA,
      p_validation_input_file_url: `storage://run-artifacts/${runA}/input.json`,
      p_validation_input_size: 10,
      p_validation_input_sha256: "3".repeat(64),
      p_validation_input_metadata: { schema: "openplan.validation-input-bundle.v1", comparison_basis_sha256: basisHash },
      p_comparison_basis_file_url: `storage://run-artifacts/${runA}/basis.json`,
      p_comparison_basis_size: 10,
      p_comparison_basis_sha256: basisHash,
      p_comparison_basis_metadata: { schema: "openplan.model-comparison-basis.v1" },
      p_assessment_file_url: `storage://run-artifacts/${runA}/assessment.json`,
      p_assessment_size: 10,
      p_assessment_sha256: "4".repeat(64),
      p_assessment_metadata: {
        schema: "openplan.model-validation-assessment.v1",
        comparison_basis_sha256: basisHash,
        rules_version: 4,
        scientific_outcome: "fail",
        partition: { kind: "holdout", id: "negative-fixture" },
        planning_use: "baseline diagnosis",
        reasons: ["Comparable decisive observations exceeded the frozen threshold."],
      },
      p_partition: { kind: "holdout", id: "negative-fixture" },
      p_planning_use: "baseline diagnosis",
      p_scientific_outcome: "fail",
      p_reasons: ["Comparable decisive observations exceeded the frozen threshold."],
    });
    if (record.error) throw new Error(record.error.message);
    const row = record.data as Record<string, unknown>;
    custodyId = String(row.id);
    assessmentArtifactId = String(row.model_validation_assessment_artifact_id);

    await member.auth.signInWithPassword({ email: `validation-custody-member-${suffix}@example.test`, password });
    await outsider.auth.signInWithPassword({ email: `validation-custody-outsider-${suffix}@example.test`, password });
  });

  it("retains a negative result for members and isolates it from outsiders", async () => {
    const visible = await member.from("modeling_validation_assessments").select("scientific_outcome, reasons_json").eq("id", custodyId).single();
    expect(visible.error).toBeNull();
    expect(visible.data?.scientific_outcome).toBe("fail");
    const hidden = await outsider.from("modeling_validation_assessments").select("id").eq("id", custodyId);
    expect(hidden.error).toBeNull();
    expect(hidden.data).toEqual([]);
  });

  it("refuses client writes and service-role mutation of custody and bound artifacts", async () => {
    const clientInsert = await member.from("modeling_validation_assessments").insert({
      workspace_id: workspaceA, model_run_id: runA, track: "assignment",
    });
    expect(clientInsert.error).not.toBeNull();
    const mutateCustody = await service.from("modeling_validation_assessments").update({ planning_use: "changed" }).eq("id", custodyId);
    expect(mutateCustody.error?.message).toContain("append-only");
    const mutateArtifact = await service.from("model_run_artifacts").update({ content_hash: "9".repeat(64) }).eq("id", assessmentArtifactId);
    expect(mutateArtifact.error?.message).toContain("immutable model validation custody");
    const deleteArtifact = await service.from("model_run_artifacts").delete().eq("id", outputA);
    expect(deleteArtifact.error?.message).toContain("immutable model validation custody");
  });

  it("rolls back every inserted evidence artifact when cross-workspace relinking is refused", async () => {
    const before = await service.from("model_run_artifacts").select("id", { count: "exact", head: true }).eq("run_id", runA);
    const basisHash = "d".repeat(64);
    const refused = await service.rpc("record_modeling_validation_assessment", {
      p_workspace_id: workspaceA, p_model_run_id: runA, p_stage_id: stageA, p_track: "assignment",
      p_model_output_artifact_id: outputB,
      p_validation_input_file_url: "storage://run-artifacts/refused-input.json", p_validation_input_size: 1, p_validation_input_sha256: "5".repeat(64), p_validation_input_metadata: { schema: "openplan.validation-input-bundle.v1", comparison_basis_sha256: basisHash },
      p_comparison_basis_file_url: "storage://run-artifacts/refused-basis.json", p_comparison_basis_size: 1, p_comparison_basis_sha256: basisHash, p_comparison_basis_metadata: { schema: "openplan.model-comparison-basis.v1" },
      p_assessment_file_url: "storage://run-artifacts/refused-assessment.json", p_assessment_size: 1, p_assessment_sha256: "6".repeat(64), p_assessment_metadata: { schema: "openplan.model-validation-assessment.v1", comparison_basis_sha256: basisHash, rules_version: 4, scientific_outcome: "inconclusive" },
      p_partition: { kind: "unpartitioned" }, p_planning_use: "unknown", p_scientific_outcome: "inconclusive", p_reasons: ["Cross-workspace fixture"],
    });
    expect(refused.error?.message).toContain("same run");
    const after = await service.from("model_run_artifacts").select("id", { count: "exact", head: true }).eq("run_id", runA);
    expect(after.count).toBe(before.count);
  });
});
