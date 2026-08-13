"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import type { WorkNotificationInbox } from "@/lib/notifications/work";
import { formatWorkDeadlineDate } from "@/lib/work/deadlines";
import { OperatorDetail } from "@/components/ui/read-failure-notice";

/**
 * THE REMINDER PANEL — what the daily check told you, and when.
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

/**
 * Plain-language names for the reminder kinds (20260811000007's CHECK, widened
 * by 20260812000010 and 20260812000013).
 *
 * "Award obligation" and "Award lapse" are deliberately different words for the
 * two award deadlines: one is the date the money must be committed, the other
 * the date an unspent balance goes back to the funder. A shared label would
 * merge the two on the one surface where a planner glances rather than reads.
 *
 * "Claim waiting" is deliberately NOT "Claim due". Every other label here names
 * a deadline; that one names a claim against a local measure fund that nobody
 * has decided, and OpenPlan holds no date by which a decision was owed. A badge
 * reading "due" beside it would put a deadline on the surface a planner glances
 * at, which is the one place the reminder's own careful wording never reaches.
 */
const KIND_LABELS: Record<string, string> = {
  deliverable_due: "Deliverable",
  milestone_due: "Milestone",
  submittal_due: "Submittal",
  invoice_due: "Invoice",
  grant_decision_due: "Grant decision",
  award_obligation_due: "Award obligation",
  award_expenditure_due: "Award lapse",
  measure_claim_review_due: "Claim waiting",
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
        {/* Two facts, two registers: the planner learns what this panel is and
            is not saying, and the migration number or the database's own words
            wait underneath for whoever can act on them. */}
        <div className="module-alert" role="status">
          {inbox.pending ? (
            <>
              <p>
                Reminders cannot be listed on this deployment yet: the database is missing the table
                they live in. Whoever runs this OpenPlan can apply the pending migrations, and then
                this panel will fill in.
              </p>
              <OperatorDetail>
                <p>
                  Migration 20260811000007 adds the table these reminders are read from. Apply the
                  pending migrations and reload.
                </p>
              </OperatorDetail>
            </>
          ) : (
            <>
              <p>
                Your reminders could not be read, so this panel is unavailable rather than empty —
                it does not mean nothing is due. Reload, and if it persists ask whoever runs this
                OpenPlan to look at the detail below.
              </p>
              <OperatorDetail>
                <p className="break-words font-mono">The database said: {inbox.message}</p>
              </OperatorDetail>
            </>
          )}
        </div>
      </article>
    );
  }

  if (inbox.rows.length === 0) {
    if (sweepConfigured) return null;
    return (
      <article className="module-section-surface">
        <h2 className="module-section-title">Reminders</h2>
        {/* What is off and who can turn it on, in the planner's sentence. The
            secret's name and the schedule to add are the operator's business
            and stay out of it — folded away, not dropped. */}
        <div className="module-note">
          <p>
            Daily deadline reminders are switched off on this deployment, so nothing arrives here on
            its own. Whoever runs this OpenPlan can switch them on. The deadlines themselves are
            listed below either way.
          </p>
          <OperatorDetail>
            <p>
              No CRON_SECRET is configured, so the daily check that writes these reminders cannot
              run. Set it, then schedule <code>/api/cron/sweep-deadlines</code> daily.
            </p>
          </OperatorDetail>
        </div>
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
        What the daily check flagged for you — everything due within a week, and everything already
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
