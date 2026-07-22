/**
 * Run-liveness predicate — decides when a model run has stopped making
 * progress and should be reaped to a truthful `failed` state.
 *
 * The AequilibraE worker has no heartbeat/lease column; its only recurring
 * liveness signal is `updated_at`, which the `set_*_updated_at` triggers bump
 * on every stage `log_tail` patch the worker streams during a stage. So a run
 * that is genuinely slow-but-progressing keeps `updated_at` fresh and is NOT
 * reaped, while a run whose worker crashed (or was never picked up) goes stale.
 *
 * This module is PURE (no I/O) so it can be unit-tested and reused by both the
 * reconcile-on-read path (the model page loader) and the cron sweep.
 */

/** A queued run that no worker touches anywhere within this window is treated
 * as abandoned — the worker is offline. Generous because a single worker
 * processes stages serially; a run only counts as "never claimed" when no
 * other run is actively progressing (see `workerLikelyAlive`). */
export const QUEUE_STALE_THRESHOLD_MS = 15 * 60 * 1000;

/** A run with a `running` stage whose heartbeat (`updated_at`) has been frozen
 * this long is treated as crashed mid-run. Conservative — a real screening
 * run streams `log_tail` patches well inside this window; the bound only has
 * to exceed the worst-case SILENT gap within one stage (notably around the
 * AequilibraE assignment). Wave 2.5's live timing should confirm/tune it. */
export const RUN_STALE_THRESHOLD_MS = 45 * 60 * 1000;

const TERMINAL_STATUSES = new Set(["succeeded", "failed", "cancelled"]);

export interface LivenessStage {
  status: string;
  started_at?: string | null;
  completed_at?: string | null;
  updated_at?: string | null;
}

export interface LivenessRun {
  status: string;
  created_at?: string | null;
  started_at?: string | null;
  updated_at?: string | null;
  stages?: LivenessStage[] | null;
}

export type RunLiveness = "ok" | "stale_queued" | "stale_running";

function toMs(value?: string | null): number | null {
  if (!value) return null;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : null;
}

export function isTerminalRun(run: Pick<LivenessRun, "status">): boolean {
  return TERMINAL_STATUSES.has(run.status);
}

function hasRunningStage(run: LivenessRun): boolean {
  if (run.status === "running") return true;
  return (run.stages ?? []).some((stage) => stage.status === "running");
}

/**
 * Freshest progress signal for a run — the implicit heartbeat. Takes the max
 * of the run's own timestamps (`created_at`/`started_at`/`updated_at`) and
 * every stage timestamp. `updated_at` is the load-bearing one: the worker
 * bumps it on each `log_tail` patch, so it advances while a stage is actively
 * executing and freezes the moment the worker dies.
 */
export function lastProgressMs(run: LivenessRun): number | null {
  const times: number[] = [];
  for (const value of [run.created_at, run.started_at, run.updated_at]) {
    const t = toMs(value);
    if (t !== null) times.push(t);
  }
  for (const stage of run.stages ?? []) {
    for (const value of [stage.started_at, stage.completed_at, stage.updated_at]) {
      const t = toMs(value);
      if (t !== null) times.push(t);
    }
  }
  return times.length ? Math.max(...times) : null;
}

/**
 * Is the modeling worker demonstrably alive? True when ANY run in the set has
 * a `running` stage whose heartbeat is fresh (within RUN_STALE_THRESHOLD_MS).
 * Used to avoid reaping a merely-QUEUED run that is legitimately waiting behind
 * another run in the single-worker serial queue — if something is actively
 * progressing, a queued run is waiting, not abandoned.
 */
export function isWorkerLikelyAlive(runs: LivenessRun[], now: number): boolean {
  return runs.some((run) => {
    if (!hasRunningStage(run)) return false;
    const last = lastProgressMs(run);
    return last !== null && now - last <= RUN_STALE_THRESHOLD_MS;
  });
}

/**
 * Classify a single run's liveness at time `now`.
 * - `stale_running`: a stage is `running` but its heartbeat froze past
 *   RUN_STALE_THRESHOLD_MS — the worker crashed mid-run. This is per-run and
 *   independent of any other run.
 * - `stale_queued`: nothing is running for this run, it has waited past
 *   QUEUE_STALE_THRESHOLD_MS, AND the worker is not demonstrably alive
 *   elsewhere — nobody ever picked it up.
 * - `ok`: terminal, progressing, or legitimately waiting.
 */
export function classifyRunLiveness(
  run: LivenessRun,
  now: number,
  opts: { workerLikelyAlive: boolean }
): RunLiveness {
  if (isTerminalRun(run)) return "ok";

  if (hasRunningStage(run)) {
    const last = lastProgressMs(run);
    if (last === null) return "ok";
    return now - last > RUN_STALE_THRESHOLD_MS ? "stale_running" : "ok";
  }

  // Queued / no stage running.
  if (opts.workerLikelyAlive) return "ok";
  const anchor = lastProgressMs(run);
  if (anchor === null) return "ok";
  return now - anchor > QUEUE_STALE_THRESHOLD_MS ? "stale_queued" : "ok";
}

const QUEUE_STALE_MINUTES = Math.round(QUEUE_STALE_THRESHOLD_MS / 60000);
const RUN_STALE_MINUTES = Math.round(RUN_STALE_THRESHOLD_MS / 60000);

/** Actionable, honest failure message for a reaped run. */
export function stalenessMessage(liveness: RunLiveness): string {
  if (liveness === "stale_queued") {
    return (
      `No modeling worker picked up this run within ${QUEUE_STALE_MINUTES} minutes. ` +
      `The AequilibraE worker may be offline — start the worker, then re-launch this run.`
    );
  }
  if (liveness === "stale_running") {
    return (
      `This run stopped reporting progress for over ${RUN_STALE_MINUTES} minutes; the modeling ` +
      `worker likely crashed or was interrupted mid-run. Re-launch to retry.`
    );
  }
  return "";
}
