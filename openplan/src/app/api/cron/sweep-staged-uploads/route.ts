import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { timingSafeSecretEquals } from "@/lib/http/secret-compare";
import { sweepAbandonedStagedUploads } from "@/lib/files/staged-upload-sweep";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Daily sweep that removes staged uploads whose complete call never came, once
 * they are a day old. See `src/lib/files/staged-upload-sweep.ts` for the age,
 * the path check and the per-run bounds.
 *
 * A bucket that fails part way answers 500 with the counts of what was done
 * before it stopped, and the audit log records the same counts.
 *
 * AUTH. `Authorization: Bearer <CRON_SECRET>`, compared with
 * `timingSafeSecretEquals`, as in `sweep-engagement-photos`. With no
 * CRON_SECRET set the route is closed.
 */
export async function GET(request: NextRequest) {
  const audit = createApiAuditLogger("cron.sweep_staged_uploads", request);

  const secret = process.env.CRON_SECRET?.trim();
  const presented = request.headers.get("authorization")?.trim().match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? null;
  if (!secret || !timingSafeSecretEquals(presented, secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await sweepAbandonedStagedUploads(createServiceRoleClient());
    if (result.failed) {
      audit.error("cron_sweep_staged_uploads_failed", result);
      return NextResponse.json(result, { status: 500 });
    }
    audit.info("cron_sweep_staged_uploads_completed", result);
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    audit.error("cron_sweep_staged_uploads_failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Unexpected error during the staged upload sweep" }, { status: 500 });
  }
}
