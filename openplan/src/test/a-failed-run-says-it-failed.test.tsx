import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ModelRunManager, type ModelRunStage } from "@/components/models/model-run-manager";
import { summarizeRunFailure } from "@/lib/models/run-failure";

/**
 * A FAILED RUN DESCRIBED ITSELF AS A RECORDED ONE.
 *
 * Measured by rendering the real run card before the fix: an AequilibraE run
 * with `status: "failed"` and a stage carrying `KeyError: 'households'` showed
 * the headline **"Run recorded — no linked analysis results yet."** The worker
 * writes its reason to the failing STAGE and then patches only
 * `{status: "failed"}` onto the run, so `model_runs.error_message` is null for
 * the entire worker lane and the card fell through to copy written for a run
 * that simply has no results.
 *
 * This is the moment a self-serve planner decides the software is broken or
 * that they did something wrong, so it is also where OpenPlan can least afford
 * to be vague — and where it must not guess. The module under test chooses
 * which of the ENGINE'S OWN sentences to show; it never authors a cause.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/components/models/study-area-picker", () => ({
  StudyAreaPicker: () => <div data-testid="study-area-picker" />,
}));

const MODEL_ID = "11111111-1111-4111-8111-111111111111";

/** The worker's real message for an unkeyed Census request, abridged. */
const CENSUS_KEY_MESSAGE =
  "RuntimeError: Dynamic package generation failed: The US Census ACS API rejected this request " +
  "because no API key was supplied. A workspace owner or admin can add a free Census key under " +
  "Settings -> Integrations and then relaunch this run.";

function stage(overrides: Partial<ModelRunStage> & { id: string }): ModelRunStage {
  return {
    started_at: null,
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

function baseRun(overrides: Record<string, unknown>) {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    status: "failed",
    run_title: "Grass Valley screening run",
    engine_key: "aequilibrae",
    source_analysis_run_id: null,
    scenario_entry_id: null,
    result_summary_json: null,
    error_message: null,
    started_at: "2026-08-08T17:00:00.000Z",
    completed_at: "2026-08-08T17:02:00.000Z",
    created_at: "2026-08-08T17:00:00.000Z",
    stages: [],
    artifacts: [],
    ...overrides,
  };
}

describe("the run card on a failed run", () => {
  it("never says a failed run was merely recorded", () => {
    // THE REGRESSION. This exact string was the headline on a crashed run.
    renderRun(
      baseRun({
        stages: [
          stage({ id: "s2", stage_name: "Network Assignment", status: "failed", sort_order: 2, error_message: "KeyError: 'households'" }),
        ],
      })
    );

    expect(screen.queryByText(/Run recorded/)).toBeNull();
    expect(screen.getByTestId("run-failure-summary")).toBeInTheDocument();
  });

  it("promotes the worker's own actionable message to the headline", () => {
    // The good sentence already existed — it was buried in a stage row under a
    // headline that contradicted it.
    renderRun(
      baseRun({
        stages: [
          stage({ id: "s1", stage_name: "AequilibraE Setup", status: "failed", sort_order: 1, error_message: CENSUS_KEY_MESSAGE }),
        ],
      })
    );

    const summary = screen.getByTestId("run-failure-summary");
    expect(summary).toHaveTextContent("AequilibraE Setup could not finish");
    expect(summary).toHaveTextContent("no API key was supplied");
    expect(summary).toHaveTextContent("Settings -> Integrations");
    // The Python exception type is noise to a planner once a sentence survives.
    expect(summary.textContent ?? "").not.toContain("RuntimeError:");
  });

  it("leaves a succeeded run's copy completely alone", () => {
    renderRun(
      baseRun({
        status: "succeeded",
        source_analysis_run_id: null,
        stages: [stage({ id: "s1", stage_name: "AequilibraE Setup", status: "succeeded", sort_order: 1 })],
      })
    );

    expect(screen.queryByTestId("run-failure-summary")).toBeNull();
    expect(screen.getByText(/Run recorded — no linked analysis results yet/)).toBeInTheDocument();
  });
});

describe("summarizeRunFailure", () => {
  it("speaks only for terminally failed runs", () => {
    for (const status of ["queued", "running", "succeeded", "", null, undefined]) {
      expect(summarizeRunFailure({ status, stages: [] })).toBeNull();
    }
    expect(summarizeRunFailure({ status: "failed", stages: [] })).not.toBeNull();
    expect(summarizeRunFailure({ status: "cancelled", stages: [] })).not.toBeNull();
  });

  it("prefers the run-level message, which the reaper writes and no stage could know", () => {
    const summary = summarizeRunFailure({
      status: "failed",
      errorMessage:
        "No modeling worker picked up this run within 15 minutes. The AequilibraE worker may be offline — start the worker, then re-launch this run.",
      stages: [stage({ id: "s1", stage_name: "AequilibraE Setup", status: "failed", sort_order: 1, error_message: "KeyError: 'x'" })],
    });

    expect(summary!.headline).toContain("No modeling worker picked up this run");
    expect(summary!.isRawEngineOutput).toBe(false);
  });

  it("takes the FIRST failed stage, never a later one blocked by it", () => {
    /**
     * When a stage fails the worker marks every later stage `skipped` with
     * "Blocked by prior stage X (failed)" in the SAME error_message column. That
     * is a consequence that reads exactly like a cause, and headlining it would
     * hide the message that would have helped.
     */
    const summary = summarizeRunFailure({
      status: "failed",
      stages: [
        stage({ id: "s1", stage_name: "AequilibraE Setup", status: "succeeded", sort_order: 1 }),
        stage({ id: "s2", stage_name: "Network Assignment", status: "failed", sort_order: 2, error_message: CENSUS_KEY_MESSAGE }),
        stage({
          id: "s3",
          stage_name: "Artifact Extraction",
          status: "skipped",
          sort_order: 3,
          error_message: "Blocked by prior stage Network Assignment (failed)",
        }),
      ],
    });

    expect(summary!.stageName).toBe("Network Assignment");
    expect(summary!.headline).not.toContain("Blocked by prior stage");
    expect(summary!.headline).toContain("no API key was supplied");
  });

  it("never headlines a 'Blocked by prior stage' consequence, even as the only message", () => {
    /**
     * A skipped stage's `error_message` is written by `mark_stage_skipped` and
     * describes what BLOCKED it, not what went wrong. When it is the only text
     * available — the failed row reaped, or the stage list partially loaded —
     * the honest answer is "no reason was recorded", not a sentence pointing at
     * a stage whose own message the planner cannot see.
     *
     * Verified by mutation: admitting `skipped` rows as causes survived every
     * other test in this file, because their sort_order always placed them
     * after the failed row in the fixtures above.
     */
    const summary = summarizeRunFailure({
      status: "failed",
      stages: [
        stage({
          id: "s3",
          stage_name: "Artifact Extraction",
          status: "skipped",
          sort_order: 3,
          error_message: "Blocked by prior stage Network Assignment (failed)",
        }),
      ],
    });

    expect(summary!.headline).not.toContain("Blocked by prior stage");
    expect(summary!.headline).toContain("no reason was recorded");
    expect(summary!.stageName).toBeNull();
  });

  it("orders by sort_order rather than array order", () => {
    const summary = summarizeRunFailure({
      status: "failed",
      stages: [
        stage({ id: "s3", stage_name: "Artifact Extraction", status: "failed", sort_order: 3, error_message: "later" }),
        stage({ id: "s2", stage_name: "Network Assignment", status: "failed", sort_order: 2, error_message: "earlier" }),
      ],
    });
    expect(summary!.stageName).toBe("Network Assignment");
  });

  it("frames an internal error as not the planner's fault, and never invents a cause", () => {
    const summary = summarizeRunFailure({
      status: "failed",
      stages: [stage({ id: "s2", stage_name: "Network Assignment", status: "failed", sort_order: 2, error_message: "KeyError: 'households'" })],
    });

    expect(summary!.isRawEngineOutput).toBe(true);
    expect(summary!.headline).toContain("not a setting you got wrong");
    expect(summary!.headline).toContain("whoever runs your OpenPlan deployment");
    // THE HONESTY BOUNDARY: the engine's words survive verbatim, and nothing
    // resembling a diagnosis is added. A plausible wrong explanation sends a
    // planner to fix something that was never broken.
    expect(summary!.headline).toContain("KeyError: 'households'");
    expect(summary!.rawMessage).toBe("KeyError: 'households'");
  });

  it("keeps the exception type when stripping it would lose information", () => {
    // `KeyError: 'households'` minus its prefix is `'households'` — strictly
    // less than it started with.
    const summary = summarizeRunFailure({
      status: "failed",
      stages: [stage({ id: "s1", stage_name: "Setup", status: "failed", sort_order: 1, error_message: "KeyError: 'households'" })],
    });
    expect(summary!.headline).toContain("KeyError:");
  });

  it("says so plainly when a run failed and recorded no reason at all", () => {
    const summary = summarizeRunFailure({
      status: "failed",
      stages: [stage({ id: "s1", stage_name: "AequilibraE Setup", status: "failed", sort_order: 1, error_message: null })],
    });

    expect(summary!.headline).toContain("no reason was recorded");
    expect(summary!.headline).toContain("AequilibraE Setup");
    expect(summary!.rawMessage).toBeNull();
    // Never the sentence that shipped.
    expect(summary!.headline).not.toContain("Run recorded");
  });

  it("handles a failed run with no stage rows at all", () => {
    const summary = summarizeRunFailure({ status: "failed", stages: null });
    expect(summary!.headline).toContain("no reason was recorded");
    expect(summary!.stageName).toBeNull();
  });
});
