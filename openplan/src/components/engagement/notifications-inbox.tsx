"use client";

import { useEffect, useState } from "react";
import { Bell, Check, Loader2, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import type {
  EmailDeliverySummary,
  EngagementNotificationRow,
  EngagementNotificationType,
} from "@/lib/notifications/engagement";

const TYPE_LABEL: Record<EngagementNotificationType, string> = {
  comment_submitted: "New submission",
  comment_flagged: "Flagged",
  survey_response: "Survey response",
  closeloop_published: "Update published",
};

const TYPE_TONE: Record<EngagementNotificationType, "info" | "warning" | "neutral" | "success"> = {
  comment_submitted: "info",
  comment_flagged: "warning",
  survey_response: "info",
  closeloop_published: "success",
};

function fmt(value: string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
}

// ── Email delivery ────────────────────────────────────────────────────────────

/**
 * Every message OpenPlan has ever queued for this campaign has been recorded in
 * the outbox since 2026-07-22 and NOTHING displayed it, so an operator who
 * broadcast a "You said / We did" update, or whose participants asked for email
 * confirmations, had no way to find out whether any of it left the building.
 *
 * The three states are kept apart on purpose: a read that FAILED may not be
 * rendered as "no emails were sent". This is an internal operator surface, so
 * the database's own message is shown — on the public portal it would not be.
 */
type DeliveryState =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; summary: Extract<EmailDeliverySummary, { ok: true }>; transport: string | null };

/**
 * Mask any email address inside a message before it is rendered.
 *
 * The outbox `error` column holds the transport's own reply VERBATIM — see
 * sendEmail() in src/lib/notifications/email.ts, which returns
 * `HTTP ${status}: ${body.slice(0, 200)}` — and a provider that rejects a
 * recipient commonly echoes the address back in that body. Participant email
 * addresses are deliberately out of an operator's reach: engagement_email_outbox
 * has RLS on with zero policies and is REVOKEd from `authenticated`, and this
 * panel's own projection excludes `to_email` for exactly that reason. A raw
 * provider string would route an address around that boundary through the side
 * door, on a panel that promises it shows none — and because a self-hosted
 * operator can point the transport at any provider, the promise cannot be kept
 * by trusting the provider's wording.
 *
 * The domain survives, because that is what makes a delivery failure
 * diagnosable, and the panel says the masking happened rather than silently
 * altering what the database recorded.
 */
export function maskEmailAddresses(message: string): string {
  return message.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, (address) => {
    const at = address.lastIndexOf("@");
    return `${address.slice(0, 1)}…@${address.slice(at + 1)}`;
  });
}

/** Operator-facing names for the four outbox statuses. */
const DELIVERY_LABELS: { key: "sent" | "skipped" | "failed" | "queued"; label: string; tone: "success" | "warning" | "danger" | "neutral" }[] = [
  { key: "sent", label: "Delivered", tone: "success" },
  { key: "skipped", label: "Recorded, not sent", tone: "warning" },
  { key: "failed", label: "Failed", tone: "danger" },
  { key: "queued", label: "Still queued", tone: "neutral" },
];

function EmailDeliveryPanel({ delivery }: { delivery: DeliveryState }) {
  if (delivery.state === "loading") {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Checking email delivery…
      </p>
    );
  }

  if (delivery.state === "error") {
    return (
      <div className="rounded-[0.5rem] border border-amber-300/80 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
        <p className="font-semibold">The email delivery record could not be read</p>
        <p className="mt-1">
          {maskEmailAddresses(delivery.message)} — so OpenPlan cannot tell you what was or was not sent. That is not the
          same as no emails having been sent; do not read this as an empty outbox.
        </p>
      </div>
    );
  }

  const { summary, transport } = delivery;
  const transportUnconfigured = transport === "none";

  if (summary.total === 0) {
    return (
      <div className="text-sm text-muted-foreground">
        <p>No emails have been queued for this campaign yet.</p>
        {transportUnconfigured ? (
          <p className="mt-1">
            This deployment has no email service configured, so update emails would be recorded here but never
            delivered.
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        {DELIVERY_LABELS.filter(({ key }) => summary.counts[key] > 0).map(({ key, label, tone }) => (
          <StatusBadge key={key} tone={tone}>
            {summary.counts[key]} {label}
          </StatusBadge>
        ))}
      </div>
      <p className="text-muted-foreground">
        {summary.total} message{summary.total === 1 ? "" : "s"} recorded
        {summary.truncated ? " (most recent only — there are more)" : ""}
        {summary.lastAttemptAt ? `, most recently ${fmt(summary.lastAttemptAt)}` : ""}.
      </p>
      {summary.counts.skipped > 0 ? (
        <p className="text-muted-foreground">
          “Recorded, not sent” means the message was saved but no email service was configured at the time, so nothing
          was delivered. OpenPlan does not retry these automatically.
        </p>
      ) : null}
      {summary.lastFailure ? (
        <p className="text-amber-800 dark:text-amber-200">
          Most recent failure ({fmt(summary.lastFailure.at)}): {maskEmailAddresses(summary.lastFailure.message)}
        </p>
      ) : null}
      <p className="text-xs text-muted-foreground">
        Email service in effect now: {transport ?? "not reported"}
        {summary.transports.length > 0 ? ` · used on these messages: ${summary.transports.join(", ")}` : ""}. Recipient
        addresses are not shown here — any that appear inside an email service’s own error text are masked.
      </p>
    </div>
  );
}

export function EngagementNotificationsInbox({
  campaignId,
  initialNotifications,
}: {
  campaignId: string;
  initialNotifications: EngagementNotificationRow[];
}) {
  const [items, setItems] = useState<EngagementNotificationRow[]>(initialNotifications);
  const [busy, setBusy] = useState(false);
  const [delivery, setDelivery] = useState<DeliveryState>({ state: "loading" });
  const unread = items.filter((n) => !n.is_read).length;

  // The outbox is service-role-only, so the delivery summary comes back from the
  // same campaign-scoped GET this component already owns rather than through the
  // server page (which this component is mounted by but does not control).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/engagement/campaigns/${campaignId}/notifications`);
        const payload = (await res.json().catch(() => ({}))) as {
          error?: string;
          emailDelivery?: EmailDeliverySummary;
          emailTransport?: string;
        };
        if (cancelled) return;
        if (!res.ok) {
          setDelivery({ state: "error", message: payload.error ?? `the request failed (${res.status})` });
          return;
        }
        const summary = payload.emailDelivery;
        if (!summary) {
          setDelivery({ state: "error", message: "the server did not report a delivery record" });
          return;
        }
        if (!summary.ok) {
          setDelivery({ state: "error", message: summary.message });
          return;
        }
        setDelivery({ state: "ready", summary, transport: payload.emailTransport ?? null });
      } catch (fetchError) {
        if (cancelled) return;
        setDelivery({ state: "error", message: fetchError instanceof Error ? fetchError.message : String(fetchError) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [campaignId]);

  async function patch(body: Record<string, unknown>): Promise<boolean> {
    const res = await fetch(`/api/engagement/campaigns/${campaignId}/notifications`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return res.ok;
  }

  async function markRead(id: string) {
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)));
    await patch({ notificationId: id });
  }

  async function markAll() {
    setBusy(true);
    setItems((prev) => prev.map((n) => ({ ...n, is_read: true })));
    await patch({ markAllRead: true });
    setBusy(false);
  }

  return (
    <article className="module-section-surface">
      <div className="module-section-header">
        <div className="module-section-heading">
          <p className="module-section-label">Activity</p>
          <h2 className="module-section-title">Notifications</h2>
          <p className="module-section-description">
            New public submissions, survey responses, flags, and published updates for this campaign.
            {unread > 0 ? ` ${unread} unread.` : " All caught up."}
          </p>
        </div>
        {unread > 0 ? (
          <Button type="button" variant="outline" size="sm" onClick={() => void markAll()} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Mark all read
          </Button>
        ) : null}
      </div>

      <div id="email-delivery-panel" className="mt-5 rounded-xl border border-border/60 p-3" data-testid="email-delivery-panel">
        <p className="flex items-center gap-2 text-[0.82rem] font-semibold text-foreground">
          <Mail className="h-4 w-4" /> Email delivery
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          What became of the update emails and confirmations OpenPlan queued for this campaign.
        </p>
        <div className="mt-3">
          <EmailDeliveryPanel delivery={delivery} />
        </div>
      </div>

      <div className="mt-5 space-y-2">
        {items.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Bell className="h-4 w-4" /> No activity yet.
          </div>
        ) : (
          items.map((n) => (
            <div key={n.id} className={`module-record-row ${n.is_read ? "opacity-70" : ""}`}>
              <div className="module-record-kicker">
                <StatusBadge tone={TYPE_TONE[n.type]}>{TYPE_LABEL[n.type]}</StatusBadge>
                {!n.is_read ? <StatusBadge tone="neutral">Unread</StatusBadge> : null}
                <span className="text-xs text-muted-foreground">{fmt(n.created_at)}</span>
              </div>
              <p className="mt-1 font-medium text-foreground">{n.title}</p>
              {n.body ? <p className="text-sm text-muted-foreground">{n.body}</p> : null}
              {!n.is_read ? (
                <button
                  type="button"
                  onClick={() => void markRead(n.id)}
                  className="mt-1 text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                >
                  Mark read
                </button>
              ) : null}
            </div>
          ))
        )}
      </div>
    </article>
  );
}
