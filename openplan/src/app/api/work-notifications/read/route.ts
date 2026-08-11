import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { BODY_LIMITS, readJsonWithLimit } from "@/lib/http/body-limit";
import {
  isWriteFailure,
  noRowsMatchedBody,
  noRowsMatchedStatus,
  writeMatchedNoRows,
} from "@/lib/http/write-outcome";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { createClient } from "@/lib/supabase/server";

/**
 * Mark deadline reminders read.
 *
 * WHY THIS ROUTE EXISTS AT ALL, given that the reminder rows are written by a
 * cron with the service role: because a table with an UPDATE policy and no way
 * to reach it is the shipped-invisible defect class in miniature — an unread
 * badge nobody can clear, and a policy that looks like a capability while being
 * decoration. 20260811000007 gives the recipient a mark-read UPDATE; this is the
 * door to it.
 *
 * WHY THE CALLER'S OWN CLIENT, and no membership lookup. The policy is
 * `recipient_user_id = auth.uid() AND <member of the workspace>`, so the
 * database already answers both questions this route would otherwise ask, and
 * asking them twice is how the two copies drift. Nothing here is scoped by a
 * workspace id from the request — an id in a request body is a claim, and the
 * session is a fact.
 *
 * ZERO MATCHED ROWS IS A 404, NOT A 500. `targetWasVerified: false`: this route
 * writes straight at an id it was handed without reading the row first, so
 * "nothing matched" is the ordinary answer to "is this yours" and must not be
 * distinguished from "no such row" — distinguishing them would confirm the
 * existence of other people's reminders. It is also what a VIEWER sees if one
 * was ever assigned work: the restrictive writer gate (20260728000006) refuses
 * their update, and the honest answer is that it was not marked read, never a
 * cheerful success over a row that did not change.
 */

const markReadSchema = z.union([
  z.object({ notificationId: z.string().uuid() }),
  z.object({ markAll: z.literal(true) }),
]);

export async function POST(request: NextRequest) {
  const audit = createApiAuditLogger("work_notifications.mark_read", request);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await readJsonWithLimit(request, BODY_LIMITS.smallJson);
  if (!body.ok) return body.response;

  const parsed = markReadSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Tell this endpoint which reminder to mark read",
        details: "Send either { notificationId } or { markAll: true }.",
      },
      { status: 400 }
    );
  }

  const readAt = new Date().toISOString();

  if ("markAll" in parsed.data) {
    // `.select("id")` rather than a bare update, so this write can SEE what it
    // changed. Zero rows is not an error here — "mark everything read" over an
    // already-empty inbox legitimately matches nothing — but the count is the
    // difference between reporting what happened and reporting that a request
    // was received. The recipient filter is redundant with the RLS policy and
    // kept anyway: it is what makes the statement correct on its own terms.
    const { data, error } = await supabase
      .from("work_notifications")
      .update({ is_read: true, read_at: readAt })
      .eq("recipient_user_id", user.id)
      .eq("is_read", false)
      .select("id");
    if (error) {
      audit.error("work_notifications_mark_all_failed", { message: error.message });
      return NextResponse.json({ error: "Your reminders could not be marked read" }, { status: 500 });
    }
    const marked = (data ?? []).length;
    audit.info("work_notifications_marked_all_read", { marked });
    return NextResponse.json({ ok: true, marked }, { status: 200 });
  }

  const result = await supabase
    .from("work_notifications")
    .update({ is_read: true, read_at: readAt })
    .eq("id", parsed.data.notificationId)
    .select("id")
    .maybeSingle();

  if (isWriteFailure(result.error)) {
    audit.error("work_notifications_mark_read_failed", { message: result.error?.message ?? null });
    return NextResponse.json({ error: "That reminder could not be marked read" }, { status: 500 });
  }

  if (writeMatchedNoRows(result)) {
    const options = { subject: "reminder", targetWasVerified: false } as const;
    audit.info("work_notifications_mark_read_no_rows", { notificationId: parsed.data.notificationId });
    return NextResponse.json(noRowsMatchedBody(options), { status: noRowsMatchedStatus(options) });
  }

  audit.info("work_notifications_marked_read", { notificationId: parsed.data.notificationId });
  return NextResponse.json({ ok: true }, { status: 200 });
}
