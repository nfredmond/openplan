/**
 * The relaunch button answers the question a planner presses it to ask.
 *
 * This surface is where a planner arrives AFTER a worker-backed run died — most
 * often because nothing on the deployment was ever going to execute it. Pressing
 * "Relaunch worker run" requeued the run and said nothing whatsoever about
 * whether the second attempt would fare any better than the first, so the honest
 * answer the launch route had already computed reached no one: a capability that
 * exists, is tested, and is rendered by nothing has not shipped.
 *
 * The wording itself is unit-tested in
 * model-run-push-reaches-a-configured-worker.test.ts. What is pinned here is the
 * link — route answer to pixels — which is the join this repo has broken
 * repeatedly.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ModelRunEvidencePanel } from "@/components/models/model-run-evidence-panel";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

const MODEL_ID = "11111111-1111-4111-8111-111111111111";
const MODEL_RUN_ID = "22222222-2222-4222-8222-222222222222";

function renderFailedRun() {
  return render(
    <ModelRunEvidencePanel
      modelId={MODEL_ID}
      modelRunId={MODEL_RUN_ID}
      runTitle="Screening run that nothing picked up"
      runStatus="failed"
      engineKey="aequilibrae"
      comparisonCandidates={[]}
    />
  );
}

function stubRelaunchResponse(body: Record<string, unknown>) {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function relaunch() {
  fireEvent.click(screen.getByRole("button", { name: /relaunch worker run/i }));
}

describe("what a planner sees after relaunching a run that died", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("names the worker that accepted the relaunched run", async () => {
    stubRelaunchResponse({
      success: true,
      status: "queued",
      executionOutlook: {
        state: "accepted",
        headline: "A processing worker at pool.example accepted this run.",
        detail: "OpenPlan pushed the run to that worker and it answered that it had taken it.",
      },
    });

    renderFailedRun();
    await relaunch();

    const outlook = await screen.findByTestId("model-run-execution-outlook");
    expect(outlook).toHaveAttribute("data-outlook-state", "accepted");
    expect(outlook).toHaveTextContent(/pool\.example accepted this run/i);
  });

  it("says plainly when nothing on the deployment will execute the relaunch either", async () => {
    // The case this button exists for. Requeuing a run on a deployment with no
    // worker produces exactly the failure the planner just watched, and saying
    // nothing lets them press it again for fifteen more minutes.
    stubRelaunchResponse({
      success: true,
      status: "queued",
      executionOutlook: {
        state: "unattended",
        headline: "Nothing on this OpenPlan installation is going to execute this run.",
        detail:
          "This OpenPlan installation is not set up to hand runs straight to a worker, so the run sits on the queue until a worker checks for it. There is nothing to buy — OpenPlan is free.",
      },
    });

    renderFailedRun();
    await relaunch();

    const outlook = await screen.findByTestId("model-run-execution-outlook");
    expect(outlook).toHaveAttribute("data-outlook-state", "unattended");
    expect(outlook).toHaveTextContent(/Nothing on this OpenPlan installation is going to execute this run/i);
    expect(outlook.textContent ?? "").not.toMatch(
      /upgrade|subscription|billing|pricing|paid tier|contact sales/i
    );
  });

  it("renders nothing at all when the route sent no outlook", async () => {
    // Absence of an answer may not become an answer. A response without an
    // outlook (an older deployment, a lane that does not dispatch) leaves the
    // panel silent rather than inventing a reassuring or a dire one.
    stubRelaunchResponse({ success: true, status: "queued" });

    renderFailedRun();
    await relaunch();

    await waitFor(() => expect(screen.getByRole("button", { name: /relaunch worker run/i })).toBeEnabled());
    expect(screen.queryByTestId("model-run-execution-outlook")).toBeNull();
  });

  it("does not leave a previous relaunch's answer on screen after a failure", async () => {
    // A stale "a worker accepted this run" next to a failed relaunch would be
    // the most confidently wrong thing this panel could say.
    stubRelaunchResponse({
      success: true,
      status: "queued",
      executionOutlook: {
        state: "accepted",
        headline: "A processing worker at pool.example accepted this run.",
        detail: "It answered that it had taken it.",
      },
    });

    renderFailedRun();
    await relaunch();
    await screen.findByTestId("model-run-execution-outlook");

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({ error: "Failed to relaunch worker run" }) })
    );
    await relaunch();

    await waitFor(() => expect(screen.getByText(/Failed to relaunch worker run/i)).toBeInTheDocument());
    expect(screen.queryByTestId("model-run-execution-outlook")).toBeNull();
  });
});
