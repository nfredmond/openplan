import { NODE_QUEUE_KINDS } from "@/lib/ops/node-queue-observation";

export function unobservedNodeQueues() {
  return { observedAt: "2026-10-14T23:00:00.000Z", scope: "process_only", jobCompletion: "unassessed",
    queues: NODE_QUEUE_KINDS.map(kind => ({ kind, lastSeenAt: null, lastState: null,
      runningInstances: 0, stoppingInstances: 0, state: "unobserved" })) };
}
