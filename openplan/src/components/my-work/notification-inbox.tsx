"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import type { WorkNotificationInbox } from "@/lib/notifications/work";
import { formatWorkDeadlineDate } from "@/lib/work/deadlines";

/**
 * THE REMINDER PANEL — what the daily sweep told you, and when.
 *
 * WHY IT SITS ABOVE THE QUEUE RATHER THAN INSIDE IT. The queue below is the
 * live state of the world: every dated record, re-read on every page load. This
 * panel is a RECORD OF BEING TOLD — one row per thing the 13:00 UTC sweep
 * flagged for you, which is a different fact and the only one that survives you
 * closing the tab. Merging them would lose the distinction that makes a
 * reminder worth having.
 *
 * IT DISAPPEARS WHEN IT HAS NOTHING TO SAY. No "0 reminders" panel: an empty
 * inbox on a page that already lists your deadlines is furniture. It renders
 * for exactly two reasons — there are unread reminders, or the read failed and
 * that has to be disclosed.
 *
 * A FAILED READ IS NOT AN EMPTY INBOX, and a deployment behind the migration is
 * neither. Three distinct sentences, because "you have no reminders", "we could
 * not check" and "this deployment has not run 20260811000007 yet" send a
 * planner to three different places.
 */

export type NotificationInboxProps = {
  inbox: WorkNotificationInbox;
  /**
   * False when this deployment has no cron secret configured, so the sweep can
   * never run. An empty panel would otherwise read as "nothing is due" forever
   * — the honest answer is that reminders are switched off, and who can switch
   * them on.
   */
  sweepConfigured: boolean;
};

/** Plain-language names for the six reminder kinds (20260811000007's CHECK). */
const KIND_LABELS: Record<string, string> = {
  deliverable_due: "Deliverable",
  milestone_due: "Milestone",
  submittal_due: "Submittal",
  invoice_due: "Invoice",
  grant_decision_due: "Grant decision",
  award_obligation_due: "Award obligation",
};

export function WorkNotificationInboxPanel({ inbox, sweepConfigured }: NotificationInboxProps) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  async function markRead(payload: { notificationId: string } | { markAll: true }, key: string) {
    setBusy(key);
    setFailure(null);
    try {
      const response = await fetch("/api/work-notifications/read", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        // The route already distinguishes "not yours / no longer there" (404)
        // from "the database refused" (500). Neither is reported as success,
        // and neither leaves the row looking cleared when it is not.
        const detail = (await response.json().catch(() => null)) as { error?: string } | null;
        setFailure(
          detail?.error ??
            "That reminder could not be marked read. It is still in your list, which is the honest state."
        );
        return;
      }
      router.refresh();
    } catch {
      setFailure("The request did not reach OpenPlan, so nothing was marked read.");
    } finally {
      setBusy(null);
    }
  }

  if (!inbox.ok) {
    return (
      <article className="module-section-surface">
        <h2 className="module-section-title">Reminders</h2>
        <p className="module-alert" role="status">
          {inbox.pending
            ? "Reminders cannot be listed on this deployment yet: the database is missing the table they live in. Apply the pending migrations (20260811000007 adds it) and reload."
            : `Your reminders could not be read, so this panel is unavailable rather than empty — it does not mean nothing is due. The database said: ${inbox.message}`}
        </p>
      </article>
    );
  }

  if (inbox.rows.length === 0) {
    if (sweepConfigured) return null;
    return (
      <article className="module-section-surface">
        <h2 className="module-section-title">Reminders</h2>
        <p className="module-note">
          Daily deadline reminders are switched off on this deployment: no CRON_SECRET is
          configured, so the sweep that writes them cannot run. Whoever operates this instance can
          set it and schedule <code>/api/cron/sweep-deadlines</code> daily. The deadlines
          themselves are listed below either way.
        </p>
      </article>
    );
  }

  return (
    <article className="module-section-surface">
      <div className="module-section-header">
        <h2 className="module-section-title">
          Reminders ({inbox.rows.length}
          {inbox.truncated ? "+" : ""})
        </h2>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy !== null}
          onClick={() => markRead({ markAll: true }, "all")}
        >
          {busy === "all" ? "Marking…" : "Mark all read"}
        </Button>
      </div>
      <p className="module-note">
        What the daily sweep flagged for you — everything due within a week, and everything already
        overdue. Marking one read removes it from here; it does not change the record itself.
      </p>
      {inbox.truncated ? (
        <p className="module-note">
          Showing the {inbox.rows.length} soonest. There are more unread reminders than this panel
          lists.
        </p>
      ) : null}
      {failure ? (
        <p className="module-alert" role="alert">
          {failure}
        </p>
      ) : null}
      <div className="module-record-list">
        {inbox.rows.map((row) => (
          <div key={row.id} className="module-record-row">
            <div className="module-record-main">
              <div className="module-record-head">
                <span className="module-record-title">{row.title}</span>
                <StatusBadge tone="info">{KIND_LABELS[row.kind] ?? "Reminder"}</StatusBadge>
                <span className="module-record-stamp">
                  {formatWorkDeadlineDate(row.dueOn) ?? row.dueOn}
                </span>
              </div>
              <p className="module-record-summary">{row.body}</p>
            </div>
            <div className="module-record-actions">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy !== null}
                onClick={() => markRead({ notificationId: row.id }, row.id)}
              >
                {busy === row.id ? "Marking…" : "Mark read"}
              </Button>
            </div>
          </div>
        ))}
      </div>
    </article>
  );
}
