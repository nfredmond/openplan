"use client";

import { useState } from "react";
import { Bell, Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import type { EngagementNotificationRow, EngagementNotificationType } from "@/lib/notifications/engagement";

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

export function EngagementNotificationsInbox({
  campaignId,
  initialNotifications,
}: {
  campaignId: string;
  initialNotifications: EngagementNotificationRow[];
}) {
  const [items, setItems] = useState<EngagementNotificationRow[]>(initialNotifications);
  const [busy, setBusy] = useState(false);
  const unread = items.filter((n) => !n.is_read).length;

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
