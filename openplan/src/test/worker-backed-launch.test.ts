import { describe, expect, it } from "vitest";

import {
  IN_PROCESS_ENGINE_KEYS,
  WORKER_BACKED_ENGINE_KEYS,
  assessWorkerLaunchReadiness,
  describeWorkerAbsenceEvidence,
  describeWorkerLaunchRefusal,
  describeWorkerQueueRisk,
  evaluateWorkerLaunchGate,
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

/**
 * The hole the declaration fills: every judgement above needs a run that has
 * ALREADY been abandoned, so the first launch on a fresh deployment could never
 * be refused — it was enqueued, waited, and was reaped, and the planner learned
 * nothing from it. An operator's declaration is the only thing that can be known
 * before any run exists, because the worker is a poller with nothing to probe.
 */
describe("refusing the first launch a deployment has ever been asked for", () => {
  const noHistory: WorkerBackedRunObservation[] = [];

  function gate(
    declaration: Parameters<typeof evaluateWorkerLaunchGate>[0]["declaration"],
    runs: WorkerBackedRunObservation[] = noHistory,
    engineKey = "aequilibrae"
  ) {
    return evaluateWorkerLaunchGate({ engineKey, declaration, runs, now: NOW });
  }

  const abandoned = (id: string, minutesAgo = 40): WorkerBackedRunObservation => ({
    id,
    engine_key: "aequilibrae",
    status: "failed",
    started_at: null,
    created_at: iso(NOW - minutesAgo * 60_000),
    stages: queuedStages(),
  });

  const executed = (id: string): WorkerBackedRunObservation => ({
    id,
    engine_key: "aequilibrae",
    status: "succeeded",
    started_at: iso(NOW - 30 * 60_000),
    created_at: iso(NOW - 31 * 60_000),
    stages: [{ status: "succeeded", started_at: iso(NOW - 30 * 60_000) }],
  });

  it("refuses a deployment that declares no worker before anything is queued", () => {
    const result = gate("absent");

    expect(result.refused).toBe(true);
    expect(result.reason).toBe("deployment_declares_no_worker");
    // There is no history, so there is nothing observed to assert.
    expect(result.evidence).toBeNull();
  });

  it("does not refuse a deployment that declares a worker and has no history", () => {
    // The reason to declare one: a correctly configured deployment must never
    // be refused a launch that would have worked.
    expect(gate("deployed").refused).toBe(false);
  });

  it("keeps claiming nothing where nothing has been declared and nothing observed", () => {
    expect(gate("undeclared").refused).toBe(false);
    expect(gate("unrecognized").refused).toBe(false);
  });

  it("reads a value it does not understand as no answer at all, never as an answer", () => {
    // A typo must not become a refusal; it falls back to inference, and the
    // dashboard tells the operator the value was ignored.
    expect(gate("unrecognized", [abandoned("run-1")]).reason).toBe("runs_were_never_started");
    expect(gate("unrecognized").refused).toBe(false);
  });

  it("lets a run that really executed override a stale declaration of absence", () => {
    // Evidence outranks configuration in both directions. A worker that has
    // demonstrably served this queue must not be refused because a variable was
    // never updated.
    expect(gate("absent", [executed("run-1")]).refused).toBe(false);
  });

  it("still refuses where a declared worker has not been picking runs up", () => {
    const result = gate("deployed", [abandoned("run-1"), abandoned("run-2")]);

    expect(result.refused).toBe(true);
    expect(result.reason).toBe("declared_worker_never_started");
    expect(result.evidence).toContain("The last 2 runs on this model that needed the modeling worker");
  });

  it("does not refuse an engine that runs inside this app, whatever is declared", () => {
    for (const engineKey of IN_PROCESS_ENGINE_KEYS) {
      expect(gate("absent", [abandoned("run-1")], engineKey).refused).toBe(false);
    }
  });

  it("does not offer a planner an override of the operator's own declaration", () => {
    // A checkbox saying "there is a worker really" cannot make a deployment's
    // stated configuration false; the person who changes it is named instead.
    expect(gate("absent").acknowledgementKey).toBeNull();
    expect(gate("absent", [abandoned("run-1")]).acknowledgementKey).toBeNull();
  });
});

describe("an acknowledgement that expires when fresh evidence arrives", () => {
  const abandoned = (id: string): WorkerBackedRunObservation => ({
    id,
    engine_key: "aequilibrae",
    status: "failed",
    started_at: null,
    created_at: iso(NOW - 40 * 60_000),
    stages: queuedStages(),
  });

  const keyFor = (runs: WorkerBackedRunObservation[]) =>
    evaluateWorkerLaunchGate({
      engineKey: "aequilibrae",
      declaration: "undeclared",
      runs,
      now: NOW,
    }).acknowledgementKey;

  it("keys the acknowledgement to the runs it was given for", () => {
    expect(keyFor([abandoned("run-1")])).toBe(keyFor([abandoned("run-1")]));
  });

  it("changes the key the moment another run is abandoned", () => {
    // The defect this closes: a planner ticked "a worker has been started", the
    // next run was reaped too, and the tick went on authorising launches into a
    // queue that had just eaten another one.
    expect(keyFor([abandoned("run-2"), abandoned("run-1")])).not.toBe(keyFor([abandoned("run-1")]));
  });

  it("changes the key even for rows carrying no identity of their own", () => {
    const anonymous = (): WorkerBackedRunObservation => ({
      engine_key: "aequilibrae",
      status: "failed",
      started_at: null,
      created_at: null,
      stages: queuedStages(),
    });

    expect(keyFor([anonymous(), anonymous()])).not.toBe(keyFor([anonymous()]));
  });
});

describe("what each refusal is allowed to say", () => {
  it("attributes a declared absence to the deployment, not to an observation", () => {
    const copy = describeWorkerLaunchRefusal("deployment_declares_no_worker", "Fast Screening", null);

    expect(copy.heading).toMatch(/this OpenPlan installation declares that it runs none/i);
    expect(copy.body).toMatch(/configuration states that no such worker runs against it/i);
    // It may not claim to have looked and found nothing.
    expect(`${copy.heading} ${copy.body}`).not.toMatch(/we (checked|found)|no worker was found/i);
    // The party who acts is the operator, and nothing is for sale.
    expect(copy.operatorAction).toMatch(/Whoever operates this OpenPlan installation/);
    expect(`${copy.heading} ${copy.body} ${copy.operatorAction}`).not.toMatch(
      /upgrade|subscription|billing|pricing|paid tier|plan tier|contact sales/i
    );
  });

  it("names the contradiction where a declared worker has not been starting runs", () => {
    const copy = describeWorkerLaunchRefusal(
      "declared_worker_never_started",
      "Fast Screening",
      "The last run on this model that needed the modeling worker was queued and never started by anything."
    );

    expect(copy.body).toMatch(/never started by anything/);
    expect(copy.body).toMatch(/not a live check/i);
    expect(copy.operatorAction).toMatch(/workers\/aequilibrae_worker\/DEPLOY\.md/);
  });

  it("keeps the inference-only refusal to what the runs show", () => {
    const copy = describeWorkerLaunchRefusal(
      "runs_were_never_started",
      "Fast Screening",
      "The last run on this model that needed the modeling worker was queued and never started by anything."
    );

    expect(copy.heading).toMatch(/nothing has been picking up the runs on this model/i);
    // Never the conclusion "this deployment has no worker" — unobservable here.
    expect(copy.heading).not.toMatch(/has no worker|runs none/i);
  });
});

describe("what a run already queued on the worker may be told", () => {
  const evidence = "The last run on this model that needed the modeling worker was queued and never started by anything.";

  it("says plainly that a declared-worker-less deployment will not finish it", () => {
    // This fires after a large sketch run is rerouted onto the worker queue
    // server-side, which the launch button cannot predict.
    expect(describeWorkerQueueRisk("absent", null)).toMatch(
      /declares that no AequilibraE worker runs against it/i
    );
    expect(describeWorkerQueueRisk("absent", null)).toMatch(/failed rather than finishing/i);
  });

  it("keeps both the observation and the declaration when they disagree", () => {
    const text = describeWorkerQueueRisk("deployed", evidence);
    expect(text).toContain(evidence);
    expect(text).toMatch(/disagree/i);
  });

  it("does not promise a declared worker is running right now", () => {
    expect(describeWorkerQueueRisk("deployed", null)).toMatch(/rather than a live check/i);
  });

  it("tells an undeclared deployment what happens if nothing takes the run", () => {
    // Retargeted 2026-08-15, exactly rather than loosened. Both sentences grew
    // the same clause — that nothing will come and tell them — after a tester
    // reasoned their way to that conclusion from a health panel instead of
    // being told it at the launch button. The no-evidence branch was rewritten
    // outright: it used to name only the condition for SUCCESS, which is the
    // half a planner about to press the button does not need.
    expect(describeWorkerQueueRisk("undeclared", evidence)).toBe(
      `${evidence} Unless a worker has been started on this installation since then, this run will sit queued and then be failed rather than finishing, and nothing will notify you — the dashboard will show it as a failed run when you next look.`
    );
    expect(describeWorkerQueueRisk("undeclared", null)).toBe(
      "Nobody has told OpenPlan whether a modeling worker runs on this installation, and it cannot check for itself. If none is running, this run will sit queued and then be marked failed rather than finishing, and nothing will notify you — the dashboard will show it as a failed run when you next look."
    );
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

    expect(one).toBe("The last run on this model that needed the modeling worker was queued and never started by anything.");
    expect(many).toContain("The last 3 runs on this model that needed the modeling worker");
    // The observation is a claim about runs, not a claim about the operator's
    // infrastructure, which is unobservable from here.
    expect(one).not.toMatch(/no worker (is|has been) deployed/i);
  });
});
