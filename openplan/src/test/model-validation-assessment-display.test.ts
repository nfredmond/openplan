import { describe, expect, it } from "vitest";
import { validationArtifactContext, validationAssessmentDisplays, type ValidationDisplayArtifact } from "@/lib/models/validation-assessment-display";
import { validationDisplayFixture } from "@/test/fixtures/modeling/validation-display";

describe("registered rules-v4 method bindings", () => {
  it.each([false, true])("retains both conflicting method outcomes, reversed=%s", (reverse) => {
    const aeq = validationDisplayFixture("aequilibrae", "pass");
    const asim = validationDisplayFixture("activitysim", "fail");
    const rows = [...aeq.artifacts, ...asim.artifacts];
    const displays = validationAssessmentDisplays(reverse ? rows.reverse() : rows);
    expect(displays).toHaveLength(2);
    for (const fixture of [aeq, asim]) {
      const display = displays.find((row) => row.artifact.id === fixture.assessment.id);
      expect(display).toMatchObject({ status: "bound", output: fixture.output, input: fixture.input, basis: fixture.basis });
      expect(display?.assessment?.scientific_outcome).toBe(fixture.assessment.metadata_json?.scientific_outcome);
    }
    expect(displays.find((row) => row.output?.id === asim.output.id)?.method).toBe("ActivitySim behavioral demand with AequilibraE assignment");
    expect(validationArtifactContext(asim.input, displays)).toContain(asim.output.id);
  });

  it.each(["storage", "local"] as const)("uses emitted v1 metadata with %s references", (storage) => {
    const fixture = validationDisplayFixture("aequilibrae", "inconclusive", storage);
    expect(validationAssessmentDisplays(fixture.artifacts)[0]).toMatchObject({ status: "bound", method: "AequilibraE assignment" });
    expect(fixture.basis.metadata_json).toEqual({ schema: "openplan.model-comparison-basis.v1" });
    expect(fixture.input.metadata_json).toEqual({ schema: "openplan.validation-input-bundle.v1", comparison_basis_sha256: fixture.basis.content_hash });
  });

  it.each(["output", "basis", "input"] as const)("does not guess a missing %s", (role) => {
    const fixture = validationDisplayFixture("aequilibrae");
    const displays = validationAssessmentDisplays(fixture.artifacts.filter((row) => row.id !== fixture[role].id));
    expect(displays[0].status).toBe("unbound");
    expect(displays[0].reason).toContain("No validation claim is allowed");
    expect(validationArtifactContext(fixture.assessment, displays)).toContain("Unbound");
  });

  it.each(["assessment", "basis", "input", "output"] as const)("refuses ambiguous %s records", (role) => {
    const fixture = validationDisplayFixture("aequilibrae");
    const duplicate = { ...fixture[role], id: role === "output" ? fixture.output.id : "66666666-1111-4111-8111-000000000001" };
    const displays = validationAssessmentDisplays([...fixture.artifacts, duplicate]);
    expect(displays.every((row) => row.status === "ambiguous")).toBe(true);
    expect(displays).toHaveLength(role === "assessment" ? 2 : 1);
  });

  it.each([
    ["output hash", (f: ReturnType<typeof validationDisplayFixture>) => { f.output.content_hash = "f".repeat(64); }],
    ["unsupported output", (f: ReturnType<typeof validationDisplayFixture>) => { f.output.artifact_type = "unknown_output"; }],
    ["unsupported assessment", (f: ReturnType<typeof validationDisplayFixture>) => { f.assessment.metadata_json!.schema = "unsupported"; }],
    ["old rules", (f: ReturnType<typeof validationDisplayFixture>) => { f.assessment.metadata_json!.rules_version = 3; }],
    ["missing metadata", (f: ReturnType<typeof validationDisplayFixture>) => { f.assessment.metadata_json = null; }],
    ["conflicting basis", (f: ReturnType<typeof validationDisplayFixture>) => { f.assessment.metadata_json!.comparison_basis_sha256 = "f".repeat(64); }],
    ["missing assessment hash", (f: ReturnType<typeof validationDisplayFixture>) => { f.assessment.content_hash = null; }],
    ["unsupported input", (f: ReturnType<typeof validationDisplayFixture>) => { f.input.metadata_json!.schema = "unsupported"; }],
    ["unsupported basis", (f: ReturnType<typeof validationDisplayFixture>) => { f.basis.metadata_json!.schema = "unsupported"; }],
  ] satisfies Array<[string, (fixture: ReturnType<typeof validationDisplayFixture>) => void]>)("withholds %s binding", (_name, change) => {
    const fixture = validationDisplayFixture("aequilibrae");
    change(fixture);
    expect(validationAssessmentDisplays(fixture.artifacts)[0].status).toBe("unbound");
  });

  it("requires output identity even when a different output has the same bytes", () => {
    const fixture = validationDisplayFixture("aequilibrae");
    const otherOutput = { ...fixture.output, id: "66666666-1111-4111-8111-000000000001" };
    expect(validationAssessmentDisplays([...fixture.artifacts.filter((row) => row !== fixture.output), otherOutput])[0].status).toBe("unbound");
  });

  it("checks an explicit contracted input hash without treating observation hashes as bundle hashes", () => {
    const fixture = validationDisplayFixture("aequilibrae");
    const exact = fixture.assessment.metadata_json!.exact_inputs as Record<string, unknown>;
    exact.observation_sha256 = ["9".repeat(64)];
    exact.validation_input_bundle_sha256 = fixture.input.content_hash;
    expect(validationAssessmentDisplays(fixture.artifacts)[0].status).toBe("bound");
    exact.validation_input_bundle_sha256 = "8".repeat(64);
    expect(validationAssessmentDisplays(fixture.artifacts)[0].status).toBe("unbound");
  });

  it("keeps filename-only and orphaned records unbound", () => {
    const artifact: ValidationDisplayArtifact = {
      id: "orphan", artifact_type: "model_comparison_basis", file_url: "storage://run-artifacts/activitysim.json", file_size_bytes: 1,
    };
    expect(validationArtifactContext(artifact, [])).toContain("Unbound validation record");
    expect(validationAssessmentDisplays([artifact])).toEqual([]);
  });

  it("does not reinterpret a managed rules-v5 instrument as a legacy output binding", () => {
    const legacy = validationDisplayFixture("aequilibrae");
    const managed: ValidationDisplayArtifact = {
      id: "managed-assessment", artifact_type: "model_validation_assessment_v2",
      file_url: "local:///owned-attempt/assessment-v2.json", file_size_bytes: 200,
      content_hash: "5".repeat(64), metadata_json: { schema: "openplan.model-validation-assessment.v2", demand_method: "activitysim" },
    };
    const displays = validationAssessmentDisplays([...legacy.artifacts, managed]);
    expect(displays).toHaveLength(2);
    expect(displays[0].status).toBe("bound");
    expect(displays[1]).toMatchObject({ status: "unbound", method: "Method unknown", artifact: managed, output: null });
    expect(validationArtifactContext(managed, displays)).toContain("Unbound");
    managed.metadata_json = legacy.assessment.metadata_json;
    expect(validationAssessmentDisplays([...legacy.artifacts.slice(1), managed])[0].status).toBe("unbound");
  });
});
