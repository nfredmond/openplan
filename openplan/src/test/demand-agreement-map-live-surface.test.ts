import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ModelRunArtifact,
  ModelRunStage,
} from "@/components/models/model-run-manager";

const { agreementMapProps } = vi.hoisted(() => ({ agreementMapProps: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@/components/models/study-area-picker", () => ({
  StudyAreaPicker: () => React.createElement("div", { "data-testid": "study-area-picker" }),
}));

vi.mock("@/components/models/model-run-headline-answer", () => ({
  ModelRunHeadlineAnswer: () => null,
}));

vi.mock("next/dynamic", async () => {
  const ReactModule = await import("react");
  let callIndex = 0;
  return {
    default: () => {
      const componentIndex = callIndex;
      callIndex += 1;
      if (componentIndex !== 1) return () => null;
      return (props: { geojsonUrl: string }) => {
        agreementMapProps(props);
        return ReactModule.createElement("div", {
          "data-testid": "rendered-demand-agreement-map",
          "data-geojson-url": props.geojsonUrl,
        });
      };
    },
  };
});

import { ModelRunManager } from "@/components/models/model-run-manager";

const MODEL_ID = "11111111-1111-4111-8111-111111111111";

function behavioralRun(id: string, title: string, withAgreement = true) {
  return {
    id,
    status: "succeeded",
    run_title: title,
    engine_key: "behavioral_demand",
    source_analysis_run_id: null,
    scenario_entry_id: null,
    result_summary_json: null,
    error_message: null,
    started_at: null,
    completed_at: null,
    created_at: null,
    stages: [] as ModelRunStage[],
    artifacts: (withAgreement
      ? [
          {
            id: `${id}-artifact`,
            artifact_type: "demand_model_agreement_geojson",
            file_url: "storage://run-artifacts/example",
            file_size_bytes: 100,
          },
        ]
      : []) as ModelRunArtifact[],
  };
}

function renderManager(modelRuns: ReturnType<typeof behavioralRun>[]) {
  return render(
    React.createElement(ModelRunManager, {
      modelId: MODEL_ID,
      modelTitle: "Any-place model",
      defaultQueryText: "Screening run",
      defaultCorridorText: "",
      scenarioEntries: [],
      modelRuns,
      schemaPending: false,
    })
  );
}

describe("behavioral demand agreement map live surface", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("mounts the newest eligible run through its run-scoped authenticated URL", () => {
    const newestId = "22222222-2222-4222-8222-222222222222";
    const olderId = "33333333-3333-4333-8333-333333333333";
    renderManager([
      behavioralRun(newestId, "Newest complete comparison"),
      behavioralRun(olderId, "Older complete comparison"),
    ]);

    const map = screen.getByTestId("rendered-demand-agreement-map");
    expect(map).toHaveAttribute(
      "data-geojson-url",
      `/api/models/${MODEL_ID}/runs/${newestId}/agreement`
    );
    expect(
      screen.getByRole("heading", {
        name: "Demand-method sensitivity from Newest complete comparison",
      })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", {
        name: "Demand-method sensitivity from Older complete comparison",
      })
    ).toBeNull();
    expect(agreementMapProps).toHaveBeenCalledTimes(1);
  });

  it("does not mount a map from a run that has no agreement artifact", () => {
    renderManager([
      behavioralRun("22222222-2222-4222-8222-222222222222", "No comparison", false),
    ]);
    expect(screen.queryByTestId("rendered-demand-agreement-map")).toBeNull();
    expect(agreementMapProps).not.toHaveBeenCalled();
  });
});
