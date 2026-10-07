import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { providerApiWorkerTarget } from "@/lib/assistant/provider-api-worker";
import { runSynthesisPreparationQueuePass } from "./synthesis-preparation-coordinator";

type Pass = Awaited<ReturnType<typeof runSynthesisPreparationQueuePass>>;
export function synthesisPreparationOptions(argv: string[], environment: Partial<NodeJS.ProcessEnv>) {
  if (argv.length === 1 && argv[0] === "--help") return { help: true as const };
  if (argv.length > 1 || (argv.length === 1 && argv[0] !== "--once")) throw new Error("preparation_worker_options_invalid");
  const target = providerApiWorkerTarget(environment.NEXT_PUBLIC_SUPABASE_URL ?? "");
  const root = environment.OPENPLAN_SYNTHESIS_PREPARATION_WORK_DIR || join(homedir(), ".local/state/openplan/synthesis-preparation-worker");
  if (!isAbsolute(root)) throw new Error("preparation_worker_directory_must_be_absolute");
  return { help: false as const, once: argv[0] === "--once", target,
    directory: join(root, createHash("sha256").update(target).digest("hex")) };
}

/** Supervise bounded passes without replacing uncertain attempts. A successful
 * pass does not mean the queue is drained or a plan is approved. Delays and
 * in-flight work share the caller's shutdown signal.
 */
export async function runSynthesisPreparationService(args: Parameters<typeof runSynthesisPreparationQueuePass>[0] & {
  once: boolean; report: (result: Pass) => void; reportError: () => void;
}) {
  async function pause(milliseconds: number) {
    try { await delay(milliseconds, undefined, { signal: args.signal }); }
    catch { if (!args.signal.aborted) throw new Error("preparation_worker_wait_failed"); }
  }
  while (!args.signal.aborted) {
    let result: Pass;
    try { result = await runSynthesisPreparationQueuePass(args); args.signal.throwIfAborted(); }
    catch {
      if (args.signal.aborted) return "stopped" as const;
      args.reportError();
      if (args.once) return "error" as const;
      await pause(5000); continue;
    }
    args.report(result);
    if (args.once) return result.pendingCount > 0 ? "unconfirmed" as const : "pass_complete" as const;
    await pause(result.pendingCount > 0 ? 5000 : 2000);
  }
  return "stopped" as const;
}
