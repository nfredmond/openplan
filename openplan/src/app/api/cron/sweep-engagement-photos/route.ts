import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { timingSafeSecretEquals } from "@/lib/http/secret-compare";
import { sweepUnattachedEngagementPhotos } from "@/lib/engagement/photo-sweep";

export const dynamic = "force-dynamic";

/**
 * Daily sweep that removes public photos no comment or survey answer took up
 * within a day of upload. See `src/lib/engagement/photo-sweep.ts` for what
 * counts as a reference and why a failed read stops the run.
 *
 * AUTH. `Authorization: Bearer <CRON_SECRET>`, compared with
 * `timingSafeSecretEquals`, as in `reap-gtfs-ingests`. With no CRON_SECRET set
 * the route is closed.
 */
export async function GET(request: NextRequest) {
  const audit = createApiAuditLogger("cron.sweep_engagement_photos", request);

  const secret = process.env.CRON_SECRET?.trim();
  const presented = request.headers.get("authorization")?.trim().match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? null;
  if (!secret || !timingSafeSecretEquals(presented, secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await sweepUnattachedEngagementPhotos(createServiceRoleClient());
    audit.info("cron_sweep_engagement_photos_completed", result);
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    audit.error("cron_sweep_engagement_photos_failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Unexpected error during the photo sweep" }, { status: 500 });
  }
}
