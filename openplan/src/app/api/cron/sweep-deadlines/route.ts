import { NextRequest, NextResponse } from "next/server";

import { timingSafeSecretEquals } from "@/lib/http/secret-compare";
import { sweepWorkDeadlines, type WorkSweepClient } from "@/lib/notifications/work";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { createServiceRoleClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * The daily deadline sweep — /api/cron/sweep-deadlines, 13:00 UTC (vercel.json).
 *
 * WHY ONCE A DAY AND NOT EVERY FEW MINUTES, like the two reaper crons beside it.
 * Those repair BOOKKEEPING that has gone stale within minutes. This one talks to
 * a person, and a person wants one summary a day (Nathaniel, 2026-08-11), not a
 * notification each time a query runs. 13:00 UTC is a deliberate compromise for
 * a product with users in every US time zone: early morning on the west coast,
 * mid-morning on the east. It is not tuned per workspace, and pretending
 * otherwise by picking a "local" hour the deployment cannot know would be worse.
 *
 * RUNNING IT TWICE COSTS NOTHING. The sweep's insert is idempotent against the
 * unique index in 20260811000007 and the digest email is built only from rows
 * that were actually created — so a retried schedule, a manual curl, or a
 * platform that fires the cron twice all produce zero extra mail. That property
 * is what makes it safe to expose this as a plain GET at all.
 *
 * AUTH. `Authorization: Bearer <CRON_SECRET>`, compared with
 * `timingSafeSecretEquals` — the reap-gtfs-ingests shape, not the older
 * reap-model-runs `===` which leaks the secret a byte at a time to anyone who
 * can measure a response. With no CRON_SECRET configured the route is CLOSED,
 * so a self-hosted deployment that never set one cannot have its reminder sweep
 * driven by a stranger.
 *
 * That has a consequence an operator has to be told about — no CRON_SECRET
 * means no reminders, ever — and the product says it IN THE PRODUCT rather than
 * only in a document: the My Work reminder panel renders "reminders are
 * switched off on this deployment" when the variable is unset, naming it. A
 * setup step that announces itself where the gap shows up beats one buried in
 * SELF_HOSTING, whose CRON_SECRET rows still describe only the model-run reaper
 * and should gain this route when the docs are next touched.
 *
 * WHY THE ORIGIN IS TAKEN FROM THE REQUEST. The digest email links to /my-work,
 * and a link needs an absolute URL. Reading it off the incoming request means a
 * self-hosted instance at any hostname gets working links with no extra
 * environment variable to discover and set — one less thing between an agency
 * and a working install.
 */
export async function GET(request: NextRequest) {
  const audit = createApiAuditLogger("cron.sweep_deadlines", request);

  const secret = process.env.CRON_SECRET?.trim();
  const presented =
    request.headers.get("authorization")?.trim().match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? null;
  if (!secret || !timingSafeSecretEquals(presented, secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await sweepWorkDeadlines(
      createServiceRoleClient() as unknown as WorkSweepClient,
      { appOrigin: request.nextUrl.origin }
    );

    // Everything an operator needs to tell "nothing was due" from "the sweep
    // could not read three of its six sources". A reminder system that logs
    // only a success count is one that can go quiet without anyone noticing.
    const unreadable = Object.entries(result.perSource)
      .filter(([, outcome]) => outcome.failed || outcome.pending)
      .map(([kind, outcome]) => `${kind}:${outcome.pending ? "pending_migration" : "failed"}`);

    audit.info("cron_sweep_deadlines_completed", {
      notificationsCreated: result.notificationsCreated,
      digestsComposed: result.digestsComposed,
      emailsDelivered: result.emailsDelivered,
      emailsSkipped: result.emailsSkipped,
      emailsFailed: result.emailsFailed,
      emailUnavailable: result.emailUnavailable,
      departedRecipients: result.departedRecipients,
      workspacesWithoutRoster: result.workspacesWithoutRoster.length,
      truncatedSources: Object.entries(result.perSource)
        .filter(([, outcome]) => outcome.truncated)
        .map(([kind]) => kind),
      unreadableSources: unreadable,
      writeError: result.writeError,
    });

    return NextResponse.json(
      {
        notificationsCreated: result.notificationsCreated,
        digestsComposed: result.digestsComposed,
        emailsDelivered: result.emailsDelivered,
        emailsSkipped: result.emailsSkipped,
        emailsFailed: result.emailsFailed,
        emailUnavailable: result.emailUnavailable,
        departedRecipients: result.departedRecipients,
        workspacesWithoutRoster: result.workspacesWithoutRoster.length,
        unreadableSources: unreadable,
        writeError: result.writeError,
      },
      { status: 200 }
    );
  } catch (error) {
    audit.error("cron_sweep_deadlines_failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Unexpected error during the deadline sweep" }, { status: 500 });
  }
}
