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
    expect(screen.getByRole("link", { name: "View / Download" })).toHaveAttribute(
      "href",
      `/api/models/${MODEL_ID}/runs/33333333-3333-4333-8333-333333333333/artifacts/assessment-artifact/download`,
    );
  });

  it("shows custody failure as scientifically unchecked", () => {
    renderRun(runWithArtifacts([], "Validation evidence write failed. Exact artifacts were not recorded."));
    const panel = screen.getByRole("region", { name: "Scientific model validation assessment" });
    expect(panel).toHaveTextContent("Validation evidence write failed");
    expect(panel).toHaveTextContent("scientifically unchecked");
  });
});
