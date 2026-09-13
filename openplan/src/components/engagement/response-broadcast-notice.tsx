"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { responseBroadcastSchema, type ResponseBroadcast } from "@/lib/engagement/response-broadcast";

export function describeResponseBroadcast(report: ResponseBroadcast | null): string[] {
  if (!report) return ["Subscriber update status is unknown. This does not mean no emails were sent. Refresh to check the retained publication record."];
  if (report.state === "queued") return ["The subscriber update is queued for the local email worker. The recipient count is not known yet."];
  if (report.state === "no_share_token") return ["No emails were prepared: this campaign had no public share link for the unsubscribe links. Future updates require a working public share link."];
  if (report.state === "cancelled") return ["This subscriber update was cancelled before messages were prepared because the published response or campaign changed."];
  if (report.preparedCount === 0) return ["Preparation found no confirmed, active subscriptions for this campaign. No messages were prepared for this update."];
  const labels: Record<keyof ResponseBroadcast["counts"], string> = {
    queued: "queued for the local worker", attempting: "being attempted; outcome not yet known",
    accepted: "accepted by the email provider; inbox delivery is not confirmed",
    skipped: "recorded but not sent because no email service was configured",
    failed: "recorded as failed", uncertain: "with an uncertain outcome; automatic resend is disabled",
    cancelled: "cancelled before delivery because the response, campaign or subscription changed",
  };
  return Object.entries(labels).flatMap(([state, label]) => {
    const n = report.counts[state as keyof ResponseBroadcast["counts"]] ?? 0;
    return n ? [`${n} ${n === 1 ? "message" : "messages"} ${label}.`] : [];
  });
}

export function ResponseBroadcastNotice({ campaignId, entryId, requestId, initialReport, anchorId }: {
  campaignId: string; entryId: string; requestId: string; initialReport: unknown; anchorId?: string;
}) {
  function validate(value: unknown) {
    const parsed = responseBroadcastSchema.safeParse(value);
    return parsed.success && parsed.data.campaignId === campaignId && parsed.data.requestId === requestId ? parsed.data : null;
  }
  const [report, setReport] = useState<ResponseBroadcast | null>(() => validate(initialReport));
  const [busy, setBusy] = useState(false);
  async function refresh() {
    setBusy(true);
    try {
      const response = await fetch(`/api/engagement/campaigns/${campaignId}/closeloop/broadcasts/${requestId}`, { cache: "no-store", signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error("Report read failed");
      const payload = await response.json();
      setReport(validate(payload.broadcast));
    } catch {
      setReport(null);
    } finally {
      setBusy(false);
    }
  }
  return <div className="space-y-2 rounded-lg border border-border bg-muted/40 p-3 text-sm" id={anchorId ?? `closeloop-broadcast-notice-${entryId}`} data-testid="closeloop-broadcast-notice">
    <p className="font-semibold">Subscriber update for this publication</p>
    <div role="status">{describeResponseBroadcast(report).map(line => <p key={line}>{line}</p>)}</div>
    <Button type="button" variant="outline" size="sm" onClick={() => void refresh()} disabled={busy}>{busy ? "Checking email status…" : "Refresh email status"}</Button>
  </div>;
}
