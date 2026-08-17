/**
 * The heartbeat a scheduled job stamps on success, and how the product reads it
 * to tell the truth about whether a cron is actually running.
 *
 * The reminder panel used to claim reminders were on whenever CRON_SECRET was
 * set — but a self-hoster sets that secret for the model-run reaper and may
 * never schedule the deadline sweep, so the claim was false (found 2026-08-17).
 * A recorded success is evidence a job ran; a configured secret is not. Both
 * the writer (the cron route) and the reader (the My Work layout) use the
 * service-role client, because `cron_job_heartbeats` is locked to it.
 */

/** Job-name keys. Add the string a route stamps here so the set is enumerable. */
export const CRON_JOB_SWEEP_DEADLINES = "sweep-deadlines";

/**
 * Freshness of a scheduled job, derived from its last recorded success — never
 * from whether a secret is set.
 *
 * - `never`   — no success ever recorded. The job may be unscheduled entirely.
 * - `stale`   — it ran once but not within the window its cadence expects, so
 *               the schedule has likely stopped.
 * - `healthy` — a success within the window.
 */
export type CronFreshness = "never" | "stale" | "healthy";

type HeartbeatClient = {
  from: (table: string) => {
    upsert: (
      values: Record<string, unknown>,
      options?: { onConflict?: string }
    ) => Promise<{ error: { message: string } | null }>;
    select: (columns: string) => {
      eq: (column: string, value: string) => {
        maybeSingle: () => Promise<{
          data: { last_succeeded_at?: string | null } | null;
          error: { message: string } | null;
        }>;
      };
    };
  };
};

/**
 * Stamp a successful run. Best-effort by contract: a heartbeat write that fails
 * must never fail the job it reports on, so callers log and move on. Returns
 * the error rather than throwing so a caller can log it.
 */
export async function recordCronHeartbeat(
  client: HeartbeatClient,
  jobName: string,
  detail: Record<string, unknown> = {},
  now: Date = new Date()
): Promise<{ error: string | null }> {
  const stamp = now.toISOString();
  // Truly non-throwing: a heartbeat is diagnostic, and it may never fail the job
  // it reports on — a missing table, a rejected write, or a malformed client all
  // come back as an error string for the caller to log, never as an exception.
  try {
    const write = await client
      .from("cron_job_heartbeats")
      .upsert(
        { job_name: jobName, last_succeeded_at: stamp, detail, updated_at: stamp },
        { onConflict: "job_name" }
      );
    return { error: write.error?.message ?? null };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "the heartbeat write threw" };
  }
}

/** Read a job's last recorded success, or null if none / unreadable. */
export async function readCronHeartbeatAt(
  client: HeartbeatClient,
  jobName: string
): Promise<string | null> {
  const read = await client
    .from("cron_job_heartbeats")
    .select("last_succeeded_at")
    .eq("job_name", jobName)
    .maybeSingle();
  if (read.error || !read.data) return null;
  const value = read.data.last_succeeded_at;
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Classify freshness. `staleAfterHours` is how long past the last success the
 * job is still considered healthy — for a daily cron, 48h gives a full missed
 * day of slack before the panel reports trouble, so a single skipped or delayed
 * run does not cry wolf.
 */
export function classifyCronFreshness(
  lastSucceededAt: string | null,
  now: Date = new Date(),
  staleAfterHours = 48
): CronFreshness {
  if (!lastSucceededAt) return "never";
  const last = Date.parse(lastSucceededAt);
  if (Number.isNaN(last)) return "never";
  const ageMs = now.getTime() - last;
  return ageMs <= staleAfterHours * 3_600_000 ? "healthy" : "stale";
}
