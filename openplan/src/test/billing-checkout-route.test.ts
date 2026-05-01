import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const createApiAuditLoggerMock = vi.fn();

const mockAudit = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: (...args: unknown[]) => createApiAuditLoggerMock(...args),
}));

import { GET as getCheckout, POST as postCheckout } from "@/app/api/billing/checkout/route";

function jsonRequest(payload: unknown) {
  return new NextRequest("http://localhost/api/billing/checkout", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

describe("/api/billing/checkout fit-review routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createApiAuditLoggerMock.mockReturnValue(mockAudit);
  });

  it("rejects GET so checkout cannot be launched from a link prefetch", async () => {
    const response = await getCheckout();

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
    expect(await response.json()).toMatchObject({ error: "Use POST to initialize billing checkout." });
  });

  it("routes legacy OpenPlan plan requests to fit-review intake without Stripe or workspace writes", async () => {
    const response = await postCheckout(
      jsonRequest({
        plan: "professional",
      }),
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toMatchObject({
      checkoutUrl: expect.stringContaining("/contact/openplan-fit?"),
      intakeUrl: expect.stringContaining("/contact/openplan-fit?"),
      mode: "fit_review_redirect",
      product: "openplan",
      tier: "professional",
      checkoutDisabled: true,
    });
    expect(payload.intakeUrl).toContain("product=openplan");
    expect(payload.intakeUrl).toContain("tier=professional");
    expect(payload.intakeUrl).toContain("checkout=disabled");
    expect(payload.intakeUrl).toContain("legacyCheckout=1");
    expect(mockAudit.info).toHaveBeenCalledWith(
      "openplan_checkout_disabled_redirect",
      expect.objectContaining({
        product: "openplan",
        tier: "professional",
        mode: "fit_review_redirect",
      }),
    );
  });

  it("normalizes old prelaunch tier references for intake", async () => {
    const response = await postCheckout(
      jsonRequest({
        product: "openplan",
        tier: "openplan-starter-prelaunch",
      }),
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.tier).toBe("starter");
    expect(payload.intakeUrl).toContain("tier=openplan-starter-prelaunch");
  });

  it("rejects unsupported non-OpenPlan products in this checkout lane", async () => {
    const response = await postCheckout(
      jsonRequest({
        product: "other-product",
        tier: "starter",
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "Unsupported checkout product" });
  });
});
