import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ModelRunManager, type ModelRunStage } from "@/components/models/model-run-manager";

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
// Map rendering is outside this clock regression. The manager and progress
// component, including their timers, run without mocks.
vi.mock("@/components/models/study-area-picker", () => ({ StudyAreaPicker: () => null }));
vi.mock("next/dynamic", () => ({ default: () => () => null }));

const startedAt = "2026-10-18T05:30:09.000Z";

function manager(stage: ModelRunStage) {
  return (
    <ModelRunManager
      modelId="model-1"
      modelTitle="Elapsed clock regression"
      defaultQueryText=""
      defaultCorridorText=""
      scenarioEntries={[]}
      modelRuns={[{
        id: "run-1",
        status: stage.status,
        run_title: "Running assignment",
        engine_key: "aequilibrae",
        source_analysis_run_id: null,
        scenario_entry_id: null,
        result_summary_json: null,
        error_message: null,
        started_at: startedAt,
        completed_at: null,
        created_at: startedAt,
        stages: [stage],
        artifacts: [],
      }]}
      schemaPending={false}
    />
  );
}

describe("ModelRunManager elapsed clock across polling refreshes", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("advances while fresh stage objects arrive every five seconds, then clears its elapsed interval when terminal", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-18T05:32:09.000Z"));
    const setIntervalSpy = vi.spyOn(window, "setInterval");
    const clearIntervalSpy = vi.spyOn(window, "clearInterval");
    const stage: ModelRunStage = {
      id: "stage-1",
      stage_name: "Network Assignment",
      status: "running",
      sort_order: 1,
      started_at: startedAt,
      completed_at: null,
      log_tail: null,
    };
    const view = await act(async () => render(manager(stage)));
    expect(screen.getByTestId("run-progress-detail")).toHaveTextContent("2m in this stage");

    // Identify the child's clock by its unique cadence, then track its returned
    // ID. Parent polling and UI timers have separate lifecycles.
    const elapsedIntervals = () => setIntervalSpy.mock.calls
      .map((call, index) => ({ delay: call[1], result: setIntervalSpy.mock.results[index] }))
      .filter(({ delay }) => delay === 30_000);
    expect(elapsedIntervals(), "one identifiable elapsed interval").toHaveLength(1);
    const elapsedTimer = elapsedIntervals()[0].result;
    expect(elapsedTimer.type).toBe("return");
    const elapsedTimerId = elapsedTimer.value;

    // A server refresh replaces the objects even when no stage fields change.
    // Later refreshes also carry new log text. Neither may starve the clock.
    for (let poll = 1; poll <= 24; poll += 1) {
      act(() => vi.advanceTimersByTime(5_000));
      view.rerender(manager({ ...stage, log_tail: poll > 12 ? `Worker update ${poll}` : null }));
      if (poll === 12) {
        expect(screen.getByTestId("run-progress-detail")).toHaveTextContent("3m in this stage");
      }
    }
    expect(screen.getByTestId("run-progress-detail")).toHaveTextContent("4m in this stage");
    expect(router.refresh).toHaveBeenCalledTimes(24);
    expect(elapsedIntervals(), "polls preserve the original elapsed interval").toHaveLength(1);
    expect(clearIntervalSpy).not.toHaveBeenCalledWith(elapsedTimerId);

    await act(async () => view.rerender(manager({
      ...stage,
      status: "succeeded",
      completed_at: new Date().toISOString(),
    })));
    expect(screen.queryByTestId("run-progress-detail")).not.toBeInTheDocument();
    expect(clearIntervalSpy, "terminal transition clears the elapsed interval ID")
      .toHaveBeenCalledWith(elapsedTimerId);
    act(() => vi.advanceTimersByTime(60_000));
    expect(elapsedIntervals(), "terminal stages do not restart the elapsed interval").toHaveLength(1);
  });
});
