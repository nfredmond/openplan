import { describe, expect, it } from "vitest";

import { resolveBillingSupportState } from "@/lib/billing/support";

describe("resolveBillingSupportState", () => {
  it("warns when Stripe returned but no webhook-backed activation evidence is visible yet", () => {
    const state = resolveBillingSupportState({
      status: "checkout_pending",
      checkoutState: "success",
      billingUpdatedAt: "2026-04-06T23:40:00.000Z",
      events: [
        {
          eventType: "checkout_initialized",
          createdAt: "2026-04-06T23:39:00.000Z",
        },
      ],
    });

    expect(state).toMatchObject({
      tone: "warning",
      title: "Stripe returned, but OpenPlan has not confirmed activation yet",
    });
    expect(state?.bullets.join(" ")).toMatch(/Most recent checkout initialization/i);
    expect(state?.bullets.join(" ")).toMatch(/capture the workspace ID, the purchaser email/i);
  });

  it("shows generic pending guidance when checkout is still unresolved", () => {
    const state = resolveBillingSupportState({
      status: "checkout_pending",
      billingUpdatedAt: "2026-04-06T23:45:00.000Z",
      events: [
        {
          eventType: "checkout_initialized",
          createdAt: "2026-04-06T23:44:00.000Z",
        },
        {
          eventType: "billing_update_blocked_pending_identity_review",
          createdAt: "2026-04-06T23:46:00.000Z",
        },
      ],
    });

    expect(state).toMatchObject({
      tone: "info",
      title: "Checkout is pending workspace activation",
    });
    expect(state?.bullets.some((bullet) => /blocked pending review/i.test(bullet))).toBe(true);
  });

  it("warns on inactive-style statuses without pretending billing is active", () => {
    const state = resolveBillingSupportState({
      status: "past_due",
      billingUpdatedAt: "2026-04-06T22:00:00.000Z",
      events: [],
    });

    expect(state).toMatchObject({
      tone: "warning",
      title: "Workspace billing is not in an active state",
    });
    expect(state?.summary).toMatch(/should not be treated as active/i);
  });

  it("returns null for healthy active subscriptions", () => {
    expect(
      resolveBillingSupportState({
        status: "active",
        checkoutState: null,
        billingUpdatedAt: "2026-04-06T22:00:00.000Z",
        events: [
          {
            eventType: "webhook_billing_updated",
            createdAt: "2026-04-06T22:01:00.000Z",
          },
        ],
      })
    ).toBeNull();
  });
});
