import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ModelRunManager, type ModelRunArtifact, type ModelRunStage } from "@/components/models/model-run-manager";
import { validationDisplayFixture } from "@/test/fixtures/modeling/validation-display";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@/components/models/study-area-picker", () => ({
  StudyAreaPicker: () => <div data-testid="study-area-picker" />,
}));

const MODEL_ID = "11111111-1111-4111-8111-111111111111";

function runWithArtifacts(artifacts: ModelRunArtifact[], reason: string | null = null) {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    status: "succeeded",
    run_title: "Baseline validation run",
    engine_key: "behavioral_demand",
    source_analysis_run_id: null,
    scenario_entry_id: null,
    result_summary_json: null,
    error_message: null,
    started_at: "2026-08-28T01:00:00Z",
    completed_at: "2026-08-28T01:05:00Z",
    created_at: "2026-08-28T01:00:00Z",
    stages: [] as ModelRunStage[],
    artifacts,
    claimDecision: reason ? { status: "prototype_only" as const, reason } : null,
  };
}

function renderRun(run: ReturnType<typeof runWithArtifacts>) {
  render(
    <ModelRunManager
      modelId={MODEL_ID}
      modelTitle="Validation model"
      defaultQueryText="Baseline"
      defaultCorridorText=""
      scenarioEntries={[]}
      modelRuns={[run]}
      schemaPending={false}
    />,
  );
}

describe("rules-v4 assessment surface", () => {
  it("shows an honest inconclusive assessment and immutable hashes", () => {
    renderRun(runWithArtifacts([
      {
        id: "assessment-artifact",
        artifact_type: "model_validation_assessment",
        file_url: "storage://run-artifacts/assessment.json",
        file_size_bytes: 2048,
        content_hash: "c".repeat(64),
        metadata_json: {
          schema: "openplan.model-validation-assessment.v1",
          comparison_basis_sha256: "a".repeat(64),
          rules_version: 4,
          scientific_outcome: "inconclusive",
          planning_use: "unknown",
          partition: { kind: "unpartitioned", id: "unknown" },
          coverage: { matched: 3, ambiguous: 1, unloaded: 2, grade_d: 1 },
          reasons: ["Same-basis day and vehicle units were not established."],
          exact_inputs: {
            comparison_basis_sha256: "a".repeat(64),
            model_output_artifact_id: "output-artifact",
            model_output_sha256: "b".repeat(64),
            network_state_hashes: {
              network: "d".repeat(64),
              observation_package: "e".repeat(64),
              pre_volume_match_audit: "f".repeat(64),
            },
          },
        },
      },
      {
        id: "diagnosis-artifact",
        artifact_type: "model_validation_structural_diagnosis",
        file_url: "storage://run-artifacts/structural-diagnosis.json",
        file_size_bytes: 4096,
        content_hash: "9".repeat(64),
        metadata_json: {
          schema: "openplan.model-validation-structural-diagnosis.v1",
          diagnosis_sha256: "9".repeat(64),
          assessment_sha256: "c".repeat(64),
          scientific_outcome: "inconclusive",
          method_aggregation: "separate",
          unknown_facts: ["model_year", "day_basis", "population_vintage", "coefficients"],
          findings: [
            {
              category: "matching",
              count: 12,
              statement: "A nearby network link lacked the name or facility evidence required by the frozen matcher.",
            },
            {
              category: "network_loading",
              count: 2,
              statement: "Recorded zero-volume matched links remain unloaded.",
            },
          ],
        },
      },
      {
        id: "output-artifact", artifact_type: "link_volumes", file_url: "storage://run-artifacts/output.csv",
        file_size_bytes: 100, content_hash: "b".repeat(64),
      },
      {
        id: "basis-artifact", artifact_type: "model_comparison_basis", file_url: "storage://run-artifacts/basis.json",
        file_size_bytes: 100, content_hash: "a".repeat(64), metadata_json: { schema: "openplan.model-comparison-basis.v1" },
      },
      {
        id: "input-artifact", artifact_type: "validation_input_bundle", file_url: "storage://run-artifacts/input.json",
        file_size_bytes: 100, content_hash: "7".repeat(64),
        metadata_json: { schema: "openplan.validation-input-bundle.v1", comparison_basis_sha256: "a".repeat(64) },
      },
    ]));

    const panel = screen.getByRole("region", { name: /^Scientific model validation assessment: AequilibraE assignment/ });
    expect(within(panel).getByText("Recorded outcome: inconclusive", { exact: true })).toHaveAttribute("data-tone", "info");
    expect(panel).toHaveTextContent("This is recorded assessment data");
    expect(panel).toHaveTextContent("Scientific validity and downloaded bytes remain unverified");
    expect(panel).toHaveTextContent("No validation claim is allowed");
    expect(panel).toHaveTextContent("matched: 3");
    expect(panel).toHaveTextContent("ambiguous: 1");
    expect(panel).toHaveTextContent("a".repeat(64));
    expect(panel).toHaveTextContent("b".repeat(64));
    expect(panel).toHaveTextContent(`network ${"d".repeat(64)}`);
    expect(panel).toHaveTextContent(`observations ${"e".repeat(64)}`);
    expect(panel).toHaveTextContent(`pre-volume audit ${"f".repeat(64)}`);
    expect(panel).toHaveClass("min-w-0", "max-w-full");
    expect(panel.parentElement).toHaveClass("min-w-0", "max-w-full");
    expect(panel.querySelector("dl")).toHaveClass("min-w-0", "grid-cols-1");
    const diagnosis = screen.getByRole("region", { name: "Why this model validation is inconclusive" });
    expect(diagnosis).toHaveTextContent("Why this is inconclusive");
    expect(diagnosis).toHaveTextContent("12 · A nearby network link lacked the name or facility evidence");
    expect(diagnosis).toHaveTextContent("2 · Recorded zero-volume matched links remain unloaded");
    expect(diagnosis).toHaveTextContent("model_year, day_basis, population_vintage, coefficients");
    expect(diagnosis).toHaveTextContent("9".repeat(64));
    expect(screen.getByRole("link", { name: "Download exact structural diagnosis" })).toHaveAttribute(
      "href",
      `/api/models/${MODEL_ID}/runs/33333333-3333-4333-8333-333333333333/artifacts/diagnosis-artifact/download`,
    );
    expect(screen.getAllByRole("link", { name: /^View \/ Download / })).toHaveLength(5);
  });

  it("shows custody failure as scientifically unchecked", () => {
    renderRun(runWithArtifacts([], "Validation evidence write failed. Exact artifacts were not recorded."));
    const panel = screen.getByRole("region", { name: "Scientific model validation assessment" });
    expect(panel).toHaveTextContent("Validation evidence write failed");
    expect(panel).toHaveTextContent("scientifically unchecked");
  });
});

describe("separate method assessment panels", () => {
  it.each([false, true])("shows conflicting outcomes and exact downloads in either order, reversed=%s", (reverse) => {
    const aeq = validationDisplayFixture("aequilibrae", "pass");
    const asim = validationDisplayFixture("activitysim", "fail");
    const artifacts = [...aeq.artifacts, ...asim.artifacts];
    renderRun(runWithArtifacts(reverse ? artifacts.reverse() : artifacts));
    expect(screen.getAllByRole("region", { name: /^Scientific model validation assessment:/ })).toHaveLength(2);
    for (const fixture of [aeq, asim]) {
      const panel = screen.getByRole("region", { name: new RegExp(`assessment ${fixture.assessment.id}$`) });
      const view = within(panel);
      expect(panel).toHaveTextContent("Binding: bound");
      expect(view.getByText(`Recorded outcome: ${fixture.assessment.metadata_json!.scientific_outcome}`, { exact: true })).toHaveAttribute("data-tone", "info");
      expect(panel).toHaveTextContent("This is recorded assessment data. This panel checks metadata association only.");
      expect(panel).toHaveTextContent("Scientific validity and downloaded bytes remain unverified. No validation claim is allowed.");
      expect(view.getByText("Coverage").parentElement).toHaveTextContent("unknown");
      const other = fixture === aeq ? asim : aeq;
      expect(view.queryByText(`Recorded outcome: ${other.assessment.metadata_json!.scientific_outcome}`, { exact: true })).toBeNull();
      expect(panel).not.toHaveTextContent(other.output.id);
      for (const reason of fixture.assessment.metadata_json!.reasons as string[]) expect(panel).toHaveTextContent(reason);
      expect(panel).toHaveTextContent(fixture.output.id);
      expect(panel).toHaveTextContent(fixture.output.content_hash!);
      expect(panel).toHaveTextContent("Model agreement is sensitivity evidence, not accuracy");
      expect(view.getAllByRole("link", { name: /^Download / })).toHaveLength(4);
      for (const artifact of fixture.artifacts) {
        expect(view.getByRole("link", { name: new RegExp(`artifact ${artifact.id}$`) })).toHaveAttribute(
          "href", `/api/models/${MODEL_ID}/runs/33333333-3333-4333-8333-333333333333/artifacts/${artifact.id}/download`,
        );
        expect(panel).toHaveTextContent(artifact.content_hash!);
        const generic = screen.getByRole("link", { name: new RegExp(`^View / Download .*artifact ${artifact.id}$`) });
        expect(generic).toHaveAccessibleName(new RegExp(fixture.output.id));
      }
    }
    expect(screen.getByRole("heading", { name: "AequilibraE assignment" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "ActivitySim behavioral demand with AequilibraE assignment" })).toBeInTheDocument();
  });

  it.each(["storage", "local"] as const)("retains single AequilibraE compatibility with %s artifact references", (storage) => {
    const fixture = validationDisplayFixture("aequilibrae", "inconclusive", storage);
    renderRun({ ...runWithArtifacts(fixture.artifacts), engine_key: "aequilibrae" });
    const panel = screen.getByRole("region", { name: /^Scientific model validation assessment: AequilibraE assignment/ });
    expect(panel).toHaveTextContent("Binding: bound");
    expect(within(panel).getByText("Recorded outcome: inconclusive", { exact: true })).toHaveAttribute("data-tone", "info");
    expect(within(panel).getByText("Coverage").parentElement).toHaveTextContent("unknown");
    expect(panel).not.toHaveTextContent("matched: 0");
  });

  it("keeps an absent outcome unknown", () => {
    const fixture = validationDisplayFixture("aequilibrae");
    delete fixture.assessment.metadata_json!.scientific_outcome;
    renderRun(runWithArtifacts(fixture.artifacts));
    const panel = screen.getByRole("region", { name: /^Scientific model validation assessment:/ });
    expect(within(panel).getByText("Recorded outcome: unknown", { exact: true })).toHaveAttribute("data-tone", "info");
    expect(within(panel).queryByText("Recorded outcome: inconclusive", { exact: true })).toBeNull();
  });

  it.each([
    { label: "pass array", outcome: ["pass"] },
    { label: "fail array", outcome: ["fail"] },
    { label: "inconclusive array", outcome: ["inconclusive"] },
    { label: "object", outcome: { scientific_outcome: "pass" } },
    { label: "null", outcome: null },
    { label: "unknown string", outcome: "unknown-result" },
    { label: "padded string", outcome: " pass " },
    { label: "case mismatch", outcome: "PASS" },
    { label: "number", outcome: 1 },
    { label: "boolean", outcome: true },
  ])("keeps malformed or unrecognized $label outcomes unknown without changing the binding", ({ outcome }) => {
    const fixture = validationDisplayFixture("aequilibrae");
    fixture.assessment.metadata_json!.scientific_outcome = outcome;
    renderRun(runWithArtifacts(fixture.artifacts));
    const panel = screen.getByRole("region", { name: new RegExp(`assessment ${fixture.assessment.id}$`) });
    const view = within(panel);
    expect(panel).toHaveTextContent("Binding: bound");
    expect(view.getByText("Recorded outcome: unknown", { exact: true })).toHaveAttribute("data-tone", "info");
    for (const known of ["pass", "fail", "inconclusive"]) {
      expect(view.queryByText(`Recorded outcome: ${known}`, { exact: true })).toBeNull();
    }
    expect(panel).toHaveTextContent("This is recorded assessment data. This panel checks metadata association only.");
    expect(panel).toHaveTextContent("Scientific validity and downloaded bytes remain unverified. No validation claim is allowed.");
    for (const artifact of fixture.artifacts) {
      expect(view.getByRole("link", { name: new RegExp(`artifact ${artifact.id}$`) })).toHaveAttribute(
        "href", `/api/models/${MODEL_ID}/runs/33333333-3333-4333-8333-333333333333/artifacts/${artifact.id}/download`,
      );
      expect(panel).toHaveTextContent(artifact.content_hash!);
    }
  });

  it.each(["missing", "ambiguous", "mismatched", "unsupported"])("shows %s bindings as unchecked with retained artifact controls", (condition) => {
    const fixture = validationDisplayFixture("activitysim", "pass");
    let artifacts = fixture.artifacts;
    if (condition === "missing") fixture.assessment.metadata_json = null;
    if (condition === "mismatched") fixture.output.content_hash = "9".repeat(64);
    if (condition === "unsupported") fixture.assessment.metadata_json!.rules_version = 3;
    if (condition === "ambiguous") artifacts = [...artifacts, { ...fixture.input, id: "second-input" }];
    renderRun(runWithArtifacts(artifacts));
    const panel = screen.getByRole("region", { name: /^Scientific model validation assessment:/ });
    expect(panel).toHaveTextContent("scientifically unchecked");
    expect(panel).toHaveTextContent("No validation claim is allowed");
    expect(panel).toHaveTextContent(condition === "ambiguous" ? "Binding: ambiguous" : "Binding: unbound");
    expect(panel).toHaveTextContent("Scientific validity and downloaded bytes remain unverified");
    expect(within(panel).getByText("scientifically unchecked", { exact: true })).toHaveAttribute("data-tone", "warning");
    expect(panel).toHaveTextContent(`Recorded outcome: ${condition === "missing" ? "unknown" : "pass"}`);
    expect(screen.getByRole("link", { name: new RegExp(`^View / Download .*artifact ${fixture.assessment.id}$`) })).toHaveAccessibleName(/Unbound/);
  });

  it("keeps diagnosis metadata with its exact assessment rather than the first method", () => {
    const aeq = validationDisplayFixture("aequilibrae");
    const asim = validationDisplayFixture("activitysim");
    const diagnosis: ModelRunArtifact = {
      id: "diagnosis-for-asim", artifact_type: "model_validation_structural_diagnosis",
      file_url: "storage://run-artifacts/diagnosis.json", file_size_bytes: 1024, content_hash: "9".repeat(64),
      metadata_json: { schema: "openplan.model-validation-structural-diagnosis.v1", assessment_sha256: asim.assessment.content_hash,
        scientific_outcome: "inconclusive", findings: [], unknown_facts: ["model_year"] },
    };
    renderRun(runWithArtifacts([...aeq.artifacts, ...asim.artifacts, diagnosis]));
    const aeqPanel = screen.getByRole("region", { name: new RegExp(`assessment ${aeq.assessment.id}$`) });
    const asimPanel = screen.getByRole("region", { name: new RegExp(`assessment ${asim.assessment.id}$`) });
    expect(within(aeqPanel).queryByRole("region", { name: "Why this model validation is inconclusive" })).toBeNull();
    expect(within(asimPanel).getByRole("region", { name: "Why this model validation is inconclusive" })).toHaveTextContent("model_year");
  });

  it("retains managed instrument downloads without borrowing a legacy assessment outcome", () => {
    const legacy = validationDisplayFixture("aequilibrae", "pass");
    const managed: ModelRunArtifact = {
      id: "managed-assessment", artifact_type: "model_validation_assessment_v2",
      file_url: "local:///owned-attempt/assessment-v2.json", file_size_bytes: 200,
      content_hash: "5".repeat(64), metadata_json: { schema: "openplan.model-validation-assessment.v2", demand_method: "activitysim" },
    };
    renderRun(runWithArtifacts([...legacy.artifacts, managed]));
    const panel = screen.getByRole("region", { name: /assessment managed-assessment$/ });
    expect(panel).toHaveTextContent("Binding: unbound");
    expect(panel).toHaveTextContent("scientifically unchecked");
    expect(panel).toHaveTextContent("Recorded outcome: unknown");
    expect(within(panel).getByRole("link", { name: /artifact managed-assessment$/ })).toHaveAttribute(
      "href", `/api/models/${MODEL_ID}/runs/33333333-3333-4333-8333-333333333333/artifacts/managed-assessment/download`,
    );
  });
});

describe("structural demand custody surface", () => {
  const audit = {
    id: "input-audit-v1",
    artifact_type: "model_structural_input_audit_v1",
    file_url: "storage://run-artifacts/input-audit.json",
    file_size_bytes: 1024,
    content_hash: "1".repeat(64),
    metadata_json: { schema: "openplan.model-structural-input-audit.v1", method: "aequilibrae" },
  } satisfies ModelRunArtifact;
  const diagnosis = {
    id: "diagnosis-v3",
    artifact_type: "model_validation_structural_diagnosis_v3",
    file_url: "storage://run-artifacts/diagnosis-v3.json",
    file_size_bytes: 2048,
    content_hash: "2".repeat(64),
    metadata_json: { schema: "openplan.model-validation-structural-diagnosis.v3", method: "aequilibrae" },
  } satisfies ModelRunArtifact;

  it("shows the exact pair as inconclusive structural coverage", () => {
    renderRun(runWithArtifacts([audit, diagnosis]));
    const panel = screen.getByRole("region", { name: "Structural demand and loading diagnosis" });
    expect(panel).toHaveTextContent("does not show improved accuracy");
    expect(panel).toHaveTextContent("remain separate");
    expect(screen.getByRole("link", { name: "Download exact before-output check" })).toHaveAttribute(
      "href", `/api/models/${MODEL_ID}/runs/33333333-3333-4333-8333-333333333333/artifacts/input-audit-v1/download`,
    );
    expect(screen.getByRole("link", { name: "Download exact v3 diagnosis" })).toHaveAttribute(
      "href", `/api/models/${MODEL_ID}/runs/33333333-3333-4333-8333-333333333333/artifacts/diagnosis-v3/download`,
    );
  });

  it("marks a partial custody pair scientifically unchecked", () => {
    renderRun(runWithArtifacts([audit]));
    const region = screen.getByRole("region", { name: "Structural demand diagnosis not saved" });
    expect(region).toHaveTextContent("scientifically unchecked");
    // The claim boundary survives the plainer wording.
    expect(region).toHaveTextContent("cannot support a structural diagnosis claim");
  });
});
