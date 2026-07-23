import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ModelRunManager } from "@/components/models/model-run-manager";

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

const CALIBRATION_LABEL = /Attempt count calibration/i;

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
    // Honest copy: discloses the tier and the CEQA boundary.
    expect(screen.getByText(/calibrated_to_counts/i)).toBeInTheDocument();
    expect(screen.getByText(/leaves\s+the CEQA VMT input unchanged/i)).toBeInTheDocument();

    selectRunMode("behavioral_demand");
    expect(screen.getByRole("checkbox", { name: CALIBRATION_LABEL })).toBeInTheDocument();
  });

  it("sends calibrate:true in the launch payload when checked", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ modelRunId: "r", status: "queued" }) }));
    vi.stubGlobal("fetch", fetchMock);

    renderManager();
    selectRunMode("aequilibrae");
    fireEvent.click(screen.getByRole("checkbox", { name: CALIBRATION_LABEL }));
    fireEvent.click(screen.getByRole("button", { name: /Launch managed run/i }));

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
    fireEvent.click(screen.getByRole("button", { name: /Launch managed run/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, { body: string }];
    const body = JSON.parse(init.body) as { calibrate?: boolean };
    expect(body.calibrate).toBe(false);
  });
});
