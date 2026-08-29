import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ModelRunManager, type ModelRunArtifact, type ModelRunStage } from "@/components/models/model-run-manager";

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
          rules_version: 4,
          scientific_outcome: "inconclusive",
          planning_use: "unknown",
          partition: { kind: "unpartitioned", id: "unknown" },
          coverage: { matched: 3, ambiguous: 1, unloaded: 2, grade_d: 1 },
          reasons: ["Same-basis day and vehicle units were not established."],
          exact_inputs: {
            comparison_basis_sha256: "a".repeat(64),
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
    ]));

    const panel = screen.getByRole("region", { name: "Scientific model validation assessment" });
    expect(panel).toHaveTextContent("inconclusive");
    expect(panel).toHaveTextContent("No validation claim is allowed");
    expect(panel).toHaveTextContent("matched: 3");
    expect(panel).toHaveTextContent("ambiguous: 1");
    expect(panel).toHaveTextContent("aaaaaaaaaaaa");
    expect(panel).toHaveTextContent("bbbbbbbbbbbb");
    expect(panel).toHaveTextContent("network dddddddddddd");
    expect(panel).toHaveTextContent("observations eeeeeeeeeeee");
    expect(panel).toHaveTextContent("pre-volume audit ffffffffffff");
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
    expect(screen.getAllByRole("link", { name: "View / Download" })).toHaveLength(2);
  });

  it("shows custody failure as scientifically unchecked", () => {
    renderRun(runWithArtifacts([], "Validation evidence write failed. Exact artifacts were not recorded."));
    const panel = screen.getByRole("region", { name: "Scientific model validation assessment" });
    expect(panel).toHaveTextContent("Validation evidence write failed");
    expect(panel).toHaveTextContent("scientifically unchecked");
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
    expect(screen.getByRole("link", { name: "Download exact input audit" })).toHaveAttribute(
      "href", `/api/models/${MODEL_ID}/runs/33333333-3333-4333-8333-333333333333/artifacts/input-audit-v1/download`,
    );
    expect(screen.getByRole("link", { name: "Download exact v3 diagnosis" })).toHaveAttribute(
      "href", `/api/models/${MODEL_ID}/runs/33333333-3333-4333-8333-333333333333/artifacts/diagnosis-v3/download`,
    );
  });

  it("marks a partial custody pair scientifically unchecked", () => {
    renderRun(runWithArtifacts([audit]));
    expect(screen.getByRole("region", { name: "Structural demand custody failure" })).toHaveTextContent(
      "scientifically unchecked",
    );
  });
});
