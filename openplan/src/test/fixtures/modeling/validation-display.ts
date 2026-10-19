import type { ValidationDisplayArtifact } from "@/lib/models/validation-assessment-display";

/** Synthetic registered metadata. Pass/fail are attribution sentinels with unknown comparability, not valid emitted legacy assessments; uncontracted rules-v4 emits only inconclusive. */
export function validationDisplayFixture(
  method: "aequilibrae" | "activitysim",
  outcome: "pass" | "fail" | "inconclusive" = "inconclusive",
  storage: "storage" | "local" = "storage",
) {
  const aeq = method === "aequilibrae";
  const id = (slot: number) => `${aeq ? "44444444" : "55555555"}-1111-4111-8111-${String(slot).padStart(12, "0")}`;
  const basisHash = (aeq ? "a" : "1").repeat(64);
  const outputHash = (aeq ? "b" : "2").repeat(64);
  const inputHash = (aeq ? "d" : "3").repeat(64);
  const artifact = (slot: number, type: string, hash: string, metadata: Record<string, unknown>): ValidationDisplayArtifact => ({
    id: id(slot), artifact_type: type, content_hash: hash,
    file_url: `${storage}://${storage === "storage" ? "run-artifacts" : "/owned-attempt"}/${type}.json`,
    file_size_bytes: 2048, metadata_json: metadata,
  });
  const output = artifact(1, aeq ? "link_volumes" : "activitysim_link_volumes", outputHash, {});
  const basis = artifact(2, "model_comparison_basis", basisHash, { schema: "openplan.model-comparison-basis.v1" });
  const input = artifact(3, "validation_input_bundle", inputHash, {
    schema: "openplan.validation-input-bundle.v1", comparison_basis_sha256: basisHash,
  });
  const assessment = artifact(4, "model_validation_assessment", (aeq ? "c" : "4").repeat(64), {
    schema: "openplan.model-validation-assessment.v1", comparison_basis_sha256: basisHash,
    rules_version: 4, scientific_outcome: outcome, planning_use: "unknown",
    partition: { kind: "unpartitioned", id: "unknown" },
    coverage: "unknown", comparability_findings: "unknown",
    reasons: [`Synthetic ${method} ${outcome} reason`],
    exact_inputs: {
      comparison_basis_sha256: basisHash, model_output_artifact_id: output.id,
      model_output_sha256: outputHash, observation_sha256: [inputHash],
    },
  });
  return { output, basis, input, assessment, artifacts: [assessment, basis, input, output] };
}
