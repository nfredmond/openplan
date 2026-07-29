import { describe, expect, it } from "vitest";

import {
  IN_PROCESS_ENGINE_KEYS,
  WORKER_BACKED_ENGINE_KEYS,
  assessWorkerLaunchReadiness,
  describeWorkerAbsenceEvidence,
  isWorkerBackedEngineKey,
  type WorkerBackedRunObservation,
} from "@/lib/models/worker-backed-launch";
import { QUEUE_STALE_THRESHOLD_MS } from "@/lib/models/run-liveness";
import { MANAGED_RUN_MODE_KEYS } from "@/lib/models/run-modes";

const NOW = Date.parse("2026-07-28T12:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();

function queuedStages(count = 3) {
  return Array.from({ length: count }, () => ({ status: "queued", started_at: null }));
}

describe("which engines need a process outside this app", () => {
  it("classifies every managed run mode as either worker-backed or in-process", () => {
    // A mode in neither list is a mode the launch control silently has no
    // opinion about — which is how "queued forever with no explanation" got
    // shipped the first time.
    const classified = [...WORKER_BACKED_ENGINE_KEYS, ...IN_PROCESS_ENGINE_KEYS].sort();
    expect(classified).toEqual([...MANAGED_RUN_MODE_KEYS].sort());
  });

  it("counts the two queue-only engines as worker-backed and the rest as not", () => {
    expect(isWorkerBackedEngineKey("aequilibrae")).toBe(true);
    expect(isWorkerBackedEngineKey("behavioral_demand")).toBe(true);
    expect(isWorkerBackedEngineKey("sketch_abm")).toBe(false);
    expect(isWorkerBackedEngineKey("ite_trip_generation")).toBe(false);
    expect(isWorkerBackedEngineKey("deterministic_corridor_v1")).toBe(false);
    expect(isWorkerBackedEngineKey(null)).toBe(false);
  });
});

describe("what a model's own run history proves about the worker", () => {
  it("claims nothing when no worker-backed run has ever been launched", () => {
    const runs: WorkerBackedRunObservation[] = [
      { engine_key: "sketch_abm", status: "succeeded", created_at: iso(NOW - 60_000) },
      { engine_key: "ite_trip_generation", status: "succeeded", created_at: iso(NOW - 90_000) },
    ];

    expect(assessWorkerLaunchReadiness(runs, NOW)).toEqual({ state: "unobserved" });
  });

  it("claims nothing about a worker-backed run that is still young in the queue", () => {
    const runs: WorkerBackedRunObservation[] = [
      {
        engine_key: "aequilibrae",
        status: "queued",
        started_at: null,
        created_at: iso(NOW - 30_000),
        stages: queuedStages(),
      },
    ];

    expect(assessWorkerLaunchReadiness(runs, NOW)).toEqual({ state: "unobserved" });
  });

  it("reports no worker once a queued run has waited past the reaper's own threshold", () => {
    const runs: WorkerBackedRunObservation[] = [
      {
        engine_key: "aequilibrae",
        status: "queued",
        started_at: null,
        created_at: iso(NOW - QUEUE_STALE_THRESHOLD_MS - 60_000),
        stages: queuedStages(),
      },
    ];

    expect(assessWorkerLaunchReadiness(runs, NOW)).toEqual({
      state: "no_worker_observed",
      abandonedRunCount: 1,
    });
  });

  it("reports no worker for a reaped run whose stages never started", () => {
    // What the model page actually renders after reconcile-on-read: status
    // flipped to failed, every stage failed, and not one `started_at` anywhere.
    const runs: WorkerBackedRunObservation[] = [
      {
        engine_key: "aequilibrae",
        status: "failed",
        started_at: null,
        created_at: iso(NOW - 40 * 60_000),
        stages: [
          { status: "failed", started_at: null },
          { status: "failed", started_at: null },
          { status: "failed", started_at: null },
        ],
      },
    ];

    expect(assessWorkerLaunchReadiness(runs, NOW)).toEqual({
      state: "no_worker_observed",
      abandonedRunCount: 1,
    });
  });

  it("does not blame the worker for a run that failed before its stages existed", () => {
    // The launch route fails a run outright when the stage insert errors. That
    // is a database problem; reading it as an absent worker would send the
    // planner to deploy infrastructure that is already there.
    const runs: WorkerBackedRunObservation[] = [
      {
        engine_key: "aequilibrae",
        status: "failed",
        started_at: null,
        created_at: iso(NOW - 40 * 60_000),
        stages: [],
      },
    ];

    expect(assessWorkerLaunchReadiness(runs, NOW)).toEqual({ state: "unobserved" });
  });

  it("does not blame the worker for a run somebody cancelled", () => {
    const runs: WorkerBackedRunObservation[] = [
      {
        engine_key: "aequilibrae",
        status: "cancelled",
        started_at: null,
        created_at: iso(NOW - 40 * 60_000),
        stages: queuedStages(),
      },
    ];

    expect(assessWorkerLaunchReadiness(runs, NOW)).toEqual({ state: "unobserved" });
  });

  it("treats a run a worker actually started as proof a worker was there", () => {
    const runs: WorkerBackedRunObservation[] = [
      {
        engine_key: "aequilibrae",
        status: "running",
        started_at: iso(NOW - 120_000),
        created_at: iso(NOW - 180_000),
        stages: [
          { status: "running", started_at: iso(NOW - 100_000) },
          { status: "queued", started_at: null },
        ],
      },
    ];

    expect(assessWorkerLaunchReadiness(runs, NOW)).toEqual({ state: "worker_observed" });
  });

  it("lets a newly abandoned run outrank an older run the worker did execute", () => {
    // The worker was up last week and is not up now. Newest-first order means
    // the recent abandonment is the live fact; the old success is history.
    const runs: WorkerBackedRunObservation[] = [
      {
        engine_key: "aequilibrae",
        status: "failed",
        started_at: null,
        created_at: iso(NOW - 30 * 60_000),
        stages: queuedStages(),
      },
      {
        engine_key: "behavioral_demand",
        status: "succeeded",
        started_at: iso(NOW - 7 * 24 * 60 * 60_000),
        created_at: iso(NOW - 7 * 24 * 60 * 60_000),
        stages: [{ status: "succeeded", started_at: iso(NOW - 7 * 24 * 60 * 60_000) }],
      },
    ];

    expect(assessWorkerLaunchReadiness(runs, NOW)).toEqual({
      state: "no_worker_observed",
      abandonedRunCount: 1,
    });
  });

  it("stops counting abandonments at the newest run a worker executed", () => {
    const runs: WorkerBackedRunObservation[] = [
      {
        engine_key: "aequilibrae",
        status: "failed",
        started_at: null,
        created_at: iso(NOW - 30 * 60_000),
        stages: queuedStages(),
      },
      {
        engine_key: "aequilibrae",
        status: "succeeded",
        started_at: iso(NOW - 60 * 60_000),
        created_at: iso(NOW - 61 * 60_000),
        stages: [{ status: "succeeded", started_at: iso(NOW - 60 * 60_000) }],
      },
      {
        engine_key: "aequilibrae",
        status: "failed",
        started_at: null,
        created_at: iso(NOW - 120 * 60_000),
        stages: queuedStages(),
      },
    ];

    expect(assessWorkerLaunchReadiness(runs, NOW)).toEqual({
      state: "no_worker_observed",
      abandonedRunCount: 1,
    });
  });

  it("withholds the age-based judgement when the caller has read no clock", () => {
    // React render may not read the clock, so `now` is null until the poll
    // timer runs. Withholding beats guessing that the epoch is now.
    const runs: WorkerBackedRunObservation[] = [
      {
        engine_key: "aequilibrae",
        status: "queued",
        started_at: null,
        created_at: iso(NOW - 10 * 60 * 60_000),
        stages: queuedStages(),
      },
    ];

    expect(assessWorkerLaunchReadiness(runs, null)).toEqual({ state: "unobserved" });
  });
});

describe("the sentence a refusal is allowed to assert", () => {
  it("says nothing when there is no evidence of absence", () => {
    expect(describeWorkerAbsenceEvidence({ state: "unobserved" })).toBeNull();
    expect(describeWorkerAbsenceEvidence({ state: "worker_observed" })).toBeNull();
  });

  it("describes only what was observed, never that no worker exists", () => {
    const one = describeWorkerAbsenceEvidence({ state: "no_worker_observed", abandonedRunCount: 1 });
    const many = describeWorkerAbsenceEvidence({ state: "no_worker_observed", abandonedRunCount: 3 });

    expect(one).toBe("The last worker-backed run on this model was queued and never started by anything.");
    expect(many).toContain("The last 3 worker-backed runs");
    // The observation is a claim about runs, not a claim about the operator's
    // infrastructure, which is unobservable from here.
    expect(one).not.toMatch(/no worker (is|has been) deployed/i);
  });
});
