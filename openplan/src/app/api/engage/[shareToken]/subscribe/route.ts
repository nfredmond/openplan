import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { BODY_LIMITS, readJsonWithLimit } from "@/lib/http/body-limit";
import {
  buildPublicSubmissionClientFingerprint,
  getPublicSubmissionUserAgent,
  PUBLIC_SUBMISSION_MAX_PER_WINDOW,
  PUBLIC_SUBMISSION_RATE_WINDOW_MINUTES,
} from "@/lib/engagement/public-submit";
import { enqueueEmail, loadRecentSubscriptionsByFingerprint, subscribeParticipant } from "@/lib/notifications/engagement";
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
    const recent = await loadRecentSubscriptionsByFingerprint(supabase, campaign.id, fingerprint);
    const windowMs = PUBLIC_SUBMISSION_RATE_WINDOW_MINUTES * 60 * 1000;
    const recentCount = recent.filter((row) => {
      const t = Date.parse(row.created_at);
      return !Number.isNaN(t) && Date.now() - t <= windowMs;
    }).length;
    if (recentCount >= PUBLIC_SUBMISSION_MAX_PER_WINDOW) {
      return NextResponse.json({ error: "Too many recent requests from this connection. Please wait a few minutes." }, { status: 429 });
    }

    const confirmToken = mintToken();
    const unsubscribeToken = mintToken();
    const result = await subscribeParticipant(supabase, {
      campaignId: campaign.id,
      email: parsed.data.email.toLowerCase(),
      fingerprint,
      userAgent: getPublicSubmissionUserAgent(request),
      confirmToken,
      unsubscribeToken,
    });
    if (!result.ok) return NextResponse.json({ error: "Failed to save your subscription" }, { status: 500 });

    // Send a double-opt-in confirmation unless they are already active. The outbox
    // records it even when no transport is configured (honest $0 no-op).
    if (!result.alreadyConfirmed) {
      const origin = request.nextUrl.origin;
      const confirmUrl = `${origin}/api/engage/${parsedParams.data.shareToken}/subscribe/confirm?token=${confirmToken}`;
      const unsubscribeUrl = `${origin}/api/engage/${parsedParams.data.shareToken}/subscribe/unsubscribe?token=${unsubscribeToken}`;
      await enqueueEmail(supabase, {
        campaignId: campaign.id,
        to: parsed.data.email.toLowerCase(),
        subject: `Confirm your updates for ${campaign.title}`,
        text: `Confirm you'd like email updates for "${campaign.title}":\n${confirmUrl}\n\nNot you? Ignore this email or unsubscribe: ${unsubscribeUrl}`,
        template: "subscribe_confirm",
      }).catch(() => {});
    }

    // Honest response: never promise an email that cannot be sent.
    const message = transportConfigured
      ? result.alreadyConfirmed
        ? "You're already subscribed to updates for this campaign."
        : "Almost there — check your email to confirm your subscription."
      : "Your interest is recorded. Email updates are not enabled for this campaign yet, so no confirmation email will be sent.";

    audit.info("subscription_recorded", { campaignId: campaign.id, alreadyConfirmed: result.alreadyConfirmed, transportConfigured });
    return NextResponse.json({ success: true, message, transportConfigured, alreadyConfirmed: result.alreadyConfirmed }, { status: 201 });
  } catch (error) {
    audit.error("unhandled_error", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "Unexpected error while subscribing" }, { status: 500 });
  }
}
