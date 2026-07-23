import type { SupabaseClient } from "@supabase/supabase-js";
import { emailTransportName, sendEmail } from "./email";

// The ONLY module that touches the sensitive engagement_subscriptions and
// engagement_email_outbox tables (participant emails) — enforced by
// src/test/engagement-notifications-reader-inventory.test.ts. It also owns
// engagement_notifications (operator inbox) reads/writes for consistency, though
// that table is operator-scoped, not sensitive. All writes here are best-effort:
// callers fire them AFTER the primary action has already succeeded, so a failure
// here never fails the user's action.

type QueryClient = Pick<SupabaseClient, "from">;

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
  const { data, error } = await client
    .from("engagement_notifications")
    .update({ is_read: true, read_at: new Date().toISOString() })
    .eq("id", params.notificationId)
    .eq("campaign_id", params.campaignId)
    .select("id")
    .maybeSingle();
  return { ok: !error, found: Boolean(data) };
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

/** Enqueue a message to every confirmed, still-subscribed participant of a campaign. */
export async function enqueueCampaignSubscriberEmails(
  client: QueryClient,
  campaignId: string,
  msg: { subject: string; text: string; template?: string }
): Promise<{ enqueued: number }> {
  const { data } = await client
    .from("engagement_subscriptions")
    .select("email")
    .eq("campaign_id", campaignId)
    .eq("confirmed", true)
    .is("unsubscribed_at", null);
  const subscribers = (data ?? []) as { email: string }[];
  let enqueued = 0;
  for (const subscriber of subscribers) {
    await enqueueEmail(client, { campaignId, to: subscriber.email, subject: msg.subject, text: msg.text, template: msg.template });
    enqueued += 1;
  }
  return { enqueued };
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
  const { data, error } = await client
    .from("engagement_subscriptions")
    .update({ confirmed: true, confirmed_at: new Date().toISOString(), unsubscribed_at: null })
    .eq("campaign_id", params.campaignId)
    .eq("confirm_token", params.token)
    .select("id")
    .maybeSingle();
  return { ok: !error, found: Boolean(data) };
}

export async function unsubscribeByToken(client: QueryClient, token: string): Promise<{ ok: boolean; found: boolean }> {
  const { data, error } = await client
    .from("engagement_subscriptions")
    .update({ unsubscribed_at: new Date().toISOString(), confirmed: false })
    .eq("unsubscribe_token", token)
    .select("id")
    .maybeSingle();
  return { ok: !error, found: Boolean(data) };
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
