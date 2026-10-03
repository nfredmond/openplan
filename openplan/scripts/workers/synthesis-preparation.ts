import { createServiceRoleClient } from "../../src/lib/supabase/server";
import { runSynthesisPreparationService, synthesisPreparationOptions } from "../../src/lib/engagement/synthesis-preparation-service";

async function main() {
  const options = synthesisPreparationOptions(process.argv.slice(2), process.env);
  if (options.help) {
    console.log("Usage: npm run worker:synthesis-preparation -- [--once|--help]. No arguments polls the explicit preparation queue. --once runs one bounded pass, not a full drain. Keep OPENPLAN_SYNTHESIS_PREPARATION_WORK_DIR on private durable storage. Preparation does not authorize model calls or approve outputs.");
    return;
  }
  const stopping = new AbortController(), stop = () => stopping.abort();
  process.on("SIGINT", stop); process.on("SIGTERM", stop);
  try {
    const status = await runSynthesisPreparationService({ ...options, service: createServiceRoleClient(), signal: stopping.signal,
      report: result => {
        const acknowledged = result.outcomes.filter(item => item.state === "acknowledged").length;
        const inactive = result.outcomes.filter(item => item.state === "not_active").length;
        console.log(`Preparation pass: ${acknowledged} attempts acknowledged; ${inactive} inactive; ${result.pendingCount} pending custody records. Queue cursor ${result.queueWrapped ? "wrapped" : "continues"}. This is not full queue completion or staff approval.`);
      },
      reportError: () => console.error("Preparation pass could not finish. Retain the private worker directory and retry against the same database. Pending attempts remain unconfirmed."),
    });
    if (status === "stopped") console.log("Preparation worker stopped. Retain its private directory to resume pending attempts.");
    process.exitCode = status === "unconfirmed" ? 2 : status === "error" || (status === "stopped" && options.once) ? 1 : 0;
  } finally { process.off("SIGINT", stop); process.off("SIGTERM", stop); }
}
void main().catch(() => {
  console.error("Preparation worker could not run. Check the Supabase URL, service credential and private absolute worker directory. Use --once, --help or no arguments. Retain existing journals.");
  process.exitCode = 1;
});
