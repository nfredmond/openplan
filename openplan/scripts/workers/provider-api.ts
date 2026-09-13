import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createServiceRoleClient } from "../../src/lib/supabase/server";
import { providerApiWorkerTarget, runProviderApiWorkerCycle } from "../../src/lib/assistant/provider-api-worker";

// Run locally with npm run worker:provider-api. --once performs one recovery or
// claim cycle; it does not imply that the model returned a successful answer.
async function main() {
  const options = process.argv.slice(2);
  if (options.length > 1 || (options.length === 1 && options[0] !== "--once")) throw new Error("worker_options_invalid");
  const once = options[0] === "--once";
  const target = providerApiWorkerTarget(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
  const directory = process.env.OPENPLAN_PROVIDER_API_WORK_DIR || join(homedir(), ".local/state/openplan/provider-api-worker", createHash("sha256").update(target).digest("hex").slice(0, 20));
  const service = createServiceRoleClient();
  const stopping = new AbortController();
  const stop = () => stopping.abort();
  process.on("SIGINT", stop); process.on("SIGTERM", stop);
  try {
    while (!stopping.signal.aborted) {
      let pause = 2000;
      try {
        const result = await runProviderApiWorkerCycle({ service, target, directory, signal: stopping.signal });
        if (result.state !== "idle" || once) console.log(`API worker cycle: ${result.state}`);
      } catch {
        if (stopping.signal.aborted) break;
        console.error("API worker cycle could not finish. Saved attempts and pending delivery remain retained; check the database and private worker directory.");
        if (once) { process.exitCode = 1; break; }
        pause = 5000;
      }
      if (once) break;
      try { await delay(pause, undefined, { signal: stopping.signal }); }
      catch { if (!stopping.signal.aborted) throw new Error("worker_wait_failed"); }
    }
  } finally { process.off("SIGINT", stop); process.off("SIGTERM", stop); }
}

void main().catch(() => {
  console.error("API worker could not start. Check the Supabase URL, service credential and worker directory. Use --once or no arguments.");
  process.exitCode = 1;
});
