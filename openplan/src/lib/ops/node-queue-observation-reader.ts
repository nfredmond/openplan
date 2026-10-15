import { z } from "zod";
import { NODE_QUEUE_KINDS } from "./node-queue-observation";

const row = z.object({
  kind: z.enum(NODE_QUEUE_KINDS),
  lastSeenAt: z.string().datetime({ offset: true }).nullable(),
  lastState: z.enum(["running", "stopping", "stopped"]).nullable(),
  runningInstances: z.number().int().nonnegative(),
  stoppingInstances: z.number().int().nonnegative(),
  state: z.enum(["observed_running", "observed_stopping", "last_observed_stopped", "unobserved", "stale", "unknown"]),
}).strict();

/** PostgreSQL timestamptz reports microseconds; preserve them across freshness boundaries. */
function micros(value: string): bigint | null {
  const match = /^(.*?:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) return null;
  const milliseconds = Date.parse(match[1] + match[3]);
  return Number.isFinite(milliseconds) ? BigInt(milliseconds) * BigInt(1000) + BigInt((match[2] ?? "").padEnd(6, "0")) : null;
}
const observation = z.object({
  observedAt: z.string().datetime({ offset: true }),
  scope: z.literal("process_only"), jobCompletion: z.literal("unassessed"),
  queues: z.array(row).length(NODE_QUEUE_KINDS.length)
    .refine(rows => new Set(rows.map(value => value.kind)).size === NODE_QUEUE_KINDS.length),
}).strict().refine(value => {
  const now = micros(value.observedAt);
  if (now === null) return false;
  return value.queues.every(item => {
    if (item.lastSeenAt === null || item.lastState === null) {
      return item.lastSeenAt === null && item.lastState === null && item.runningInstances === 0
        && item.stoppingInstances === 0 && item.state === "unobserved";
    }
    const seen = micros(item.lastSeenAt);
    if (seen === null) return false;
    if (seen > now) return item.state === "unknown";
    const recent = seen >= now - BigInt(120_000_000);
    if (!recent && (item.runningInstances > 0 || item.stoppingInstances > 0)) return false;
    if (item.runningInstances > 0) return item.state === "observed_running"
      && (item.lastState !== "stopping" || item.stoppingInstances > 0);
    if (item.stoppingInstances > 0) return item.state === "observed_stopping" && item.lastState !== "running";
    if (item.lastState === "stopped") return item.state === "last_observed_stopped";
    return !recent && item.state === "stale";
  });
});

/** Unreadable or inconsistent observations remain unavailable, never zero workers. */
export function parseNodeQueueObservation(input: unknown) {
  const parsed = observation.safeParse(input);
  return parsed.success ? parsed.data : null;
}
