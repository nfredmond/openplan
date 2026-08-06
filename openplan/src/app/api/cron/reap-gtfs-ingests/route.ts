import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { timingSafeSecretEquals } from "@/lib/http/secret-compare";
import { reapAbandonedGtfsIngests } from "@/lib/gtfs/persist";

export const dynamic = "force-dynamic";

/**
 * Scheduled sweep that closes transit-feed ingests which stopped responding.
 *
 * WHY THIS EXISTS AT ALL, since nothing else in the GTFS lane needs a cron.
 * `beginGtfsFeedVersion` writes the version row as `pending` BEFORE any network
 * work, deliberately, so that a fetch which hangs or a process which is killed
 * leaves evidence rather than nothing. That choice is only honest if something
 * eventually resolves those rows: without this route, the price of good
 * bookkeeping would be a Data Hub card stuck on "parsing" forever, which reads
 * to a planner as "OpenPlan is still working on it" and never stops.
 *
 * It reaps nothing that could still be running — see
 * `GTFS_INGEST_ABANDONED_AFTER_MS`, which is derived from the ingest routes'
 * own `maxDuration` rather than picked.
 *
 * AUTH. `Authorization: Bearer <CRON_SECRET>`, compared with
 * `timingSafeSecretEquals`. The older `reap-model-runs` route compares the
 * header with `===`, which leaks the secret a byte at a time to anyone who can
 * measure the response; this one does not copy that. With no CRON_SECRET set
 * the route is closed rather than open, so a deployment that never configured
 * one cannot be swept by a stranger.
 */
export async function GET(request: NextRequest) {
  const audit = createApiAuditLogger("cron.reap_gtfs_ingests", request);

  const secret = process.env.CRON_SECRET?.trim();
  const presented = request.headers.get("authorization")?.trim().match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? null;
  if (!secret || !timingSafeSecretEquals(presented, secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await reapAbandonedGtfsIngests(createServiceRoleClient());

    audit.info("cron_reap_gtfs_ingests_completed", {
      scanned: result.scanned,
      reaped: result.reaped.length,
    });

    return NextResponse.json(
      { scanned: result.scanned, reaped: result.reaped.length },
      { status: 200 }
    );
  } catch (error) {
    audit.error("cron_reap_gtfs_ingests_failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Unexpected error during the ingest sweep" }, { status: 500 });
  }
}
