import type { SupabaseClient } from "@supabase/supabase-js";
import { isWriteFailure, writeMatchedNoRows } from "@/lib/http/write-outcome";
import { emailTransportName, sendEmail } from "./email";

// The ONLY module that touches the sensitive engagement_subscriptions and
// engagement_email_outbox tables (participant emails) — enforced by
// src/test/engagement-notifications-reader-inventory.test.ts. It also owns
// engagement_notifications (operator inbox) reads/writes for consistency, though
// that table is operator-scoped, not sensitive. All writes here are best-effort:
// callers fire them AFTER the primary action has already succeeded, so a failure
// here never fails the user's action.

type QueryClient = Pick<SupabaseClient, "from">;

// The three scoped single-row writes below all answer `{ ok, found }`, and the
// two axes are deliberately independent: `ok` is whether the database answered
// at all, `found` is whether the write matched a row. Collapsing them is how a
// genuine failure ends up telling a participant their confirmation link was
// "already used" — see @/lib/http/write-outcome for why zero matched rows is
// not a fault. A failed write knows nothing about rows, so it is never `found`.
// Each site reads those helpers itself rather than through a wrapper here: the
// decision belongs at the write, and a wrapper would hide it from the reader
// and from src/test/write-zero-row-status-guard.test.ts alike.

export type EngagementNotificationType =
  | "comment_submitted"
  | "comment_flagged"
  | "survey_response"
  | "closeloop_published";

export type EngagementNotificationRow = {
  id: string;
  workspace_id: string;
  campaign_id: string;
  type: EngagementNotificationType;
  title: string;
  body: string;
  payload_json: Record<string, unknown>;
  is_read: boolean;
  read_at: string | null;
  created_at: string;
};

const NOTIFICATION_COLUMNS = "id, workspace_id, campaign_id, type, title, body, payload_json, is_read, read_at, created_at";

// ── Operator inbox ────────────────────────────────────────────────────────────

/** Best-effort: record an operator inbox notification. Never throws. */
export async function recordOperatorNotification(
  client: QueryClient,
  params: { workspaceId: string; campaignId: string; type: EngagementNotificationType; title: string; body?: string; payload?: Record<string, unknown> }
): Promise<{ ok: boolean }> {
  try {
    const { error } = await client.from("engagement_notifications").insert({
      workspace_id: params.workspaceId,
      campaign_id: params.campaignId,
      type: params.type,
      title: params.title,
      body: params.body ?? "",
      payload_json: params.payload ?? {},
    });
    return { ok: !error };
  } catch {
    return { ok: false };
  }
}

export async function loadOperatorNotifications(
  client: QueryClient,
  campaignId: string,
  opts?: { limit?: number }
): Promise<EngagementNotificationRow[]> {
  const { data } = await client
    .from("engagement_notifications")
    .select(NOTIFICATION_COLUMNS)
    .eq("campaign_id", campaignId)
    .order("created_at", { ascending: false })
    .limit(opts?.limit ?? 30);
  return (data ?? []) as EngagementNotificationRow[];
}

/** Mark every unread notification for a campaign read. */
export async function markAllNotificationsRead(client: QueryClient, campaignId: string): Promise<{ ok: boolean }> {
  const { error } = await client
    .from("engagement_notifications")
    .update({ is_read: true, read_at: new Date().toISOString() })
    .eq("campaign_id", campaignId)
    .eq("is_read", false);
  return { ok: !error };
}

/** Mark a single notification read, double-scoped by id AND campaign_id. */
export async function markNotificationRead(
  client: QueryClient,
  params: { notificationId: string; campaignId: string }
): Promise<{ ok: boolean; found: boolean }> {
  const result = await client
    .from("engagement_notifications")
    .update({ is_read: true, read_at: new Date().toISOString() })
    .eq("id", params.notificationId)
    .eq("campaign_id", params.campaignId)
    .select("id")
    .maybeSingle();
  if (isWriteFailure(result.error)) return { ok: false, found: false };
  return { ok: true, found: !writeMatchedNoRows(result) };
}

// ── Email outbox (sensitive) ──────────────────────────────────────────────────

export type EnqueueEmailResult = { outboxId: string | null; status: "sent" | "skipped" | "failed"; transport: string };

/**
 * Record a message in the outbox, then attempt delivery through the transport
 * seam. At $0 sendEmail() no-ops → status 'skipped' (honest, observable). The
 * row is always written first so nothing is lost even if delivery is impossible.
 */
export async function enqueueEmail(
  client: QueryClient,
  msg: { campaignId: string | null; to: string; subject: string; text: string; template?: string; payload?: Record<string, unknown> }
): Promise<EnqueueEmailResult> {
  let outboxId: string | null = null;
  try {
    const { data: row } = await client
      .from("engagement_email_outbox")
      .insert({
        campaign_id: msg.campaignId,
        to_email: msg.to,
        subject: msg.subject,
        body: msg.text,
        template: msg.template ?? null,
        status: "queued",
        payload_json: msg.payload ?? {},
      })
      .select("id")
      .single();
    outboxId = (row?.id as string | undefined) ?? null;
  } catch {
    return { outboxId: null, status: "failed", transport: emailTransportName() };
  }

  const result = await sendEmail({ to: msg.to, subject: msg.subject, text: msg.text });
  const status: EnqueueEmailResult["status"] = result.delivered ? "sent" : result.reason === "not_configured" ? "skipped" : "failed";

  if (outboxId) {
    await client
      .from("engagement_email_outbox")
      .update({ status, transport: result.transport, error: result.error ?? null, sent_at: result.delivered ? new Date().toISOString() : null })
      .eq("id", outboxId);
  }
  return { outboxId, status, transport: result.transport };
}

export type CampaignBroadcastResult = {
  /** Rows written to the outbox — one per confirmed, still-subscribed participant. */
  enqueued: number;
  /** Of those, how many the transport actually accepted. */
  delivered: number;
  /** Recorded but not sent, because no transport is configured. */
  skipped: number;
  /** Recorded and the transport refused or errored. */
  failed: number;
  /** Transport name in effect ("none" when unconfigured). */
  transport: string;
};

/**
 * Enqueue a message to every confirmed, still-subscribed participant of a
 * campaign. The `unsubscribe` context is REQUIRED, not optional: these are
 * bulk emails to members of the public, and a broadcast without a working
 * per-recipient opt-out link is a CAN-SPAM problem, not a styling choice.
 * (Shipped without it until 2026-08-04 — the token existed on every row and
 * was simply never selected.) The URL shape must match the one the subscribe
 * confirmation email mints in api/engage/[shareToken]/subscribe/route.ts.
 */
export async function enqueueCampaignSubscriberEmails(
  client: QueryClient,
  campaignId: string,
  msg: { subject: string; text: string; template?: string },
  unsubscribe: { origin: string; shareToken: string }
): Promise<CampaignBroadcastResult> {
  const { data } = await client
    .from("engagement_subscriptions")
    .select("email, unsubscribe_token")
    .eq("campaign_id", campaignId)
    .eq("confirmed", true)
    .is("unsubscribed_at", null);
  const subscribers = (data ?? []) as { email: string; unsubscribe_token: string }[];
  // The per-recipient outcome was already in hand here and was thrown away, so
  // an operator who published an update learned nothing about whether it went
  // anywhere. `enqueued` alone is NOT an answer to "did it send" — at $0 every
  // row is 'skipped' — so the caller gets the delivery breakdown too.
  let enqueued = 0;
  let delivered = 0;
  let skipped = 0;
  let failed = 0;
  for (const subscriber of subscribers) {
    const unsubscribeUrl = `${unsubscribe.origin}/api/engage/${unsubscribe.shareToken}/subscribe/unsubscribe?token=${subscriber.unsubscribe_token}`;
    const outcome = await enqueueEmail(client, {
      campaignId,
      to: subscriber.email,
      subject: msg.subject,
      text: `${msg.text}\n\nUnsubscribe from these updates: ${unsubscribeUrl}`,
      template: msg.template,
    });
    enqueued += 1;
    if (outcome.status === "sent") delivered += 1;
    else if (outcome.status === "skipped") skipped += 1;
    else failed += 1;
  }
  return { enqueued, delivered, skipped, failed, transport: emailTransportName() };
}

// ── Outbox delivery status, for the operator console ──────────────────────────

export type EmailDeliveryCounts = { queued: number; sent: number; skipped: number; failed: number };

/**
 * What an operator is allowed to be told about a campaign's outbox.
 *
 * `ok: false` is a DISTINCT answer from `ok: true, total: 0`: "we could not read
 * the delivery record" and "nothing was ever queued" are different facts, and a
 * failed read may not be rendered as "no emails have been sent".
 *
 * NOTE the shape carries no recipient address. The outbox holds participant
 * email addresses (sensitive PII, service-role-only); a delivery *status* panel
 * needs counts, not people, so the projection below never selects `to_email`.
 */
export type EmailDeliverySummary =
  | {
      ok: true;
      total: number;
      counts: EmailDeliveryCounts;
      /** Distinct transports observed on these rows ("none" = recorded, never sent). */
      transports: string[];
      lastAttemptAt: string | null;
      lastFailure: { at: string; message: string } | null;
      /** True when the window filled up, so the counts are a floor, not a total. */
      truncated: boolean;
    }
  | { ok: false; message: string };

const EMAIL_DELIVERY_WINDOW = 500;

const DELIVERY_STATUS_KEYS: readonly (keyof EmailDeliveryCounts)[] = ["queued", "sent", "skipped", "failed"];

/** The columns the delivery panel renders — deliberately excluding `to_email`. */
export const EMAIL_OUTBOX_SUMMARY_COLUMNS = "status, transport, error, created_at, sent_at";

/**
 * Delivery status for one campaign's outbox rows. Never throws: a failed read
 * comes back as `{ ok: false }` so the caller can say so instead of inventing a
 * zero.
 */
export async function loadCampaignEmailDeliverySummary(
  client: QueryClient,
  campaignId: string
): Promise<EmailDeliverySummary> {
  type OutboxStatusRow = {
    status: string | null;
    transport: string | null;
    error: string | null;
    created_at: string;
    sent_at: string | null;
  };
  let rows: OutboxStatusRow[];
  try {
    const { data, error } = await client
      .from("engagement_email_outbox")
      .select(EMAIL_OUTBOX_SUMMARY_COLUMNS)
      .eq("campaign_id", campaignId)
      .order("created_at", { ascending: false })
      .limit(EMAIL_DELIVERY_WINDOW);
    if (error) return { ok: false, message: error.message ?? "the database returned no reason" };
    rows = (data ?? []) as OutboxStatusRow[];
  } catch (readError) {
    return { ok: false, message: readError instanceof Error ? readError.message : String(readError) };
  }

  const counts: EmailDeliveryCounts = { queued: 0, sent: 0, skipped: 0, failed: 0 };
  const transports = new Set<string>();
  let lastAttemptAt: string | null = null;
  let lastFailure: { at: string; message: string } | null = null;

  for (const row of rows) {
    const status = (row.status ?? "") as keyof EmailDeliveryCounts;
    if (DELIVERY_STATUS_KEYS.includes(status)) counts[status] += 1;
    if (row.transport) transports.add(row.transport);
    if (!lastAttemptAt || row.created_at > lastAttemptAt) lastAttemptAt = row.created_at;
    if (status === "failed" && (!lastFailure || row.created_at > lastFailure.at)) {
      lastFailure = { at: row.created_at, message: row.error ?? "no reason was recorded" };
    }
  }

  return {
    ok: true,
    total: rows.length,
    counts,
    transports: [...transports].sort(),
    lastAttemptAt,
    lastFailure,
    truncated: rows.length >= EMAIL_DELIVERY_WINDOW,
  };
}

// ── Subscriptions (sensitive) ─────────────────────────────────────────────────

export type SubscribeResult = { ok: boolean; alreadyConfirmed: boolean };

/**
 * Opt a participant in. A still-active confirmed subscription is left untouched
 * (no re-confirmation churn); otherwise the row is (re)created unconfirmed with
 * fresh tokens for a double-opt-in confirm link.
 */
export async function subscribeParticipant(
  client: QueryClient,
  params: { campaignId: string; email: string; fingerprint: string | null; userAgent: string | null; confirmToken: string; unsubscribeToken: string }
): Promise<SubscribeResult> {
  const { data: existing } = await client
    .from("engagement_subscriptions")
    .select("id, confirmed, unsubscribed_at")
    .eq("campaign_id", params.campaignId)
    .eq("email", params.email)
    .maybeSingle();

  if (existing && (existing as { confirmed: boolean }).confirmed && !(existing as { unsubscribed_at: string | null }).unsubscribed_at) {
    return { ok: true, alreadyConfirmed: true };
  }

  const { error } = await client.from("engagement_subscriptions").upsert(
    {
      campaign_id: params.campaignId,
      email: params.email,
      fingerprint: params.fingerprint,
      user_agent: params.userAgent,
      confirmed: false,
      confirm_token: params.confirmToken,
      unsubscribe_token: params.unsubscribeToken,
      unsubscribed_at: null,
    },
    { onConflict: "campaign_id,email" }
  );
  return { ok: !error, alreadyConfirmed: false };
}

export async function confirmSubscription(
  client: QueryClient,
  params: { campaignId: string; token: string }
): Promise<{ ok: boolean; found: boolean }> {
  const result = await client
    .from("engagement_subscriptions")
    .update({ confirmed: true, confirmed_at: new Date().toISOString(), unsubscribed_at: null })
    .eq("campaign_id", params.campaignId)
    .eq("confirm_token", params.token)
    .select("id")
    .maybeSingle();
  if (isWriteFailure(result.error)) return { ok: false, found: false };
  return { ok: true, found: !writeMatchedNoRows(result) };
}

export async function unsubscribeByToken(client: QueryClient, token: string): Promise<{ ok: boolean; found: boolean }> {
  const result = await client
    .from("engagement_subscriptions")
    .update({ unsubscribed_at: new Date().toISOString(), confirmed: false })
    .eq("unsubscribe_token", token)
    .select("id")
    .maybeSingle();
  if (isWriteFailure(result.error)) return { ok: false, found: false };
  return { ok: true, found: !writeMatchedNoRows(result) };
}

/** Rows this fingerprint created for a campaign — for per-IP subscribe rate limiting. */
export async function loadRecentSubscriptionsByFingerprint(
  client: QueryClient,
  campaignId: string,
  fingerprint: string
): Promise<{ created_at: string }[]> {
  const { data } = await client
    .from("engagement_subscriptions")
    .select("created_at")
    .eq("campaign_id", campaignId)
    .eq("fingerprint", fingerprint);
  return (data ?? []) as { created_at: string }[];
}
