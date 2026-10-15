import { describe, expect, it } from "vitest";
import { NODE_QUEUE_KINDS } from "@/lib/ops/node-queue-observation";
import { parseNodeQueueObservation } from "@/lib/ops/node-queue-observation-reader";

function observation() {
  return { observedAt: "2026-10-14T23:00:00.000Z", scope: "process_only", jobCompletion: "unassessed",
    queues: NODE_QUEUE_KINDS.map(kind => ({ kind, lastSeenAt: null as string | null,
      lastState: null as string | null, runningInstances: 0, stoppingInstances: 0, state: "unobserved" })) };
}

describe("Node process observation reader", () => {
  it("keeps a complete missing-observation report distinct from unreadable data", () => {
    const value = observation();
    expect(parseNodeQueueObservation(value), "A valid unobserved census must remain readable").toEqual(value);
    for (const invalid of [null, true, {}, { ...value, queues: [] }]) {
      expect(parseNodeQueueObservation(invalid), "Unreadable observation cannot become zero workers").toBeNull();
    }
  });
  it("refuses a duplicated kind that hides another queue", () => {
    const value = observation(); value.queues[1] = { ...value.queues[0] };
    expect(parseNodeQueueObservation(value), "Every declared queue needs its own observation").toBeNull();
    const extra = observation(); extra.queues.push({ ...extra.queues[0] });
    expect(parseNodeQueueObservation(extra), "An extra duplicate cannot expand the declared census").toBeNull();
  });
  it("refuses a foreign queue or missing time", () => {
    const value = observation();
    expect(parseNodeQueueObservation({ ...value, observedAt: "not-a-time" }), "Observation time must remain readable").toBeNull();
    expect(parseNodeQueueObservation({ ...value, queues: [{ ...value.queues[0], kind: "foreign" }, ...value.queues.slice(1)] }),
      "Unknown queues cannot replace declared observations").toBeNull();
  });
  it("refuses negative fractional and unsafe instance counts", () => {
    for (const field of ["runningInstances", "stoppingInstances"] as const) {
      for (const count of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
        const value = observation(); Object.assign(value.queues[0], { state: "unknown", lastState: "running", lastSeenAt: "2026-10-14T23:00:00.000001Z" });
        value.queues[0][field] = count;
        expect(parseNodeQueueObservation(value), "Unreadable instance counts cannot imply process availability").toBeNull();
      }
    }
  });
  it("cannot promote process facts to accepted work", () => {
    const value = observation();
    for (const invalid of [{ ...value, scope: "work_verified" }, { ...value, jobCompletion: "approved" }]) {
      expect(parseNodeQueueObservation(invalid), "Process observations cannot approve work").toBeNull();
    }
  });
  it("refuses a running claim without a matching count", () => {
    const value = observation(); Object.assign(value.queues[0], { state: "observed_running", lastState: "running", lastSeenAt: value.observedAt });
    expect(parseNodeQueueObservation(value), "A running observation needs at least one observed instance").toBeNull();
    value.queues[0].runningInstances = 1;
    expect(parseNodeQueueObservation(value), "A consistent running observation must remain readable").toEqual(value);
  });
  it("refuses an unobserved claim carrying an instance or timestamp", () => {
    const value = observation(); value.queues[0].lastSeenAt = value.observedAt;
    expect(parseNodeQueueObservation(value), "Unobserved cannot carry an observed timestamp").toBeNull();
  });
  it("refuses stale or stopped claims carrying live instances", () => {
    const value = observation(); Object.assign(value.queues[0], { state: "stale", lastState: "running", lastSeenAt: value.observedAt, runningInstances: 1 });
    expect(parseNodeQueueObservation(value), "Stale cannot carry a live instance count").toBeNull();
    Object.assign(value.queues[0], { state: "last_observed_stopped", lastState: "running", runningInstances: 0 });
    expect(parseNodeQueueObservation(value), "A stopped observation must actually record stopped").toBeNull();
  });
  it("keeps consistent stopping stale stopped and unknown facts readable", () => {
    for (const state of ["observed_stopping", "stale", "last_observed_stopped", "unknown"]) {
      const value = observation(); Object.assign(value.queues[0], { state, lastSeenAt: state === "stale" ? "2026-10-14T22:57:00.000Z" : state === "unknown" ? "2026-10-14T23:00:00.000001Z" : value.observedAt,
        lastState: state === "last_observed_stopped" ? "stopped" : "stopping", stoppingInstances: state === "observed_stopping" ? 1 : 0 });
      expect(parseNodeQueueObservation(value), "Consistent process observations must remain readable").toEqual(value);
    }
  });
  it("refuses a stopping claim with no stopping instance or a live running instance", () => {
    const value = observation(); Object.assign(value.queues[0], { state: "observed_stopping", lastSeenAt: value.observedAt, lastState: "stopping" });
    expect(parseNodeQueueObservation(value), "Stopping requires an observed stopping instance").toBeNull();
    value.queues[0].stoppingInstances = 1; value.queues[0].runningInstances = 1;
    expect(parseNodeQueueObservation(value), "Stopping cannot hide an observed running instance").toBeNull();
  });
  it("refuses activity claims with missing or unreadable time and state", () => {
    for (const at of [null, "not-a-time"]) {
      const value = observation(); Object.assign(value.queues[0], { state: "observed_running", runningInstances: 1, lastState: "running", lastSeenAt: at });
      expect(parseNodeQueueObservation(value), "Activity requires a readable observation time").toBeNull();
    }
    for (const lastState of [null, "approved"]) {
      const value = observation(); Object.assign(value.queues[0], { state: "observed_running", runningInstances: 1, lastState, lastSeenAt: value.observedAt });
      expect(parseNodeQueueObservation(value), "Activity requires a supported observed state").toBeNull();
    }
  });
  it("refuses unsupported summary states instead of treating them as assessed", () => {
    const value = observation(); Object.assign(value.queues[0], { state: "approved", lastState: "running", lastSeenAt: value.observedAt });
    expect(parseNodeQueueObservation(value), "Unsupported process states cannot be promoted").toBeNull();
  });
  it("keeps exact microsecond freshness and future boundaries", () => {
    for (const [at, state, count] of [
      ["2026-10-14T22:58:00.000000Z", "observed_running", 1],
      ["2026-10-14T22:57:59.999999Z", "stale", 0],
      ["2026-10-14T23:00:00.000001Z", "unknown", 0],
      ["2026-10-15T01:00:00.000001+02:00", "unknown", 0],
    ] as const) {
      const value = observation(); Object.assign(value.queues[0], { state, runningInstances: count, lastState: "running", lastSeenAt: at });
      expect(parseNodeQueueObservation(value), "Exact producer time boundaries must remain readable").toEqual(value);
    }
  });
  it("refuses producer time and state contradictions", () => {
    for (const facts of [
      { state: "observed_running", lastState: "running", lastSeenAt: "2026-10-14T23:00:00.000001Z", runningInstances: 1 },
      { state: "stale", lastState: "stopped", lastSeenAt: "2026-10-14T22:57:00.000000Z", runningInstances: 0 },
      { state: "stale", lastState: "running", lastSeenAt: "2026-10-14T22:59:00.000000Z", runningInstances: 0 },
      { state: "observed_running", lastState: "running", lastSeenAt: "2026-10-14T22:57:00.000000Z", runningInstances: 1 },
      { state: "unknown", lastState: "running", lastSeenAt: "2026-10-14T22:59:00.000000Z", runningInstances: 0 },
    ]) {
      const value = observation(); Object.assign(value.queues[0], facts);
      expect(parseNodeQueueObservation(value), "Inconsistent producer facts cannot pass operational health").toBeNull();
    }
  });
  it("keeps mixed instances readable when the latest row has another state", () => {
    for (const facts of [
      { state: "observed_running", lastState: "stopped", runningInstances: 1, stoppingInstances: 0 },
      { state: "observed_stopping", lastState: "stopped", runningInstances: 0, stoppingInstances: 1 },
      { state: "observed_running", lastState: "stopping", runningInstances: 1, stoppingInstances: 1 },
    ]) {
      const value = observation(); Object.assign(value.queues[0], facts, { lastSeenAt: value.observedAt });
      expect(parseNodeQueueObservation(value), "Mixed latest and active instance states must remain readable").toEqual(value);
    }
  });
  it("requires each fresh latest instance to contribute to its own state count", () => {
    for (const facts of [
      { state: "observed_stopping", lastState: "running", runningInstances: 0, stoppingInstances: 1 },
      { state: "observed_running", lastState: "stopping", runningInstances: 1, stoppingInstances: 0 },
    ]) {
      const value = observation(); Object.assign(value.queues[0], facts, { lastSeenAt: value.observedAt });
      expect(parseNodeQueueObservation(value), "Fresh latest instances must contribute to their own state count").toBeNull();
    }
  });
  it("refuses unsupported timestamp precision without rounding it into a claim", () => {
    const value = observation(); value.observedAt = "2026-10-14T23:00:00.0000001Z";
    expect(parseNodeQueueObservation(value), "Unsupported producer precision must remain unavailable").toBeNull();
  });
  it("refuses an unknown field rather than forwarding it", () => {
    const value = observation();
    expect(parseNodeQueueObservation({ ...value, privatePayload: "private-sentinel" }),
      "Operational reports cannot accept unknown fields").toBeNull();
    expect(parseNodeQueueObservation({ ...value, queues: [{ ...value.queues[0], privatePayload: "private-sentinel" }, ...value.queues.slice(1)] }),
      "Operational reports cannot accept unknown fields").toBeNull();
  });
});
