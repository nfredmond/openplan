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
 *   So "this deployment has no worker" is NOT a fact this app can OBSERVE, and
 *   stating it from observation would be exactly the confident-wrong answer the
 *   product forbids.
 *
 *   What IS a fact is the history sitting in front of us. A worker-backed run
 *   that reached a started stage proves a worker existed. A worker-backed run
 *   that ended with no stage EVER started proves nothing ever claimed it. This
 *   module reports that observation and its count; the caller presents it as
 *   evidence, names the deployment operator as the party who acts on it, and
 *   leaves the planner a way to proceed if a worker has since been started.
 *
 * THE SECOND SOURCE: WHAT THE DEPLOYMENT DECLARES
 *   Inference alone is RETROSPECTIVE, and that was a real hole. Evidence of an
 *   abandoned run only exists after a run has been abandoned, so on a fresh
 *   deployment the very first launch was enqueued, waited, and was reaped
 *   minutes later — the exact experience this module was written to prevent,
 *   suffered once by every new deployment before the guard could say anything.
 *
 *   The fix is the one the aerial and county-onramp lanes already use: the
 *   operator DECLARES the worker (`ModelingWorkerDeclaration`, from
 *   `deployment-health.ts`), and the launch control reads the declaration
 *   before it reads the history. A declaration is not an observation and is
 *   never presented as one — it is a statement of configuration, attributed to
 *   the deployment, and it can be wrong.
 *
 *   Which is why observed history OUTRANKS it in both directions: a run that
 *   really executed clears a stale "no worker" declaration, and runs that were
 *   never picked up still refuse a launch even where a worker is declared. The
 *   declaration only decides the case evidence cannot reach — no history at all.
 *
 * PURE — no I/O and no clock of its own. `now` is passed in, and may be null
 * when the caller has not read a clock yet (React render is not allowed to),
 * which simply withholds the age-dependent branch instead of guessing.
 */

import type { ModelingWorkerDeclaration } from "@/lib/config/deployment-health";
import { QUEUE_STALE_THRESHOLD_MS } from "./run-liveness";
import type { ManagedRunModeKey } from "./run-modes";

export type { ModelingWorkerDeclaration };

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
  /**
   * Optional, and read only to fingerprint WHICH runs the evidence rests on —
   * never to fetch anything. A planner's acknowledgement of a refusal has to
   * expire when new evidence arrives, and that requires being able to tell one
   * set of abandoned runs from the next.
   */
  id?: string | null;
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
 * The single scan behind every judgement here, so the verdict, the sentence a
 * refusal may assert, and the fingerprint an acknowledgement expires against
 * can never be computed from different readings of the same rows.
 *
 * Runs must be ordered NEWEST FIRST (the order the model page already loads
 * them in). Recency decides: a worker that ran last month says nothing about
 * the queue right now, so the scan stops at the first run something
 * demonstrably executed — anything abandoned since then outranks it. Runs that
 * are merely inconclusive (still young in the queue) are skipped rather than
 * treated as either kind of evidence.
 */
function scanWorkerEvidence(runs: readonly WorkerBackedRunObservation[], now: number | null) {
  const abandoned: WorkerBackedRunObservation[] = [];
  let sawWorkerProgress = false;

  for (const run of runs) {
    if (!isWorkerBackedEngineKey(run.engine_key)) continue;

    if (workerTouchedRun(run)) {
      sawWorkerProgress = true;
      break;
    }

    if (isAbandonedUnstarted(run, now)) abandoned.push(run);
  }

  return { abandoned, sawWorkerProgress };
}

/** Judge the most recent worker-backed evidence in `runs` (newest first). */
export function assessWorkerLaunchReadiness(
  runs: readonly WorkerBackedRunObservation[],
  now: number | null
): WorkerLaunchReadiness {
  const { abandoned, sawWorkerProgress } = scanWorkerEvidence(runs, now);

  if (abandoned.length > 0) {
    return { state: "no_worker_observed", abandonedRunCount: abandoned.length };
  }
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

/** Why a launch is being refused before enqueue. Null when it is not. */
export type WorkerLaunchRefusalReason =
  /** The deployment itself declares no worker, and no run contradicts that. */
  | "deployment_declares_no_worker"
  /** A worker IS declared, but the runs in front of us were never picked up. */
  | "declared_worker_never_started"
  /** Nothing is declared; the refusal rests entirely on abandoned runs. */
  | "runs_were_never_started";

export type WorkerLaunchGate = {
  refused: boolean;
  reason: WorkerLaunchRefusalReason | null;
  /** The one sentence of run evidence this refusal may assert, or null. */
  evidence: string | null;
  /**
   * Identifies the evidence this refusal rests on, or null when the refusal is
   * not the planner's to wave away.
   *
   * A planner may say "a worker has been started since those runs" — the app
   * cannot see that for itself, and refusing them forever would be a wall with
   * no door. But an acknowledgement is only ever an answer to the evidence in
   * front of them, so the caller stores this key with it and offers the
   * override only while the key still matches. New abandoned runs produce a new
   * key, and the refusal re-asserts itself instead of a stale tick continuing
   * to authorise launches into a queue that has since eaten another run.
   *
   * Null when the deployment itself declares no worker: that is a statement by
   * whoever operates the deployment, and a planner ticking a box does not make
   * it false. Changing it is the operator's job, and the refusal says so.
   */
  acknowledgementKey: string | null;
};

const NOT_REFUSED: WorkerLaunchGate = {
  refused: false,
  reason: null,
  evidence: null,
  acknowledgementKey: null,
};

/**
 * Fingerprint of the runs a refusal rests on. Count first so that a new
 * abandonment always changes the key even where rows carry no identity at all.
 */
function acknowledgementKeyFor(abandoned: readonly WorkerBackedRunObservation[]): string {
  const identities = abandoned.map((run) => run.id ?? run.created_at ?? "unidentified");
  return `${abandoned.length}:${identities.join("|")}`;
}

/**
 * Should this launch be refused before anything is enqueued, and on what basis?
 *
 * Order is the design (see the module header): a run that demonstrably executed
 * clears everything, then an explicit declaration of no worker refuses, then
 * abandoned runs refuse. A deployment that declares a worker and has no
 * abandoned runs is never refused — which is the point of declaring one.
 */
export function evaluateWorkerLaunchGate(params: {
  engineKey: string | null | undefined;
  declaration: ModelingWorkerDeclaration;
  runs: readonly WorkerBackedRunObservation[];
  now: number | null;
}): WorkerLaunchGate {
  const { engineKey, declaration, runs, now } = params;

  // An engine that executes in this process cannot be blocked by a worker that
  // does not exist, whatever the deployment declares.
  if (!isWorkerBackedEngineKey(engineKey)) return NOT_REFUSED;

  const { abandoned, sawWorkerProgress } = scanWorkerEvidence(runs, now);

  // Something really ran here. That outranks any declaration, including a stale
  // "absent" one — refusing a launch the deployment has demonstrably served
  // would be the same defect in the opposite direction.
  if (abandoned.length === 0 && sawWorkerProgress) return NOT_REFUSED;

  const evidence =
    abandoned.length > 0
      ? describeWorkerAbsenceEvidence({
          state: "no_worker_observed",
          abandonedRunCount: abandoned.length,
        })
      : null;

  // `unrecognized` deliberately falls through to the inference path with
  // `undeclared`: a value OpenPlan does not understand may not be read as an
  // answer. The dashboard tells the operator it was ignored.
  if (declaration === "absent") {
    return {
      refused: true,
      reason: "deployment_declares_no_worker",
      evidence,
      acknowledgementKey: null,
    };
  }

  if (abandoned.length > 0) {
    return {
      refused: true,
      reason: declaration === "deployed" ? "declared_worker_never_started" : "runs_were_never_started",
      evidence,
      acknowledgementKey: acknowledgementKeyFor(abandoned),
    };
  }

  return NOT_REFUSED;
}

export type WorkerLaunchRefusalCopy = {
  /** Claims no more than the body does. */
  heading: string;
  /** What launching would actually do, and the evidence for saying so. */
  body: string;
  /** Who acts, and on what. Never a plan, a tier, or a purchase. */
  operatorAction: string;
};

/**
 * The words a refusal is allowed to use, per reason.
 *
 * Kept out of the component so each sentence can be tested for what it claims
 * without rendering anything, and so the three refusals cannot drift into
 * saying the same thing about different situations. `modeLabel` is passed in
 * because the run modes own their own names.
 */
export function describeWorkerLaunchRefusal(
  reason: WorkerLaunchRefusalReason,
  modeLabel: string,
  evidence: string | null
): WorkerLaunchRefusalCopy {
  const doesNotRunHere = `${modeLabel} does not run inside OpenPlan. Launching it puts stages on a queue that a separate AequilibraE worker polls and executes.`;
  const whatWouldHappen =
    "this launch would report success, the run would sit queued, and it would be failed some minutes later with nothing to show.";
  const nothingToBuy =
    "Nothing about this workspace, this account or this study area is blocking it, and there is nothing to buy — OpenPlan is free.";

  if (reason === "deployment_declares_no_worker") {
    return {
      heading: `${modeLabel} needs a processing worker, and this deployment declares that it runs none`,
      body: `${doesNotRunHere} This deployment's configuration states that no such worker runs against it, so nothing would serve that queue: ${whatWouldHappen}${evidence ? ` ${evidence}` : ""}`,
      operatorAction: `${nothingToBuy} Whoever operates this deployment starts the worker — the steps are in workers/aequilibrae_worker/DEPLOY.md — and updates the declaration (OPENPLAN_MODELING_WORKER) to say so. Until the deployment says otherwise, this control refuses rather than queueing a run that cannot finish; a checkbox here would only override the operator's own answer.`,
    };
  }

  if (reason === "declared_worker_never_started") {
    return {
      heading: `${modeLabel} needs a processing worker, and the one this deployment declares has not been picking up its runs`,
      body: `${doesNotRunHere} This deployment declares that an AequilibraE worker runs against it. ${evidence ?? ""} A declaration is a statement of configuration, not a heartbeat — the worker polls and cannot be probed from here — so what is on screen is the run history contradicting the configuration. On this evidence ${whatWouldHappen}`,
      operatorAction: `${nothingToBuy} Whoever operates this deployment checks that the worker is running and pointed at this deployment's own Supabase project, and reads its logs; the steps are in workers/aequilibrae_worker/DEPLOY.md.`,
    };
  }

  return {
    heading: `${modeLabel} needs a processing worker, and nothing has been picking up the worker-backed runs on this model`,
    body: `${doesNotRunHere} ${evidence ?? ""} That is what an absent worker looks like: ${whatWouldHappen}`,
    operatorAction: `${nothingToBuy} Whoever operates this deployment starts the worker; the steps are in workers/aequilibrae_worker/DEPLOY.md.`,
  };
}

/**
 * What a "this run was queued on the worker" notice may add about whether
 * anything is going to serve that queue.
 *
 * Separate from the refusal because this fires AFTER an enqueue that was
 * allowed — a large sketch run rerouted server-side onto the worker queue. The
 * launch button cannot predict that reroute (the zone count is resolved
 * server-side), so the honest moment for this deployment's answer is the notice.
 */
export function describeWorkerQueueRisk(
  declaration: ModelingWorkerDeclaration,
  evidence: string | null
): string {
  const observed = evidence ? `${evidence} ` : "";

  if (declaration === "absent") {
    return `${observed}This deployment declares that no AequilibraE worker runs against it, so this run will sit queued and then be failed rather than finishing.`;
  }

  if (declaration === "deployed") {
    return observed
      ? `${observed}This deployment declares that an AequilibraE worker runs against it, so the configuration and the history disagree — the worker polls and has no heartbeat, so both can only be reported, not resolved.`
      : "This deployment declares that an AequilibraE worker runs against it, which is a statement of configuration rather than a live check — the worker polls and has no heartbeat.";
  }

  return observed
    ? `${observed}Unless a worker has been started on this deployment since then, this run will sit queued and then be failed rather than finishing.`
    : "It finishes only while a worker is polling this deployment.";
}
