import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { BODY_LIMITS, readJsonWithLimit } from "@/lib/http/body-limit";
import { buildPublicSubmissionClientFingerprint, getPublicSubmissionUserAgent } from "@/lib/engagement/public-submit";
import {
  countRecentSubscribeEmails,
  enqueueEmail,
  subscribeEmailRefusal,
  subscribeParticipant,
  type SubscribeEmailRefusal,
} from "@/lib/notifications/engagement";
import { isEmailTransportConfigured } from "@/lib/notifications/email";

const paramsSchema = z.object({ shareToken: z.string().min(8).max(64) });
const bodySchema = z.object({
  email: z.string().trim().email().max(254),
  // Honeypot: bots fill this in.
  website: z.string().max(500).optional(),
});

function mintToken(): string {
  return (randomUUID() + randomUUID()).replace(/-/g, "");
}

type RouteContext = { params: Promise<{ shareToken: string }> };

const LIMIT_MESSAGES: Record<SubscribeEmailRefusal, string> = {
  connection: "Too many recent requests from this connection. Please wait a few minutes.",
  daily: "Too many sign-up requests today. Please try again tomorrow.",
};

function refused(refusal: SubscribeEmailRefusal) {
  return NextResponse.json({ error: LIMIT_MESSAGES[refusal] }, { status: 429 });
}

/**
 * Sign up for a campaign's email updates.
 *
 * THE ANSWER IS THE SAME WHETHER OR NOT THE ADDRESS IS ALREADY SUBSCRIBED.
 * Until 2026-10-12 it said "You're already subscribed", so anyone could test
 * whether an address follows a consultation (relaunch review L-3). An address
 * that is already subscribed now gets a short email saying so instead of a
 * confirmation link; it counts toward the same daily limits, and the response
 * depends only on whether that email went.
 *
 * Limits per connection, per address and per campaign
 * (`notifications/engagement.ts`) protect the shared email quota
 * (KI-2026-10-12-013). All three count emails in the outbox, and are checked
 * before anything is written and again after the email is recorded, before it
 * is sent.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("engagement.subscribe", request);
  const transportConfigured = isEmailTransportConfigured();
  try {
    const parsedParams = paramsSchema.safeParse(await context.params);
    if (!parsedParams.success) return NextResponse.json({ error: "Invalid share token" }, { status: 400 });

    const payloadBody = await readJsonWithLimit(request, BODY_LIMITS.smallJson);
    if (!payloadBody.ok) return payloadBody.response;
    const parsed = bodySchema.safeParse(payloadBody.data);
    if (!parsed.success) return NextResponse.json({ error: "A valid email is required" }, { status: 400 });

    // Honeypot — silently accept + discard.
    if (parsed.data.website && parsed.data.website.length > 0) {
      return NextResponse.json({ success: true, message: "Thank you." }, { status: 201 });
    }

    const supabase = createServiceRoleClient();

    const { data: campaign, error: campaignError } = await supabase
      .from("engagement_campaigns")
      .select("id, title, status")
      .eq("share_token", parsedParams.data.shareToken)
      .eq("status", "active")
      .maybeSingle();
    if (campaignError) return NextResponse.json({ error: "Failed to verify campaign" }, { status: 500 });
    if (!campaign) return NextResponse.json({ error: "Campaign not found or not publicly available" }, { status: 404 });

    const fingerprint = buildPublicSubmissionClientFingerprint(request);
    const email = parsed.data.email.toLowerCase();
    const scope = { campaignId: campaign.id, email, fingerprint };
    const countsBefore = await countRecentSubscribeEmails(supabase, scope);
    if (!countsBefore) return NextResponse.json({ error: "Failed to verify recent sign-ups" }, { status: 500 });
    const refusedBefore = subscribeEmailRefusal(countsBefore, { includesThisEmail: false });
    if (refusedBefore) return refused(refusedBefore);

    const confirmToken = mintToken();
    const unsubscribeToken = mintToken();
    const result = await subscribeParticipant(supabase, {
      campaignId: campaign.id,
      email,
      fingerprint,
      userAgent: getPublicSubmissionUserAgent(request),
      confirmToken,
      unsubscribeToken,
    });
    if (!result.ok) return NextResponse.json({ error: "Failed to save your subscription" }, { status: 500 });

    // A double-opt-in confirmation, or a note to an address that is already
    // subscribed. The outbox records either one even when no transport is
    // configured (honest $0 no-op).
    const origin = request.nextUrl.origin;
    const unsubscribeUrl = (token: string) =>
      `${origin}/api/engage/${parsedParams.data.shareToken}/subscribe/unsubscribe?token=${token}`;
    const confirmUrl = `${origin}/api/engage/${parsedParams.data.shareToken}/subscribe/confirm?token=${confirmToken}`;
    const message = result.alreadyConfirmed
      ? {
          subject: `You already get updates for ${campaign.title}`,
          text: `You already get email updates for "${campaign.title}". There is nothing more to do.${
            result.existingUnsubscribeToken
              ? `\n\nTo stop these updates: ${unsubscribeUrl(result.existingUnsubscribeToken)}`
              : ""
          }`,
          template: "subscribe_already",
        }
      : {
          subject: `Confirm your updates for ${campaign.title}`,
          text: `Confirm you'd like email updates for "${campaign.title}":\n${confirmUrl}\n\nNot you? Ignore this email or unsubscribe: ${unsubscribeUrl(unsubscribeToken)}`,
          template: "subscribe_confirm",
        };
    // Counted again once this email is in the outbox, so parallel requests
    // cannot all pass. A count that cannot be read sends nothing.
    let refusedAfter: SubscribeEmailRefusal | "unverified" = "unverified";
    const admit = async () => {
      const counts = await countRecentSubscribeEmails(supabase, scope);
      const refusal = counts ? subscribeEmailRefusal(counts, { includesThisEmail: true }) : "unverified";
      if (refusal) refusedAfter = refusal;
      return refusal === null;
    };
    const outcome = await enqueueEmail(
      supabase,
      { campaignId: campaign.id, to: email, ...message, payload: { source_fingerprint: fingerprint } },
      { admit }
    ).catch(() => null);
    if (outcome?.limited) {
      return refusedAfter === "unverified"
        ? NextResponse.json({ error: "Failed to verify recent sign-ups" }, { status: 500 })
        : refused(refusedAfter);
    }

    const confirmationNeedsRetry = !outcome?.outboxId || outcome.status === "failed";

    // Honest response: never promise an email that cannot be sent. It depends on
    // the email only, never on whether the address was already subscribed.
    const reply = !outcome?.outboxId
      ? "Your interest is saved, but the confirmation email could not be prepared. Try subscribing again."
      : outcome.status === "failed"
        ? "Your interest is saved, but the confirmation email could not be sent. Try subscribing again."
        : outcome.status === "sent"
          ? "Check your email to confirm your subscription. If you confirmed before, nothing more is needed."
          : "Your interest is recorded. Email updates are not enabled for this campaign yet, so no confirmation email will be sent.";

    audit.info("subscription_recorded", { campaignId: campaign.id, transportConfigured });
    return NextResponse.json({ success: true, message: reply, transportConfigured, confirmationNeedsRetry }, { status: 201 });
  } catch (error) {
    audit.error("unhandled_error", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "Unexpected error while subscribing" }, { status: 500 });
  }
}
