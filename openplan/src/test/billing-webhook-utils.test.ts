import { describe, expect, it } from "vitest";
import {
  buildWebhookPayloadHash,
  detectStripeCheckoutIdentityReview,
  mapStripeEventToBillingMutation,
  parseLegacyWebhookPayload,
  resolveLegacyWebhookEventId,
  verifyStripeWebhookSignature,
} from "@/lib/billing/webhook";

describe("billing webhook helpers", () => {
  it("uses explicit legacy event id when provided", () => {
    const eventId = resolveLegacyWebhookEventId('{"hello":"world"}', "legacy_evt_123");
    expect(eventId).toBe("legacy_evt_123");
  });

  it("derives deterministic legacy event id from payload hash", () => {
    const rawBody = JSON.stringify({ workspaceId: "w", status: "active" });
    const eventIdA = resolveLegacyWebhookEventId(rawBody);
    const eventIdB = resolveLegacyWebhookEventId(rawBody);

    expect(eventIdA).toBe(eventIdB);
    expect(eventIdA).toBe(`legacy_${buildWebhookPayloadHash(rawBody)}`);
  });

  it("parses legacy payload schema with optional id/type", () => {
    const parsed = parseLegacyWebhookPayload({
      workspaceId: "11111111-1111-4111-8111-111111111111",
      subscriptionStatus: "active",
      subscriptionPlan: "starter",
      eventType: "legacy.test",
      eventId: "evt_legacy_1",
    });

    expect(parsed.success).toBe(true);
  });

  it("returns guarded error when stripe webhook secret is missing", async () => {
    const result = await verifyStripeWebhookSignature({
      rawBody: "{}",
      signatureHeader: "t=123,v1=abc",
      webhookSecret: "",
      loadStripeConstructor: async () => null,
    });

    expect(result).toMatchObject({ ok: false, reason: "missing_webhook_secret" });
  });

  it("returns guarded error when stripe sdk is unavailable", async () => {
    const result = await verifyStripeWebhookSignature({
      rawBody: "{}",
      signatureHeader: "t=123,v1=abc",
      webhookSecret: "whsec_test",
      loadStripeConstructor: async () => null,
    });

    expect(result).toMatchObject({ ok: false, reason: "missing_sdk" });
  });

  it("detects purchaser-email mismatch for checkout manual review", () => {
    const review = detectStripeCheckoutIdentityReview({
      id: "evt_checkout_123",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_test_123",
          customer: "cus_123",
          customer_details: {
            email: "billing@example.com",
          },
          metadata: {
            workspaceId: "11111111-1111-4111-8111-111111111111",
            plan: "starter",
            initiatedByUserEmail: "owner@example.com",
          },
        },
      },
    });

    expect(review).toMatchObject({
      workspaceId: "11111111-1111-4111-8111-111111111111",
      checkoutSessionId: "cs_test_123",
      stripeCustomerId: "cus_123",
      initiatedByUserEmail: "owner@example.com",
      purchaserEmail: "billing@example.com",
      reason: "purchaser_email_mismatch",
    });
  });

  it("maps customer.subscription.updated into billing mutation", () => {
    const mapped = mapStripeEventToBillingMutation({
      id: "evt_123",
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_123",
          customer: "cus_123",
          status: "past_due",
          current_period_end: 1767225600,
          metadata: {
            workspaceId: "11111111-1111-4111-8111-111111111111",
            plan: "professional",
          },
        },
      },
    });

    expect(mapped.handled).toBe(true);
    if (mapped.handled) {
      expect(mapped.mutation.workspaceId).toBe("11111111-1111-4111-8111-111111111111");
      expect(mapped.mutation.subscriptionStatus).toBe("past_due");
      expect(mapped.mutation.subscriptionPlan).toBe("professional");
      expect(mapped.mutation.stripeCustomerId).toBe("cus_123");
      expect(mapped.mutation.stripeSubscriptionId).toBe("sub_123");
      expect(mapped.mutation.currentPeriodEnd).toBe("2026-01-01T00:00:00.000Z");
    }
  });

  it("ignores unsupported stripe event types", () => {
    const mapped = mapStripeEventToBillingMutation({
      id: "evt_123",
      type: "invoice.created",
      data: {
        object: {},
      },
    });

    expect(mapped).toMatchObject({ handled: false, reason: "unsupported_event_type" });
  });
});
