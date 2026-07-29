/**
 * WORKER-BACKED LAUNCH — which run modes need a process outside this app, and
 * what may honestly be said about whether one is there, BEFORE the enqueue.
 *
 * WHY THIS EXISTS
 *   Two managed run modes do not execute inside OpenPlan. `aequilibrae` and the
 *   `behavioral_demand` preflight write `queued` stage rows and return 201; the
 *   work itself is done by a separate AequilibraE worker that POLLS that queue.
 *   On a deployment with no worker running, a planner is told the launch
 *   succeeded, watches nothing happen, and some minutes later is told by the
 *   reaper that the run failed. Two opposite answers, neither explaining
 *   anything, and no way to tell that the cause was infrastructure rather than
 *   their study area.
 *
 *   The reaper (`run-liveness.ts`, `/api/cron/reap-model-runs`) is the right
 *   backstop but the wrong first line: by the time it speaks the planner has
 *   already been told "queued" and has already waited. The truthful moment is
 *   before the button does anything.
 *
 * WHAT MAY BE CLAIMED, AND WHAT MAY NOT
 *   The worker is a poller. It has no endpoint to ping and no heartbeat column
 *   — `deployment-health.ts` and `run-liveness.ts` both stop at that same wall.
 *   So "this deployment has no worker" is NOT a fact this app can establish,
 *   and stating it would be exactly the confident-wrong answer the product
 *   forbids.
 *
 *   What IS a fact is the history sitting in front of us. A worker-backed run
 *   that reached a started stage proves a worker existed. A worker-backed run
 *   that ended with no stage EVER started proves nothing ever claimed it. This
 *   module reports that observation and its count; the caller presents it as
 *   evidence, names the deployment operator as the party who acts on it, and
 *   leaves the planner a way to proceed if a worker has since been started.
 *
 * PURE — no I/O and no clock of its own. `now` is passed in, and may be null
 * when the caller has not read a clock yet (React render is not allowed to),
 * which simply withholds the age-dependent branch instead of guessing.
 */

import { QUEUE_STALE_THRESHOLD_MS } from "./run-liveness";
import type { ManagedRunModeKey } from "./run-modes";

/**
 * Engines whose work happens in the AequilibraE worker process. `sketch_abm` is
 * deliberately NOT here even though a large study area is rerouted to the same
 * queue: which lane a sketch run takes is decided server-side from the resolved
 * tract count, so it cannot be known at the launch button. That reroute is
 * disclosed as a possibility rather than predicted.
 */
export const WORKER_BACKED_ENGINE_KEYS = [
  "aequilibrae",
  "behavioral_demand",
] as const satisfies readonly ManagedRunModeKey[];

/**
 * Engines that execute inside the request cycle and therefore keep working with
 * no worker anywhere. Ordered by how much a planner gets out of them, because
 * this is the list a refusal steers to.
 */
export const IN_PROCESS_ENGINE_KEYS = [
  "sketch_abm",
  "ite_trip_generation",
  "deterministic_corridor_v1",
] as const satisfies readonly ManagedRunModeKey[];

export function isWorkerBackedEngineKey(engineKey: string | null | undefined): boolean {
  return (WORKER_BACKED_ENGINE_KEYS as readonly string[]).includes(engineKey ?? "");
}

/** The stage fields this judgement reads. Structural, so any caller row fits. */
export type WorkerBackedStageObservation = {
  status?: string | null;
  started_at?: string | null;
};

/** The run fields this judgement reads. */
export type WorkerBackedRunObservation = {
  engine_key?: string | null;
  status?: string | null;
  started_at?: string | null;
  created_at?: string | null;
  stages?: WorkerBackedStageObservation[] | null;
};

export type WorkerLaunchReadiness =
  /** No worker-backed run here has yet produced a usable observation. */
  | { state: "unobserved" }
  /** Something executed a worker-backed run — a worker was really there. */
  | { state: "worker_observed" }
  /** The most recent worker-backed runs were queued and never started. */
  | { state: "no_worker_observed"; abandonedRunCount: number };

/** Did anything ever begin executing this run? */
function workerTouchedRun(run: WorkerBackedRunObservation): boolean {
  // The worker stamps `started_at` on the run when it flips it to running, and
  // on each stage as it begins. `succeeded` covers a run whose timestamps were
  // not selected by the caller — it cannot have succeeded untouched.
  if (run.status === "succeeded") return true;
  if (run.started_at) return true;
  return (run.stages ?? []).some((stage) => Boolean(stage.started_at));
}

function runAgeMs(run: WorkerBackedRunObservation, now: number | null): number | null {
  if (now === null) return null;
  const created = run.created_at ? new Date(run.created_at).getTime() : Number.NaN;
  return Number.isFinite(created) ? now - created : null;
}

/**
 * Was this run queued and then abandoned unstarted — the signature of nothing
 * polling the queue?
 *
 * Requires at least one stage row on purpose. A run with no stages at all
 * failed before its queue entry was even written (the launch route's
 * stage-insert error path), which says nothing about the worker; counting it
 * would turn a database problem into an accusation about infrastructure.
 * `cancelled` is excluded for the same reason — a person stopped that one.
 */
function isAbandonedUnstarted(run: WorkerBackedRunObservation, now: number | null): boolean {
  const stages = run.stages ?? [];
  if (stages.length === 0) return false;

  if (run.status === "failed") return true;

  if (run.status === "queued" || run.status === "running") {
    const age = runAgeMs(run, now);
    // Same threshold the reaper uses, so the launch control and the reaper can
    // never disagree about when waiting became abandonment.
    return age !== null && age > QUEUE_STALE_THRESHOLD_MS;
  }

  return false;
}

/**
 * Judge the most recent worker-backed evidence in `runs`, which must be ordered
 * NEWEST FIRST (the order the model page already loads them in).
 *
 * Recency decides. A worker that ran last month says nothing about the queue
 * right now, so the scan stops at the first run something demonstrably
 * executed: anything abandoned since then outranks it. Runs that are merely
 * inconclusive — still young in the queue — are skipped rather than treated as
 * either kind of evidence.
 */
export function assessWorkerLaunchReadiness(
  runs: readonly WorkerBackedRunObservation[],
  now: number | null
): WorkerLaunchReadiness {
  let abandonedRunCount = 0;
  let sawWorkerProgress = false;

  for (const run of runs) {
    if (!isWorkerBackedEngineKey(run.engine_key)) continue;

    if (workerTouchedRun(run)) {
      sawWorkerProgress = true;
      break;
    }

    if (isAbandonedUnstarted(run, now)) abandonedRunCount += 1;
  }

  if (abandonedRunCount > 0) return { state: "no_worker_observed", abandonedRunCount };
  return sawWorkerProgress ? { state: "worker_observed" } : { state: "unobserved" };
}

/**
 * The one sentence of evidence a refusal is allowed to assert, or null when
 * there is no such evidence. Deliberately describes only what was observed —
 * the inference drawn from it belongs to the surface saying it, so that a
 * reader can always separate the two.
 */
export function describeWorkerAbsenceEvidence(readiness: WorkerLaunchReadiness): string | null {
  if (readiness.state !== "no_worker_observed") return null;
  const { abandonedRunCount } = readiness;
  return abandonedRunCount === 1
    ? "The last worker-backed run on this model was queued and never started by anything."
    : `The last ${abandonedRunCount} worker-backed runs on this model were queued and never started by anything.`;
}
