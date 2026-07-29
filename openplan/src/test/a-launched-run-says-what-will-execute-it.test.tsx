/**
 * After launching a worker-backed run, the planner is told what has it.
 *
 * The gap this closes is the one a planner most feels. A run accepted by a
 * worker, a run waiting for a poller that may or may not exist, and a run on a
 * deployment where nothing will ever look at it were rendered IDENTICALLY —
 * "queued" — and the difference between them only surfaced fifteen minutes
 * later, as a reaper failure with no cause a planner could act on.
 *
 * This is the reachability seam, not the unit. `describeModelRunDispatch` is
 * unit-tested in model-run-push-reaches-a-configured-worker.test.ts; what is
 * asserted here is that the route's answer travels through the component and
 * reaches a screen — the exact link that has broken repeatedly in this repo,
 * where a complete, tested capability was rendered by nothing.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ModelRunManager } from "@/components/models/model-run-manager";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

// The picker mounts Mapbox and has its own tests; here it is scenery.
vi.mock("@/components/models/study-area-picker", () => ({
  StudyAreaPicker: () => <div data-testid="study-area-picker" />,
}));

const MODEL_ID = "11111111-1111-4111-8111-111111111111";

type Declaration = NonNullable<
  React.ComponentProps<typeof ModelRunManager>["modelingWorkerDeclaration"]
>;

function renderManager(declaration: Declaration = "undeclared") {
  return render(
    <ModelRunManager
      modelId={MODEL_ID}
      modelTitle="Screening"
      defaultQueryText="Screening run"
      defaultCorridorText='{"type":"Polygon","coordinates":[[[-121.8,38.5],[-121.7,38.5],[-121.7,38.6],[-121.8,38.5]]]}'
      scenarioEntries={[]}
      modelRuns={[]}
      schemaPending={false}
      modelingWorkerDeclaration={declaration}
    />
  );
}

function stubLaunchResponse(body: Record<string, unknown>) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 201,
    json: async () => body,
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function launchAequilibrae() {
  fireEvent.change(screen.getByLabelText(/Run mode/i), { target: { value: "aequilibrae" } });
  fireEvent.click(screen.getByRole("button", { name: /Launch managed run/i }));
}

/** The rendered outlook block, or null when the panel rendered none. */
function outlook() {
  return screen.queryByTestId("model-run-execution-outlook");
}

describe("what a planner sees after launching a worker-backed run", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("names the worker that accepted the run", async () => {
    stubLaunchResponse({
      modelRunId: "run-1",
      status: "queued",
      dispatch: { state: "accepted", workerHost: "worker.example", jobReference: "job-1" },
    });

    renderManager("undeclared");
    await launchAequilibrae();

    await waitFor(() => expect(outlook()).not.toBeNull());
    expect(outlook()?.getAttribute("data-outlook-state")).toBe("accepted");
    expect(outlook()?.textContent).toMatch(/worker\.example/);
    expect(outlook()?.textContent).toMatch(/accepted this run/i);
    // Acceptance is not completion, and the panel may not let it read as one.
    expect(outlook()?.textContent).not.toMatch(/will (finish|succeed|complete)/i);
  });

  it("says nothing will execute it where the deployment declares no worker and pushes nowhere", async () => {
    // Deliberately the SKETCH lane, not a worker-backed one. Picking a
    // worker-backed engine on a deployment that declares no worker is refused
    // at the button before anything is queued, and that refusal is the right
    // behaviour and stays. The run that still reaches the queue here is a
    // sketch run rerouted server-side for a large study area — the lane a
    // mid-size city lands on without ever choosing a worker at all, and the one
    // the launch button cannot predict.
    stubLaunchResponse({
      modelRunId: "run-2",
      status: "queued",
      engineKey: "aequilibrae",
      reroutedFrom: "sketch_abm",
      notice: "Study area resolves to 402 census tracts; the fast in-process sketch lane caps at 150.",
      dispatch: { state: "not_configured" },
    });

    renderManager("absent");
    fireEvent.change(screen.getByLabelText(/Run mode/i), { target: { value: "sketch_abm" } });
    fireEvent.click(screen.getByRole("button", { name: /Launch managed run/i }));

    await waitFor(() => expect(outlook()).not.toBeNull());
    expect(outlook()?.getAttribute("data-outlook-state")).toBe("unattended");
    expect(outlook()?.textContent).toMatch(/Nothing on this deployment is going to execute this run/i);
    // Never the planner's fault, and never anything to buy.
    expect(outlook()?.textContent).toMatch(/nothing to buy/i);
    expect(outlook()?.textContent).not.toMatch(
      /upgrade|subscription|billing|pricing|paid tier|plan tier|contact sales/i
    );
  });

  it("distinguishes 'waiting for a poller' from 'nothing has it'", async () => {
    stubLaunchResponse({
      modelRunId: "run-3",
      status: "queued",
      dispatch: { state: "not_configured" },
    });

    renderManager("deployed");
    await launchAequilibrae();

    await waitFor(() => expect(outlook()).not.toBeNull());
    expect(outlook()?.getAttribute("data-outlook-state")).toBe("waiting_for_poller");
    expect(outlook()?.textContent).toMatch(/waiting for a polling worker/i);
  });

  it("admits it cannot tell, rather than guessing, on an undeclared deployment with nowhere to push", async () => {
    stubLaunchResponse({
      modelRunId: "run-4",
      status: "queued",
      dispatch: { state: "not_configured" },
    });

    renderManager("undeclared");
    await launchAequilibrae();

    await waitFor(() => expect(outlook()).not.toBeNull());
    expect(outlook()?.getAttribute("data-outlook-state")).toBe("unknown");
    expect(outlook()?.textContent).toMatch(/cannot tell whether anything will execute this run/i);
  });

  it("surfaces a failed push instead of reporting a plain queued run", async () => {
    stubLaunchResponse({
      modelRunId: "run-5",
      status: "queued",
      dispatch: {
        state: "dispatch_failed",
        workerHost: "worker.example",
        detail: "Could not reach the worker: ECONNREFUSED",
      },
    });

    renderManager("deployed");
    await launchAequilibrae();

    await waitFor(() => expect(outlook()).not.toBeNull());
    expect(outlook()?.textContent).toMatch(/ECONNREFUSED/);
    expect(outlook()?.textContent).toMatch(/still on the queue/i);
  });

  it("says nothing about who will execute an in-process run, because nothing needs to", async () => {
    // The deterministic lane runs inside the request. A response with no
    // dispatch block means "this ran here" — the panel must not invent an
    // execution outlook for it.
    stubLaunchResponse({ modelRunId: "run-6", runId: "analysis-1" });

    renderManager("absent");
    fireEvent.click(screen.getByRole("button", { name: /Launch managed run/i }));

    await waitFor(() => expect(screen.queryByText(/Failed to launch/i)).toBeNull());
    expect(outlook()).toBeNull();
  });

  it("reports the reroute AND what will run it when a large sketch area lands on the worker", async () => {
    // The lane a mid-size city hits without ever choosing a worker-backed
    // engine. Before this it was told only that it had been rerouted.
    stubLaunchResponse({
      modelRunId: "run-7",
      status: "queued",
      engineKey: "aequilibrae",
      reroutedFrom: "sketch_abm",
      notice: "Study area resolves to 402 census tracts; the fast in-process sketch lane caps at 150.",
      dispatch: { state: "accepted", workerHost: "pool.internal", jobReference: null },
    });

    renderManager("undeclared");
    fireEvent.change(screen.getByLabelText(/Run mode/i), { target: { value: "sketch_abm" } });
    fireEvent.click(screen.getByRole("button", { name: /Launch managed run/i }));

    await waitFor(() => expect(outlook()).not.toBeNull());
    expect(screen.getByText(/402 census tracts/)).toBeTruthy();
    expect(outlook()?.textContent).toMatch(/pool\.internal/);
    // And the older, weaker sentence must not still be on screen contradicting
    // it: "it finishes only while a worker is polling this deployment" is false
    // about a run a pushed worker has already accepted.
    expect(screen.queryByText(/finishes only while a worker is polling/i)).toBeNull();
  });
});
