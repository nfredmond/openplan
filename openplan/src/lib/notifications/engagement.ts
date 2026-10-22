import type { SupabaseClient } from "@supabase/supabase-js";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { isWriteFailure, writeMatchedNoRows } from "@/lib/http/write-outcome";
import { emailTransportName, sendEmail } from "./email";
import {
  PUBLIC_SUBMISSION_MAX_PER_WINDOW,
  PUBLIC_SUBMISSION_RATE_WINDOW_MINUTES,
} from "@/lib/engagement/public-submit";
import { responseEmailOutcomeSchema, type ResponseEmailOutcome } from "./response-email-outcome";

// The ONLY module that touches the sensitive engagement_subscriptions and
// engagement_email_outbox tables (participant emails) — enforced by
// src/test/engagement-notifications-reader-inventory.test.ts. It also owns
// engagement_notifications (operator inbox) reads/writes for consistency, though
// that table is operator-scoped, not sensitive. All writes here are best-effort:
// callers fire them AFTER the primary action has already succeeded, so a failure
// here never fails the user's action.

type QueryClient = Pick<SupabaseClient, "from">;

const preparedBroadcastSchema = z.object({
  campaignId: z.string().uuid(), requestId: z.string().uuid(),
  state: z.enum(["prepared", "cancelled", "no_share_token"]),
  count: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
}).nullable();
const responseEmailClaimSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("cancelled"), outboxId: z.string().uuid() }),
  z.object({ state: z.literal("attempting"), outboxId: z.string().uuid(), attemptToken: z.string().uuid(),
    messageText: z.string(), contentSha256: z.string().regex(/^[a-f0-9]{64}$/) }),
]).nullable();
const retainedEmailSchema = z.object({ to: z.string().email(), subject: z.string(), text: z.string() }).strict();

/** Retry recording an observed outcome, never retry its transport call. */
export async function finishResponseEmail(client: Pick<SupabaseClient, "rpc">, outcome: ResponseEmailOutcome): Promise<boolean> {
  try {
    const parsed = responseEmailOutcomeSchema.parse(outcome);
    const result = await client.rpc("finish_engagement_response_email", {
      p_outbox: parsed.outboxId, p_attempt: parsed.attemptToken, p_state: parsed.state,
      p_transport: parsed.transport, p_error: parsed.error,
    });
    return !result.error && result.data === true;
  } catch { return false; }
}

/** Process one retained publication email. The worker journals outcomes before acknowledging them in the database. */
export async function processResponseEmail(
  client: Pick<SupabaseClient, "rpc">,
  origin: string,
  journal: { retain: (outcome: ResponseEmailOutcome) => Promise<void>; recorded: (outcome: ResponseEmailOutcome) => Promise<void> },
  transport: typeof sendEmail = sendEmail,
): Promise<"idle" | "progress" | "unavailable"> {
  try {
    const url = new URL(origin);
    if (!["http:", "https:"].includes(url.protocol) || url.origin !== origin) return "unavailable";
    const prepared = await client.rpc("prepare_engagement_response_broadcast", { p_origin: origin });
    if (prepared.error) return "unavailable";
    const preparation = preparedBroadcastSchema.parse(prepared.data);
    const attempt = randomUUID();
    const claimed = await client.rpc("claim_engagement_response_email", { p_attempt: attempt });
    if (claimed.error) return "unavailable";
    const claim = responseEmailClaimSchema.parse(claimed.data);
    if (!claim) return preparation ? "progress" : "idle";
    if (claim.state === "cancelled") return "progress";
    if (claim.attemptToken !== attempt || createHash("sha256").update(claim.messageText).digest("hex") !== claim.contentSha256) {
      return "unavailable";
    }
    const message = retainedEmailSchema.parse(JSON.parse(claim.messageText));
    let result: Awaited<ReturnType<typeof sendEmail>>;
    try { result = await transport(message); }
    catch { result = { delivered: false, transport: emailTransportName(), reason: "unknown" }; }
    const outcome: ResponseEmailOutcome = {
      outboxId: claim.outboxId, attemptToken: attempt,
      state: result.delivered ? "accepted" : result.reason === "not_configured" ? "skipped" : "uncertain",
      transport: result.transport,
      error: result.delivered || result.reason === "not_configured" ? null : "The email service did not provide a confirmed delivery result. Do not resend automatically.",
    };
    await journal.retain(outcome);
    if (!await finishResponseEmail(client, outcome)) return "unavailable";
    await journal.recorded(outcome);
    return "progress";
  } catch { return "unavailable"; }
}

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

export type EnqueueEmailResult = {
  outboxId: string | null;
  status: "sent" | "skipped" | "failed";
  transport: string;
  /** True when `admit` refused the message after it was recorded; nothing was sent. */
  limited?: boolean;
};

const LIMITED_EMAIL_NOTE = "Not sent: the daily limit for this kind of email was reached.";

/**
 * Record a message in the outbox, then attempt delivery through the transport
 * seam. At $0 sendEmail() no-ops → status 'skipped' (honest, observable). The
 * row is always written first so nothing is lost even if delivery is impossible.
 *
 * `admit`, when given, runs after the row is written and before anything is
 * sent. A limit counted there includes this message and every other one already
 * recorded, so parallel requests cannot all pass it. A refused message stays in
 * the outbox as 'skipped' with a note, and still counts toward the limit.
 */
export async function enqueueEmail(
  client: QueryClient,
  msg: { campaignId: string | null; to: string; subject: string; text: string; template?: string; payload?: Record<string, unknown> },
  options: { admit?: () => Promise<boolean> } = {}
): Promise<EnqueueEmailResult> {
  let outboxId: string | null = null;
  try {
    const { data: row, error: insertError } = await client
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
    if (insertError || !row || typeof row.id !== "string" || !row.id.trim()) {
      return { outboxId: null, status: "failed", transport: emailTransportName() };
    }
    outboxId = row.id;
  } catch {
    return { outboxId: null, status: "failed", transport: emailTransportName() };
  }

  if (options.admit && !(await options.admit().catch(() => false))) {
    // Nothing is sent either way; the row is marked so the outbox says why.
    const marked = await client
      .from("engagement_email_outbox")
      .update({ status: "skipped", transport: "none", error: LIMITED_EMAIL_NOTE })
      .eq("id", outboxId)
      .select("id");
    if (marked.error || (marked.data ?? []).length !== 1) {
      console.warn("[notifications] a limited email was not sent, but its outbox row still reads 'queued'");
    }
    return { outboxId, status: "skipped", transport: "none", limited: true };
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
  /** Outbox writes that failed before any delivery attempt. */
  unrecorded: number;
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
  let unrecorded = 0;
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
    if (!outcome.outboxId) { unrecorded += 1; continue; }
    enqueued += 1;
    if (outcome.status === "sent") delivered += 1;
    else if (outcome.status === "skipped") skipped += 1;
    else failed += 1;
  }
  return { enqueued, unrecorded, delivered, skipped, failed, transport: emailTransportName() };
}

// ── Subscriptions (sensitive) ─────────────────────────────────────────────────

export type SubscribeResult = {
  ok: boolean;
  alreadyConfirmed: boolean;
  /** The existing row's opt-out token when `alreadyConfirmed`; otherwise null. */
  existingUnsubscribeToken: string | null;
};

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
    .select("id, confirmed, unsubscribed_at, unsubscribe_token")
    .eq("campaign_id", params.campaignId)
    .eq("email", params.email)
    .maybeSingle();

  const row = existing as { confirmed: boolean; unsubscribed_at: string | null; unsubscribe_token: string | null } | null;
  if (row && row.confirmed && !row.unsubscribed_at) {
    return { ok: true, alreadyConfirmed: true, existingUnsubscribeToken: row.unsubscribe_token ?? null };
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
  return { ok: !error, alreadyConfirmed: false, existingUnsubscribeToken: null };
}

/*
  SIGN-UP EMAIL LIMITS (KI-2026-10-12-013). The subscribe form sends an email to
  any address typed into it, and the hosted installation's email plan has one
  daily quota shared with account confirmation and password reset mail. A flood
  of sign-ups could use it up and stop those from arriving.

  Every email the subscribe form causes is counted in the outbox:
  - per connection and campaign, over 10 minutes: the public comment limit, so
    a meeting room on one Wi-Fi can sign up. The connection is kept in the
    row's payload_json.source_fingerprint.
  - per address, across every campaign, over a rolling day: 3. A person who
    mistypes, retries and asks again is served; a stranger cannot fill an inbox.
  - per campaign, over a rolling day: 30. Two flooded campaigns use 60 a day;
    under a daily quota of 100, 40 remain for sign-up and password mail.
  The email to an address that is already subscribed counts the same way, so
  every limit behaves identically whether or not the address is subscribed.
  (The connection limit used to count new subscription rows, which an
  already-subscribed address does not create, and a repeat request for the
  same address did not create either.)
*/
export const SUBSCRIBE_EMAIL_TEMPLATES = ["subscribe_confirm", "subscribe_already"] as const;
export const SUBSCRIBE_EMAIL_WINDOW_HOURS = 24;
export const SUBSCRIBE_EMAILS_PER_ADDRESS_PER_DAY = 3;
export const SUBSCRIBE_EMAILS_PER_CAMPAIGN_PER_DAY = 30;

export type SubscribeEmailCounts = { fromConnection: number; toAddress: number; forCampaign: number };
export type SubscribeEmailRefusal = "connection" | "daily";

/** Recent sign-up emails from this connection, to this address and for this campaign. Null when a read failed. */
export async function countRecentSubscribeEmails(
  client: QueryClient,
  params: { campaignId: string; email: string; fingerprint: string; now?: number }
): Promise<SubscribeEmailCounts | null> {
  const now = params.now ?? Date.now();
  const recent = (windowMs: number) =>
    client
      .from("engagement_email_outbox")
      .select("id", { count: "exact", head: true })
      .in("template", [...SUBSCRIBE_EMAIL_TEMPLATES])
      .gte("created_at", new Date(now - windowMs).toISOString());
  const day = SUBSCRIBE_EMAIL_WINDOW_HOURS * 60 * 60 * 1000;
  const [fromConnection, toAddress, forCampaign] = await Promise.all([
    recent(PUBLIC_SUBMISSION_RATE_WINDOW_MINUTES * 60 * 1000)
      .eq("campaign_id", params.campaignId)
      .eq("payload_json->>source_fingerprint", params.fingerprint),
    recent(day).eq("to_email", params.email),
    recent(day).eq("campaign_id", params.campaignId),
  ]);
  if (fromConnection.error || toAddress.error || forCampaign.error) return null;
  return {
    fromConnection: fromConnection.count ?? 0,
    toAddress: toAddress.count ?? 0,
    forCampaign: forCampaign.count ?? 0,
  };
}

/** Which limit another sign-up email would pass. Before it is recorded `>=` refuses; after, it is counted (`>`). */
export function subscribeEmailRefusal(
  counts: SubscribeEmailCounts,
  options: { includesThisEmail: boolean }
): SubscribeEmailRefusal | null {
  const over = (value: number, max: number) => (options.includesThisEmail ? value > max : value >= max);
  if (over(counts.fromConnection, PUBLIC_SUBMISSION_MAX_PER_WINDOW)) return "connection";
  if (
    over(counts.toAddress, SUBSCRIBE_EMAILS_PER_ADDRESS_PER_DAY) ||
    over(counts.forCampaign, SUBSCRIBE_EMAILS_PER_CAMPAIGN_PER_DAY)
  ) {
    return "daily";
  }
  return null;
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
