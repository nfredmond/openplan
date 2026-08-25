import type { ReactNode } from "react";

import { WorkNotificationInboxPanel } from "@/components/my-work/notification-inbox";
import { loadWorkNotifications } from "@/lib/notifications/work";
import {
  CRON_JOB_SWEEP_DEADLINES,
  classifyCronFreshness,
  readCronHeartbeatAt,
} from "@/lib/notifications/cron-heartbeat";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { loadWorkspaceContext } from "@/lib/workspaces/current";
import { canAccessWorkspaceAction } from "@/lib/auth/role-matrix";
import { loadWorkspaceReminderPreference } from "@/lib/notifications/reminder-preferences";
import { ReminderPreferencesPanel } from "@/components/my-work/reminder-preferences";

/**
 * The reminder panel, above the work queue.
 *
 * WHY A LAYOUT AND NOT A LINE IN page.tsx — recorded, because it is a trade and
 * not an obvious call. `page.tsx` returns a SINGLE element (`MyWorkBoard`, or
 * the membership prompt) and its wiring test pins that shape while proving the
 * queue is read with the caller's client and the roster with the service role —
 * assertions worth more than the small cost here. Mounting the panel beside the
 * board would have meant returning a fragment and rewriting four assertions in
 * a mutation-verified test belonging to another lane. A layout composes the two
 * without either file knowing about the other.
 *
 * WHAT IT COSTS, STATED: one extra `getUser()` per render of this route, since
 * a layout cannot receive what the page already resolved. If a later change
 * touches both files in one commit, folding this into `page.tsx` and passing
 * the panel in beside the board is the better shape — this is a seam, not a
 * conviction.
 *
 * The read uses the CALLER'S client on purpose. `work_notifications`' SELECT
 * policy is `recipient_user_id = auth.uid() AND <member of the workspace>`, so
 * the database is the access control; a service-role read here would replace a
 * policy with an `.eq()` and quietly become the only thing standing between one
 * planner's reminders and another's.
 */
export default async function MyWorkLayout({ children }: { children: ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Signed out: the page below redirects to sign-in, and a reminder panel on
  // the way there would be noise. No read is attempted for nobody.
  if (!user) return children;

  const inbox = await loadWorkNotifications(supabase, user.id);
  const { membership } = await loadWorkspaceContext(supabase, user.id);
  const reminderPreference = membership
    ? await loadWorkspaceReminderPreference(supabase, membership.workspace_id)
    : null;

  // Whether reminders are ACTUALLY running, read from the sweep's own heartbeat
  // rather than inferred from CRON_SECRET being set. Presence of the secret told
  // us nothing — a self-hoster sets it for the model-run reaper and may never
  // schedule this sweep, and the old panel then claimed reminders were on while
  // none fired. The heartbeat is deployment-global and locked to the service
  // role, so it is read with the service-role client here (NOT the caller's,
  // which governs work_notifications above and must stay that way). A failed or
  // missing read classifies as `never` — the honest, non-alarming-but-not-
  // reassuring default.
  const sweepFreshness = classifyCronFreshness(
    await readCronHeartbeatAt(
      createServiceRoleClient() as unknown as Parameters<typeof readCronHeartbeatAt>[0],
      CRON_JOB_SWEEP_DEADLINES
    )
  );

  // `grid gap-6` matches `.module-page`'s own 1.5rem gap, so the panel sits in
  // the same rhythm as the sections the page renders below it rather than
  // flush against them.
  return (
    <div className="grid gap-6">
      <WorkNotificationInboxPanel
        inbox={inbox}
        sweepFreshness={sweepFreshness}
        advanceDays={reminderPreference?.preference.advanceDays ?? 7}
      />
      {reminderPreference ? (
        <ReminderPreferencesPanel
          preference={reminderPreference.preference}
          canManage={canAccessWorkspaceAction("workspace.configure", membership?.role)}
        />
      ) : null}
      {children}
    </div>
  );
}
