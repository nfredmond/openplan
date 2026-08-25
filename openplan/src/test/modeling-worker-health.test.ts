import { describe, expect, it } from "vitest";
import {
  evaluateWorkerHealthLaunchGate,
  reduceModelingWorkerHealth,
  WORKER_HEARTBEAT_STALE_AFTER_MS,
  type ModelingWorkerHeartbeatRow,
} from "@/lib/models/worker-health";

const NOW = Date.parse("2026-08-24T20:00:00Z");

function row(
  kind: "aequilibrae" | "activitysim",
  ageMs: number,
  overrides: Partial<ModelingWorkerHeartbeatRow> = {}
): ModelingWorkerHeartbeatRow {
  return {
    worker_kind: kind,
    instance_id: `${kind}-one`,
    supported_stages: kind === "aequilibrae"
      ? ["AequilibraE Setup", "Network Assignment", "Artifact Extraction"]
      : ["ActivitySim Bundle & Preflight"],
    runtime_mode: "poll",
    worker_version: "5e03ff2f",
    current_work: null,
    started_at: new Date(NOW - 60_000).toISOString(),
    last_successful_heartbeat_at: new Date(NOW - ageMs).toISOString(),
    ...overrides,
  };
}

describe("deployment-global modeling worker health", () => {
  it("classifies two-minute-old heartbeats as fresh and older ones as stale", () => {
    const fresh = reduceModelingWorkerHealth({
      rows: [row("aequilibrae", WORKER_HEARTBEAT_STALE_AFTER_MS)],
      now: NOW,
      declaration: "deployed",
    });
    const stale = reduceModelingWorkerHealth({
      rows: [row("aequilibrae", WORKER_HEARTBEAT_STALE_AFTER_MS + 1)],
      now: NOW,
      declaration: "deployed",
    });
    expect(fresh.aequilibrae.state).toBe("fresh");
    expect(stale.aequilibrae.state).toBe("stale");
  });

  it("requires both worker kinds for behavioral demand", () => {
    const health = reduceModelingWorkerHealth({
      rows: [row("aequilibrae", 30_000), row("activitysim", 30_000)],
      now: NOW,
      declaration: "deployed",
    });
    expect(evaluateWorkerHealthLaunchGate("behavioral_demand", health).blocked).toBe(false);

    const missingActivitySim = reduceModelingWorkerHealth({
      rows: [row("aequilibrae", 30_000)],
      now: NOW,
      declaration: "deployed",
    });
    expect(missingActivitySim.activitysim.state).toBe("unknown");
    expect(evaluateWorkerHealthLaunchGate("behavioral_demand", missingActivitySim).states).toHaveLength(2);
  });

  it("ties stale acknowledgement to the exact observed heartbeat", () => {
    const first = reduceModelingWorkerHealth({
      rows: [row("aequilibrae", 180_000)],
      now: NOW,
      declaration: "deployed",
    });
    const second = reduceModelingWorkerHealth({
      rows: [row("aequilibrae", 181_000)],
      now: NOW,
      declaration: "deployed",
    });
    const firstKey = evaluateWorkerHealthLaunchGate("aequilibrae", first).acknowledgementKey;
    const secondKey = evaluateWorkerHealthLaunchGate("aequilibrae", second).acknowledgementKey;
    expect(firstKey).not.toBeNull();
    expect(secondKey).not.toBe(firstKey);
  });

  it("keeps explicit worker absence a hard refusal even when a row exists", () => {
    const health = reduceModelingWorkerHealth({
      rows: [row("aequilibrae", 30_000)],
      now: NOW,
      declaration: "absent",
    });
    const gate = evaluateWorkerHealthLaunchGate("aequilibrae", health);
    expect(health.aequilibrae.state).toBe("absent");
    expect(gate.blocked).toBe(true);
    expect(gate.acknowledgementKey).toBeNull();
  });

  it("degrades pending schema and unversioned workers to explicit unknown", () => {
    const pending = reduceModelingWorkerHealth({
      rows: [],
      now: NOW,
      declaration: "undeclared",
      schemaAvailable: false,
    });
    const old = reduceModelingWorkerHealth({
      rows: [row("aequilibrae", 30_000, { worker_version: "unrecorded" })],
      now: NOW,
      declaration: "deployed",
    });
    expect(pending.aequilibrae.state).toBe("unknown");
    expect(old.aequilibrae.state).toBe("unknown");
  });

  it("does not let a retired incompatible instance poison a current worker", () => {
    const health = reduceModelingWorkerHealth({
      rows: [
        row("aequilibrae", 30_000, { instance_id: "current" }),
        row("aequilibrae", 86_400_000, { instance_id: "retired", supported_stages: [] }),
      ],
      now: NOW,
      declaration: "deployed",
    });
    expect(health.aequilibrae.state).toBe("fresh");
    expect(health.aequilibrae.instanceCount).toBe(1);
  });
});
