import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { RUN_STALE_THRESHOLD_MS, stalenessMessage } from "./run-liveness";
import { reapStaleRuns, type ReaperClient, type ReaperRun } from "./run-reaper";

/**
 * Reconcile-on-read for the model page loader. Reaps any stale runs among the
 * loaded set (worker crashed, or never picked the run up) and returns a map of
 * runId → actionable failure message so the caller can reflect the reap in the
 * rendered payload without a re-query.
 *
 * Best-effort: never throws (the cron sweep at /api/cron/reap-model-runs is the
 * no-viewer backstop). Uses the service-role client so the guarded reap writes
 * bypass RLS, and a lightweight GLOBAL "is the worker alive" probe so a queued
 * run is not falsely reaped while the single worker is busy on another model.
 */
export async function reconcileStaleModelRuns(rawModelRuns: ReaperRun[]): Promise<Map<string, string>> {
  const messages = new Map<string, string>();

  const hasNonTerminal = rawModelRuns.some((r) => r.status === "queued" || r.status === "running");
  if (!hasNonTerminal) return messages;

  try {
    const serviceClient = createServiceRoleClient();
    const now = Date.now();

    const { data: aliveProbe } = await serviceClient
      .from("model_run_stages")
      .select("run_id")
      .eq("status", "running")
      .gt("updated_at", new Date(now - RUN_STALE_THRESHOLD_MS).toISOString())
      .limit(1);
    const workerLikelyAlive = Boolean(aliveProbe && aliveProbe.length > 0);

    const reap = await reapStaleRuns(serviceClient as unknown as ReaperClient, rawModelRuns, now, {
      workerLikelyAlive,
    });
    for (const detail of reap.details) {
      messages.set(detail.id, stalenessMessage(detail.liveness));
    }
  } catch {
    // Reconcile is best-effort; the cron sweep will catch anything missed.
  }

  return messages;
}
