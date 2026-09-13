"use client";

import { useEffect, useState } from "react";
import { Bell, Check, Loader2, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import type {
  EngagementNotificationRow,
  EngagementNotificationType,
} from "@/lib/notifications/engagement";

import { emailDeliveryRecordSchema, type EmailDeliverySummary } from "@/lib/notifications/email-delivery-summary";

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

type DeliveryState =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; summary: Extract<EmailDeliverySummary, { ok: true }>; transport: string | null };

/** Mask addresses in request failures; delivery summaries already withhold provider text in SQL. */
export function maskEmailAddresses(message: string): string {
  return message.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, (address) => {
    const at = address.lastIndexOf("@");
    return `${address.slice(0, 1)}…@${address.slice(at + 1)}`;
  });
}

/** Outcomes remain distinct even when the old outbox status is still queued. */
const DELIVERY_LABELS: { key: keyof Extract<EmailDeliverySummary, { ok: true }>["counts"]; label: string; tone: "success" | "warning" | "danger" | "neutral" | "info" }[] = [
  { key: "sent", label: "Accepted by email service", tone: "success" },
  { key: "skipped", label: "Recorded, not sent", tone: "warning" },
  { key: "failed", label: "Failed", tone: "danger" },
  { key: "queued", label: "Still queued", tone: "neutral" },
  { key: "attempting", label: "Attempt in progress", tone: "info" },
  { key: "uncertain", label: "Outcome uncertain", tone: "warning" },
  { key: "cancelled", label: "Cancelled before sending", tone: "neutral" },
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

  if (summary.total === 0 && Object.values(summary.broadcasts).every(value => value === 0)) {
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
        {summary.lastRecordedAt ? `, most recently ${fmt(summary.lastRecordedAt)}` : ""}.
      </p>
      <p className="text-muted-foreground">Email service acceptance does not confirm inbox delivery.</p>
      {summary.broadcasts.queued > 0 ? <p>{summary.broadcasts.queued} published update(s) waiting for recipient preparation. Recipient count is not known yet.</p> : null}
      {summary.broadcasts.noShareToken > 0 ? <p>{summary.broadcasts.noShareToken} published update(s) could not prepare emails because the campaign had no public link.</p> : null}
      {summary.broadcasts.cancelled > 0 ? <p>{summary.broadcasts.cancelled} published update(s) cancelled before recipient preparation.</p> : null}
      {summary.broadcasts.prepared > 0 && summary.total === 0 ? <p>Recipient preparation completed with no eligible messages.</p> : null}
      {summary.counts.uncertain > 0 ? <p>These attempts may have reached the email service. OpenPlan does not automatically resend uncertain messages.</p> : null}
      {summary.counts.skipped > 0 ? (
        <p className="text-muted-foreground">
          “Recorded, not sent” means the message was saved but no email service was configured at the time, so nothing
          was delivered. OpenPlan does not retry these automatically.
        </p>
      ) : null}
      {summary.lastFailure ? (
        <p className="text-amber-800 dark:text-amber-200">
          Latest failed message, recorded {fmt(summary.lastFailure.at)}: {maskEmailAddresses(summary.lastFailure.message)}
        </p>
      ) : null}
      <p className="text-xs text-muted-foreground">
        Email service in effect now: {transport ?? "not reported"}
        {summary.transports.length > 0 ? ` · used on these messages: ${summary.transports.join(", ")}` : ""}. Recipient
        addresses and private provider error text are not included in this record.
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

  const [refresh, setRefresh] = useState(0);
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
        const parsed = emailDeliveryRecordSchema.safeParse(summary);
        if (!parsed.success || parsed.data.campaignId !== campaignId) {
          setDelivery({ state: "error", message: "The server returned an incomplete or mismatched delivery record." });
          return;
        }
        setDelivery({ state: "ready", summary: parsed.data, transport: payload.emailTransport ?? null });
      } catch (fetchError) {
        if (cancelled) return;
        setDelivery({ state: "error", message: fetchError instanceof Error ? fetchError.message : String(fetchError) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [campaignId, refresh]);

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
        <p className="flex flex-wrap items-center gap-2 text-[0.82rem] font-semibold text-foreground">
          <Mail className="h-4 w-4" /> Email delivery
          <Button type="button" variant="outline" size="sm" disabled={delivery.state === "loading"} onClick={() => { setDelivery({ state: "loading" }); setRefresh(value => value + 1); }}>Refresh email status</Button>
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          What became of the update emails and confirmations OpenPlan queued for this campaign.
        </p>
        <div className="mt-3">
          <EmailDeliveryPanel delivery={delivery.state === "ready" && delivery.summary.campaignId !== campaignId ? { state: "loading" } : delivery} />
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
