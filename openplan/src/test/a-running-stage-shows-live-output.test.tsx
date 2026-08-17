import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ModelRunManager, type ModelRunStage } from "@/components/models/model-run-manager";

/**
 * A HEALTHY LONG RUN LOOKED IDENTICAL TO A HUNG ONE.
 *
 * `assig.execute()` is a single blocking call that can run for minutes, and
 * nothing was written to the stage log while it ran. A planner watching a run
 * saw the console box freeze on its last line with no way to tell progress from
 * a hang — the stuck-run banner only fires after ten minutes, which is longer
 * than many assignments take in total.
 *
 * The worker now forwards the engine's own per-iteration line. These tests
 * cover the half a reader touches: the box has to FOLLOW that output, and it
 * has to stop following when they scroll up to read something, or it snatches
 * the text away from them.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/components/models/study-area-picker", () => ({
  StudyAreaPicker: () => <div data-testid="study-area-picker" />,
}));

const MODEL_ID = "11111111-1111-4111-8111-111111111111";

const PROGRESS_LOG = [
  "Building graph...",
  "Assignment iteration 1 of at most 3,000 — relative gap 0.5, target 0.0005, step 1",
  "Assignment iteration 140 of at most 3,000 — relative gap 0.0034, target 0.0005, step 0.21",
].join("\n");

function stage(overrides: Partial<ModelRunStage> & { id: string }): ModelRunStage {
  return {
    started_at: "2026-08-17T17:00:00.000Z",
    completed_at: null,
    error_message: null,
    log_tail: null,
    ...overrides,
  } as unknown as ModelRunStage;
}

function renderRun(run: Record<string, unknown>) {
  return render(
    <ModelRunManager
      modelId={MODEL_ID}
      modelTitle="Grass Valley"
      defaultQueryText="Screening run"
      defaultCorridorText=""
      scenarioEntries={[]}
      modelRuns={[run as never]}
      schemaPending={false}
    />
  );
}

function runningRun(logTail: string) {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    status: "running",
    run_title: "Grass Valley screening run",
    engine_key: "aequilibrae",
    source_analysis_run_id: null,
    scenario_entry_id: null,
    result_summary_json: null,
    error_message: null,
    started_at: "2026-08-17T17:00:00.000Z",
    completed_at: null,
    created_at: "2026-08-17T17:00:00.000Z",
    stages: [
      stage({
        id: "s1",
        stage_name: "Network Assignment",
        status: "running",
        sort_order: 1,
        log_tail: logTail,
      }),
    ],
    artifacts: [],
  };
}

/** jsdom gives every element zero size, so scroll geometry is set explicitly. */
function setScrollGeometry(
  element: HTMLElement,
  { scrollHeight, clientHeight, scrollTop }: { scrollHeight: number; clientHeight: number; scrollTop: number }
) {
  Object.defineProperty(element, "scrollHeight", { value: scrollHeight, configurable: true });
  Object.defineProperty(element, "clientHeight", { value: clientHeight, configurable: true });
  element.scrollTop = scrollTop;
}

describe("a running stage's console output", () => {
  it("shows the engine's progress while the stage is still running", () => {
    // The log used to be visible only once a stage had finished or failed.
    renderRun(runningRun(PROGRESS_LOG));
    const box = screen.getByTestId("stage-log-output");
    expect(box.textContent).toContain("Assignment iteration 140");
    expect(box.textContent).toContain("target 0.0005");
  });

  it("follows new output by scrolling to the bottom", () => {
    renderRun(runningRun(PROGRESS_LOG));
    const box = screen.getByTestId("stage-log-output");
    setScrollGeometry(box, { scrollHeight: 900, clientHeight: 300, scrollTop: 0 });
    fireEvent.scroll(box);
    // Back at the bottom: following resumes and the box is pinned there.
    setScrollGeometry(box, { scrollHeight: 900, clientHeight: 300, scrollTop: 600 });
    fireEvent.scroll(box);
    expect(box.getAttribute("data-following")).toBe("true");
  });

  it("actually scrolls to the bottom when new output arrives", () => {
    // The behaviour itself, not the flag that reports it: a mutation removing
    // the scroll assignment passed every other test in this file.
    const { rerender } = renderRun(runningRun(PROGRESS_LOG));
    const box = screen.getByTestId("stage-log-output");
    setScrollGeometry(box, { scrollHeight: 900, clientHeight: 300, scrollTop: 0 });

    const grown = runningRun(
      `${PROGRESS_LOG}\nAssignment iteration 300 of at most 3,000 — relative gap 0.0018, target 0.0005, step 0.11`
    );
    rerender(
      <ModelRunManager
        modelId={MODEL_ID}
        modelTitle="Grass Valley"
        defaultQueryText="Screening run"
        defaultCorridorText=""
        scenarioEntries={[]}
        modelRuns={[grown as never]}
        schemaPending={false}
      />
    );

    expect(screen.getByTestId("stage-log-output").scrollTop).toBe(900);
  });

  it("does not scroll when the reader has scrolled up", () => {
    const { rerender } = renderRun(runningRun(PROGRESS_LOG));
    const box = screen.getByTestId("stage-log-output");
    setScrollGeometry(box, { scrollHeight: 900, clientHeight: 300, scrollTop: 100 });
    fireEvent.scroll(box);

    const grown = runningRun(`${PROGRESS_LOG}\nAssignment iteration 300 — relative gap 0.0018`);
    rerender(
      <ModelRunManager
        modelId={MODEL_ID}
        modelTitle="Grass Valley"
        defaultQueryText="Screening run"
        defaultCorridorText=""
        scenarioEntries={[]}
        modelRuns={[grown as never]}
        schemaPending={false}
      />
    );

    expect(screen.getByTestId("stage-log-output").scrollTop).toBe(100);
  });

  it("stops following when the reader scrolls up, and says why", () => {
    // Otherwise the next progress line yanks the view away from someone who
    // scrolled back to read a warning.
    renderRun(runningRun(PROGRESS_LOG));
    const box = screen.getByTestId("stage-log-output");
    setScrollGeometry(box, { scrollHeight: 900, clientHeight: 300, scrollTop: 100 });
    fireEvent.scroll(box);

    expect(box.getAttribute("data-following")).toBe("false");
    expect(screen.getByTestId("stage-log-paused").textContent).toMatch(/scroll to the bottom/i);
  });

  it("treats a nearly-bottom position as the bottom", () => {
    // A fractional scroll height makes an exact comparison false on a box the
    // reader has scrolled all the way down.
    renderRun(runningRun(PROGRESS_LOG));
    const box = screen.getByTestId("stage-log-output");
    setScrollGeometry(box, { scrollHeight: 900, clientHeight: 300, scrollTop: 592 });
    fireEvent.scroll(box);
    expect(box.getAttribute("data-following")).toBe("true");
  });

  it("gives a running stage more room than a finished one", () => {
    renderRun(runningRun(PROGRESS_LOG));
    expect(screen.getByTestId("stage-log-output").className).toContain("max-h-64");
  });

  it("never shows the paused hint on a stage that is not running", () => {
    const finished = runningRun(PROGRESS_LOG);
    finished.status = "succeeded";
    finished.stages[0] = stage({
      id: "s1",
      stage_name: "Network Assignment",
      status: "succeeded",
      sort_order: 1,
      log_tail: PROGRESS_LOG,
      completed_at: "2026-08-17T17:05:00.000Z",
    });
    renderRun(finished);
    const box = screen.getByTestId("stage-log-output");
    setScrollGeometry(box, { scrollHeight: 900, clientHeight: 300, scrollTop: 0 });
    fireEvent.scroll(box);
    expect(screen.queryByTestId("stage-log-paused")).toBeNull();
  });
});
