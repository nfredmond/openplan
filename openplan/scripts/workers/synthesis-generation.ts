import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { createServiceRoleClient } from "../../src/lib/supabase/server";
import { providerApiWorkerTarget } from "../../src/lib/assistant/provider-api-worker";
import { runSynthesisGenerationSchedule } from "../../src/lib/engagement/synthesis-generation-scheduler";
import { runSynthesisGenerationWorkerAttempt } from "../../src/lib/engagement/synthesis-generation-worker";

// Operate one task or drain the retained authorization. Repeating either command
// recovers the same journals; new provider attempts require native authorization.
async function main() {
  const options = process.argv.slice(2);
  const allTasks = options.length === 3 && options[2] === "--all-tasks";
  if (options[0] !== "--authorization" || (!allTasks &&
    (options.length !== 4 || options[2] !== "--task-index" || !/^(0|[1-9][0-9]*)$/.test(options[3])))) {
    throw new Error("synthesis_worker_options_invalid");
  }
  const authorizationId = z.string().uuid().parse(options[1]);
  const taskIndex = allTasks ? null : z.number().int().nonnegative().safe().parse(Number(options[3]));
  const target = providerApiWorkerTarget(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
  const root = process.env.OPENPLAN_SYNTHESIS_GENERATION_WORK_DIR || join(homedir(), ".local/state/openplan/synthesis-generation-worker");
  const directory = join(root, createHash("sha256").update(target).digest("hex"), authorizationId);
  const stopping = new AbortController(), stop = () => stopping.abort();
  process.on("SIGINT", stop); process.on("SIGTERM", stop);
  try {
    const shared = { service: createServiceRoleClient(), target, authorizationId, signal: stopping.signal };
    if (taskIndex === null) {
      const result = await runSynthesisGenerationSchedule({ ...shared, directory });
      const unobserved = result.outcomes.filter(outcome => outcome.state === "unobserved").length;
      console.log(`Synthesis grant: ${result.scheduledCount - unobserved} outputs retained; ${unobserved} dispatches unobserved; ${result.outsideScheduleCount} tasks outside this schedule. Output still needs complete analysis and review.`);
      if (unobserved > 0 || result.outsideScheduleCount > 0) process.exitCode = 2;
    } else {
      const result = await runSynthesisGenerationWorkerAttempt({ ...shared, directory: join(directory, String(taskIndex)), taskIndex });
      console.log(`Synthesis worker attempt: ${result.state}`);
      if (result.state === "unobserved") process.exitCode = 2;
    }
  } finally { process.off("SIGINT", stop); process.off("SIGTERM", stop); }
}
void main().catch(() => {
  console.error("Synthesis worker could not finish. Retain its private journal and retry the same command. Use --authorization UUID with --task-index INTEGER or --all-tasks.");
  process.exitCode = 1;
});
