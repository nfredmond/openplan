import { createServiceRoleClient } from "../../src/lib/supabase/server";
import { gtfsQueueOptions, runGtfsQueueService } from "../../src/lib/gtfs/managed-worker-queue";

async function main() {
  const options = gtfsQueueOptions(process.argv.slice(2), process.env);
  if (options.help) {
    console.log("Usage: npm run worker:gtfs-ingestion -- [--once|--help]. No arguments polls enrolled transit imports. --once runs one bounded pass. Configure OPENPLAN_GTFS_INSTALLATION_ID, OPENPLAN_GTFS_PARSER_BUILD and private durable OPENPLAN_GTFS_WORK_DIR. Retain journals across restarts. Completion does not adopt a feed or validate actual transit service.");
    return;
  }
  const stopping = new AbortController(), stop = () => stopping.abort();
  process.on("SIGINT", stop); process.on("SIGTERM", stop);
  try {
    const status = await runGtfsQueueService({ ...options, service: createServiceRoleClient(),
      serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "", signal: stopping.signal, batchSize: 100,
      parser: { maxOutputBytes: 128 * 1024 * 1024, maxOldSpaceMb: 768, renewEveryMs: 30_000,
        renewTimeoutMs: 10_000, maxRuntimeMs: 30 * 60_000, terminationGraceMs: 1000 },
      report: pass => console.log(`Transit pass: ${pass.outcomes.filter(item => ["finished", "recovered_terminal", "observed_terminal"].includes(item.state)).length} terminal observations; ${pass.pendingCount} retained jobs unconfirmed or awaiting another pass. This is not full queue completion or adoption.`),
      reportError: () => console.error("Transit pass could not finish. Retain private worker files and retry against the same installation. Import outcomes remain unconfirmed."),
    });
    if (status === "stopped") console.log("Transit worker stopped. Retain private journals and source bytes to resume.");
    process.exitCode = status === "unconfirmed" ? 2 : status === "error" || (status === "stopped" && options.once) ? 1 : 0;
  } finally { process.off("SIGINT", stop); process.off("SIGTERM", stop); }
}
void main().catch(() => {
  console.error("Transit worker could not run. Check installation/build identity, Supabase configuration and the private absolute worker directory. Retain existing journals.");
  process.exitCode = 1;
});
