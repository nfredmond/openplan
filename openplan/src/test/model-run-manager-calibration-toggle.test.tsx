import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ModelRunManager, type ModelRunStage, type ModelRunArtifact } from "@/components/models/model-run-manager";
import { modelingClaimStatusLabel, type ModelingClaimStatus } from "@/lib/models/evidence-backbone";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

// The study-area picker mounts Mapbox; stub it out for this unit test.
vi.mock("@/components/models/study-area-picker", () => ({
  StudyAreaPicker: () => <div data-testid="study-area-picker" />,
}));

const MODEL_ID = "11111111-1111-4111-8111-111111111111";

function renderManager() {
  return render(
    <ModelRunManager
      modelId={MODEL_ID}
      modelTitle="Davis screening"
      defaultQueryText="Screening run"
      defaultCorridorText='{"type":"Polygon","coordinates":[[[-121.8,38.5],[-121.7,38.5],[-121.7,38.6],[-121.8,38.5]]]}'
      scenarioEntries={[]}
      modelRuns={[]}
      schemaPending={false}
    />
  );
}

function selectRunMode(value: string) {
  fireEvent.change(screen.getByLabelText(/Run mode/i), { target: { value } });
}

// Matches the checkbox by what it OFFERS rather than by a phrase, so a
// rewording does not read as a missing control.
const CALIBRATION_LABEL = /Tune the assignment to local traffic counts/i;

describe("ModelRunManager per-run calibration toggle", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("hides the calibration checkbox for engines that cannot calibrate", () => {
    renderManager();
    // Default engine is the deterministic corridor engine — no calibration.
    expect(screen.queryByRole("checkbox", { name: CALIBRATION_LABEL })).toBeNull();
  });

  it("shows an honest calibration checkbox for aequilibrae and behavioral_demand", () => {
    renderManager();

    selectRunMode("aequilibrae");
    const box = screen.getByRole("checkbox", { name: CALIBRATION_LABEL });
    expect(box).toBeInTheDocument();
    // HONEST COPY: it discloses the tier and the CEQA boundary. Both claims are
    // load-bearing and both survived the 2026-08-07 rewording — what changed is
    // that the tier is now named in the planner's words rather than the
    // database's, and by the SAME function that labels it on the run itself, so
    // the two surfaces cannot drift into calling one thing two names.
    expect(
      screen.getByText(modelingClaimStatusLabel("calibrated_to_counts"))
    ).toBeInTheDocument();
    expect(screen.getByText(/CEQA VMT input is unchanged/i)).toBeInTheDocument();

    selectRunMode("behavioral_demand");
    expect(screen.getByRole("checkbox", { name: CALIBRATION_LABEL })).toBeInTheDocument();
  });

  it("sends calibrate:true in the launch payload when checked", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ modelRunId: "r", status: "queued" }) }));
    vi.stubGlobal("fetch", fetchMock);

    renderManager();
    selectRunMode("aequilibrae");
    fireEvent.click(screen.getByRole("checkbox", { name: CALIBRATION_LABEL }));
    fireEvent.click(screen.getByRole("button", { name: /Launch run/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, { body: string }];
    const body = JSON.parse(init.body) as { engineKey: string; calibrate?: boolean };
    expect(body.engineKey).toBe("aequilibrae");
    expect(body.calibrate).toBe(true);
  });

  it("sends calibrate:false when left unchecked (per-run opt-out beats the worker env)", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ modelRunId: "r", status: "queued" }) }));
    vi.stubGlobal("fetch", fetchMock);

    renderManager();
    selectRunMode("aequilibrae");
    fireEvent.click(screen.getByRole("button", { name: /Launch run/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, { body: string }];
    const body = JSON.parse(init.body) as { calibrate?: boolean };
    expect(body.calibrate).toBe(false);
  });

  // Integration guard for the honesty fix (commit 3c51b609): the run's REAL claim
  // tier must survive the page → manager → panel prop threading, not just render
  // when injected straight into the panel.
  it("threads a run's real claim tier through to the evidence panel badge", async () => {
    // The evidence panel fetches its packet on "Inspect evidence".
    const packet = {
      engine: "behavioral_demand",
      provenance: { engine_version: "aeq-1.6.2" },
      inputs: { zone_count: 42 },
      assumptions: {},
      caveats: [],
    };
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => packet })));

    const run = {
      id: "33333333-3333-4333-8333-333333333333",
      status: "succeeded",
      run_title: "Davis calibrated run",
      // behavioral_demand (not aequilibrae) so no sibling CEQA/map panels mount.
      engine_key: "behavioral_demand",
      source_analysis_run_id: null,
      scenario_entry_id: null,
      result_summary_json: null,
      error_message: null,
      started_at: null,
      completed_at: null,
      created_at: null,
      stages: [] as ModelRunStage[],
      artifacts: [] as ModelRunArtifact[],
      // The recorded decision, tier AND reason. The reason travels with the
      // tier so the panel can say WHY a run carries it — three unrelated
      // findings otherwise share one badge.
      claimDecision: {
        status: "calibrated_to_counts" as ModelingClaimStatus,
        reason: "Model calibrated to observed counts (6 fit / 3 holdout stations).",
      },
    };

    render(
      <ModelRunManager
        modelId={MODEL_ID}
        modelTitle="Davis screening"
        defaultQueryText="Screening run"
        defaultCorridorText=""
        scenarioEntries={[]}
        modelRuns={[run]}
        schemaPending={false}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /inspect evidence/i }));
    const block = await screen.findByTestId("evidence-run-honesty");
    expect(block).toHaveTextContent(modelingClaimStatusLabel("calibrated_to_counts"));
    expect(block).not.toHaveTextContent("Uncalibrated by default");
    // ...and the recorded justification threads through with it.
    expect(screen.getByTestId("evidence-claim-status-reason")).toHaveTextContent(
      "6 fit / 3 holdout stations"
    );
  });
});
