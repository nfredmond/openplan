import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { providerApiWorkerTarget } from "@/lib/assistant/provider-api-worker";
import { runSynthesisExecutionQueuePass } from "./synthesis-execution-queue-coordinator";

type Pass = Awaited<ReturnType<typeof runSynthesisExecutionQueuePass>>;
/** Diagnostics never grant retries or imply that a refused call was unsent. */
export function synthesisExecutionDiagnostics(result: Pass): string[] {
  return result.outcomes.flatMap(item => {
    if (item.state !== "unconfirmed") return [];
    if (item.reason === "endpoint_policy") return [`Queue ${item.queueId}: provider endpoint policy refused execution. Check the worker process OPENPLAN_AI_LOCAL_ENDPOINTS and outbound host policy. Preserve its journals and inspect saved task results before any retry; dispatch may already be retained.`];
    if (item.reason === "task_bytes" && item.resource) {
      const { taskIndex, requiredTaskBytes, taskByteLimit } = item.resource;
      return [`Queue ${item.queueId}: task index ${taskIndex} requires ${requiredTaskBytes} bytes, exceeding its saved ${taskByteLimit}-byte limit. Preserve the original request and journals. Review complete saved results before creating a separate request with an explicit larger task budget and separate execution permission. This does not authorize a retry or shorten source text.`];
    }
    return [];
  });
}

export function synthesisExecutionOptions(argv: string[], environment: Partial<NodeJS.ProcessEnv>) {
  if (argv.length === 1 && argv[0] === "--help") return { help: true as const };
  if (argv.length > 1 || (argv.length === 1 && argv[0] !== "--once")) throw new Error("execution_worker_options_invalid");
  const target = providerApiWorkerTarget(environment.NEXT_PUBLIC_SUPABASE_URL ?? "");
  const root = environment.OPENPLAN_SYNTHESIS_GENERATION_WORK_DIR || join(homedir(), ".local/state/openplan/synthesis-generation-worker");
  if (!isAbsolute(root)) throw new Error("execution_worker_directory_must_be_absolute");
  return { help: false as const, once: argv[0] === "--once", target, root,
    directory: join(root, createHash("sha256").update(target).digest("hex"), "queue-coordinator") };
}

/** Supervise bounded passes without replacing uncertain attempts. A successful
 * pass does not mean the queue is drained or a plan is approved. Delays and
 * in-flight work share the caller's shutdown signal.
 */
export async function runSynthesisExecutionService(args: Parameters<typeof runSynthesisExecutionQueuePass>[0] & {
  once: boolean; report: (result: Pass) => void; reportError: () => void;
}) {
  async function pause(milliseconds: number) {
    try { await delay(milliseconds, undefined, { signal: args.signal }); }
    catch { if (!args.signal.aborted) throw new Error("execution_worker_wait_failed"); }
  }
  while (!args.signal.aborted) {
    let result: Pass;
    try { result = await runSynthesisExecutionQueuePass(args); args.signal.throwIfAborted(); }
    catch {
      if (args.signal.aborted) return "stopped" as const;
      args.reportError();
      if (args.once) return "error" as const;
      await pause(5000); continue;
    }
    args.report(result);
    if (args.once) return result.outcomes.some(item => item.state === "unconfirmed") ? "unconfirmed" as const : "pass_complete" as const;
    await pause(result.outcomes.some(item => item.state === "unconfirmed") ? 5000 : 2000);
  }
  return "stopped" as const;
}
