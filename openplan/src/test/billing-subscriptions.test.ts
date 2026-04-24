import { describe, expect, it, vi } from "vitest";
import {
  applyBillingSubscriptionMutation,
  loadWorkspaceSubscriptionSnapshot,
} from "@/lib/billing/subscriptions";

function createApplyClient(params?: {
  upsertError?: { message: string; code?: string | null } | null;
  updateError?: { message: string; code?: string | null } | null;
}) {
  const upsertMock = vi.fn(async () => ({ error: params?.upsertError ?? null }));
  const updateEqMock = vi.fn(async () => ({ error: params?.updateError ?? null }));
  const updateMock = vi.fn(() => ({ eq: updateEqMock }));

  return {
    client: {
      from: vi.fn((table: string) => {
        if (table === "subscriptions") return { upsert: upsertMock };
        if (table === "workspaces") return { update: updateMock };
        throw new Error(`Unexpected table: ${table}`);
      }),
    },
    upsertMock,
    updateMock,
    updateEqMock,
  };
}

describe("billing subscription ledger helpers", () => {
  it("upserts the normalized subscription and syncs the workspace snapshot", async () => {
    const { client, upsertMock, updateMock, updateEqMock } = createApplyClient();

    await expect(
      applyBillingSubscriptionMutation(
        client as never,
        {
          workspaceId: "workspace-1",
          subscriptionPlan: "professional",
          subscriptionStatus: "active",
          stripeCustomerId: "cus_123",
          stripeSubscriptionId: "sub_123",
          currentPeriodEnd: "2026-05-01T00:00:00.000Z",
        },
        new Date("2026-04-24T04:00:00.000Z")
      )
    ).resolves.toEqual({ error: null, ledgerMissing: false });

    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workspace_id: "workspace-1",
        plan: "professional",
        status: "active",
        stripe_customer_id: "cus_123",
        stripe_subscription_id: "sub_123",
        current_period_end: "2026-05-01T00:00:00.000Z",
      }),
      { onConflict: "workspace_id" }
    );
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        plan: "professional",
        subscription_plan: "professional",
        subscription_status: "active",
        billing_updated_at: "2026-04-24T04:00:00.000Z",
      })
    );
    expect(updateEqMock).toHaveBeenCalledWith("id", "workspace-1");
  });

  it("keeps checkout/webhook writes migration-tolerant when the ledger table is pending", async () => {
    const { client, updateEqMock } = createApplyClient({
      upsertError: { message: 'relation "subscriptions" does not exist', code: "42P01" },
    });

    await expect(
      applyBillingSubscriptionMutation(client as never, {
        workspaceId: "workspace-1",
        subscriptionPlan: "starter",
        subscriptionStatus: "checkout_pending",
      })
    ).resolves.toEqual({ error: null, ledgerMissing: true });

    expect(updateEqMock).toHaveBeenCalledWith("id", "workspace-1");
  });

  it("loads a normalized subscription snapshot", async () => {
    const maybeSingleMock = vi.fn(async () => ({
      data: {
        workspace_id: "workspace-1",
        plan: "starter",
        status: "active",
        stripe_customer_id: "cus_123",
        stripe_subscription_id: "sub_123",
        current_period_start: "2026-04-01T00:00:00.000Z",
        current_period_end: "2026-05-01T00:00:00.000Z",
        quota_buckets: { runs: { limit: 100 } },
        updated_at: "2026-04-24T04:00:00.000Z",
      },
      error: null,
    }));
    const eqMock = vi.fn(() => ({ maybeSingle: maybeSingleMock }));
    const selectMock = vi.fn(() => ({ eq: eqMock }));
    const client = {
      from: vi.fn((table: string) => {
        if (table === "subscriptions") return { select: selectMock };
        throw new Error(`Unexpected table: ${table}`);
      }),
    };

    const result = await loadWorkspaceSubscriptionSnapshot(client as never, "workspace-1");

    expect(result.error).toBeNull();
    expect(result.subscription).toMatchObject({
      workspaceId: "workspace-1",
      plan: "starter",
      status: "active",
      stripeCustomerId: "cus_123",
      source: "subscriptions",
    });
  });
});
