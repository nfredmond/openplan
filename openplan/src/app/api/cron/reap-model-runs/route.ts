import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { reapStaleRuns, type ReaperClient, type ReaperRun } from "@/lib/models/run-reaper";

export const dynamic = "force-dynamic";

/**
 * Cron sweep that reaps stale model runs across ALL workspaces — the
 * no-viewer safety net for the reconcile-on-read that runs in the model page
 * loader. A run whose worker crashed (or was never claimed) is flipped to a
 * truthful `failed` state so run history never lies.
 *
 * Auth: Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` when the
 * CRON_SECRET env var is set. We require it — without the secret the route is
 * closed (401), so it can never be triggered anonymously.
 */
export async function GET(request: NextRequest) {
  const audit = createApiAuditLogger("cron.reap_model_runs", request);

  const secret = process.env.CRON_SECRET;
  const authorized =
    typeof secret === "string" && secret.length > 0 && request.headers.get("authorization") === `Bearer ${secret}`;
  if (!authorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const client = createServiceRoleClient();
    const { data, error } = await client
      .from("model_runs")
      .select(
        "id, status, created_at, started_at, updated_at, stages:model_run_stages(status, started_at, completed_at, updated_at)"
      )
      .in("status", ["queued", "running"])
      .order("created_at", { ascending: false })
      .limit(1000);

    if (error) {
      audit.error("cron_reap_query_failed", { message: error.message, code: error.code ?? null });
      return NextResponse.json({ error: "Failed to load non-terminal runs" }, { status: 500 });
    }

    const runs = (data ?? []) as ReaperRun[];
    const now = Date.now();
    // Cron sees every non-terminal run, so the internal workerLikelyAlive
    // computation is globally correct — no override needed.
    const result = await reapStaleRuns(client as unknown as ReaperClient, runs, now);

    audit.info("cron_reap_completed", {
      scanned: result.scanned,
      reaped: result.reapedRunIds.length,
    });

    return NextResponse.json(
      { scanned: result.scanned, reaped: result.reapedRunIds.length, details: result.details },
      { status: 200 }
    );
  } catch (error) {
    audit.error("cron_reap_unhandled_error", {
      message: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Unexpected error during reap sweep" }, { status: 500 });
  }
}
