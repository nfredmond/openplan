import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ModelRunManager, type ModelRunArtifact, type ModelRunStage } from "@/components/models/model-run-manager";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

// The picker mounts Mapbox and has its own tests; here it is scenery.
vi.mock("@/components/models/study-area-picker", () => ({
  StudyAreaPicker: () => <div data-testid="study-area-picker" />,
}));

const MODEL_ID = "11111111-1111-4111-8111-111111111111";

type ManagedRun = React.ComponentProps<typeof ModelRunManager>["modelRuns"][number];

/**
 * A worker-backed run exactly as the model page renders it once the reaper has
 * been through: failed, every stage failed, and no `started_at` anywhere —
 * nothing ever picked it up.
 */
function abandonedAequilibraeRun(id: string): ManagedRun {
  return {
    id,
    status: "failed",
    run_title: "Screening run",
    engine_key: "aequilibrae",
    source_analysis_run_id: null,
    scenario_entry_id: null,
    result_summary_json: null,
    error_message: "No modeling worker picked up this run within 15 minutes.",
    started_at: null,
    completed_at: "2026-07-28T11:20:00Z",
    created_at: "2026-07-28T11:00:00Z",
    stages: [
      { id: `${id}-s1`, stage_name: "AequilibraE Setup", status: "failed", started_at: null, completed_at: null },
      { id: `${id}-s2`, stage_name: "Network Assignment", status: "failed", started_at: null, completed_at: null },
    ] as ModelRunStage[],
    artifacts: [] as ModelRunArtifact[],
  };
}

function executedAequilibraeRun(id: string): ManagedRun {
  return {
    ...abandonedAequilibraeRun(id),
    status: "succeeded",
    started_at: "2026-07-28T11:01:00Z",
    error_message: null,
    stages: [
      {
        id: `${id}-s1`,
        stage_name: "AequilibraE Setup",
        status: "succeeded",
        started_at: "2026-07-28T11:01:00Z",
        completed_at: "2026-07-28T11:05:00Z",
      },
    ] as ModelRunStage[],
  };
}

function renderManager(modelRuns: ManagedRun[]) {
  return render(
    <ModelRunManager
      modelId={MODEL_ID}
      modelTitle="Screening"
      defaultQueryText="Screening run"
      defaultCorridorText='{"type":"Polygon","coordinates":[[[-121.8,38.5],[-121.7,38.5],[-121.7,38.6],[-121.8,38.5]]]}'
      scenarioEntries={[]}
      modelRuns={modelRuns}
      schemaPending={false}
    />
  );
}

function selectRunMode(value: string) {
  fireEvent.change(screen.getByLabelText(/Run mode/i), { target: { value } });
}

describe("launching a worker-backed run where nothing is processing runs", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not send the launch request at all", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ modelRunId: "r", status: "queued" }) }));
    vi.stubGlobal("fetch", fetchMock);

    renderManager([abandonedAequilibraeRun("run-1")]);
    selectRunMode("aequilibrae");

    fireEvent.click(screen.getByRole("button", { name: /Launch refused/i }));

    // The whole point: no run row, no queued stages, no 201 that becomes a
    // failure fifteen minutes later.
    await waitFor(() => expect(screen.getByTestId("worker-launch-refusal")).toBeInTheDocument());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("names the missing worker and the deployment operator, and offers no upgrade", () => {
    renderManager([abandonedAequilibraeRun("run-1")]);
    selectRunMode("aequilibrae");

    const refusal = screen.getByTestId("worker-launch-refusal");
    expect(refusal).toHaveTextContent(/does not run inside OpenPlan/i);
    expect(refusal).toHaveTextContent(/AequilibraE worker/i);
    expect(refusal).toHaveTextContent(/workers\/aequilibrae_worker\/DEPLOY\.md/);
    // A refusal may never point at a plan, a tier, or a payment: there are
    // none. (The word "plan" itself is unusable as a signal here — "OpenPlan"
    // contains it — so this matches the commercial vocabulary specifically.)
    expect(refusal.textContent ?? "").not.toMatch(
      /upgrade|subscription|billing|pricing|paid tier|plan tier|contact sales/i
    );
  });

  it("states the evidence it has, not a verdict about the operator's infrastructure", () => {
    renderManager([abandonedAequilibraeRun("run-1"), abandonedAequilibraeRun("run-2")]);
    selectRunMode("aequilibrae");

    const refusal = screen.getByTestId("worker-launch-refusal");
    expect(refusal).toHaveTextContent(/The last 2 worker-backed runs on this model were queued and never started/i);
  });

  it("hands the planner the run modes that do execute here", () => {
    renderManager([abandonedAequilibraeRun("run-1")]);
    selectRunMode("aequilibrae");

    fireEvent.click(screen.getByRole("button", { name: /Switch to Trip Generation/i }));

    // Switching lands on an engine that runs in-process, so the refusal is gone
    // and the launch button is live again.
    expect(screen.queryByTestId("worker-launch-refusal")).toBeNull();
    expect(screen.getByRole("button", { name: /Launch managed run/i })).toHaveProperty("disabled", false);
  });

  it("lets the planner launch once they say a worker has been started", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ modelRunId: "r", status: "queued" }) }));
    vi.stubGlobal("fetch", fetchMock);

    renderManager([abandonedAequilibraeRun("run-1")]);
    selectRunMode("aequilibrae");

    fireEvent.click(screen.getByRole("checkbox", { name: /worker has been started on this deployment/i }));
    fireEvent.click(screen.getByRole("button", { name: /Launch managed run/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, { body: string }];
    expect(JSON.parse(init.body).engineKey).toBe("aequilibrae");
  });

  it("does not refuse an in-process engine, which needs no worker", () => {
    renderManager([abandonedAequilibraeRun("run-1")]);

    // Default engine is the deterministic corridor lane.
    expect(screen.queryByTestId("worker-launch-refusal")).toBeNull();
    selectRunMode("sketch_abm");
    expect(screen.queryByTestId("worker-launch-refusal")).toBeNull();
  });

  it("does not refuse when the last worker-backed run was actually executed", () => {
    renderManager([executedAequilibraeRun("run-1")]);
    selectRunMode("aequilibrae");

    expect(screen.queryByTestId("worker-launch-refusal")).toBeNull();
    expect(screen.getByRole("button", { name: /Launch managed run/i })).toHaveProperty("disabled", false);
  });

  it("does not refuse a model that has never run a worker-backed engine", () => {
    renderManager([]);
    selectRunMode("aequilibrae");

    expect(screen.queryByTestId("worker-launch-refusal")).toBeNull();
  });
});

describe("the in-app sketch lane's dependence on the same worker", () => {
  it("says a study area over the zone cap is handed to the worker queue", () => {
    renderManager([]);
    selectRunMode("sketch_abm");

    expect(screen.getByText(/handed to the AequilibraE worker queue/i)).toBeInTheDocument();
  });

  it("warns when a rerouted run lands on a queue nothing has been servicing", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        modelRunId: "r",
        status: "queued",
        engineKey: "aequilibrae",
        reroutedFrom: "sketch_abm",
        reason: "large_study_area",
        notice: "Study area resolves to 412 census tracts; this run was routed to the worker.",
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    renderManager([abandonedAequilibraeRun("run-1")]);
    selectRunMode("sketch_abm");
    fireEvent.click(screen.getByRole("button", { name: /Launch managed run/i }));

    // The server's own notice reads as "expect a longer runtime". With runs
    // already abandoned on that queue, presenting it that calmly would be the
    // same false reassurance in a different place.
    const notice = await screen.findByText(/served by the AequilibraE worker, not by this app/i);
    expect(notice).toHaveTextContent(/sit queued and then be failed rather than finishing/i);
  });
});
