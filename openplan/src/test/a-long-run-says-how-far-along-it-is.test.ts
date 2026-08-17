import { describe, expect, it } from "vitest";

import {
  describeElapsed,
  latestConvergence,
  summarizeRunProgress,
  type ProgressStageLike,
} from "@/lib/models/run-progress";

/**
 * A MODEL RUN MAY TAKE HOURS OR DAYS, BY DESIGN.
 *
 * OpenPlan spends runtime to get a defensible corridor number. Somebody
 * watching a run that lasts a day needs to know how far along it is — and must
 * not be handed a fabricated time estimate, because stage durations differ by
 * an order of magnitude and an equilibrium assignment's length is unknowable
 * until it converges.
 *
 * So: percent complete is STAGES DONE over stages declared at launch (a known
 * denominator, not a guess), elapsed time is offered because it is a fact, and
 * time-remaining is offered nowhere.
 */

function stage(overrides: Partial<ProgressStageLike>): ProgressStageLike {
  return { stage_name: "Stage", status: "queued", sort_order: 1, ...overrides };
}

const SIX_STAGES: ProgressStageLike[] = [
  stage({ stage_name: "AequilibraE Setup", status: "succeeded", sort_order: 1 }),
  stage({ stage_name: "Zone Package", status: "succeeded", sort_order: 2 }),
  stage({ stage_name: "Network Assignment", status: "running", sort_order: 3 }),
  stage({ stage_name: "Validation", status: "queued", sort_order: 4 }),
  stage({ stage_name: "Artifacts", status: "queued", sort_order: 5 }),
  stage({ stage_name: "Summary", status: "queued", sort_order: 6 }),
];

describe("how far along a long run is", () => {
  it("reports stages finished over stages declared, not a guess", () => {
    const progress = summarizeRunProgress(SIX_STAGES);
    expect(progress.completed).toBe(2);
    expect(progress.total).toBe(6);
    expect(progress.percent).toBe(33);
  });

  it("names the stage that is actually running, and its position", () => {
    const progress = summarizeRunProgress(SIX_STAGES);
    expect(progress.runningStageName).toBe("Network Assignment");
    expect(progress.runningStagePosition).toBe(3);
    expect(progress.label).toBe("Stage 3 of 6: Network Assignment.");
  });

  it("orders by sort_order rather than by array order", () => {
    // The API may return stages in any order; position must not depend on it.
    // The running stage (sort_order 3) is placed FIRST in the array on
    // purpose: an implementation that reads array position would answer 1 here
    // and would have passed a shuffle that happened to leave it at index 2.
    const shuffled = [SIX_STAGES[2], SIX_STAGES[5], SIX_STAGES[0], SIX_STAGES[4], SIX_STAGES[1], SIX_STAGES[3]];
    const progress = summarizeRunProgress(shuffled);
    expect(progress.runningStagePosition).toBe(3);
    expect(progress.label).toBe("Stage 3 of 6: Network Assignment.");
    expect(progress.completed).toBe(2);
  });

  it("says a run is finished only when every stage is terminal", () => {
    expect(summarizeRunProgress(SIX_STAGES).isFinished).toBe(false);
    const done = SIX_STAGES.map((s) => ({ ...s, status: "succeeded" }));
    const finished = summarizeRunProgress(done);
    expect(finished.isFinished).toBe(true);
    expect(finished.percent).toBe(100);
    expect(finished.label).toBe("All 6 stages finished.");
  });

  it("names the stage a failed run stopped at", () => {
    const failed = [
      stage({ stage_name: "AequilibraE Setup", status: "succeeded", sort_order: 1 }),
      stage({ stage_name: "Network Assignment", status: "failed", sort_order: 2 }),
      stage({ stage_name: "Validation", status: "queued", sort_order: 3 }),
    ];
    const progress = summarizeRunProgress(failed);
    expect(progress.label).toContain("Stopped at Network Assignment");
    expect(progress.label).toContain("1 of 3");
  });

  it("counts a skipped stage as done rather than stalling at 99%", () => {
    const withSkip = [
      stage({ status: "succeeded", sort_order: 1 }),
      stage({ status: "skipped", sort_order: 2 }),
    ];
    expect(summarizeRunProgress(withSkip).percent).toBe(100);
  });

  it("does not pretend to know progress before any stage is reported", () => {
    const progress = summarizeRunProgress([]);
    expect(progress.percent).toBeNull();
    expect(progress.label).toMatch(/Waiting for the run to report its stages/);
  });

  it("never offers a time estimate anywhere in its output", () => {
    // The one thing a progress bar must not invent on a run whose length is
    // genuinely unknowable.
    for (const stages of [SIX_STAGES, [], SIX_STAGES.map((s) => ({ ...s, status: "succeeded" }))]) {
      const label = summarizeRunProgress(stages).label.toLowerCase();
      expect(label).not.toMatch(/remaining|eta|estimated|left|finish(es)? (at|in)/);
    }
  });
});

describe("elapsed time in the running stage", () => {
  const now = Date.parse("2026-08-17T12:00:00.000Z");

  it("reads in seconds, minutes, hours and days as a run gets longer", () => {
    expect(describeElapsed("2026-08-17T11:59:30.000Z", now)).toBe("30s");
    expect(describeElapsed("2026-08-17T11:20:00.000Z", now)).toBe("40m");
    expect(describeElapsed("2026-08-17T07:48:00.000Z", now)).toBe("4h 12m");
    expect(describeElapsed("2026-08-14T09:00:00.000Z", now)).toBe("3d 3h");
  });

  it("returns nothing rather than a negative age for a clock skew", () => {
    expect(describeElapsed("2026-08-17T12:30:00.000Z", now)).toBeNull();
    expect(describeElapsed(null, now)).toBeNull();
    expect(describeElapsed("not a date", now)).toBeNull();
  });
});

describe("the assignment's convergence, read from what the worker streamed", () => {
  const LOG = [
    "Building graph...",
    "Assignment iteration 1 of at most 3,000 — relative gap 0.5, target 0.0005, step 1",
    "Assignment iteration 140 of at most 3,000 — relative gap 0.0034, target 0.0005, step 0.21",
  ].join("\n");

  it("takes the most recent line, not the first", () => {
    expect(latestConvergence(LOG)).toEqual({ gap: 0.0034, target: 0.0005 });
  });

  it("returns nothing when the log has no convergence line yet", () => {
    expect(latestConvergence("Building graph...")).toBeNull();
    expect(latestConvergence(null)).toBeNull();
  });

  it("reports the two numbers and derives no percentage from them", () => {
    // Convergence is logarithmic and not monotonic in wall-clock terms, so a
    // bar filling toward the target would imply a rate that does not exist.
    const result = latestConvergence(LOG);
    expect(result).not.toHaveProperty("percent");
    expect(Object.keys(result ?? {})).toEqual(["gap", "target"]);
  });
});
