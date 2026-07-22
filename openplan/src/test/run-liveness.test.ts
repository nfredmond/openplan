import { describe, expect, it } from "vitest";
import {
  QUEUE_STALE_THRESHOLD_MS,
  RUN_STALE_THRESHOLD_MS,
  classifyRunLiveness,
  isWorkerLikelyAlive,
  lastProgressMs,
  stalenessMessage,
  type LivenessRun,
} from "@/lib/models/run-liveness";

const NOW = 1_800_000_000_000;
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();
const MIN = 60 * 1000;

describe("classifyRunLiveness", () => {
  it("never reaps a terminal run", () => {
    for (const status of ["succeeded", "failed", "cancelled"]) {
      const run: LivenessRun = { status, created_at: iso(120 * MIN), updated_at: iso(120 * MIN) };
      expect(classifyRunLiveness(run, NOW, { workerLikelyAlive: false })).toBe("ok");
    }
  });

  it("does not reap a running stage with a FRESH heartbeat (slow-but-progressing)", () => {
    const run: LivenessRun = {
      status: "running",
      created_at: iso(90 * MIN),
      started_at: iso(85 * MIN),
      updated_at: iso(2 * MIN), // worker streamed a log_tail 2 min ago
      stages: [
        { status: "succeeded", started_at: iso(85 * MIN), completed_at: iso(60 * MIN) },
        { status: "running", started_at: iso(60 * MIN), updated_at: iso(2 * MIN) },
      ],
    };
    expect(classifyRunLiveness(run, NOW, { workerLikelyAlive: false })).toBe("ok");
  });

  it("reaps a running stage whose heartbeat froze past the run threshold (crashed mid-run)", () => {
    const frozen = RUN_STALE_THRESHOLD_MS + 5 * MIN;
    const run: LivenessRun = {
      status: "running",
      created_at: iso(frozen + 10 * MIN),
      started_at: iso(frozen + 5 * MIN),
      updated_at: iso(frozen),
      stages: [{ status: "running", started_at: iso(frozen + 2 * MIN), updated_at: iso(frozen) }],
    };
    expect(classifyRunLiveness(run, NOW, { workerLikelyAlive: false })).toBe("stale_running");
    // Even if the worker is alive elsewhere, a frozen running stage is still crashed.
    expect(classifyRunLiveness(run, NOW, { workerLikelyAlive: true })).toBe("stale_running");
  });

  it("reaps a queued run nobody picked up when the worker is not alive", () => {
    const run: LivenessRun = {
      status: "queued",
      created_at: iso(QUEUE_STALE_THRESHOLD_MS + 2 * MIN),
      updated_at: iso(QUEUE_STALE_THRESHOLD_MS + 2 * MIN),
      stages: [{ status: "queued" }, { status: "queued" }, { status: "queued" }],
    };
    expect(classifyRunLiveness(run, NOW, { workerLikelyAlive: false })).toBe("stale_queued");
  });

  it("does NOT reap a queued run that is waiting while the worker is busy elsewhere", () => {
    const run: LivenessRun = {
      status: "queued",
      created_at: iso(QUEUE_STALE_THRESHOLD_MS + 2 * MIN),
      updated_at: iso(QUEUE_STALE_THRESHOLD_MS + 2 * MIN),
      stages: [{ status: "queued" }],
    };
    expect(classifyRunLiveness(run, NOW, { workerLikelyAlive: true })).toBe("ok");
  });

  it("does not reap a freshly queued run within the queue threshold", () => {
    const run: LivenessRun = {
      status: "queued",
      created_at: iso(QUEUE_STALE_THRESHOLD_MS - 2 * MIN),
      updated_at: iso(QUEUE_STALE_THRESHOLD_MS - 2 * MIN),
    };
    expect(classifyRunLiveness(run, NOW, { workerLikelyAlive: false })).toBe("ok");
  });
});

describe("isWorkerLikelyAlive", () => {
  it("is true when a run has a running stage with a fresh heartbeat", () => {
    const runs: LivenessRun[] = [
      { status: "queued", created_at: iso(30 * MIN) },
      { status: "running", updated_at: iso(1 * MIN), stages: [{ status: "running", updated_at: iso(1 * MIN) }] },
    ];
    expect(isWorkerLikelyAlive(runs, NOW)).toBe(true);
  });

  it("is false when every running run's heartbeat is frozen (worker dead)", () => {
    const frozen = RUN_STALE_THRESHOLD_MS + 1 * MIN;
    const runs: LivenessRun[] = [
      { status: "running", updated_at: iso(frozen), stages: [{ status: "running", updated_at: iso(frozen) }] },
      { status: "queued", created_at: iso(30 * MIN) },
    ];
    expect(isWorkerLikelyAlive(runs, NOW)).toBe(false);
  });
});

describe("lastProgressMs", () => {
  it("returns the freshest of all run/stage timestamps", () => {
    const run: LivenessRun = {
      status: "running",
      created_at: iso(90 * MIN),
      started_at: iso(85 * MIN),
      updated_at: iso(3 * MIN),
      stages: [{ status: "running", started_at: iso(60 * MIN), updated_at: iso(3 * MIN) }],
    };
    expect(lastProgressMs(run)).toBe(NOW - 3 * MIN);
  });

  it("returns null when a run has no usable timestamps", () => {
    expect(lastProgressMs({ status: "queued" })).toBeNull();
  });
});

describe("stalenessMessage", () => {
  it("gives an actionable, honest message per staleness kind", () => {
    expect(stalenessMessage("stale_queued")).toContain("worker may be offline");
    expect(stalenessMessage("stale_queued")).toContain("re-launch");
    expect(stalenessMessage("stale_running")).toContain("crashed");
    expect(stalenessMessage("ok")).toBe("");
  });
});
