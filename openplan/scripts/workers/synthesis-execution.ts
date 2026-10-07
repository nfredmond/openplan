import { createServiceRoleClient } from "../../src/lib/supabase/server";
import { runSynthesisExecutionService, synthesisExecutionOptions } from "../../src/lib/engagement/synthesis-execution-service";

async function main() {
  const options = synthesisExecutionOptions(process.argv.slice(2), process.env);
  if (options.help) {
    console.log("Usage: npm run worker:synthesis-execution -- [--once|--help]. No arguments polls explicit execution requests. --once runs one bounded page, not a full drain. Use the same private OPENPLAN_SYNTHESIS_GENERATION_WORK_DIR as the single-grant CLI. Scheduling does not approve outputs or create additional permission.");
    return;
  }
  const stopping = new AbortController(), stop = () => stopping.abort();
  process.on("SIGINT", stop); process.on("SIGTERM", stop);
  try {
    const status = await runSynthesisExecutionService({ ...options, service: createServiceRoleClient(), signal: stopping.signal,
      report: result => {
        const unconfirmed = result.outcomes.filter(item => item.state === "unconfirmed").length;
        console.log(`Execution pass: ${result.outcomes.length} queue entries visited; ${unconfirmed} schedules unconfirmed. Cursor ${result.queueWrapped ? "wrapped" : "continues"}. Inspect retained task results for output status. This is not full source completion or staff approval.`);
      },
      reportError: () => console.error("Execution pass could not finish. Keep the private worker directory and retry against the same database. Existing dispatch outcomes remain unchanged."),
    });
    if (status === "stopped") console.log("Execution worker stopped. Keep its private journals for recovery.");
    process.exitCode = status === "unconfirmed" ? 2 : status === "error" || (status === "stopped" && options.once) ? 1 : 0;
  } finally { process.off("SIGINT", stop); process.off("SIGTERM", stop); }
}
void main().catch(() => {
  console.error("Execution worker could not run. Check the database URL, service credential and absolute private journal root. Use --once, --help or no arguments. Keep existing journals.");
  process.exitCode = 1;
});
