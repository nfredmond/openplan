import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BillingCheckoutLauncher } from "@/components/billing/billing-checkout-launcher";

describe("BillingCheckoutLauncher", () => {
  const fetchMock = vi.fn();
  const assignMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    assignMock.mockReset();
    vi.restoreAllMocks();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("posts the selected workspace and plan before redirecting to Stripe", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ checkoutUrl: "https://checkout.stripe.com/c/pay/cs_test_123" }),
    });

    render(
      <BillingCheckoutLauncher
        workspaceId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
        workspaceName="Nevada County Pilot"
        currentPlan="pilot"
        currentStatus="pilot"
        currentPeriodEnd={null}
        canStartCheckout
        onCheckoutRedirect={assignMock}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Start Starter checkout for Nevada County Pilot" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/billing/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          plan: "starter",
        }),
      });
    });

    await waitFor(() => {
      expect(assignMock).toHaveBeenCalledWith("https://checkout.stripe.com/c/pay/cs_test_123");
    });
  });

  it("surfaces API errors inline instead of silently failing", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Owner/admin access is required" }),
    });

    render(
      <BillingCheckoutLauncher
        workspaceId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
        workspaceName="Nevada County Pilot"
        currentPlan="pilot"
        currentStatus="pilot"
        currentPeriodEnd={null}
        canStartCheckout
        onCheckoutRedirect={assignMock}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Start Professional checkout for Nevada County Pilot" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Owner/admin access is required");
    expect(assignMock).not.toHaveBeenCalled();
  });

  it("shows read-only guidance when the member role cannot launch checkout", () => {
    render(
      <BillingCheckoutLauncher
        workspaceId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
        workspaceName="Nevada County Pilot"
        currentPlan="starter"
        currentStatus="active"
        currentPeriodEnd="2026-04-30T00:00:00.000Z"
        canStartCheckout={false}
        onCheckoutRedirect={assignMock}
      />
    );

    expect(screen.getByText(/Members can review billing posture/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Start Starter checkout/i })).not.toBeInTheDocument();
  });

  it("surfaces the locked workspace target in the safeguard copy", () => {
    render(
      <BillingCheckoutLauncher
        workspaceId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
        workspaceName="Nevada County Pilot"
        currentPlan="starter"
        currentStatus="active"
        currentPeriodEnd="2026-04-30T00:00:00.000Z"
        canStartCheckout
        onCheckoutRedirect={assignMock}
      />
    );

    expect(screen.getByText(/Checkout target is locked before Stripe opens/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Nevada County Pilot/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/aaaaaaaa/).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /Start Starter checkout for Nevada County Pilot/i })).toBeInTheDocument();
  });
});
