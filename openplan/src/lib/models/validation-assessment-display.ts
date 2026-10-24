import { isJsonRecord } from "@/lib/models/demand-agreement-artifact";

export type ValidationDisplayArtifact = {
  id: string;
  artifact_type: string;
  file_url: string;
  file_size_bytes: number | null;
  content_hash?: string | null;
  metadata_json?: Record<string, unknown> | null;
};

export type ValidationAssessmentDisplay = {
  artifact: ValidationDisplayArtifact;
  assessment: Record<string, unknown> | null;
  output: ValidationDisplayArtifact | null;
  basis: ValidationDisplayArtifact | null;
  input: ValidationDisplayArtifact | null;
  method: string;
  status: "bound" | "unbound" | "ambiguous";
  reason: string;
};

function sha256(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

export function validationOutputMethod(type: string): string | null {
  if (type === "link_volumes") return "AequilibraE assignment";
  if (type === "activitysim_link_volumes") return "ActivitySim behavioral demand with AequilibraE assignment";
  return null;
}

/** Join registered metadata, never filenames or artifact order. This does not verify file bytes or scientific validity. */
export function validationAssessmentDisplays(artifacts: ValidationDisplayArtifact[]): ValidationAssessmentDisplay[] {
  const assessments = artifacts.filter((artifact) => ["model_validation_assessment", "model_validation_assessment_v2"].includes(artifact.artifact_type));
  return assessments.map((artifact): ValidationAssessmentDisplay => {
    const assessment = isJsonRecord(artifact.metadata_json) ? artifact.metadata_json : null;
    const display: ValidationAssessmentDisplay = {
      artifact, assessment, output: null, basis: null, input: null,
      method: "Method unknown", status: "unbound",
      reason: "Assessment metadata is missing or unsupported. No validation claim is allowed.",
    };
    if (artifact.artifact_type !== "model_validation_assessment" ||
        assessment?.schema !== "openplan.model-validation-assessment.v1" || assessment.rules_version !== 4) return display;
    const exact = isJsonRecord(assessment.exact_inputs) ? assessment.exact_inputs : null;
    if (!exact || typeof exact.model_output_artifact_id !== "string" || !exact.model_output_artifact_id ||
        !sha256(exact.model_output_sha256) || !sha256(exact.comparison_basis_sha256) ||
        assessment.comparison_basis_sha256 !== exact.comparison_basis_sha256 || !sha256(artifact.content_hash)) {
      return { ...display, reason: "Exact output or comparison-basis binding is missing or conflicting. No validation claim is allowed." };
    }
    const outputs = artifacts.filter((row) => row.id === exact.model_output_artifact_id);
    if (outputs.length !== 1) {
      return { ...display, status: outputs.length > 1 ? "ambiguous" : "unbound",
        reason: "The exact output artifact is missing or duplicated. No validation claim is allowed." };
    }
    const output = outputs[0];
    const method = validationOutputMethod(output.artifact_type);
    if (!method || output.content_hash !== exact.model_output_sha256) {
      return { ...display, reason: "The output type is unsupported or its SHA-256 differs from the assessment. No validation claim is allowed." };
    }
    display.output = output;
    display.method = method;
    const bases = artifacts.filter((row) => row.artifact_type === "model_comparison_basis" && row.content_hash === exact.comparison_basis_sha256);
    const inputs = artifacts.filter((row) => row.artifact_type === "validation_input_bundle" &&
      row.metadata_json?.comparison_basis_sha256 === exact.comparison_basis_sha256);
    const peers = assessments.filter((row) => {
      const other = row.metadata_json?.exact_inputs;
      return isJsonRecord(other) && other.model_output_artifact_id === exact.model_output_artifact_id &&
        other.comparison_basis_sha256 === exact.comparison_basis_sha256;
    });
    if (bases.length > 1 || inputs.length > 1 || peers.length > 1) {
      return { ...display, status: "ambiguous", reason: "Multiple assessment, basis or input records share this binding. No record is selected. No validation claim is allowed." };
    }
    if (bases.length !== 1 || inputs.length !== 1) {
      return { ...display, reason: "The exact comparison basis or linked input bundle is missing. No validation claim is allowed." };
    }
    const basis = bases[0];
    const input = inputs[0];
    if (basis.metadata_json?.schema !== "openplan.model-comparison-basis.v1" ||
        input.metadata_json?.schema !== "openplan.validation-input-bundle.v1" || !sha256(input.content_hash) ||
        (exact.validation_input_bundle_sha256 !== undefined && exact.validation_input_bundle_sha256 !== input.content_hash) ||
        new Set([artifact.id, output.id, basis.id, input.id]).size !== 4) {
      return { ...display, reason: "The input or basis contract conflicts with the recorded binding. No validation claim is allowed." };
    }
    return { ...display, basis, input, status: "bound",
      reason: "Linked by registered output identity and SHA-256, and the shared comparison-basis SHA-256. Downloaded bytes are not checked by this panel." };
  });
}

/** Retain exact controls even when an old or unsupported row cannot be assigned to a method. */
export function validationArtifactContext(artifact: ValidationDisplayArtifact, displays: ValidationAssessmentDisplay[]): string | null {
  const matches = displays.filter((display) => display.status === "bound" &&
    [display.artifact.id, display.output?.id, display.basis?.id, display.input?.id].includes(artifact.id));
  if (matches.length === 1) return `${matches[0].method} · output ${matches[0].output?.id}`;
  if (matches.length > 1) return "Ambiguous validation binding";
  if (["model_validation_assessment", "model_comparison_basis", "validation_input_bundle",
    "model_validation_assessment_v2", "model_comparison_basis_v2", "validation_input_bundle_v2", "pre_volume_match_audit_v2"].includes(artifact.artifact_type)) {
    return "Unbound validation record · method association unchecked";
  }
  return validationOutputMethod(artifact.artifact_type);
}
