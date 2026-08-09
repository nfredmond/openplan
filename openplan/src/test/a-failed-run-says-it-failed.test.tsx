import { readFileSync } from "node:fs";
import path from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ModelRunManager, type ModelRunStage } from "@/components/models/model-run-manager";
import { stageLogForDisplay, summarizeRunFailure } from "@/lib/models/run-failure";

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

describe("a failed stage's log box", () => {
  it("does not show a log claiming the stage is starting", () => {
    /**
     * The worker stamps `log_tail` with "Starting <stage>..." when it claims a
     * stage and never clears it on failure. Every failure a planner can
     * actually fix — no study area, no Census key, study area too large —
     * raises early, so those are exactly the runs that rendered a console box
     * saying the stage was STARTING directly beneath its red error.
     */
    renderRun(
      baseRun({
        stages: [
          stage({
            id: "s1",
            stage_name: "AequilibraE Setup",
            status: "failed",
            sort_order: 1,
            error_message: CENSUS_KEY_MESSAGE,
            log_tail: "Starting AequilibraE Setup...",
          }),
        ],
      })
    );

    expect(screen.queryByText(/Starting AequilibraE Setup/)).toBeNull();
    expect(screen.queryByTestId("stage-log")).toBeNull();
  });

  it("keeps a genuine partial log and says where it stops", () => {
    renderRun(
      baseRun({
        stages: [
          stage({
            id: "s2",
            stage_name: "Network Assignment",
            status: "failed",
            sort_order: 2,
            error_message: "KeyError: 'households'",
            log_tail: "Loaded 3,174 links\nBuilding OD matrix",
          }),
        ],
      })
    );

    const box = screen.getByTestId("stage-log");
    expect(box).toHaveTextContent("Loaded 3,174 links");
    expect(box).toHaveTextContent("Log up to the point of failure");
  });

  it("leaves a succeeded stage's log unlabelled", () => {
    renderRun(
      baseRun({
        status: "succeeded",
        stages: [
          stage({
            id: "s1",
            stage_name: "AequilibraE Setup",
            status: "succeeded",
            sort_order: 1,
            log_tail: "Resolved 26 zones",
          }),
        ],
      })
    );

    const box = screen.getByTestId("stage-log");
    expect(box).toHaveTextContent("Resolved 26 zones");
    expect(box.textContent ?? "").not.toContain("Log up to the point of failure");
  });

  it("shows an unrecognised log on a failed stage rather than hiding it", () => {
    // The placeholder is matched exactly. Anything else is real output and must
    // survive — dropping a log because it did not match a string would lose the
    // only record of what the run did.
    const shown = stageLogForDisplay({
      stage_name: "Network Assignment",
      status: "failed",
      log_tail: "Starting Network Assignment",
    });
    expect(shown).not.toBeNull();
    expect(shown!.isPartial).toBe(true);
  });

  it("has nothing to show when there is no log", () => {
    expect(stageLogForDisplay({ stage_name: "Setup", status: "failed", log_tail: null })).toBeNull();
    expect(stageLogForDisplay({ stage_name: "Setup", status: "failed", log_tail: "   " })).toBeNull();
  });

  it("recognises the placeholder the WORKER actually writes", () => {
    /**
     * The placeholder is a literal shared across two runtimes: Python writes it
     * when it claims a stage, TypeScript recognises it when it decides whether
     * to render the log box. If the worker rewords it, this side silently stops
     * matching and the "Starting <stage>..." box comes back — a regression with
     * no failing test anywhere, because each side would still agree with
     * itself. So the format is read out of the worker's own source.
     *
     * It throws rather than defaulting when the function cannot be found: an
     * extraction that silently yields nothing passes forever while proving
     * nothing.
     */
    const workerSource = readFileSync(
      path.join(process.cwd(), "..", "workers", "aequilibrae_worker", "main.py"),
      "utf8"
    );
    const fn = workerSource.slice(workerSource.indexOf("def stage_claim_placeholder("));
    const match = /return f"([^"]*)"/.exec(fn);
    if (!match) {
      throw new Error(
        "stage_claim_placeholder() was not found in the worker's main.py. If it moved or was " +
          "renamed, update this guard — it is the only thing keeping the two runtimes agreeing " +
          "on the placeholder string."
      );
    }

    const stageName = "Network Assignment";
    const workerWrites = match[1].replace("{stage_name}", stageName);
    // Exactly what the worker would store must be recognised and dropped...
    expect(stageLogForDisplay({ stage_name: stageName, status: "failed", log_tail: workerWrites })).toBeNull();
    // ...and must NOT be dropped on a stage that is still running, where it is
    // the honest current state rather than a leftover.
    expect(stageLogForDisplay({ stage_name: stageName, status: "running", log_tail: workerWrites })).not.toBeNull();
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

  it("asks the database for the column the ordering depends on", () => {
    /**
     * `sort_order` was NOT in the page's nested stage projection, so the sort
     * below had nothing to sort on and silently fell back to whatever order
     * PostgREST returned — on the one decision that separates a cause from a
     * stage blocked by it. Found by a TYPE error rather than a failing test,
     * because the fixtures here supplied a field the real query never did.
     * That is the mocked-client blind spot; asserting the projection string is
     * the only thing that closes it.
     */
    const source = readFileSync(
      path.join(process.cwd(), "src/app/(app)/models/[modelId]/page.tsx"),
      "utf8"
    );
    const embed = /stages:model_run_stages\(([^)]*)\)/.exec(source)?.[1];
    expect(embed, "could not find the model_run_stages embed").toBeTypeOf("string");
    const columns = embed!.split(",").map((column) => column.trim());
    for (const column of ["sort_order", "status", "stage_name", "error_message", "log_tail"]) {
      expect(columns).toContain(column);
    }
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
