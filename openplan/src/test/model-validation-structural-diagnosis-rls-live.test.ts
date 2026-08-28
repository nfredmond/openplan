import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

import { LIVE_RLS, getLocalSupabaseEnv, liveClient } from "./local-supabase-env";

const liveDescribe = LIVE_RLS ? describe : describe.skip;

liveDescribe("model validation structural diagnosis custody live RLS", () => {
  let service: SupabaseClient;
  let member: SupabaseClient;
  let outsider: SupabaseClient;
  let workspaceA = "";
  let workspaceB = "";
  let runA = "";
  let stageA = "";
  let assessmentA = "";
  let assessmentB = "";
  let assessmentHashA = "";
  let diagnosisCustodyId = "";
  let diagnosisArtifactId = "";
  const password = "StructuralDiagnosisLive!2026";

  beforeAll(async () => {
    const env = getLocalSupabaseEnv();
    service = liveClient(env.API_URL, env.SERVICE_ROLE_KEY, "structural-diagnosis-service");
    member = liveClient(env.API_URL, env.ANON_KEY, "structural-diagnosis-member");
    outsider = liveClient(env.API_URL, env.ANON_KEY, "structural-diagnosis-outsider");
    const suffix = randomUUID().replace(/-/g, "").slice(0, 10);
    const memberUser = await service.auth.admin.createUser({
      email: `structural-diagnosis-member-${suffix}@example.test`,
      password,
      email_confirm: true,
    });
    const outsiderUser = await service.auth.admin.createUser({
      email: `structural-diagnosis-outsider-${suffix}@example.test`,
      password,
      email_confirm: true,
    });
    if (!memberUser.data.user || !outsiderUser.data.user) {
      throw new Error("live fixture users were not created");
    }

    workspaceA = randomUUID();
    workspaceB = randomUUID();
    const workspaces = await service.from("workspaces").insert([
      { id: workspaceA, name: `Diagnosis A ${suffix}`, slug: `diagnosis-a-${suffix}` },
      { id: workspaceB, name: `Diagnosis B ${suffix}`, slug: `diagnosis-b-${suffix}` },
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
      {
        id: modelA,
        workspace_id: workspaceA,
        title: "Structural diagnosis A",
        model_family: "travel_demand",
        created_by: memberUser.data.user.id,
      },
      {
        id: modelB,
        workspace_id: workspaceB,
        title: "Structural diagnosis B",
        model_family: "travel_demand",
        created_by: outsiderUser.data.user.id,
      },
    ]);
    if (models.error) throw new Error(models.error.message);
    runA = randomUUID();
    const runB = randomUUID();
    const runs = await service.from("model_runs").insert([
      {
        id: runA,
        workspace_id: workspaceA,
        model_id: modelA,
        engine_key: "aequilibrae",
        status: "succeeded",
        run_title: "Inconclusive diagnosis A",
        created_by: memberUser.data.user.id,
      },
      {
        id: runB,
        workspace_id: workspaceB,
        model_id: modelB,
        engine_key: "aequilibrae",
        status: "succeeded",
        run_title: "Inconclusive diagnosis B",
        created_by: outsiderUser.data.user.id,
      },
    ]);
    if (runs.error) throw new Error(runs.error.message);
    stageA = randomUUID();
    const stageB = randomUUID();
    const stages = await service.from("model_run_stages").insert([
      { id: stageA, run_id: runA, stage_name: "Validation", status: "succeeded", sort_order: 1 },
      { id: stageB, run_id: runB, stage_name: "Validation", status: "succeeded", sort_order: 1 },
    ]);
    if (stages.error) throw new Error(stages.error.message);

    const outputA = randomUUID();
    const outputB = randomUUID();
    const outputs = await service.from("model_run_artifacts").insert([
      {
        id: outputA,
        run_id: runA,
        stage_id: stageA,
        artifact_type: "link_volumes",
        file_url: `storage://run-artifacts/model-runs/${runA}/links.csv`,
        file_size_bytes: 10,
        content_hash: "1".repeat(64),
        metadata_json: {},
      },
      {
        id: outputB,
        run_id: runB,
        stage_id: stageB,
        artifact_type: "link_volumes",
        file_url: `storage://run-artifacts/model-runs/${runB}/links.csv`,
        file_size_bytes: 10,
        content_hash: "2".repeat(64),
        metadata_json: {},
      },
    ]);
    if (outputs.error) throw new Error(outputs.error.message);

    async function recordAssessment(
      workspaceId: string,
      runId: string,
      stageId: string,
      outputId: string,
      hashSeed: string,
    ) {
      const basisHash = hashSeed.repeat(64);
      const assessmentHash = (hashSeed === "a" ? "b" : "d").repeat(64);
      const record = await service.rpc("record_modeling_validation_assessment", {
        p_workspace_id: workspaceId,
        p_model_run_id: runId,
        p_stage_id: stageId,
        p_track: "assignment",
        p_model_output_artifact_id: outputId,
        p_validation_input_file_url: `storage://run-artifacts/model-runs/${runId}/input.json`,
        p_validation_input_size: 10,
        p_validation_input_sha256: "3".repeat(64),
        p_validation_input_metadata: {
          schema: "openplan.validation-input-bundle.v1",
          comparison_basis_sha256: basisHash,
        },
        p_comparison_basis_file_url: `storage://run-artifacts/model-runs/${runId}/basis.json`,
        p_comparison_basis_size: 10,
        p_comparison_basis_sha256: basisHash,
        p_comparison_basis_metadata: { schema: "openplan.model-comparison-basis.v1" },
        p_assessment_file_url: `storage://run-artifacts/model-runs/${runId}/assessment.json`,
        p_assessment_size: 10,
        p_assessment_sha256: assessmentHash,
        p_assessment_metadata: {
          schema: "openplan.model-validation-assessment.v1",
          comparison_basis_sha256: basisHash,
          rules_version: 4,
          scientific_outcome: "inconclusive",
          partition: { kind: "development", id: runId },
          planning_use: "frozen structural diagnosis",
          reasons: ["Same-basis facts remain unknown."],
        },
        p_partition: { kind: "development", id: runId },
        p_planning_use: "frozen structural diagnosis",
        p_scientific_outcome: "inconclusive",
        p_reasons: ["Same-basis facts remain unknown."],
      });
      if (record.error) throw new Error(record.error.message);
      return {
        id: String((record.data as Record<string, unknown>).id),
        hash: assessmentHash,
      };
    }

    const recordedA = await recordAssessment(workspaceA, runA, stageA, outputA, "a");
    const recordedB = await recordAssessment(workspaceB, runB, stageB, outputB, "c");
    assessmentA = recordedA.id;
    assessmentB = recordedB.id;
    assessmentHashA = recordedA.hash;
    const diagnosisHash = "e".repeat(64);
    const diagnosis = await service.rpc("record_modeling_validation_structural_diagnosis", {
      p_workspace_id: workspaceA,
      p_model_run_id: runA,
      p_stage_id: stageA,
      p_modeling_validation_assessment_id: assessmentA,
      p_assessment_sha256: assessmentHashA,
      p_diagnosis_file_url: `storage://run-artifacts/model-runs/${runA}/structural-diagnosis.json`,
      p_diagnosis_size: 100,
      p_diagnosis_sha256: diagnosisHash,
      p_diagnosis_metadata: {
        schema: "openplan.model-validation-structural-diagnosis.v1",
        modeling_validation_assessment_id: assessmentA,
        assessment_sha256: assessmentHashA,
        diagnosis_sha256: diagnosisHash,
        scientific_outcome: "inconclusive",
      },
      p_scientific_outcome: "inconclusive",
    });
    if (diagnosis.error) throw new Error(diagnosis.error.message);
    const row = diagnosis.data as Record<string, unknown>;
    diagnosisCustodyId = String(row.id);
    diagnosisArtifactId = String(row.diagnosis_artifact_id);

    await member.auth.signInWithPassword({
      email: `structural-diagnosis-member-${suffix}@example.test`,
      password,
    });
    await outsider.auth.signInWithPassword({
      email: `structural-diagnosis-outsider-${suffix}@example.test`,
      password,
    });
  });

  it("is visible to a workspace member and hidden from an outsider", async () => {
    const visible = await member
      .from("modeling_validation_structural_diagnoses")
      .select("scientific_outcome, diagnosis_sha256")
      .eq("id", diagnosisCustodyId)
      .single();
    expect(visible.error).toBeNull();
    expect(visible.data?.scientific_outcome).toBe("inconclusive");
    const hidden = await outsider
      .from("modeling_validation_structural_diagnoses")
      .select("id")
      .eq("id", diagnosisCustodyId);
    expect(hidden.error).toBeNull();
    expect(hidden.data).toEqual([]);
  });

  it("refuses member creation and service-role mutation or deletion", async () => {
    const memberRecord = await member.rpc("record_modeling_validation_structural_diagnosis", {
      p_workspace_id: workspaceA,
      p_model_run_id: runA,
      p_stage_id: stageA,
      p_modeling_validation_assessment_id: assessmentA,
      p_assessment_sha256: assessmentHashA,
      p_diagnosis_file_url: "storage://run-artifacts/refused.json",
      p_diagnosis_size: 1,
      p_diagnosis_sha256: "f".repeat(64),
      p_diagnosis_metadata: {},
      p_scientific_outcome: "inconclusive",
    });
    expect(memberRecord.error).not.toBeNull();
    const mutate = await service
      .from("modeling_validation_structural_diagnoses")
      .update({ diagnosis_sha256: "0".repeat(64) })
      .eq("id", diagnosisCustodyId);
    expect(mutate.error?.message).toContain("append-only");
    const mutateArtifact = await service
      .from("model_run_artifacts")
      .update({ content_hash: "0".repeat(64) })
      .eq("id", diagnosisArtifactId);
    expect(mutateArtifact.error?.message).toContain("immutable model validation custody");
    const deleteArtifact = await service
      .from("model_run_artifacts")
      .delete()
      .eq("id", diagnosisArtifactId);
    expect(deleteArtifact.error?.message).toContain("immutable model validation custody");
  });

  it("rolls back on cross-workspace assessment and wrong hash bindings", async () => {
    const before = await service
      .from("model_run_artifacts")
      .select("id", { count: "exact", head: true })
      .eq("run_id", runA);
    const crossWorkspace = await service.rpc("record_modeling_validation_structural_diagnosis", {
      p_workspace_id: workspaceA,
      p_model_run_id: runA,
      p_stage_id: stageA,
      p_modeling_validation_assessment_id: assessmentB,
      p_assessment_sha256: "d".repeat(64),
      p_diagnosis_file_url: `storage://run-artifacts/model-runs/${runA}/cross-workspace.json`,
      p_diagnosis_size: 1,
      p_diagnosis_sha256: "7".repeat(64),
      p_diagnosis_metadata: {
        schema: "openplan.model-validation-structural-diagnosis.v1",
        modeling_validation_assessment_id: assessmentB,
        assessment_sha256: "d".repeat(64),
        diagnosis_sha256: "7".repeat(64),
        scientific_outcome: "inconclusive",
      },
      p_scientific_outcome: "inconclusive",
    });
    expect(crossWorkspace.error?.message).toContain("same workspace and run");
    const wrongHash = await service.rpc("record_modeling_validation_structural_diagnosis", {
      p_workspace_id: workspaceA,
      p_model_run_id: runA,
      p_stage_id: stageA,
      p_modeling_validation_assessment_id: assessmentA,
      p_assessment_sha256: "9".repeat(64),
      p_diagnosis_file_url: `storage://run-artifacts/model-runs/${runA}/wrong-hash.json`,
      p_diagnosis_size: 1,
      p_diagnosis_sha256: "8".repeat(64),
      p_diagnosis_metadata: {
        schema: "openplan.model-validation-structural-diagnosis.v1",
        modeling_validation_assessment_id: assessmentA,
        assessment_sha256: "9".repeat(64),
        diagnosis_sha256: "8".repeat(64),
        scientific_outcome: "inconclusive",
      },
      p_scientific_outcome: "inconclusive",
    });
    expect(wrongHash.error?.message).toContain("assessment hash");
    const after = await service
      .from("model_run_artifacts")
      .select("id", { count: "exact", head: true })
      .eq("run_id", runA);
    expect(after.count).toBe(before.count);
  });
});
