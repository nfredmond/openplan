/**
 * Stale-run reaper — turns a stuck run into a truthful `failed` state.
 *
 * Given a set of non-terminal runs (each with its stages), classify each with
 * the pure `run-liveness` predicate and, for the stale ones, call the atomic
 * `reap_model_run_if_stale` RPC (see migration 20260722000004).
 *
 * The RPC re-validates progress across BOTH model_runs and model_run_stages
 * inside one transaction, so a worker that claims a long-queued run — or
 * streams a fresh `log_tail` on an in-flight stage — between our snapshot read
 * and the reap write is never clobbered. `model_runs.updated_at` alone is NOT a
 * usable guard: it freezes for the life of a `running` run (only the per-stage
 * heartbeat advances), which is why the reap runs server-side across both
 * tables rather than as a client-side status-only guarded update. The `client`
 * MUST be a service-role client (the RPC is granted to service_role only).
 */

import {
  classifyRunLiveness,
  isWorkerLikelyAlive,
  lastProgressMs,
  stalenessMessage,
  type LivenessRun,
  type RunLiveness,
} from "./run-liveness";

export interface ReaperRun extends LivenessRun {
  id: string;
}

/** Minimal structural view of the supabase RPC call, so the reaper is
 * unit-testable with a lightweight mock. */
export interface ReaperClient {
  rpc(fn: string, params: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
}

export interface ReapResult {
  scanned: number;
  reapedRunIds: string[];
  details: Array<{ id: string; liveness: Exclude<RunLiveness, "ok"> }>;
}

/**
 * Reap any stale runs in `runs`.
 * @param opts.workerLikelyAlive optional override for the queued-run guard.
 *   Callers that only see one model's runs (the page loader) should pass a
 *   GLOBAL signal so a queued run isn't falsely reaped while the single worker
 *   is busy on a different model. When omitted, it is computed from `runs`
 *   (correct for the cron sweep, which loads every non-terminal run).
 */
export async function reapStaleRuns(
  client: ReaperClient,
  runs: ReaperRun[],
  now: number,
  opts?: { workerLikelyAlive?: boolean }
): Promise<ReapResult> {
  const workerLikelyAlive = opts?.workerLikelyAlive ?? isWorkerLikelyAlive(runs, now);
  const reapedRunIds: string[] = [];
  const details: ReapResult["details"] = [];

  for (const run of runs) {
    const liveness = classifyRunLiveness(run, now, { workerLikelyAlive });
    if (liveness === "ok") continue;

    const message = stalenessMessage(liveness);
    // Freshest progress we observed at snapshot. The RPC reaps only if nothing
    // has advanced past this on either table, atomically — so a worker that
    // resumes in the read→write gap wins the race and the reap no-ops.
    const staleBefore = new Date(lastProgressMs(run) ?? now).toISOString();

    const { data, error } = await client.rpc("reap_model_run_if_stale", {
      p_run_id: run.id,
      p_stale_before: staleBefore,
      p_message: message,
    });

    if (error || data !== true) continue;

    reapedRunIds.push(run.id);
    details.push({ id: run.id, liveness });
  }

  return { scanned: runs.length, reapedRunIds, details };
}
