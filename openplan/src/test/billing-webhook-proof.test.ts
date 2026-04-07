import { describe, expect, it } from "vitest";
import { summarizeWebhookProof } from "@/lib/billing/webhook-proof";

describe("summarizeWebhookProof", () => {
  it("passes when stripe events, receipts, billing events, and workspace state align", () => {
    const summary = summarizeWebhookProof({
      workspaceId: "11111111-1111-4111-8111-111111111111",
      workspace: {
        id: "11111111-1111-4111-8111-111111111111",
        name: "QA Canary",
        subscriptionStatus: "active",
        subscriptionPlan: "starter",
      },
      stripeEvents: [
        {
          id: "evt_1",
          type: "checkout.session.completed",
          created: 1712440000,
          workspaceId: "11111111-1111-4111-8111-111111111111",
        },
      ],
      billingEvents: [
        {
          eventType: "webhook_billing_updated",
          createdAt: "2026-04-06T23:00:00.000Z",
        },
      ],
      webhookReceipts: [
        {
          eventId: "evt_1",
          eventType: "checkout.session.completed",
          status: "processed",
          createdAt: "2026-04-06T23:00:00.000Z",
          processedAt: "2026-04-06T23:00:05.000Z",
        },
      ],
    });

    expect(summary.status).toBe("pass");
    expect(summary.blockers).toEqual([]);
    expect(summary.checks.every((check) => check.ok)).toBe(true);
  });

  it("blocks when stripe events exist without processed receipts and workspace stays pending", () => {
    const summary = summarizeWebhookProof({
      workspaceId: "11111111-1111-4111-8111-111111111111",
      workspace: {
        id: "11111111-1111-4111-8111-111111111111",
        name: "QA Canary",
        subscriptionStatus: "checkout_pending",
        subscriptionPlan: "starter",
      },
      stripeEvents: [
        {
          id: "evt_missing",
          type: "checkout.session.completed",
          created: 1712440000,
          workspaceId: "11111111-1111-4111-8111-111111111111",
        },
      ],
      billingEvents: [],
      webhookReceipts: [],
    });

    expect(summary.status).toBe("blocked");
    expect(summary.blockers.join(" ")).toContain("no processed billing_webhook_receipts row");
    expect(summary.blockers.join(" ")).toContain("checkout_pending");
    expect(summary.nextActions.join(" ")).toContain("Verify the Stripe webhook endpoint URL");
  });

  it("blocks when no stripe events were observed yet", () => {
    const summary = summarizeWebhookProof({
      workspaceId: "11111111-1111-4111-8111-111111111111",
      workspace: {
        id: "11111111-1111-4111-8111-111111111111",
        name: "QA Canary",
        subscriptionStatus: "inactive",
        subscriptionPlan: "starter",
      },
      stripeEvents: [],
      billingEvents: [],
      webhookReceipts: [],
    });

    expect(summary.status).toBe("blocked");
    expect(summary.blockers[0]).toContain("No recent Stripe billing events matched this workspace");
    expect(summary.nextActions[0]).toContain("Run or re-run the supervised checkout canary");
  });
});
