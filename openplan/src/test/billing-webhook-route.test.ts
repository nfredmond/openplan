import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const createApiAuditLoggerMock = vi.fn();
const createServiceRoleClientMock = vi.fn();
const buildWebhookPayloadHashMock = vi.fn();
const parseLegacyWebhookPayloadMock = vi.fn();
const resolveLegacyWebhookEventIdMock = vi.fn();
const verifyStripeWebhookSignatureMock = vi.fn();
const mapStripeEventToBillingMutationMock = vi.fn();
const claimWebhookEventMock = vi.fn();
const completeWebhookEventMock = vi.fn();
const logBillingEventMock = vi.fn();
const workspaceUpdateEqMock = vi.fn();
const workspaceUpdateMock = vi.fn();
const workspaceFromMock = vi.fn();

const mockAudit = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: (...args: unknown[]) => createApiAuditLoggerMock(...args),
}));

vi.mock("@/lib/supabase/server", () => ({
  createServiceRoleClient: (...args: unknown[]) => createServiceRoleClientMock(...args),
}));

vi.mock("@/lib/billing/webhook", () => ({
  buildWebhookPayloadHash: (...args: unknown[]) => buildWebhookPayloadHashMock(...args),
  parseLegacyWebhookPayload: (...args: unknown[]) => parseLegacyWebhookPayloadMock(...args),
  resolveLegacyWebhookEventId: (...args: unknown[]) => resolveLegacyWebhookEventIdMock(...args),
  verifyStripeWebhookSignature: (...args: unknown[]) => verifyStripeWebhookSignatureMock(...args),
  mapStripeEventToBillingMutation: (...args: unknown[]) => mapStripeEventToBillingMutationMock(...args),
}));

vi.mock("@/lib/billing/webhook-idempotency", () => ({
  claimWebhookEvent: (...args: unknown[]) => claimWebhookEventMock(...args),
  completeWebhookEvent: (...args: unknown[]) => completeWebhookEventMock(...args),
}));

vi.mock("@/lib/billing/events", () => ({
  logBillingEvent: (...args: unknown[]) => logBillingEventMock(...args),
}));

import { POST as postWebhook } from "@/app/api/billing/webhook/route";

function jsonRequest(payload: unknown, headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/billing/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(payload),
  });
}

describe("POST /api/billing/webhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    createApiAuditLoggerMock.mockReturnValue(mockAudit);

    buildWebhookPayloadHashMock.mockReturnValue("hash_abc");
    resolveLegacyWebhookEventIdMock.mockReturnValue("legacy_evt_1");

    parseLegacyWebhookPayloadMock.mockReturnValue({
      success: true,
      data: {
        workspaceId: "11111111-1111-4111-8111-111111111111",
        subscriptionStatus: "active",
        subscriptionPlan: "starter",
        eventType: "legacy.workspace_billing_updated",
        eventId: "legacy_evt_1",
        source: "legacy.test",
      },
    });

    claimWebhookEventMock.mockResolvedValue({ accepted: true, receiptId: "receipt_1" });
    completeWebhookEventMock.mockResolvedValue(undefined);
    logBillingEventMock.mockResolvedValue(undefined);
    mapStripeEventToBillingMutationMock.mockReturnValue({
      handled: true,
      mutation: {
        workspaceId: "11111111-1111-4111-8111-111111111111",
        subscriptionStatus: "active",
        subscriptionPlan: "starter",
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_123",
        source: "stripe.checkout.session.completed",
      },
    });

    workspaceUpdateEqMock.mockResolvedValue({ error: null });
    workspaceUpdateMock.mockReturnValue({ eq: workspaceUpdateEqMock });
    workspaceFromMock.mockReturnValue({ update: workspaceUpdateMock });
    createServiceRoleClientMock.mockReturnValue({ from: workspaceFromMock });

    process.env.OPENPLAN_BILLING_WEBHOOK_SECRET = "legacy-secret";
    delete process.env.OPENPLAN_STRIPE_ALLOW_GUARDED_FALLBACK;
  });

  it("enforces strict mode in production when stripe verification is unavailable", async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";

    verifyStripeWebhookSignatureMock.mockResolvedValue({
      ok: false,
      reason: "missing_sdk",
      message: "Stripe SDK package is not installed",
    });

    const response = await postWebhook(
      jsonRequest(
        {
          workspaceId: "11111111-1111-4111-8111-111111111111",
          subscriptionStatus: "active",
        },
        {
          "stripe-signature": "t=123,v1=test",
          "x-openplan-billing-secret": "legacy-secret",
        }
      )
    );

    process.env.NODE_ENV = originalNodeEnv;

    expect(response.status).toBe(503);
    const payload = (await response.json()) as { error: string; fallbackAllowed: boolean };
    expect(payload.error).toBe("Stripe webhook verification failed");
    expect(payload.fallbackAllowed).toBe(false);

    expect(parseLegacyWebhookPayloadMock).not.toHaveBeenCalled();
    expect(claimWebhookEventMock).not.toHaveBeenCalled();
  });

  it("keeps fallback disabled unless explicitly enabled", async () => {
    verifyStripeWebhookSignatureMock.mockResolvedValue({
      ok: false,
      reason: "missing_sdk",
      message: "Stripe SDK package is not installed",
    });

    const response = await postWebhook(
      jsonRequest(
        {
          workspaceId: "11111111-1111-4111-8111-111111111111",
          subscriptionStatus: "active",
        },
        {
          "stripe-signature": "t=123,v1=test",
          "x-openplan-billing-secret": "legacy-secret",
        }
      )
    );

    expect(response.status).toBe(503);
    const payload = (await response.json()) as { fallbackAllowed: boolean };
    expect(payload.fallbackAllowed).toBe(false);
    expect(parseLegacyWebhookPayloadMock).not.toHaveBeenCalled();
  });

  it("processes verified stripe events and marks receipt as processed", async () => {
    verifyStripeWebhookSignatureMock.mockResolvedValue({
      ok: true,
      event: {
        id: "evt_123",
        type: "checkout.session.completed",
        data: { object: {} },
      },
    });

    const response = await postWebhook(
      jsonRequest(
        {
          object: "event",
          id: "evt_123",
        },
        {
          "stripe-signature": "t=123,v1=test",
        }
      )
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true });

    expect(claimWebhookEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "stripe",
        eventId: "evt_123",
        eventType: "checkout.session.completed",
      })
    );
    expect(workspaceFromMock).toHaveBeenCalledWith("workspaces");
    expect(workspaceUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        subscription_status: "active",
        subscription_plan: "starter",
        stripe_customer_id: "cus_123",
        stripe_subscription_id: "sub_123",
      })
    );
    expect(completeWebhookEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        receiptId: "receipt_1",
        status: "processed",
        eventType: "checkout.session.completed",
      })
    );
    expect(logBillingEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "webhook_billing_updated",
        payload: expect.objectContaining({
          provider: "stripe",
          providerEventId: "evt_123",
          verificationMode: "stripe_signature",
        }),
      })
    );
  });

  it("short-circuits duplicate verified stripe events with 200 duplicate response", async () => {
    verifyStripeWebhookSignatureMock.mockResolvedValue({
      ok: true,
      event: {
        id: "evt_dup",
        type: "checkout.session.completed",
        data: { object: {} },
      },
    });
    claimWebhookEventMock.mockResolvedValue({ accepted: false, receiptId: "receipt_existing" });

    const response = await postWebhook(
      jsonRequest(
        {
          object: "event",
          id: "evt_dup",
        },
        {
          "stripe-signature": "t=123,v1=test",
        }
      )
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, duplicate: true });
    expect(workspaceFromMock).not.toHaveBeenCalled();
    expect(completeWebhookEventMock).not.toHaveBeenCalled();
    expect(logBillingEventMock).not.toHaveBeenCalled();
  });

  it("short-circuits duplicate legacy events with 200 duplicate response", async () => {
    claimWebhookEventMock.mockResolvedValue({ accepted: false, receiptId: "receipt_existing" });

    const response = await postWebhook(
      jsonRequest(
        {
          workspaceId: "11111111-1111-4111-8111-111111111111",
          subscriptionStatus: "active",
          eventType: "legacy.workspace_billing_updated",
          eventId: "legacy_evt_1",
        },
        {
          "x-openplan-billing-secret": "legacy-secret",
        }
      )
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, duplicate: true });

    expect(createServiceRoleClientMock).not.toHaveBeenCalled();
    expect(completeWebhookEventMock).not.toHaveBeenCalled();
    expect(logBillingEventMock).not.toHaveBeenCalled();
  });
});
