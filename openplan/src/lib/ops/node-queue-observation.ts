import { randomUUID } from "node:crypto";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { appCommitSha } from "@/lib/runtime/app-version";

export const NODE_QUEUE_KINDS = [
  "document-exports", "engagement-email", "provider-api", "translation-generation",
  "synthesis-preparation", "synthesis-execution", "contract-calculations", "gtfs-ingestion",
] as const;
export type NodeQueueKind = typeof NODE_QUEUE_KINDS[number];
type State = "running" | "stopping" | "stopped";
const INTERVAL_MS = 30_000;
const REQUEST_MS = 3_000;

/** Observe the event loop independently of job outcomes. Diagnostic failure
 * cannot approve, retry or fail the work. The final sequence fences late writes.
 */
export async function observeNodeQueue<T>(kind: NodeQueueKind, work: (noticeStopping: () => void) => Promise<T>): Promise<T> {
  if (process.argv.slice(2).includes("--help")) return work(() => {});
  if (!NODE_QUEUE_KINDS.includes(kind)) return work(() => {});
  const instance = randomUUID();
  const candidate = appCommitSha()?.trim().toLowerCase();
  const build = candidate && /^[a-f0-9]{7,40}$/.test(candidate) ? candidate : null;
  let state: State = "running", sequence = 0, warned = false;
  const activity: { current: { controller: AbortController; done: Promise<void> } | null } = { current: null };
  let timer: ReturnType<typeof setInterval> | undefined;
  const notice = () => { state = "stopping"; };
  const warn = () => {
    if (warned) return;
    warned = true;
    try { console.error("Node worker process observation is unavailable. Queue outcomes remain separate."); } catch { /* Diagnostics do not fail work. */ }
  };
  let client: ReturnType<typeof createServiceRoleClient>;
  try { client = createServiceRoleClient(); } catch { warn(); return work(() => {}); }
  async function send(value: State, number: number, signal: AbortSignal) {
    const ownCancellation = () => value !== "stopped" && state === "stopped" && signal.aborted;
    try {
      const result = await client.rpc("record_node_queue_process_observation", {
        p_worker_kind: kind, p_instance: instance, p_sequence: number, p_state: value, p_build_sha: build,
      }).abortSignal(signal);
      if (!ownCancellation() && (result.error || result.data !== true)) warn();
    } catch { if (!ownCancellation()) warn(); }
  }
  const pulse = () => {
    if (activity.current || state === "stopped") return;
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(REQUEST_MS)]);
    const done = send(state, ++sequence, signal).finally(() => { activity.current = null; });
    activity.current = { controller, done };
  };
  try {
    pulse(); timer = setInterval(pulse, INTERVAL_MS); timer.unref();
    return await work(notice);
  } finally {
    state = "stopped";
    if (timer) clearInterval(timer);
    const pending = activity.current;
    pending?.controller.abort();
    await pending?.done;
    await send("stopped", ++sequence, AbortSignal.timeout(REQUEST_MS));
  }
}
