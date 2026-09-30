import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { createServiceRoleClient } from "../../src/lib/supabase/server";
import { providerApiWorkerTarget } from "../../src/lib/assistant/provider-api-worker";
import { runSynthesisGenerationWorkerAttempt } from "../../src/lib/engagement/synthesis-generation-worker";

// Operate one explicitly authorized task. Repeat the same command to recover
// custody; a new provider attempt requires a separate native authorization.
async function main() {
  const options = process.argv.slice(2);
  if (options.length !== 4 || options[0] !== "--authorization" || options[2] !== "--task-index" || !/^(0|[1-9][0-9]*)$/.test(options[3])) {
    throw new Error("synthesis_worker_options_invalid");
  }
  const authorizationId = z.string().uuid().parse(options[1]), taskIndex = z.number().int().nonnegative().safe().parse(Number(options[3]));
  const target = providerApiWorkerTarget(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
  const root = process.env.OPENPLAN_SYNTHESIS_GENERATION_WORK_DIR || join(homedir(), ".local/state/openplan/synthesis-generation-worker");
  const directory = join(root, createHash("sha256").update(target).digest("hex"), authorizationId, String(taskIndex));
  const stopping = new AbortController(), stop = () => stopping.abort();
  process.on("SIGINT", stop); process.on("SIGTERM", stop);
  try {
    const result = await runSynthesisGenerationWorkerAttempt({ service: createServiceRoleClient(), target, directory,
      authorizationId, taskIndex, signal: stopping.signal });
    console.log(`Synthesis worker attempt: ${result.state}`);
    if (result.state === "unobserved") process.exitCode = 2;
  } finally { process.off("SIGINT", stop); process.off("SIGTERM", stop); }
}
void main().catch(() => {
  console.error("Synthesis worker could not finish. Retain its private journal and retry the same command. Use --authorization UUID --task-index INTEGER.");
  process.exitCode = 1;
});
